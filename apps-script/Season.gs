/**
 * 2027 sponsor banner intake. Lives next to Code.gs in the same Apps Script
 * project (add it with Files → + → Script, name it "Season").
 *
 * THE PROBLEM IT SOLVES
 *
 * Banner-level sponsors ($500 and up: MVP, Championship, Championship+) reach
 * LYBS three ways, and only one of them used to tell anyone:
 *   1. the Crossbar sponsorship form on lunenburgybs.com
 *   2. a payment on lunenburgybs.com/donate with no form at all
 *   3. an email or a check, which a board member logs on the 2027 sponsorship sheet
 *
 * scanForNewSponsors() runs every hour (installSeasonTrigger sets that up) and
 * looks in all three places. Every new banner-level sponsor it finds:
 *   - becomes a row on the "2027 Banners" tab of the private data Sheet,
 *     which the app's 2027 tab shows (assign a banner from stock, or mark one
 *     to order)
 *   - is listed in one summary email to Nate
 *   - gets the "send us your banner and sponsor info" email, as a Gmail
 *     draft or sent straight away (REQUEST_MODE below), with a personal link
 *     to intake.html, the reply form with the drop-downs and file uploads.
 *
 * When a sponsor sends that form, their files land in a Drive folder, their
 * answers land on their row, and Nate gets an email saying so.
 *
 * Nothing here reads or writes Nate's mail beyond: searching the league's own
 * "Donation received from" notifications, labelling the ones it has read, and
 * the drafts/emails described above.
 */

var SEASON = '2027';
var SEASON_SHEET_NAME = SEASON + ' Banners';

// The 2027 sponsorship sheet the sponsorship lead keeps (read only from here).
var SPONSOR_SHEET_ID = '1LeyNi8HffeWdC2j6ayEyHjFQMa5JKDmUGh9-FuPiEIg';
var SPONSOR_TAB = '2027 sponsors';
var ONLINE_TAB = 'OnlineLogs';

// Same rule as that sheet's own "Owed a Banner" column (=Amount>=500).
var BANNER_MIN_AMOUNT = 500;
var TIER_AMOUNTS = { 'MVP': 500, 'Championship': 750, 'Championship+': 1000 };

// What the sponsor email says and links to.
var INFO_DEADLINE = 'March 20';
var APP_URL = 'https://natesteele888.github.io/sponsor-banner-inventory/';
var INTAKE_URL = APP_URL + 'intake.html';
var LEAGUE_CC = 'info@lunenburgybs.com';
var SIGNATURE_NAME = 'Nate Steele';
var SIGNATURE_TITLE = 'Director & IT/Social Media Coordinator';

// 'draft' (default): the sponsor email waits in Gmail Drafts for Nate to press Send.
// 'send': it goes out on its own. Change with setRequestMode('send') in the editor.
function requestMode_() {
  return PropertiesService.getScriptProperties().getProperty('REQUEST_MODE') || 'draft';
}
function setRequestMode(mode) {
  if (['draft', 'send'].indexOf(mode) < 0) throw new Error('Use draft or send.');
  PropertiesService.getScriptProperties().setProperty('REQUEST_MODE', mode);
  console.log('Sponsor emails will now be: ' + mode);
}

// Gmail label put on donation notices once they have been read.
var SEEN_LABEL = 'LYBS banner intake seen';
var SEEN_LABEL_SEARCH = 'lybs-banner-intake-seen';
// Website payments from before the 2027 drive started don't count.
var DONATIONS_SINCE = '2026/10/01';

var SEASON_COLUMNS = ['key', 'company', 'tier', 'amount', 'source',
  'contactName', 'contactEmail', 'contactPhone',
  'requestStatus', 'requestAt', 'token', 'submittedAt',
  'website', 'jerseyName', 'writeup', 'bannerChoice', 'bannerText', 'fileLink', 'fileFolderId',
  'bannerStatus', 'assignedBannerId', 'notes', 'addedAt', 'updatedAt'];

var BANNER_STATUSES = ['Not decided', 'Use banner from stock', 'Reprint needed', 'Order new', 'Ordered', 'Ready to hang'];


// ---------- one-time setup (run from the editor) ----------

// Runs the scan every hour. Run once; running it again just replaces the trigger.
function installSeasonTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scanForNewSponsors') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanForNewSponsors').timeBased().everyHours(1).create();
  console.log('Hourly sponsor scan is on. Sponsor emails are: ' + requestMode_());
}

function removeSeasonTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scanForNewSponsors') ScriptApp.deleteTrigger(t);
  });
  console.log('Hourly sponsor scan is off.');
}


// ---------- the season sheet ----------

function seasonSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SEASON_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SEASON_SHEET_NAME);
    sh.getRange(1, 1, 1, SEASON_COLUMNS.length).setValues([SEASON_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSeason_() {
  var sh = seasonSheet_();
  var values = sh.getDataRange().getValues();
  var header = values[0];
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    header.forEach(function (h, i) { o[h] = values[r][i]; });
    if (o.company || o.key) rows.push(o);
  }
  return { sheet: sh, header: header, rows: rows };
}

function writeFields_(sheet, header, rowNum, fields) {
  Object.keys(fields).forEach(function (col) {
    var c = header.indexOf(col);
    if (c >= 0) sheet.getRange(rowNum, c + 1).setValue(fields[col]);
  });
  var u = header.indexOf('updatedAt');
  if (u >= 0) sheet.getRange(rowNum, u + 1).setValue(todayStamp());
}

// "Black Bear Coating & Concrete, Inc." and "black bear coating and concrete"
// are the same sponsor.
function companyKey_(s) {
  return String(s || '').toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\b(inc|llc|co|corp|company|pc|p\.c|the|ltd)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

function nameKey_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function parseAmount_(v) {
  if (typeof v === 'number') return v;
  var m = String(v || '').replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function tierFromText_(t) {
  var s = String(t || '').toLowerCase().replace(/\s+/g, '');
  if (s.indexOf('championship+') >= 0 || s.indexOf('championshipplus') >= 0) return 'Championship+';
  if (s.indexOf('championship') >= 0) return 'Championship';
  if (s.indexOf('mvp') >= 0) return 'MVP';
  if (s.indexOf('all-star') >= 0 || s.indexOf('allstar') >= 0) return 'All-Star';
  if (s.indexOf('gameday') >= 0) return 'Gameday';
  return '';
}

function tierFromAmount_(a) {
  if (a >= 1000) return 'Championship+';
  if (a >= 750) return 'Championship';
  if (a >= 500) return 'MVP';
  return '';
}

function money_(a) {
  return a ? '$' + Number(a).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
}

function firstEmail_(s) {
  var m = String(s || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : '';
}

/**
 * Adds a sponsor, or fills in blanks on the row it already has. Never
 * overwrites what's already there: Nate's edits in the app win.
 * Returns { rec, isNew }.
 */
function upsertSponsor_(season, cand) {
  var key = companyKey_(cand.company);
  if (!key) return null;
  var hit = null;
  season.rows.forEach(function (r) { if (r.key === key) hit = r; });
  if (hit) {
    var fill = {};
    ['tier', 'amount', 'contactName', 'contactEmail', 'contactPhone'].forEach(function (k) {
      if (!hit[k] && cand[k]) { fill[k] = clean(cand[k], 300); hit[k] = fill[k]; }
    });
    if (cand.source && String(hit.source).indexOf(cand.source) < 0) {
      fill.source = hit.source ? hit.source + ' + ' + cand.source : cand.source;
      hit.source = fill.source;
    }
    if (Object.keys(fill).length) writeFields_(season.sheet, season.header, hit._row, fill);
    return { rec: hit, isNew: false };
  }
  var rec = {};
  SEASON_COLUMNS.forEach(function (c) { rec[c] = ''; });
  rec.key = key;
  rec.company = clean(cand.company, 300);
  rec.tier = clean(cand.tier, 50);
  rec.amount = clean(cand.amount, 50);
  rec.source = clean(cand.source, 100);
  rec.contactName = clean(cand.contactName, 300);
  rec.contactEmail = clean(cand.contactEmail, 300);
  rec.contactPhone = clean(cand.contactPhone, 100);
  rec.notes = clean(cand.notes, 2000);
  rec.bannerStatus = 'Not decided';
  rec.token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  rec.addedAt = todayStamp();
  rec.updatedAt = todayStamp();
  var row = season.header.map(function (h) { return rec[h] !== undefined ? rec[h] : ''; });
  season.sheet.appendRow(row);
  rec._row = season.sheet.getLastRow();
  season.rows.push(rec);
  return { rec: rec, isNew: true };
}


// ---------- finding sponsors ----------

function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  var header = v[0].map(function (h) { return String(h).trim(); });
  return v.slice(1).map(function (row) {
    var o = {};
    header.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

// Banner-level rows on the sponsorship sheet: anyone a board member has logged,
// however they came in (form, website payment, email or check).
function fromSponsorSheet_(ss) {
  return readTab_(ss, SPONSOR_TAB).map(function (r) {
    var amount = parseAmount_(r['Amount']);
    var tier = tierFromText_(r['Tier Selected 2027']) || tierFromAmount_(amount);
    if (amount < BANNER_MIN_AMOUNT && !TIER_AMOUNTS[tier]) return null;
    if (!String(r['Company'] || '').trim()) return null;
    return {
      company: String(r['Company']).trim(),
      tier: tier,
      amount: money_(amount || TIER_AMOUNTS[tier]),
      contactName: String(r['Contact'] || '').trim(),
      contactEmail: firstEmail_(r['Email']),
      contactPhone: String(r['Phone'] || '').trim(),
      source: 'Sponsorship sheet'
    };
  }).filter(Boolean);
}

// The website sponsorship form's submissions, as logged on the OnlineLogs tab.
function fromOnlineLogs_(ss) {
  return readTab_(ss, ONLINE_TAB).map(function (r) {
    var company = String(r['Business Name/Sponsor Name'] || '').trim();
    var levelText = String(r['Sponsorship Level'] || r['Submitted'] || '');
    var tier = tierFromText_(levelText) || tierFromAmount_(parseAmount_(levelText));
    if (!company || !TIER_AMOUNTS[tier]) return null;
    var name = String(r['Contact Name'] || '').trim() ||
      [r['First'], r['Last']].filter(Boolean).join(' ').trim();
    return {
      company: company,
      tier: tier,
      amount: money_(TIER_AMOUNTS[tier]),
      contactName: name,
      contactEmail: firstEmail_(r['Email Address']) || firstEmail_(r['Email']),
      source: 'Website form'
    };
  }).filter(Boolean);
}

/**
 * Website payments with no form: Crossbar emails "Your club has received a
 * $750.00 donation from Jason Camerano." That's a person, not a company, so it
 * is matched against contact names on the sponsorship sheet. No match means
 * the row is marked "Needs a match" and gets no sponsor email until Nate
 * fills in who it is (a $500 gift could be a family's donation, not a sponsor).
 */
function fromDonationEmails_(ss) {
  var label = GmailApp.getUserLabelByName(SEEN_LABEL) || GmailApp.createLabel(SEEN_LABEL);
  var threads = GmailApp.search('from:notifications@lunenburgybs.com subject:"Donation received from" after:' +
    DONATIONS_SINCE + ' -label:' + SEEN_LABEL_SEARCH, 0, 50);
  var people = readTab_(ss, SPONSOR_TAB);
  var out = [];
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      var text = m.getPlainBody() || '';
      var hit = text.match(/received a \$([\d,]+(?:\.\d+)?) donation from ([^\.\n]+)/i);
      if (!hit) return;
      var amount = parseAmount_(hit[1]);
      var donor = hit[2].trim();
      if (amount < BANNER_MIN_AMOUNT) return;
      var match = null;
      people.forEach(function (p) {
        var c = nameKey_(p['Contact']);
        if (c && (c === nameKey_(donor) || (c.length > 4 && nameKey_(donor).indexOf(c) >= 0))) match = p;
      });
      // Same last name and the same amount as a logged sponsor: one family, one
      // sponsorship (a spouse often pays for the business).
      if (!match) {
        var last = nameKey_(donor).split(' ').pop();
        people.forEach(function (p) {
          var pl = nameKey_(p['Contact']).split(' ').pop();
          if (!match && last && pl === last && parseAmount_(p['Amount']) === amount) match = p;
        });
      }
      var when = Utilities.formatDate(m.getDate(), Session.getScriptTimeZone(), 'MMM d');
      if (match && String(match['Company'] || '').trim()) {
        out.push({
          company: String(match['Company']).trim(),
          tier: tierFromAmount_(amount),
          amount: money_(amount),
          contactName: donor,
          contactEmail: firstEmail_(match['Email']),
          contactPhone: String(match['Phone'] || '').trim(),
          source: 'Website payment'
        });
      } else {
        out.push({
          company: 'Needs a match: ' + donor,
          tier: tierFromAmount_(amount),
          amount: money_(amount),
          contactName: donor,
          source: 'Website payment',
          notes: 'Paid ' + money_(amount) + ' on the website on ' + when +
            ' with no sponsorship form. Not matched to a company on the sponsorship sheet. ' +
            'Fill in the company and email, then make the sponsor email.'
        });
      }
    });
    t.addLabel(label);
  });
  return out;
}

/**
 * The hourly job. Safe to run by hand too ("Check for new sponsors" in the app).
 * Returns how many new sponsors it added.
 */
function scanForNewSponsors() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    var ss = SpreadsheetApp.openById(SPONSOR_SHEET_ID);
    var season = readSeason_();
    var cands = [];
    try { cands = cands.concat(fromSponsorSheet_(ss)); } catch (e) { console.log('sponsor tab: ' + e); }
    try { cands = cands.concat(fromOnlineLogs_(ss)); } catch (e) { console.log('online logs: ' + e); }
    try { cands = cands.concat(fromDonationEmails_(ss)); } catch (e) { console.log('donations: ' + e); }

    var added = [];
    cands.forEach(function (c) {
      var res = upsertSponsor_(season, c);
      if (res && res.isNew) added.push(res.rec);
    });

    // A sponsor with an email and no request yet gets one.
    var requested = [];
    season.rows.forEach(function (r) {
      if (!r.requestStatus && r.contactEmail && String(r.company).indexOf('Needs a match') !== 0) {
        try { prepareRequest_(season, r, requestMode_()); requested.push(r); }
        catch (e) { console.log('request email for row ' + r._row + ': ' + e); }
      }
    });

    if (added.length) notifyNewSponsors_(added, requested);
    return added.length;
  } finally {
    lock.releaseLock();
  }
}


// ---------- emails ----------

function intakeLink_(rec) {
  return INTAKE_URL + '?t=' + encodeURIComponent(rec.token);
}

function firstName_(full) {
  var s = String(full || '').replace(/^(manager|owner)\s*:\s*/i, '').trim();
  return s.split(/[\s\/]+/)[0] || '';
}

/**
 * The sponsor email. Variables: first name, company, tier, amount, the
 * personal form link and the deadline. Wording follows the 2026 "Sponsorship
 * Info Request" email Nate sent by hand.
 */
function buildRequestEmail_(rec) {
  var first = firstName_(rec.contactName);
  var hi = first ? 'Hi ' + first + ',' : 'Hi there,';
  var tier = rec.tier || 'banner';
  var link = intakeLink_(rec);
  var subject = 'LYBS ' + SEASON + ' sponsorship: your banner and sponsor info';
  var text = [
    hi,
    '',
    'Thank you so much for sponsoring Lunenburg Youth Baseball & Softball at the ' + tier + ' level' +
      (rec.amount ? ' (' + rec.amount + ')' : '') + ' for ' + SEASON + '. We are excited to have ' + rec.company + "'s support!",
    '',
    'To make sure you are properly recognized, please fill out this short form by ' + INFO_DEADLINE + ':',
    link,
    '',
    'It asks for:',
    '- The website or social link for your sponsor listing',
    '- Your business name as it should appear on the team jersey',
    '- A short write-up about your business (up to 200 characters) for our website',
    '- A high resolution logo (PNG, SVG, AI, EPS, PDF or JPG)',
    '- Your 3x5 vinyl banner for the fence at Marshall Park: reuse last season\'s, send a print-ready design, or we can design one with your logo',
    '',
    'If the form gives you any trouble, just reply to this email with the same info and attach your files.',
    '',
    'Thank you again!',
    '',
    SIGNATURE_NAME,
    SIGNATURE_TITLE,
    'Lunenburg Youth Baseball & Softball'
  ].join('\n');

  var e = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var li = function (s) { return '<li style="margin-bottom:4px">' + s + '</li>'; };
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">' +
    '<p>' + e(hi) + '</p>' +
    '<p>Thank you so much for sponsoring Lunenburg Youth Baseball &amp; Softball at the <b>' + e(tier) + '</b> level' +
      (rec.amount ? ' (' + e(rec.amount) + ')' : '') + ' for ' + SEASON + '. We are excited to have ' + e(rec.company) + '&#39;s support!</p>' +
    '<p>To make sure you are properly recognized, please fill out this short form by <b>' + e(INFO_DEADLINE) + '</b>:</p>' +
    '<p style="margin:22px 0"><a href="' + e(link) + '" style="background:#0a1628;color:#ffffff;text-decoration:none;' +
      'padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">Send us your banner &amp; sponsor info</a></p>' +
    '<p style="margin-bottom:6px">It asks for:</p><ul style="margin-top:0;padding-left:20px">' +
      li('The website or social link for your sponsor listing') +
      li('Your business name as it should appear on the team jersey') +
      li('A short write-up about your business (up to 200 characters) for our website') +
      li('A high resolution logo (PNG, SVG, AI, EPS, PDF or JPG)') +
      li('Your 3x5 vinyl banner for the fence at Marshall Park: reuse last season&#39;s, send a print-ready design, or we can design one with your logo') +
    '</ul>' +
    '<p>If the button gives you any trouble, just reply to this email with the same info and attach your files.</p>' +
    '<p>Thank you again!</p>' +
    '<p>' + e(SIGNATURE_NAME) + '<br>' + e(SIGNATURE_TITLE) + '<br>Lunenburg Youth Baseball &amp; Softball</p>' +
    '</div>';
  return { subject: subject, text: text, html: html };
}

// mode 'draft' leaves it in Gmail Drafts; 'send' sends it.
function prepareRequest_(season, rec, mode) {
  var to = firstEmail_(rec.contactEmail);
  if (!to) throw new Error('No email address on this sponsor yet.');
  if (!rec.token) {
    rec.token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    writeFields_(season.sheet, season.header, rec._row, { token: rec.token });
  }
  var mail = buildRequestEmail_(rec);
  var opts = { htmlBody: mail.html, name: SIGNATURE_NAME, cc: LEAGUE_CC };
  if (mode === 'send') {
    GmailApp.sendEmail(to, mail.subject, mail.text, opts);
    rec.requestStatus = 'Sent';
  } else {
    GmailApp.createDraft(to, mail.subject, mail.text, opts);
    rec.requestStatus = 'Draft in Gmail';
  }
  rec.requestAt = todayStamp();
  writeFields_(season.sheet, season.header, rec._row, { requestStatus: rec.requestStatus, requestAt: rec.requestAt });
}

function myEmail_() {
  return Session.getEffectiveUser().getEmail();
}

function notifyNewSponsors_(added, requested) {
  var lines = added.map(function (r) {
    var what = String(r.company).indexOf('Needs a match') === 0
      ? ' (website payment, not matched to a company yet)'
      : (requested.indexOf(r) >= 0
          ? (r.requestStatus === 'Sent' ? ', info email sent' : ', info email waiting in Drafts')
          : (r.contactEmail ? '' : ', no email on file yet'));
    return '- ' + r.company + ': ' + (r.tier || '?') + ' ' + (r.amount || '') + ' via ' + r.source + what;
  });
  var body = 'New ' + SEASON + ' banner sponsors:\n\n' + lines.join('\n') +
    '\n\nThey are on the ' + SEASON + ' tab of Sponsor Banners, where you can assign a banner from stock or mark one to order:\n' + APP_URL;
  GmailApp.sendEmail(myEmail_(), 'New ' + SEASON + ' banner sponsor' + (added.length > 1 ? 's' : '') + ' (' + added.length + ')', body,
    { name: 'LYBS Sponsor Banners' });
}


// ---------- signed-in actions (the app's 2027 tab) ----------

function seasonList() {
  var season = readSeason_();
  var rows = season.rows.map(function (r) {
    var o = {};
    SEASON_COLUMNS.forEach(function (c) { o[c] = r[c] === undefined ? '' : String(r[c]); });
    o.row = r._row;
    o.intakeLink = r.token ? intakeLink_(r) : '';
    delete o.token;
    return o;
  });
  return { season: SEASON, rows: rows, statuses: BANNER_STATUSES, requestMode: requestMode_() };
}

// Rows are found by their company key, not their row number, so a row
// deleted by hand in Sheets can't make an edit land on the wrong sponsor.
function findSeasonRow_(season, key) {
  var hit = null;
  season.rows.forEach(function (r) { if (key && String(r.key) === String(key)) hit = r; });
  return hit;
}

function seasonUpdate(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var season = readSeason_();
  var rec = findSeasonRow_(season, data.key);
  if (!rec) return fail('That sponsor is no longer on the list.');
  var editable = ['company', 'tier', 'amount', 'contactName', 'contactEmail', 'contactPhone',
                  'bannerStatus', 'assignedBannerId', 'notes', 'requestStatus'];
  var fields = {};
  editable.forEach(function (k) {
    if (k in data) fields[k] = clean(data[k], k === 'notes' ? 2000 : 300);
  });
  if (fields.company) {
    fields.key = companyKey_(fields.company);
    var clash = findSeasonRow_(season, fields.key);
    if (clash && clash !== rec) return fail(clash.company + ' is already on the list. Edit that one instead.');
  }
  writeFields_(season.sheet, season.header, rec._row, fields);
  return ok({ message: 'Saved.' });
}

// For a sponsor who emailed or mailed a check and isn't on the sheet yet.
function seasonAdd(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var company = clean(data.company, 300);
  if (!company) return fail('Company name is required.');
  var tier = tierFromText_(data.tier) || tierFromAmount_(parseAmount_(data.amount));
  var season = readSeason_();
  var res = upsertSponsor_(season, {
    company: company, tier: tier, amount: data.amount ? money_(parseAmount_(data.amount)) : money_(TIER_AMOUNTS[tier]),
    contactName: data.contactName, contactEmail: firstEmail_(data.contactEmail), contactPhone: data.contactPhone,
    source: clean(data.source, 50) || 'Email', notes: data.notes
  });
  if (!res) return fail('Company name is required.');
  if (!res.isNew) return fail(res.rec.company + ' is already on the ' + SEASON + ' list.');
  return ok({ message: 'Added.' });
}

// The app's "Make email draft" / "Send email" button.
function seasonRequest(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var season = readSeason_();
  var rec = findSeasonRow_(season, data.key);
  if (!rec) return fail('That sponsor is no longer on the list.');
  if (!firstEmail_(rec.contactEmail)) return fail('Add an email address for this sponsor first, and save.');
  prepareRequest_(season, rec, data.mode === 'send' ? 'send' : 'draft');
  return ok({ message: rec.requestStatus === 'Sent' ? 'Sent.' : 'Draft is in your Gmail.', requestStatus: rec.requestStatus });
}


// ---------- public: the sponsor reply form (intake.html) ----------

var INTAKE_MAX_FILE = 15 * 1024 * 1024;
var INTAKE_MAX_TOTAL = 30 * 1024 * 1024;
var INTAKE_MAX_FILES = 4;
var INTAKE_FOLDER_NAME = SEASON + ' Sponsor Submissions';

function rowByToken_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  var season = readSeason_();
  var hit = null;
  season.rows.forEach(function (r) { if (String(r.token) === token) hit = r; });
  return hit ? { season: season, rec: hit } : null;
}

// Only what the form needs to greet them. Nothing else on the row leaves.
function intakeGet(data) {
  var found = rowByToken_(data.t);
  if (!found) return fail('This link is not valid. Please reply to the email you got from us instead.');
  var r = found.rec;
  return ok({
    season: SEASON, company: String(r.company), tier: String(r.tier || ''),
    contactName: String(r.contactName || ''), deadline: INFO_DEADLINE,
    alreadySent: !!r.submittedAt
  });
}

function underPublicLimit_(token) {
  var props = PropertiesService.getScriptProperties();
  var now = Date.now(), hour = 60 * 60 * 1000;
  var all = JSON.parse(props.getProperty('intakeTimes') || '[]').filter(function (t) { return now - t.at < hour; });
  var mine = all.filter(function (t) { return t.k === token.slice(0, 8); });
  if (all.length >= 40 || mine.length >= 5) return false;
  all.push({ at: now, k: token.slice(0, 8) });
  props.setProperty('intakeTimes', JSON.stringify(all));
  return true;
}

/**
 * Recognize a file by its first bytes, not by its name. Logos and banner
 * designs come as pictures, PDFs, Illustrator (PDF-based or PostScript), EPS,
 * SVG or Photoshop files. They are only stored in Drive, never served back.
 */
function sniffDesign_(b) {
  if (!b || b.length < 8) return null;
  function u(i) { return b[i] & 0xFF; }
  function str(n) { var s = ''; for (var i = 0; i < Math.min(n, b.length); i++) s += String.fromCharCode(u(i)); return s; }
  var img = sniffImage(b);
  if (img) return { mime: img, ext: img.split('/')[1].replace('jpeg', 'jpg') };
  var head = str(512);
  if (head.indexOf('%PDF') === 0) return { mime: 'application/pdf', ext: 'pdf' };
  if (head.indexOf('%!PS') === 0) return { mime: 'application/postscript', ext: 'eps' };
  if (u(0) === 0xC5 && u(1) === 0xD0 && u(2) === 0xD3 && u(3) === 0xC6) return { mime: 'application/postscript', ext: 'eps' };
  if (head.indexOf('8BPS') === 0) return { mime: 'image/vnd.adobe.photoshop', ext: 'psd' };
  if ((u(0) === 0x49 && u(1) === 0x49 && u(2) === 0x2A) || (u(0) === 0x4D && u(1) === 0x4D && u(3) === 0x2A)) return { mime: 'image/tiff', ext: 'tif' };
  // SVG is text. Stored as plain text so Drive never renders it as a page.
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'text/plain', ext: 'svg' };
  return null;
}

function intakeFolder_(company) {
  var parent = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  var it = parent.getFoldersByName(INTAKE_FOLDER_NAME);
  var top = it.hasNext() ? it.next() : parent.createFolder(INTAKE_FOLDER_NAME);
  var name = String(company).replace(/[^A-Za-z0-9 &'.\-]+/g, ' ').trim().slice(0, 80) || 'Sponsor';
  var sub = top.getFoldersByName(name);
  return sub.hasNext() ? sub.next() : top.createFolder(name);
}

function intakeSubmit(data) {
  var token = String(data.t || '');
  var found = rowByToken_(token);
  if (!found) return fail('This link is not valid. Please reply to the email you got from us instead.');
  if (!underPublicLimit_(token)) return fail('Too many tries in the last hour. Please wait a bit, or reply to the email instead.');
  var rec = found.rec, season = found.season;

  var f = data.fields || {};
  var contactName = clean(f.contactName, 200);
  var contactEmail = firstEmail_(f.contactEmail);
  var jerseyName = clean(f.jerseyName, 120);
  var bannerChoice = clean(f.bannerChoice, 80);
  if (!contactName || !contactEmail || !jerseyName || !bannerChoice) {
    return fail('Please fill in your name, email, jersey name and banner choice.');
  }

  var files = (data.files || []).slice(0, INTAKE_MAX_FILES);
  var total = 0, saved = [];
  var folder = null;
  for (var i = 0; i < files.length; i++) {
    var parts = String(files[i].data || '').split(',');
    var bytes = Utilities.base64Decode(parts[parts.length - 1]);
    total += bytes.length;
    if (bytes.length > INTAKE_MAX_FILE) return fail('One file is larger than 15 MB. Paste a share link for it instead.');
    if (total > INTAKE_MAX_TOTAL) return fail('Your files add up to more than 30 MB. Paste a share link for the big ones instead.');
    var kind = files[i].kind === 'design' ? 'banner-design' : 'logo';
    var t = sniffDesign_(bytes);
    if (!t) return fail('We could not read one of your files. PNG, JPG, PDF, SVG, AI, EPS, PSD and TIFF all work.');
    folder = folder || intakeFolder_(rec.company);
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmm');
    var safe = String(rec.company).replace(/[^A-Za-z0-9]+/g, '') + '_' + kind + '_' + stamp + '_' + (i + 1) + '.' + t.ext;
    folder.createFile(Utilities.newBlob(bytes, t.mime, safe));
    saved.push(kind);
  }
  if (saved.indexOf('logo') < 0 && !clean(f.fileLink, 500) && !rec.submittedAt) {
    return fail('Please attach your logo, or paste a link to it.');
  }

  var fields = {
    contactName: contactName,
    contactEmail: contactEmail,
    contactPhone: clean(f.contactPhone, 60),
    website: clean(f.website, 300),
    jerseyName: jerseyName,
    writeup: clean(f.writeup, 200),
    bannerChoice: bannerChoice,
    bannerText: clean(f.bannerText, 600),
    fileLink: clean(f.fileLink, 500),
    requestStatus: 'Info received',
    submittedAt: todayStamp()
  };
  if (folder) fields.fileFolderId = folder.getId();
  writeFields_(season.sheet, season.header, rec._row, fields);

  var body = rec.company + ' sent their ' + SEASON + ' sponsor info.\n\n' +
    'Contact: ' + contactName + ', ' + contactEmail + (fields.contactPhone ? ', ' + fields.contactPhone : '') + '\n' +
    'Jersey name: ' + jerseyName + '\n' +
    'Website: ' + (fields.website || '(none)') + '\n' +
    'Banner: ' + bannerChoice + (fields.bannerText ? '\nBanner notes: ' + fields.bannerText : '') + '\n' +
    'Write-up: ' + (fields.writeup || '(none)') + '\n' +
    'Files: ' + (saved.length ? saved.join(', ') + '\n' + folder.getUrl() : '(none attached)') +
    (fields.fileLink ? '\nLink they pasted (check it before opening): ' + fields.fileLink : '') +
    '\n\nOpen the ' + SEASON + ' tab in Sponsor Banners to assign or order their banner:\n' + APP_URL;
  GmailApp.sendEmail(myEmail_(), SEASON + ' sponsor info received: ' + rec.company, body, { name: 'LYBS Sponsor Banners' });

  return ok({ message: 'Thank you! We have your info.' });
}

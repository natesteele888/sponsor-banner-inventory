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
 *   - once their payment is in, gets the "send us your banner and sponsor
 *     info" email as a Gmail DRAFT, with a personal link to intake.html (the
 *     reply form with the drop-downs and file uploads). Nate checks it's a
 *     real signup with a real payment, then presses Send himself. This code
 *     never sends a sponsor email on its own.
 *
 * Payment is the gate, Nate's rule: no payment, no banner. A sponsor counts
 * as paid when the sponsorship sheet's "Paid?" column says yes, when a
 * website payment notice matches them, or when Nate ticks "Paid" in the app
 * (a check in the mail). Until then the row shows "Waiting on payment".
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
// It's found by its name in Drive, not by an address written here: this file
// is public on GitHub, and the sheet holds sponsors' contact details. Once
// found, its address is remembered in this script's private Script Properties.
var SPONSOR_SHEET_NAME = SEASON + '_Sponsorship Sheet';
var SPONSOR_TAB = SEASON + ' sponsors';
var ONLINE_TAB = 'OnlineLogs';

// The board's own sponsor sheet has one tab people type in and a sorted view
// tab that is all formulas. The app reads and writes the typing tab when the
// sheet has one, else the season's sponsor tab (the sponsorship lead's own
// sheet). The SPONSOR_TAB_USE Script Property can name another tab.
var ENTRY_TAB = 'Enter sponsors here';
function sponsorTabName_(ss) {
  var want = PropertiesService.getScriptProperties().getProperty('SPONSOR_TAB_USE');
  if (want && ss.getSheetByName(want)) return want;
  if (ss.getSheetByName(ENTRY_TAB)) return ENTRY_TAB;
  return SPONSOR_TAB;
}

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


// Gmail label put on donation notices once they have been read.
var SEEN_LABEL = 'LYBS banner intake seen';
var SEEN_LABEL_SEARCH = 'lybs-banner-intake-seen';
// Website payments from before the 2027 drive started don't count.
var DONATIONS_SINCE = '2026/10/01';

var SEASON_COLUMNS = ['key', 'company', 'tier', 'amount', 'source', 'paid', 'paidVia',
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
  console.log('Hourly sponsor scan is on. Sponsor emails are made as Gmail drafts for you to send.');
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
  } else {
    // A column added in a later version goes on the end of an existing tab.
    var have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    SEASON_COLUMNS.forEach(function (c) {
      if (have.indexOf(c) < 0) { have.push(c); sh.getRange(1, have.length).setValue(c); }
    });
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

function isPaid_(r) { return String(r.paid).toUpperCase() === 'TRUE'; }

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
    // Paid only ever goes from no to yes here; Nate can untick it in the app.
    if (cand.paid && !isPaid_(hit)) {
      fill.paid = 'TRUE'; hit.paid = 'TRUE';
      fill.paidVia = clean(cand.paidVia, 200); hit.paidVia = fill.paidVia;
    }
    if (cand.source && String(hit.source).indexOf(cand.source) < 0) {
      fill.source = hit.source ? hit.source + ' + ' + cand.source : cand.source;
      hit.source = fill.source;
    }
    if (Object.keys(fill).length) writeFields_(season.sheet, season.header, hit._row, fill);
    return { rec: hit, isNew: false, newlyPaid: !!fill.paid };
  }
  var rec = {};
  SEASON_COLUMNS.forEach(function (c) { rec[c] = ''; });
  rec.key = key;
  rec.company = clean(cand.company, 300);
  rec.tier = clean(cand.tier, 50);
  rec.amount = clean(cand.amount, 50);
  rec.source = clean(cand.source, 100);
  rec.paid = cand.paid ? 'TRUE' : 'FALSE';
  rec.paidVia = cand.paid ? clean(cand.paidVia, 200) : '';
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

// The header is the first row with at least three filled cells, so a title or
// blank row added above it (as on the 2027 sheet) doesn't break the readers.
function headerRow_(v) {
  for (var r = 0; r < Math.min(v.length, 10); r++) {
    var n = v[r].filter(function (c) { return String(c).trim(); }).length;
    if (n >= 3) return r;
  }
  return 0;
}

function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return [];
  var v = sh.getDataRange().getValues();
  if (!v.length) return [];
  var h0 = headerRow_(v);
  var header = v[h0].map(function (h) { return String(h).trim(); });
  return v.slice(h0 + 1).map(function (row) {
    var o = {};
    header.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

// Banner-level rows on the sponsorship sheet: anyone a board member has logged,
// however they came in (form, website payment, email or check).
function fromSponsorSheet_(ss) {
  return readTab_(ss, sponsorTabName_(ss)).map(function (r) {
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
      source: 'Sponsorship sheet',
      paid: /^\s*(y|true|x|paid)/i.test(String(r['Paid?'] || '')),
      paidVia: 'Marked paid on the sponsorship sheet'
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
function fromDonationEmails_(ss, season) {
  var label = GmailApp.getUserLabelByName(SEEN_LABEL) || GmailApp.createLabel(SEEN_LABEL);
  var threads = GmailApp.search('from:notifications@lunenburgybs.com subject:"Donation received from" after:' +
    DONATIONS_SINCE + ' -label:' + SEEN_LABEL_SEARCH, 0, 50);
  var people = readTab_(ss, sponsorTabName_(ss));
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
      // A website-form signup that's now paying: match its contact name first.
      season.rows.forEach(function (r) {
        if (!match && r.contactName && nameKey_(r.contactName) === nameKey_(donor) && String(r.company).indexOf('Needs a match') !== 0) {
          match = { 'Company': r.company, 'Email': r.contactEmail, 'Phone': r.contactPhone };
        }
      });
      people.forEach(function (p) {
        var c = nameKey_(p['Contact']);
        if (!match && c && (c === nameKey_(donor) || (c.length > 4 && nameKey_(donor).indexOf(c) >= 0))) match = p;
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
          source: 'Website payment',
          paid: true,
          paidVia: 'Website payment ' + when + ' (approve it in the Crossbar dashboard)'
        });
      } else {
        out.push({
          company: 'Needs a match: ' + donor,
          tier: tierFromAmount_(amount),
          amount: money_(amount),
          contactName: donor,
          source: 'Website payment',
          paid: true,
          paidVia: 'Website payment ' + when + ' (approve it in the Crossbar dashboard)',
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
    var ss = sponsorSpreadsheet_();
    var season = readSeason_();
    var cands = [];
    try { cands = cands.concat(fromSponsorSheet_(ss)); } catch (e) { console.log('sponsor tab: ' + e); }
    try { cands = cands.concat(fromOnlineLogs_(ss)); } catch (e) { console.log('online logs: ' + e); }
    try { cands = cands.concat(fromDonationEmails_(ss, season)); } catch (e) { console.log('donations: ' + e); }

    var added = [], paidNow = [];
    cands.forEach(function (c) {
      var res = upsertSponsor_(season, c);
      if (res && res.isNew) added.push(res.rec);
      else if (res && res.newlyPaid && added.indexOf(res.rec) < 0) paidNow.push(res.rec);
    });

    // Paid, with an email, and not asked yet: make the info email as a draft.
    // No payment, no email (and no banner).
    var drafted = [];
    season.rows.forEach(function (r) {
      if (!r.requestStatus && isPaid_(r) && r.contactEmail && String(r.company).indexOf('Needs a match') !== 0) {
        try { prepareRequest_(season, r); drafted.push(r); }
        catch (e) { console.log('request email for row ' + r._row + ': ' + e); }
      }
    });

    if (added.length || paidNow.length) notifyNewSponsors_(added, paidNow, drafted);
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

// Always a draft in Nate's Gmail. He checks the signup and the payment, then
// presses Send. There is deliberately no way here to send it automatically.
function prepareRequest_(season, rec) {
  var to = firstEmail_(rec.contactEmail);
  if (!to) throw new Error('No email address on this sponsor yet.');
  if (!rec.token) {
    rec.token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    writeFields_(season.sheet, season.header, rec._row, { token: rec.token });
  }
  var mail = buildRequestEmail_(rec);
  var opts = { htmlBody: mail.html, name: SIGNATURE_NAME, cc: LEAGUE_CC };
  GmailApp.createDraft(to, mail.subject, mail.text, opts);
  rec.requestStatus = 'Draft in Gmail';
  rec.requestAt = todayStamp();
  writeFields_(season.sheet, season.header, rec._row, { requestStatus: rec.requestStatus, requestAt: rec.requestAt });
}

function myEmail_() {
  return Session.getEffectiveUser().getEmail();
}

function notifyNewSponsors_(added, paidNow, drafted) {
  var line = function (r) {
    var what;
    if (String(r.company).indexOf('Needs a match') === 0) what = 'paid on the website, not matched to a company yet';
    else if (!isPaid_(r)) what = 'signed up, waiting on payment (no email or banner yet)';
    else if (drafted.indexOf(r) >= 0) what = 'paid, info email is in your Drafts for you to check and send';
    else if (!r.contactEmail) what = 'paid, no email on file yet';
    else what = 'paid';
    return '- ' + r.company + ': ' + (r.tier || '?') + ' ' + (r.amount || '') + ' via ' + r.source + ': ' + what;
  };
  var parts = [];
  if (added.length) parts.push('New ' + SEASON + ' banner sponsors:\n' + added.map(line).join('\n'));
  if (paidNow.length) parts.push('Payment now in:\n' + paidNow.map(line).join('\n'));
  var body = parts.join('\n\n') +
    '\n\nNothing has been sent to any sponsor. Open the ' + SEASON + ' tab of Sponsor Banners to check them, ' +
    'assign a banner from stock or mark one to order:\n' + APP_URL;
  var n = added.length + paidNow.length;
  GmailApp.sendEmail(myEmail_(), SEASON + ' banner sponsors: ' + n + ' update' + (n > 1 ? 's' : ''), body,
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
  return { season: SEASON, rows: rows, statuses: BANNER_STATUSES };
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
  if ('paid' in data) {
    fields.paid = data.paid ? 'TRUE' : 'FALSE';
    if (data.paid && !isPaid_(rec)) fields.paidVia = 'Marked paid in the app ' + todayStamp();
    if (!data.paid) fields.paidVia = '';
  }
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
    source: clean(data.source, 50) || 'Email', notes: data.notes,
    paid: !!data.paid, paidVia: 'Marked paid in the app ' + todayStamp()
  });
  if (!res) return fail('Company name is required.');
  if (!res.isNew) return fail(res.rec.company + ' is already on the ' + SEASON + ' list.');
  return ok({ message: 'Added.' });
}

// The app's "Make email draft" button. Always a draft.
function seasonRequest(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var season = readSeason_();
  var rec = findSeasonRow_(season, data.key);
  if (!rec) return fail('That sponsor is no longer on the list.');
  if (!firstEmail_(rec.contactEmail)) return fail('Add an email address for this sponsor first, and save.');
  if (!isPaid_(rec)) return fail('Their payment is not in yet. Tick Paid and save once it is.');
  prepareRequest_(season, rec);
  return ok({ message: 'Draft is in your Gmail. Check it, then press Send.', requestStatus: rec.requestStatus });
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


// ---------- the sponsorship sheet, read live (the app's Sponsors tab) ----------
//
// Everything on the sponsorship lead's sheet, shown in the app behind the
// Dashboard sign-in: who owns each sponsor, who has contacted them, contacts,
// last year's and this year's level, amount, paid, banner and plaque flags.
// Read only: this code never changes a cell on that sheet. Nothing is copied
// anywhere either: each open of the tab reads the sheet as it is right then.
//
// The one thing the app writes is which team a sponsor is lined up with. That
// goes in this script's private Script Properties (one entry per sponsor,
// "SPONSOR_TEAM_<season>_<key>"), never onto the sponsorship sheet, and it
// rides along in sponsorSheet() so the Dashboard's Uniforms and Jersey Order
// pages see it too. (A new tab on the data Sheet was the first plan, but
// adding a tab from the web app was refused by Google, so it lives here.)

var SPONSOR_TEAM_PREFIX = 'SPONSOR_TEAM_' + SEASON + '_';
// The sheet tabs the Sponsors tab shows, in this order. A tab that isn't there is skipped.
var SPONSOR_BOOK_TABS = [SPONSOR_TAB, ONLINE_TAB, 'Jerseys', 'Plaques'];
var SPONSOR_PROP = 'SPONSOR_SHEET_ID_' + SEASON;

// The sponsorship sheet, found by name the first time and remembered after.
function sponsorSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var own = props.getProperty('SPONSOR_SHEET_USE');
  if (own) {
    try { return SpreadsheetApp.openById(own); }
    catch (e) { throw new Error('The board copy of the sponsorship sheet (SPONSOR_SHEET_USE) did not open.'); }
  }
  var id = props.getProperty(SPONSOR_PROP);
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { props.deleteProperty(SPONSOR_PROP); }
  }
  var it = DriveApp.getFilesByName(SPONSOR_SHEET_NAME);
  var best = null, bestAt = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    var at = f.getLastUpdated().getTime();
    if (at <= bestAt) continue;
    // Only a sheet that has the season's sponsor tab counts.
    var ss;
    try { ss = SpreadsheetApp.openById(f.getId()); } catch (e) { continue; }
    if (!ss.getSheetByName(SPONSOR_TAB) && !ss.getSheetByName(ENTRY_TAB)) continue;
    best = ss; bestAt = at;
  }
  if (!best) throw new Error('Could not find the "' + SPONSOR_SHEET_NAME + '" sheet in Drive.');
  props.setProperty(SPONSOR_PROP, best.getId());
  return best;
}

// Run once from the editor if the sheet is ever renamed or replaced: it forgets
// the remembered sheet so the next read finds it by name again.
function forgetSponsorSheet() {
  PropertiesService.getScriptProperties().deleteProperty(SPONSOR_PROP);
  console.log('Forgot the sponsorship sheet. The next read looks for "' + SPONSOR_SHEET_NAME + '" again.');
}

// A tab as its header row plus every row, as the text a person sees in each
// cell. Blank rows are dropped; nothing is reordered.
function bookTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return null;
  var v = sh.getDataRange().getDisplayValues();
  if (!v.length) return { name: name, headers: [], rows: [] };
  var h0 = headerRow_(v);
  var width = 0;
  v[h0].forEach(function (h, i) { if (String(h).trim()) width = i + 1; });
  var headers = v[h0].slice(0, width).map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); });
  var rows = [];
  for (var r = h0 + 1; r < v.length; r++) {
    var cells = [];
    for (var i = 0; i < width; i++) cells.push(String(v[r][i] == null ? '' : v[r][i]).trim().slice(0, 500));
    if (cells.some(function (c) { return c; })) rows.push({ row: r + 1, cells: cells });
  }
  return { name: name, headers: headers, rows: rows };
}

function sponsorBook() {
  var ss = sponsorSpreadsheet_();
  var tabs = [sponsorTabName_(ss)].concat(SPONSOR_BOOK_TABS.slice(1)).map(function (n) { return bookTab_(ss, n); }).filter(Boolean);
  return {
    season: SEASON,
    sheetName: ss.getName(),
    sheetUrl: ss.getUrl(),
    readAt: new Date().toISOString(),
    tabs: tabs,
    teams: sponsorTeams_().rows.map(function (t) {
      return { key: String(t.key), company: String(t.company), division: String(t.division || ''),
               team: String(t.team || ''), note: String(t.note || ''), updatedAt: String(t.updatedAt || '') };
    })
  };
}


// ---------- sponsor to team ----------

function sponsorTeams_() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var rows = [];
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SPONSOR_TEAM_PREFIX) !== 0) return;
    try {
      var o = JSON.parse(all[k]);
      if (o && o.key) rows.push(o);
    } catch (e) { /* a damaged entry is skipped */ }
  });
  rows.sort(function (a, b) { return String(a.company).localeCompare(String(b.company)); });
  return { rows: rows };
}

// One sponsor's team. An empty division, team and note clears it.
function sponsorTeamSave(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var company = clean(data.company, 120);
  var key = companyKey_(company);
  if (!key) return fail('No sponsor given.');
  var fields = { key: key, company: company, division: clean(data.division, 60), team: clean(data.team, 80),
                 note: clean(data.note, 300), updatedAt: todayStamp() };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var props = PropertiesService.getScriptProperties();
    var name = SPONSOR_TEAM_PREFIX + key.slice(0, 80);
    var before = JSON.parse(props.getProperty(name) || 'null');
    if (before && before.imageFileId) fields.imageFileId = before.imageFileId;
    if (!fields.division && !fields.team && !fields.note && !fields.imageFileId) {
      props.deleteProperty(name);
      return ok({ message: 'Team cleared.' });
    }
    props.setProperty(name, JSON.stringify(fields));
    return ok({ message: 'Saved.' });
  } finally {
    lock.releaseLock();
  }
}


// ---------- for the LYBS Dashboard (Uniforms and Jersey Order pages) ----------
//
// The same sheet without the contact columns: the Dashboard pages only need
// who's sponsoring at what level, paid, and which team. A team set in this
// app wins over the sheet's own "Associated Team" cell.

function sponsorSheet() {
  var ss = sponsorSpreadsheet_();
  var season = Number(SEASON);
  var main = sheetRows_(ss, sponsorTabName_(ss), {
    owner: /^lybs owner/,
    contacted: /^contacted/,
    company: /^(company|business)/,
    pastSponsor: /sponsored in past/,
    tierPrev: new RegExp('^tier selected ' + (season - 1)),
    tier: new RegExp('^tier selected ' + season),
    amount: /^amount/,
    paid: /^paid/,
    owedBanner: /^owed a banner/,
    bannerNeed: /^banner/,
    team: /^(associated team|team)/,
    owedPlaque: /^owed a plaque/
  });
  var jerseys = sheetRows_(ss, 'Jerseys', {
    company: /^(business|company|sponsor)/,
    team: /team/
  });
  var online = sheetRows_(ss, ONLINE_TAB, {
    company: /^business name/,
    level: /^sponsorship level/,
    returning: /^been a sponsor/,
    requests: /^sponsor requests/,
    submitted: /^submitted/
  });
  var picked = {};
  sponsorTeams_().rows.forEach(function (t) {
    picked[String(t.key)] = [t.division, t.team].filter(function (x) { return String(x || '').trim(); }).join(' ');
  });
  var sponsors = main.rows.filter(function (r) { return r.company; }).map(function (r) {
    var p = picked[companyKey_(r.company)];
    if (p) r.team = p.slice(0, 160);
    return r;
  });
  return {
    season: SEASON,
    sheetName: ss.getName(),
    sheetUrl: ss.getUrl(),
    readAt: new Date().toISOString(),
    sponsors: sponsors,
    jerseys: jerseys.rows.filter(function (r) { return r.company; }),
    online: online.rows.filter(function (r) { return r.company; }),
    missing: main.missing.concat(jerseys.missing, online.missing)
  };
}

// One tab as a list of plain objects with only the wanted fields, every value
// as display text, found by header text so a moved or added column doesn't
// break it. A header it can't find comes back empty and is listed in missing.
function sheetRows_(ss, tabName, wanted) {
  var sh = ss.getSheetByName(tabName);
  var keys = Object.keys(wanted);
  if (!sh) return { rows: [], missing: [tabName + ' (tab)'] };
  var v = sh.getDataRange().getDisplayValues();
  if (!v.length) return { rows: [], missing: [] };
  var h0 = headerRow_(v);
  var header = v[h0].map(function (h) {
    return String(h).toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim();
  });
  var col = {}, missing = [];
  keys.forEach(function (k) {
    col[k] = -1;
    for (var i = 0; i < header.length; i++) {
      if (header[i] && wanted[k].test(header[i])) { col[k] = i; break; }
    }
    if (col[k] < 0) missing.push(tabName + ': ' + k);
  });
  var rows = v.slice(h0 + 1).map(function (row) {
    var o = {};
    keys.forEach(function (k) { o[k] = col[k] < 0 ? '' : String(row[col[k]] || '').trim().slice(0, 160); });
    return o;
  });
  return { rows: rows, missing: missing };
}


// ---------- for Ballclub team pages ("Sponsored by") ----------
//
// Sponsors are board-only. The one place one shows outside the board is the
// team's own page in Ballclub: "Sponsored by", with that season's sponsor (or
// sponsors) lined up with the team in the Sponsors tab, and their logo. So
// this answers one team at a time with names and logos only: no contact,
// level, amount, paid, owner or notes, and nothing about any other team.
//
// Who can ask: anyone Ballclub itself lets see that team's page (its database
// rules, teams/<team> .read): the team's own code accounts, a Google account
// holding a grant for that team, or a Ballclub board member. Ballclub's
// signed-out public view gets nothing.
//
// The logo is the one the board sets in the Sponsors tab's team box (saved in
// the Drive folder below), or else a PNG/JPG/GIF/WebP logo the sponsor sent
// through their reply form. Either way it is read from Drive each time; no
// image lives in any repo.

// Ballclub's Firebase project. Both are public identifiers already shipped in
// Ballclub's own index.html; neither can read anything by itself.
var BALLCLUB_WEB_API_KEY = 'AIzaSyCK2-ZDnWxSs-5ghhueRIR4OaSZ-1NgHGY';
var BALLCLUB_DB_URL = 'https://lybs-ballclub-default-rtdb.firebaseio.com';
var TEAM_LOGO_FOLDER_NAME = 'Team Page Logos';
var TEAM_LOGO_MAX_BYTES = 5 * 1024 * 1024;
var TEAM_PAGE_MAX_SPONSORS = 3;

function teamPageSponsorRequest_(data) {
  var teamId = String(data.teamId || '').toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+){0,4}$/.test(teamId) || teamId.length > 40) return fail('Unknown team.');
  var who = authorizeTeamViewer_(String(data.idToken || ''), teamId);
  if (!who.ok) return fail(who.error);
  return ok(teamPageSponsor_(teamId));
}

function authorizeTeamViewer_(idToken, teamId) {
  var denied = { ok: false, error: 'Not signed in to this team.' };
  if (!idToken) return { ok: false, error: 'Please sign in.' };
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken + '|' + teamId);
  var cacheKey = 'teamview_' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();
  if (cache.get(cacheKey) === 'yes') return { ok: true };

  var lookup = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + BALLCLUB_WEB_API_KEY,
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (lookup.getResponseCode() !== 200) return { ok: false, error: 'Your sign-in expired. Please sign in again.' };
  var user = (JSON.parse(lookup.getContentText()).users || [])[0];
  if (!user || !user.localId || !user.email) return denied;

  var email = String(user.email).toLowerCase();
  var allowed = email === 'coach-' + teamId + '-gate@lybsballclub.internal' ||
                email === 'player-' + teamId + '-gate@lybsballclub.internal';
  if (!allowed && user.emailVerified) {
    var auth = '.json?auth=' + encodeURIComponent(idToken);
    var uid = encodeURIComponent(user.localId);
    var grant = UrlFetchApp.fetch(BALLCLUB_DB_URL + '/access/' + encodeURIComponent(teamId) + '/' + uid + auth,
      { muteHttpExceptions: true });
    allowed = grant.getResponseCode() === 200 && JSON.parse(grant.getContentText() || 'null') !== null;
    if (!allowed) {
      var board = UrlFetchApp.fetch(BALLCLUB_DB_URL + '/boardMembers/' + uid + auth, { muteHttpExceptions: true });
      allowed = board.getResponseCode() === 200 && JSON.parse(board.getContentText() || 'null') === true;
    }
  }
  if (!allowed) return denied;
  cache.put(cacheKey, 'yes', 300);
  return { ok: true };
}

// The sponsors lined up with this team: a team set in the Sponsors tab wins,
// else the sheet's own "Associated Team" cell. A team matches when every word
// of its Ballclub id is in the label ("majors-blue" matches "Majors · Blue").
function teamPageSponsor_(teamId) {
  var ss = sponsorSpreadsheet_();
  var words = teamId.split('-');
  function matches(label) {
    var have = String(label || '').toLowerCase().split(/[^a-z0-9]+/);
    return words.every(function (w) { return have.indexOf(w) >= 0; });
  }
  var picks = {};
  sponsorTeams_().rows.forEach(function (t) { picks[String(t.key)] = t; });
  var seen = {}, list = [];
  sheetRows_(ss, sponsorTabName_(ss), { company: /^(company|business)/, team: /^(associated team|team)/ }).rows
    .forEach(function (r) {
      var key = companyKey_(r.company);
      if (!r.company || !key || seen[key]) return;
      var p = picks[key];
      var label = p && (p.division || p.team) ? [p.division, p.team].join(' ') : r.team;
      if (!matches(label)) return;
      seen[key] = 1;
      list.push({ key: key, name: String(r.company).trim().slice(0, 120), imageFileId: p && p.imageFileId });
    });
  list.sort(function (a, b) { return a.name.localeCompare(b.name); });
  list = list.slice(0, TEAM_PAGE_MAX_SPONSORS);
  var folders = null;
  return {
    season: SEASON,
    teamId: teamId,
    sponsors: list.map(function (s) {
      var img = null;
      try {
        img = s.imageFileId ? teamLogoById_(s.imageFileId) : null;
        if (!img) {
          folders = folders || intakeFolders_();
          img = folders[s.key] ? intakeLogo_(folders[s.key]) : null;
        }
      } catch (e) {
        console.log('team page logo for ' + s.key + ': ' + e);
      }
      return { name: s.name, image: img };
    })
  };
}

// Only a file inside the Team Page Logos folder is ever served, so a damaged
// or edited entry can't be used to read some other Drive file.
function teamLogoById_(fileId) {
  var file = DriveApp.getFileById(String(fileId));
  var parents = file.getParents();
  var inFolder = false;
  while (parents.hasNext()) { if (parents.next().getName() === TEAM_LOGO_FOLDER_NAME) inFolder = true; }
  if (!inFolder || file.isTrashed()) return null;
  return logoBlob_(file);
}

// company key -> the Drive folder the sponsor's reply form saved files in.
function intakeFolders_() {
  var out = {};
  try {
    readSeason_().rows.forEach(function (r) {
      if (r.key && r.fileFolderId) out[String(r.key)] = String(r.fileFolderId);
    });
  } catch (e) {
    console.log('intake folders: ' + e);
  }
  return out;
}

// The newest logo they sent that a browser can show (not AI, EPS, PDF...).
function intakeLogo_(folderId) {
  var it = DriveApp.getFolderById(folderId).getFiles();
  var best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || f.getName().indexOf('_logo_') < 0) continue;
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(f.getMimeType()) < 0) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return best ? logoBlob_(best) : null;
}

function logoBlob_(file) {
  var blob = file.getSize() > 400 * 1024 ? (file.getThumbnail() || null) : file.getBlob();
  if (!blob) return null;
  var mime = blob.getContentType();
  if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(mime) < 0) return null;
  return { mime: mime, base64: Utilities.base64Encode(blob.getBytes()) };
}

// Board side: the Sponsors tab's team box sets or clears a sponsor's team page
// logo. The file goes in the Team Page Logos folder (inside the Sponsor
// Banners folder) and its id is kept on the sponsor's team entry.
function sponsorTeamLogo(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var company = clean(data.company, 120);
  var key = companyKey_(company);
  if (!key) return fail('No sponsor given.');
  var name = SPONSOR_TEAM_PREFIX + key.slice(0, 80);
  var props = PropertiesService.getScriptProperties();
  if (data.get) {
    var cur = JSON.parse(props.getProperty(name) || 'null');
    var img = null;
    try {
      img = cur && cur.imageFileId ? teamLogoById_(cur.imageFileId) : null;
      var source = img ? 'set' : '';
      if (!img) {
        var folders = intakeFolders_();
        img = folders[key] ? intakeLogo_(folders[key]) : null;
        source = img ? 'form' : '';
      }
    } catch (e) { console.log('logo get: ' + e); }
    return ok({ image: img, source: img ? source : '' });
  }
  var fileId = '';
  if (data.photo) {
    var parts = String(data.photo).split(',');
    var bytes = Utilities.base64Decode(parts[parts.length - 1]);
    if (bytes.length > TEAM_LOGO_MAX_BYTES) return fail('That logo is larger than 5 MB. Try a smaller PNG or JPG.');
    var type = sniffImage(bytes);
    if (['image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(type) < 0) {
      return fail('Use a PNG, JPG, GIF or WebP logo.');
    }
    var parent = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    var fit = parent.getFoldersByName(TEAM_LOGO_FOLDER_NAME);
    var folder = fit.hasNext() ? fit.next() : parent.createFolder(TEAM_LOGO_FOLDER_NAME);
    var safe = String(company).replace(/[^A-Za-z0-9]+/g, '') + '_team-page-logo_' + todayStamp() + '.' + type.split('/')[1];
    fileId = folder.createFile(Utilities.newBlob(bytes, type, safe)).getId();
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var entry = JSON.parse(props.getProperty(name) || 'null') ||
      { key: key, company: company, division: '', team: '', note: '' };
    if (fileId) entry.imageFileId = fileId; else delete entry.imageFileId;
    entry.updatedAt = todayStamp();
    if (!entry.division && !entry.team && !entry.note && !entry.imageFileId) props.deleteProperty(name);
    else props.setProperty(name, JSON.stringify(entry));
  } finally {
    lock.releaseLock();
  }
  return ok({ message: fileId ? 'Logo saved.' : 'Logo removed.' });
}

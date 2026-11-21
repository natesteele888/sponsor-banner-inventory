/**
 * Welcome email: the thank-you and next steps a sponsor gets when they sign
 * up on the league website, for everyone who didn't: check payers and anyone
 * added by hand. Lives next to Code.gs in the same Apps Script project
 * (Files → + → Script, name it "Welcome"). Uses Outreach.gs for who it's
 * from and the address checks.
 *
 *   Sponsors tab → Welcome: every sponsor who signed up or paid, each marked
 *   "had it" (signed up on the website, sent from here, or marked by hand)
 *   or "needs it"
 *        │  Preview shows To and the greeting side by side
 *        ▼
 *   a sponsorship editor picks who it's from and taps Send twice: one email,
 *   only that sponsor's address in To, no CC or BCC. "Already had it" marks
 *   one without sending.
 *
 * Nothing runs on a schedule and nothing goes out without that tap.
 *
 * Who signed up on the website comes from the sheet's OnlineLogs tab (the
 * website form's entries), matched by business name. Website signups got
 * the website's own email, so they're never listed as needing it.
 *
 * Script Properties (optional; nothing about a sponsor is in this file):
 *   WELCOME_DONATE_URL    the league's online payment page (default below)
 *   RECEIPT_ORG_ADDRESS   the league's mailing address, for checks (Receipts.gs)
 */

var WELCOME_PROP = 'WELCOME_' + SEASON;
var WELCOME_SUBJECT = 'Thank You for Becoming an LYBS Sponsor!';
var WELCOME_DONATE_DEFAULT = 'https://www.lunenburgybs.com/donate';
var WELCOME_LEAGUE_MAIL = 'info@lunenburgybs.com';

function welcomeLog_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(WELCOME_PROP) || '{}'); } catch (e) { return {}; }
}
function saveWelcomeLog_(log) { PropertiesService.getScriptProperties().setProperty(WELCOME_PROP, JSON.stringify(log)); }

function welcomeSettings_() {
  var p = PropertiesService.getScriptProperties();
  var donate = String(p.getProperty('WELCOME_DONATE_URL') || WELCOME_DONATE_DEFAULT).trim();
  return {
    donate: /^https:\/\/[^\s"<>]+$/.test(donate) ? donate : '',
    address: String(p.getProperty('RECEIPT_ORG_ADDRESS') || '').replace(/\s*\n\s*/g, ', ').trim(),
    deadline: typeof INFO_DEADLINE === 'string' ? INFO_DEADLINE : 'March 20',
    sign: outreachSettings_().sign
  };
}

// Business names from the website form's entries.
function welcomeWebsiteKeys_(ss) {
  var keys = [];
  try {
    readTab_(ss, ONLINE_TAB).forEach(function (r) {
      var k = companyKey_(r['Business Name/Sponsor Name'] || '');
      if (k) keys.push(k);
    });
  } catch (e) { console.log('welcome: online logs: ' + e); }
  return keys;
}
function welcomeOnWebsite_(company, keys) {
  var k = companyKey_(company);
  if (!k) return false;
  return keys.some(function (w) {
    return w === k || (w.length >= 6 && k.indexOf(w) === 0) || (k.length >= 6 && w.indexOf(k) === 0);
  });
}

// Signed up or paid, and hasn't said no.
function welcomeSponsor_(r) {
  if (/^not sponsoring/i.test(r.status) || /not spons|declin/i.test(r.contacted)) return false;
  if (/^(paid|signed up)/i.test(r.status) || isYes_(r.paid)) return true;
  return !!r.tier && !/^none/i.test(r.tier);
}
function welcomePaid_(r) { return isYes_(r.paid) || /^paid/i.test(r.status); }

function welcomeText_(r, greet, s) {
  var paid = welcomePaid_(r);
  var level = r.tier && !/^none/i.test(r.tier) ? ' at the ' + r.tier + ' level' : '';
  var steps = [
    paid ? 'We’ve received your payment. Thank you!'
         : 'Submit your payment before the deadline of ' + s.deadline + ' to make sure your benefits are ready for the season.',
    'We will contact you to gather things such as your business write-up, logo files, and any additional information needed to complete your sponsorship package.'
  ];
  var paras = [
    'Hi ' + (greet || 'there') + ',',
    'Thank you for sponsoring Lunenburg Youth Baseball & Softball' + level + ' for ' + SEASON + '! We truly appreciate ' + r.company + '’s commitment to our players and community.',
    'NEXT STEPS:\n' + steps.map(function (x) { return '- ' + x; }).join('\n')
  ];
  if (!paid) {
    var pay = [];
    if (s.donate) pay.push('You can pay online by ACH or credit card here:\n' + s.donate);
    if (s.address) pay.push('You can also send a check, payable to Lunenburg Youth Baseball & Softball, to:\n' + s.address);
    if (pay.length) paras.push(pay.join('\n\n'));
  }
  paras.push('For any questions, please reach out to ' + WELCOME_LEAGUE_MAIL + '.');
  paras.push('Sincerely,\n' + s.sign + '\nLunenburg Youth Baseball & Softball');
  return paras.join('\n\n');
}

function welcomeHtml_(text) {
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  return '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a;max-width:560px">' +
    text.split('\n\n').map(function (p) {
      var lines = p.split('\n');
      if (lines[0] === 'NEXT STEPS:') {
        return '<p style="margin-bottom:4px"><b>NEXT STEPS:</b></p><ul style="margin-top:0;padding-left:20px">' +
          lines.slice(1).map(function (l) { return '<li style="margin-bottom:5px">' + esc(l.replace(/^- /, '')) + '</li>'; }).join('') + '</ul>';
      }
      return '<p>' + esc(p).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
        .replace(/([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})/g, '<a href="mailto:$1">$1</a>').replace(/\n/g, '<br>') + '</p>';
    }).join('') + '</div>';
}

// Every sponsor, with whether they've had it and the address checks.
function welcomeItems_() {
  var ss = sponsorSpreadsheet_(), web = welcomeWebsiteKeys_(ss), log = welcomeLog_();
  var rows = outreachRows_(), all = rows.filter(welcomeSponsor_);
  return all.map(function (r) {
    var mine = log[companyKey_(r.company)] || null;
    var had = mine ? { how: mine.how, at: mine.at, by: mine.by } : welcomeOnWebsite_(r.company, web) ? { how: 'website' } : null;
    var email = firstEmail_(r.emailCell), hold = [], look = [];
    var found = String(r.emailCell || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
    if (!r.emailCell) hold.push('No email on the sheet.');
    else if (!email) hold.push('The email cell doesn’t hold an address ("' + r.emailCell.slice(0, 40) + '").');
    if (email) {
      if (found.length > 1) look.push('The email cell has ' + found.length + ' addresses; this goes to the first one only.');
      if (r.contact && !outreachNameMatches_(r.contact, email)) look.push('The contact is ' + r.contact.slice(0, 40) + ', but the address may be someone else’s.');
      var twin = all.filter(function (o) { return o.row !== r.row && firstEmail_(o.emailCell).toLowerCase() === email.toLowerCase(); })[0];
      if (twin) look.push('The same address is on ' + twin.company + ' too.');
    }
    return { r: r, row: r.row, company: r.company, contact: r.contact, email: email, status: r.status, owner: r.owner,
             tier: r.tier, paid: welcomePaid_(r), greet: outreachFirstName_(r.contact), had: had, hold: hold, look: look };
  });
}
function welcomePublic_(i) {
  return { row: i.row, company: i.company, contact: i.contact, email: i.email, status: i.status, owner: i.owner, tier: i.tier,
           paid: i.paid, greet: i.greet, had: i.had, hold: i.hold, look: i.look };
}
function welcomeFind_(data) {
  var row = Number(data && data.row);
  var it = welcomeItems_().filter(function (i) { return i.row === row; })[0];
  return it && companyKey_(it.company) === companyKey_(data.company) ? it : null;
}

// ---------- the app's calls ----------

function welcomeList() {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send welcome emails.');
  var items = welcomeItems_().map(welcomePublic_);
  return ok({ items: items, senders: outreachSenders_(), needs: items.filter(function (i) { return !i.had; }).length });
}

function welcomePreview(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send welcome emails.');
  var it = welcomeFind_(data);
  if (!it) return fail('That row changed on the sheet. Refresh the list.');
  var text = welcomeText_(it.r, it.greet, welcomeSettings_());
  return ok({ subject: WELCOME_SUBJECT, text: text, html: welcomeHtml_(text), to: it.email, greet: it.greet || 'there',
              company: it.company, contact: it.contact, hold: it.hold, look: it.look, had: it.had });
}

// data: { row, company, email, sender, looked } sends one; { ..., mark: true } marks it had without sending.
function welcomeSend(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send welcome emails.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail('Someone else is sending right now. Try again in a moment.');
  try {
    var it = welcomeFind_(data);
    if (!it) return fail('That row changed on the sheet. Nothing was sent.');
    var log = welcomeLog_(), key = companyKey_(it.company), today = dayOf_(new Date());
    var by = String(WHO && WHO.email || '');
    if (data.mark === true) {
      log[key] = { how: 'marked', at: today, by: by };
      saveWelcomeLog_(log);
      return ok({ message: it.company + ' is marked as already welcomed. Nothing was sent.' });
    }
    if (it.had) return fail(it.company + ' already had it' + (it.had.at ? ' (' + it.had.at + ')' : ' from the website') + '. Nothing was sent.');
    if (it.hold.length) return fail(it.hold[0] + ' Nothing was sent.');
    if (String(data.email || '').toLowerCase() !== it.email.toLowerCase()) return fail('The address on the sheet changed. Nothing was sent.');
    if (it.look.length && data.looked !== true) return fail('This one needs a look first. Nothing was sent.');
    var sender = data.sender === 'league' ? 'league' : data.sender === 'mine' ? 'mine' : '';
    var pick = outreachSenders_().filter(function (x) { return x.id === sender; })[0];
    if (!pick) return fail('Pick who it’s from.');
    if (!pick.ok) return fail(pick.why);
    var s = welcomeSettings_(), text = welcomeText_(it.r, it.greet, s), o = { htmlBody: welcomeHtml_(text) };
    if (sender === 'league') { var mail = senderSettings_(); o.from = mail.from; o.replyTo = mail.from; o.name = RECEIPT_ORG; }
    else o.name = String(s.sign.split('\n')[0] || 'Nate Steele');
    try { GmailApp.sendEmail(it.email, WELCOME_SUBJECT, text, o); }   // one sponsor, one To, no CC or BCC
    catch (e) { return fail('Gmail refused it: ' + String(e.message || e).slice(0, 120) + ' Nothing was sent.'); }
    log[key] = { how: 'sent', at: today, by: by, via: sender, to: it.email.toLowerCase() };
    saveWelcomeLog_(log);
    return ok({ message: 'Welcome email sent to ' + it.email + '.' });
  } finally {
    lock.releaseLock();
  }
}

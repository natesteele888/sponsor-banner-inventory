/**
 * Donation receipts for paid sponsors. Lives next to Code.gs and Season.gs in
 * the same Apps Script project (Files → + → Script, name it "Receipts").
 *
 *   sponsorship sheet: a row marked Paid, with an email, amount over $0
 *        │  read only; this file never writes to that sheet
 *        ▼
 *   Sponsors tab: "Receipts to send" lists each one, with a preview
 *        │  a board member taps Send (nothing is ever sent on its own: no trigger)
 *        ▼
 *   one email to the sponsor: the donation receipt plus the sponsor packet link
 *        │
 *        ▼
 *   RECEIPTS_<season> Script Property remembers it as sent, and the day
 *
 * Website payments are left out: the league site already emails its own tax
 * receipt when a donation is accepted. A row counts as a website payment when
 * a "Donation received from" notice matches its contact name and amount, or
 * when someone taps "Website sent it" on the row.
 *
 * What the receipt says about the league comes from Script Properties, so no
 * address, tax ID, name or link is written in this public file:
 *   RECEIPT_ORG_ADDRESS   the league's mailing address, as on the old receipt
 *   RECEIPT_EIN           the league's federal EIN, as on the old receipt
 *   RECEIPT_ISSUER        who issues it, e.g. "Name, President"
 *   SPONSOR_PACKET_URL    the sponsor info packet page (changes when it moves)
 *   RECEIPTS_TEST_TO      while testing, every receipt goes to this one address
 *   RECEIPTS_LIVE         "on" sends to sponsors; anything else is test mode
 * Without the first three, Send refuses. Without SPONSOR_PACKET_URL the
 * receipt goes out without the packet part.
 */

var RECEIPTS_PROP = 'RECEIPTS_' + SEASON;
var RECEIPT_ORG = 'Lunenburg Youth Baseball & Softball';

function receiptSettings_() {
  var p = PropertiesService.getScriptProperties();
  var s = {
    address: String(p.getProperty('RECEIPT_ORG_ADDRESS') || '').trim(),
    ein: String(p.getProperty('RECEIPT_EIN') || '').trim(),
    issuer: String(p.getProperty('RECEIPT_ISSUER') || '').trim(),
    packetUrl: String(p.getProperty('SPONSOR_PACKET_URL') || '').trim(),
    testTo: firstEmail_(p.getProperty('RECEIPTS_TEST_TO') || ''),
    live: String(p.getProperty('RECEIPTS_LIVE') || '').trim().toLowerCase() === 'on'
  };
  if (!/^https:\/\//.test(s.packetUrl)) s.packetUrl = '';
  s.missing = [];
  if (!s.address) s.missing.push('mailing address');
  if (!/^\d{2}-\d{7}$/.test(s.ein)) s.missing.push('EIN');
  if (!s.issuer) s.missing.push('who issues it');
  return s;
}

function receiptLog_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(RECEIPTS_PROP) || '{}'); }
  catch (e) { return {}; }
}

function saveReceiptLog_(log) {
  PropertiesService.getScriptProperties().setProperty(RECEIPTS_PROP, JSON.stringify(log));
}

// Same sponsor, same email, same amount: one receipt. A changed amount is a new one.
function receiptKey_(r) {
  return companyKey_(r.company) + '|' + r.email.toLowerCase() + '|' + Math.round(r.amount * 100);
}

// Website donations from the league site's own notices: who and how much.
function websiteDonations_() {
  var cache = CacheService.getScriptCache(), ck = 'RCPT_WEB_' + SEASON;
  var hit = cache.get(ck);
  if (hit) { try { return JSON.parse(hit); } catch (e) { /* read again */ } }
  var out = [];
  try {
    GmailApp.search('from:notifications@lunenburgybs.com subject:"Donation received from" after:' + DONATIONS_SINCE, 0, 100)
      .forEach(function (t) {
        t.getMessages().forEach(function (m) {
          var x = (m.getPlainBody() || '').match(/received a \$([\d,]+(?:\.\d+)?) donation from ([^\.\n]+)/i);
          if (x) out.push({ name: nameKey_(x[2]), amount: parseAmount_(x[1]) });
        });
      });
  } catch (e) { console.log('website donations not read: ' + e); }
  cache.put(ck, JSON.stringify(out), 600);
  return out;
}

function paidOnline_(r, web) {
  if (/\b(online|website|crossbar)\b/i.test(r.paidText + ' ' + r.notes)) return true;
  var who = nameKey_(r.contact);
  if (!who) return false;
  var flip = who.split(' ').reverse().join(' ');   // "Camerano Jason" is "Jason Camerano"
  return web.some(function (d) { return (d.name === who || d.name === flip) && Math.abs(d.amount - r.amount) < 0.01; });
}

// Paid rows with an email, from the sheet, with what has happened to each.
function receiptRows_() {
  var tab = bookTab_(sponsorSpreadsheet_(), SPONSOR_TAB);
  if (!tab) return [];
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), email: col(/^email/), address: col(/^address/),
            amount: col(/^amount/), paid: col(/^paid/), notes: col(/^notes?$/) };
  if (c.company < 0 || c.amount < 0 || c.paid < 0 || c.email < 0) return [];
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var log = receiptLog_(), web = null, out = [];
  tab.rows.forEach(function (r) {
    var row = { row: r.row, company: get(r, 'company'), contact: get(r, 'contact'), email: firstEmail_(get(r, 'email')),
                address: get(r, 'address'), amount: parseAmount_(get(r, 'amount')), paidText: get(r, 'paid'), notes: get(r, 'notes') };
    if (!row.company || row.amount <= 0 || !isYes_(row.paidText) || !row.email) return;
    row.key = receiptKey_(row);
    var done = log[row.key];
    if (done) { row.status = done.how; row.at = done.at; }
    else {
      web = web || websiteDonations_();
      row.status = paidOnline_(row, web) ? 'website' : 'ready';
    }
    out.push(row);
  });
  return out;
}

// ---------- the email ----------

function receiptEmail_(r, s, when) {
  var e = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  var date = Utilities.formatDate(when || new Date(), 'America/New_York', 'MMMM d, yyyy');
  var amount = money_(r.amount);
  var subject = 'Your ' + SEASON + ' donation receipt from ' + RECEIPT_ORG;
  var ein = s.ein || 'EIN NOT SET';
  var taxLine = RECEIPT_ORG + ' is a 501(c)(3) charitable, tax-exempt organization. Our federal EIN number is ' + ein + '.';
  var noGoods = 'The donor received no goods or services in return for this contribution.';
  var rows = [['Donor', r.company], ['Contact', r.contact], ['Address', r.address], ['Donation amount', amount], ['Date', date]]
    .filter(function (x) { return x[1]; });

  var cell = 'padding:10px 0;border-bottom:1px solid #E3E6EE;font-size:15px;vertical-align:top;';
  var html =
    '<div style="background:#F4F6FA;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#0B1120">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E3E6EE;border-radius:12px;border-collapse:separate;overflow:hidden">' +
    '<tr><td style="background:#0a1628;padding:20px 24px;color:#ffffff">' +
      '<div style="font-size:20px;font-weight:bold;line-height:1.25">' + e(RECEIPT_ORG) + '</div>' +
      (s.address ? '<div style="font-size:13px;color:#C9D2E8;margin-top:4px">' + e(s.address) + '</div>' : '') +
      '<div style="font-size:12px;letter-spacing:1.5px;color:#9FB3E6;margin-top:14px;font-weight:bold">NON-PROFIT DONATION RECEIPT</div>' +
    '</td></tr>' +
    '<tr><td style="padding:20px 24px 4px">' +
      '<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Thank you for supporting ' + e(RECEIPT_ORG) + '. Please keep this receipt for your tax records.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">' +
      rows.map(function (x) {
        var big = x[0] === 'Donation amount';
        return '<tr><td style="' + cell + 'color:#5B6478;width:40%">' + e(x[0]) + '</td>' +
          '<td style="' + cell + (big ? 'font-size:20px;font-weight:bold;color:#1A56DB' : '') + '">' + e(x[1]) + '</td></tr>';
      }).join('') +
      '</table>' +
      '<p style="margin:16px 0 0;font-size:14px;line-height:1.5">' + e(noGoods) + '</p>' +
      '<p style="margin:12px 0 0;font-size:14px;line-height:1.5">Issued by ' + e(s.issuer || 'NOT SET') + '</p>' +
      '<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#5B6478">' + e(taxLine) + '</p>' +
    '</td></tr>' +
    (s.packetUrl ?
      '<tr><td style="padding:16px 24px 24px">' +
        '<div style="background:#EEF3FF;border-radius:10px;padding:16px">' +
          '<div style="font-size:15px;font-weight:bold;margin-bottom:6px">Next: your sponsor info</div>' +
          '<div style="font-size:14px;line-height:1.5;margin-bottom:12px">Pick your sponsorship level and send us your logo and details so we can recognize you.</div>' +
          '<a href="' + e(s.packetUrl) + '" style="display:inline-block;background:#1A56DB;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:10px 18px;border-radius:8px">Open the sponsor packet</a>' +
        '</div>' +
      '</td></tr>' : '<tr><td style="padding:0 0 20px"></td></tr>') +
    '</table></div>';

  var text = [RECEIPT_ORG, s.address, '', 'NON-PROFIT DONATION RECEIPT', '']
    .concat(rows.map(function (x) { return x[0] + ': ' + x[1]; }))
    .concat(['', noGoods, 'Issued by ' + (s.issuer || 'NOT SET'), '', taxLine])
    .concat(s.packetUrl ? ['', 'Next: pick your sponsorship level and send us your info:', s.packetUrl] : [])
    .join('\n');
  return { subject: subject, html: html, text: text };
}

// ---------- the app's actions ----------

function receiptList() {
  var s = receiptSettings_();
  return {
    settings: { missing: s.missing, live: s.live, testTo: s.testTo ? true : false, packet: !!s.packetUrl },
    items: receiptRows_().map(function (r) {
      return { key: r.key, row: r.row, company: r.company, email: r.email, amount: money_(r.amount), status: r.status, at: r.at || '' };
    })
  };
}

function findReceiptRow_(key) {
  return receiptRows_().filter(function (r) { return r.key === String(key || ''); })[0] || null;
}

function receiptPreview(data) {
  var r = findReceiptRow_(data.key);
  if (!r) return fail('That row is no longer marked paid with an email.');
  var s = receiptSettings_(), m = receiptEmail_(r, s);
  return ok({ subject: m.subject, html: m.html, to: s.live ? r.email : (s.testTo ? 'test address' : ''), live: s.live });
}

// One tap from a board member sends one receipt. Never called on a schedule.
function receiptSend(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var s = receiptSettings_();
  if (s.missing.length) return fail('Receipts are not set up yet: missing ' + s.missing.join(', ') + ' (Script Properties).');
  if (!s.live && !s.testTo) return fail('Receipts are in test mode with no test address set.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is sending one right now. Try again in a moment.');
  try {
    var r = findReceiptRow_(data.key);
    if (!r) return fail('That row is no longer marked paid with an email.');
    if (r.status === 'sent') return fail('That receipt was already sent' + (r.at ? ' on ' + r.at : '') + '.');
    if (r.status === 'website' && !data.anyway) return fail('The website already sent this one its receipt.');
    var m = receiptEmail_(r, s);
    var to = s.live ? r.email : s.testTo;
    MailApp.sendEmail({ to: to, subject: (s.live ? '' : '[TEST] ') + m.subject, body: m.text, htmlBody: m.html, name: RECEIPT_ORG });
    var log = receiptLog_();
    var at = dayOf_(new Date());
    if (s.live) { log[r.key] = { how: 'sent', at: at }; saveReceiptLog_(log); }
    return ok({ message: s.live ? 'Receipt sent to ' + r.email + '.' : 'Test receipt sent to the test address. The row stays ready.', status: s.live ? 'sent' : 'ready', at: at });
  } finally {
    lock.releaseLock();
  }
}

// "Website sent it" (or "Not needed"), and undo for either.
function receiptMark(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var key = String(data.key || ''), how = String(data.how || '');
  var log = receiptLog_();
  if (how === 'undo') {
    if (log[key] && log[key].how === 'sent') return fail('A sent receipt stays marked sent.');
    delete log[key];
  } else if (how === 'website' || how === 'skip') {
    if (!findReceiptRow_(key)) return fail('That row is no longer marked paid with an email.');
    log[key] = { how: how, at: dayOf_(new Date()) };
  } else return fail('Unknown choice.');
  saveReceiptLog_(log);
  return ok({ message: 'Saved.' });
}

/**
 * Donation receipts for paid sponsors. Lives next to Code.gs and Season.gs in
 * the same Apps Script project (Files → + → Script, name it "Receipts").
 *
 *   sponsorship sheet: a row marked Paid, with an email, amount over $0
 *        │  read only; this file never writes to that sheet
 *        ▼
 *   Sponsors tab: "Receipts to send" lists each one, with a preview
 *        │  Nate gets one heads-up email per new one (receiptPing, hourly)
 *        │  a sponsorship editor taps Send (a receipt is never sent on its own)
 *        ▼
 *   one email to the sponsor: the donation receipt plus the sponsor packet link
 *        │
 *        ▼
 *   RECEIPTS_<season> Script Property remembers it as sent, and the day
 *
 * Every paid row on the sponsor list gets this receipt, online and check
 * payers alike, so for a sponsor the league site's own receipt button is
 * not used. Plain donations from people who aren't on the sponsor list
 * never show here: those keep the website's receipt button.
 *
 * What the receipt says about the league comes from Script Properties, so no
 * address, tax ID, name or link is written in this public file:
 *   RECEIPT_ORG_ADDRESS   the league's mailing address, as on the old receipt
 *   RECEIPT_EIN           the league's federal EIN, as on the old receipt
 *   RECEIPT_ISSUER        who issues it, e.g. "Name, President"
 *   SPONSOR_PACKET_URL    the sponsor info packet page (changes when it moves)
 *   RECEIPTS_TEST_TO      while testing, every receipt goes to this one address
 *   RECEIPTS_LIVE         "on" sends to sponsors; anything else is test mode
 *   RECEIPTS_PING_TO      who gets the "receipt ready" heads-up (default: the
 *                         account this script runs as); never a sponsor
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

function receiptRows_() {
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return [];
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), email: col(/^email/), address: col(/^address/),
            amount: col(/^amount/), paid: col(/^paid\??$/), notes: col(/^notes?$/), how: col(/^(paid how|payment method|paid by)/) };
  if (c.company < 0 || c.amount < 0 || c.paid < 0 || c.email < 0) return [];
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var log = receiptLog_(), out = [];
  tab.rows.forEach(function (r) {
    var row = { row: r.row, company: get(r, 'company'), contact: get(r, 'contact'), email: firstEmail_(get(r, 'email')),
                address: get(r, 'address'), amount: parseAmount_(get(r, 'amount')), paidText: get(r, 'paid'), notes: get(r, 'notes'), how: get(r, 'how') };
    if (!row.company || row.amount <= 0 || !isYes_(row.paidText) || !row.email) return;
    row.key = receiptKey_(row);
    row.online = /\b(online|website|crossbar|card)\b/i.test(row.how || (row.paidText + ' ' + row.notes));
    row.inKind = /\bin.?kind\b/i.test(row.how || '');
    // An upgrade paid after an earlier receipt: this receipt is for the new
    // money only, with the season's total under it, so nothing is counted twice.
    var pre = companyKey_(row.company) + '|' + row.email.toLowerCase() + '|', before = 0;
    Object.keys(log).forEach(function (k) {
      var cents = Number(k.slice(pre.length));
      if (k.indexOf(pre) === 0 && log[k].how === 'sent' && cents > 0 && cents < Math.round(row.amount * 100)) before = Math.max(before, cents);
    });
    if (before) { row.total = row.amount; row.given = row.amount - before / 100; }
    var done = log[row.key];
    if (done && done.how !== 'website') { row.status = done.how; row.at = done.at; }
    else row.status = 'ready';
    out.push(row);
  });
  return out;
}

// ---------- the email ----------

function receiptEmail_(r, s, when) {
  var e = function (v) { return String(v == null ? '' : v).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  var date = Utilities.formatDate(when || new Date(), 'America/New_York', 'MMMM d, yyyy');
  var amount = money_(r.given || r.amount);
  var subject = 'Your ' + SEASON + ' donation receipt from ' + RECEIPT_ORG;
  var ein = s.ein || 'EIN NOT SET';
  var taxLine = RECEIPT_ORG + ' is a 501(c)(3) charitable, tax-exempt organization. Our federal EIN number is ' + ein + '.';
  var noGoods = 'The donor received no goods or services in return for this contribution.';
  // A gift of goods or services: the receipt says what kind of gift it was
  // and puts no dollar value on it.
  var rows = (r.inKind
    ? [['Donor', r.company], ['Contact', r.contact], ['Address', r.address], ['Donation', 'In-kind gift of goods or services'], ['Date', date]]
    : [['Donor', r.company], ['Contact', r.contact], ['Address', r.address], ['Donation amount', amount], ['Season total', r.given ? money_(r.total) : ''], ['Payment method', r.how], ['Date', date]])
    .filter(function (x) { return x[1]; });

  var thanks = 'Thank you' + (r.company ? ', ' + r.company + ',' : '') + ' for sponsoring ' + RECEIPT_ORG + ' this season!';

  var cell = 'padding:10px 0;border-bottom:1px solid #E3E6EE;font-size:15px;vertical-align:top;';
  // Laid out like the league's Crossbar emails, so both read as coming from
  // the same place: a light grey page, the league logo centred on it, then a
  // white card with rounded top corners, and a small grey footer.
  var col = 'max-width:650px;margin:0 auto;';
  var html =
    '<div class="rc-outer" style="background:#F7F7F7;padding:30px 12px;font-family:Arial,Helvetica,sans-serif;color:#0B1120">' +
    // Header: the league logo, centred above everything.
    '<div class="rc-head" style="' + col + 'text-align:center;padding:0 0 24px">' +
      '<img src="' + e(leagueLogoUrl_()) + '" width="240" height="100" alt="' + e(RECEIPT_ORG) + '" style="display:inline-block;width:240px;height:100px;border:0">' +
    '</div>' +
    // The opening line: a thank-you to the sponsor by name. Left off the PDF
    // and the printed copy, which are the tax receipt.
    '<!--ty--><div class="rc-ty" style="' + col + 'margin-bottom:20px;font-size:20px;font-weight:bold;line-height:1.35;color:#0a1628">' + e(thanks) + '</div><!--/ty-->' +
    // The sponsor packet: its own card above the receipt, with clear space
    // between, so a screenshot of the receipt stays clean. Left off the PDF.
    (s.packetUrl ?
      '<!--pk--><table role="presentation" class="rc-packet" cellpadding="0" cellspacing="0" width="100%" style="' + col + 'margin-bottom:28px;background:#EEF3FF;border:1px solid #C9D6FF;border-radius:20px;border-collapse:separate">' +
        '<tr><td style="padding:24px 30px">' +
          '<div style="font-size:17px;font-weight:bold;margin-bottom:6px;color:#0a1628">One more step: your sponsor info packet</div>' +
          '<div style="font-size:14px;line-height:1.5;margin-bottom:14px">Send us your logo and business details so we can put you on your banner, jersey and our social posts. It takes about five minutes.</div>' +
          '<a href="' + e(s.packetUrl) + '" style="display:inline-block;background:#2E52E8;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 20px;border-radius:8px">Fill out your sponsor packet</a>' +
        '</td></tr></table><!--/pk-->' : '') +
    '<table role="presentation" class="rc-card" cellpadding="0" cellspacing="0" width="100%" style="' + col + 'background:#ffffff;border-radius:20px 20px 0 0;border-collapse:separate;overflow:hidden">' +
    '<tr><td style="padding:30px 30px 4px">' +
      '<div style="font-size:12px;letter-spacing:1.5px;color:#5B6478;font-weight:bold;margin-bottom:6px">NON-PROFIT DONATION RECEIPT</div>' +
      '<div style="font-size:18px;font-weight:bold;line-height:1.25;color:#0a1628">' + e(RECEIPT_ORG) + '</div>' +
      (s.address ? '<div style="font-size:13px;color:#5B6478;margin-top:3px">' + e(s.address) + '</div>' : '') +
    '</td></tr>' +
    '<tr><td style="padding:16px 30px 4px">' +
      '<p style="margin:0 0 14px;font-size:15px;line-height:1.5">Thank you for supporting ' + e(RECEIPT_ORG) + '. <!--pdf-->Your receipt is attached as a PDF to print or save for your taxes.<!--/pdf--></p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">' +
      rows.map(function (x) {
        var big = x[0] === 'Donation amount';
        return '<tr><td style="' + cell + 'color:#5B6478;width:40%">' + e(x[0]) + '</td>' +
          '<td style="' + cell + (big ? 'font-size:20px;font-weight:bold;color:#1A56DB' : '') + '">' + e(x[1]) + '</td></tr>';
      }).join('') +
      '</table>' +
      '<p style="margin:16px 0 0;font-size:14px;line-height:1.5">' + e(noGoods) + '</p>' +
      '<p style="margin:16px 0 0;font-size:14px;line-height:1.5">Sincerely,<br><b>' + e(RECEIPT_ORG) + '</b><br>' + e(s.issuer || 'NOT SET') + '</p>' +
      '<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:#5B6478">' + e(taxLine) + '</p>' +
    '</td></tr>' +
    '<tr><td style="padding:0 0 30px"></td></tr>' +
    '</table>' +
    // Footer, small and grey like Crossbar's: the league and its address.
    '<div class="rc-foot" style="' + col + 'padding:18px 0 0;text-align:center;font-size:11px;line-height:1.5;color:#999999">' +
      e(RECEIPT_ORG) + (s.address ? ' · ' + e(s.address) : '') +
    '</div>' +
    '</div>';

  var text = [thanks, ''].concat(s.packetUrl ? ['One more step: your sponsor info packet', 'Send us your logo and business details so we can put you on your banner, jersey and our social posts. It takes about five minutes.', 'Fill out your sponsor packet: ' + s.packetUrl, '', '----------', ''] : [])
    .concat([RECEIPT_ORG, s.address, '', 'NON-PROFIT DONATION RECEIPT', '', 'Thank you for supporting ' + RECEIPT_ORG + '. Your receipt is attached as a PDF to print or save for your taxes.', ''])
    .concat(rows.map(function (x) { return x[0] + ': ' + x[1]; }))
    .concat(['', noGoods, '', 'Sincerely,', RECEIPT_ORG, (s.issuer || 'NOT SET'), '', taxLine])
    .join('\n');
  return { subject: subject, html: html, text: text };
}

// The receipt as a page of its own: prints on one sheet, without the grey
// surround or the packet card.
function receiptDoc_(html, title) {
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + String(title).replace(/[<>&]/g, '') + '</title>' +
    '<style>@page{size:letter;margin:12mm}body{margin:0;background:#fff}' +
    '@media print{.rc-outer{background:#fff!important;padding:0!important}.rc-packet,.rc-ty{display:none!important}}</style></head><body>' +
    html + '</body></html>';
}

// The same receipt as a PDF, to attach. The logo goes in as data, since the
// PDF maker doesn't fetch pictures. Returns null if it can't be made.
function receiptPdf_(r, s, when) {
  try {
    var m = receiptEmail_(r, s, when), logo = logoDataUri_();
    var html = m.html.split('src="' + leagueLogoUrl_() + '"').join(logo ? 'src="' + logo + '"' : 'src=""')
      .replace(/<!--ty-->[\s\S]*?<!--\/ty-->/, '')
      .replace(/<!--pk-->[\s\S]*?<!--\/pk-->/, '')
      .replace(/<!--pdf-->[\s\S]*?<!--\/pdf-->/, 'Please keep this receipt for your tax records.');
    var doc = receiptDoc_(html.replace('background:#F7F7F7;padding:30px 12px', 'background:#ffffff;padding:0'), m.subject);
    var name = 'LYBS ' + SEASON + ' donation receipt - ' + String(r.company).replace(/[^\w &.'-]+/g, '').trim() + '.pdf';
    return HtmlService.createHtmlOutput(doc).getBlob().getAs(MimeType.PDF).setName(name);
  } catch (e) { console.log('receipt pdf: ' + e); return null; }
}

// ---------- the app's actions ----------

function receiptList() {
  var s = receiptSettings_();
  return {
    settings: { missing: s.missing, live: s.live, testTo: s.testTo ? true : false, packet: true, sender: senderSettings_().connected },
    items: receiptRows_().map(function (r) {
      return { key: r.key, row: r.row, company: r.company, email: r.email, amount: r.inKind ? 'In kind' : money_(r.given || r.amount), status: r.status, at: r.at || '', online: !!r.online, inKind: !!r.inKind };
    })
  };
}

function findReceiptRow_(key) {
  return receiptRows_().filter(function (r) { return r.key === String(key || ''); })[0] || null;
}

function receiptPreview(data) {
  var r = findReceiptRow_(data.key);
  if (!r) return fail('That row is no longer marked paid with an email.');
  // A sent receipt reopens with the day it was sent, ready to print again.
  var when = r.status === 'sent' && /^\d{4}-\d{2}-\d{2}$/.test(r.at || '') ? new Date(r.at + 'T12:00:00') : null;
  var s = receiptSettings_();
  s.packetUrl = sponsorPageLink_(r) || s.packetUrl;
  var m = receiptEmail_(r, s, when);
  return ok({ subject: m.subject, html: receiptDoc_(m.html, m.subject), to: s.live ? r.email : (s.testTo ? 'test address' : ''), live: s.live, sent: r.status === 'sent' });
}

// One tap from a board member sends one receipt. Never called on a schedule.
function receiptSend(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send receipts.');
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
    s.packetUrl = sponsorPageLink_(r) || s.packetUrl;
    var m = receiptEmail_(r, s);
    var to = s.live ? r.email : s.testTo;
    var pdf = receiptPdf_(r, s);
    var how = leagueSend_({ to: to, subject: m.subject, text: m.text, html: m.html, live: s.live, attachments: pdf ? [pdf] : null });
    if (!how.ok) return fail(how.error);
    var log = receiptLog_();
    var at = dayOf_(new Date());
    if (s.live) { log[r.key] = { how: 'sent', at: at }; saveReceiptLog_(log); noteOnBoardCopy_(r.company, 'Receipt sent', at); }
    return ok({ message: s.live ? 'Receipt sent to ' + r.email + '.' : 'Test receipt sent to the test address. The row stays ready.', status: s.live ? 'sent' : 'ready', at: at });
  } finally {
    lock.releaseLock();
  }
}

// "Not needed", and undo.
function receiptMark(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can change a receipt.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var key = String(data.key || ''), how = String(data.how || '');
  var log = receiptLog_();
  if (how === 'undo') {
    if (log[key] && log[key].how === 'sent') return fail('A sent receipt stays marked sent.');
    delete log[key];
  } else if (how === 'skip') {
    if (!findReceiptRow_(key)) return fail('That row is no longer marked paid with an email.');
    log[key] = { how: how, at: dayOf_(new Date()) };
  } else return fail('Unknown choice.');
  saveReceiptLog_(log);
  return ok({ message: 'Saved.' });
}

// ---------- heads-up email to Nate ----------
// Once an hour (installReceiptPing sets that up), a receipt that has just
// started waiting gets one short email to Nate, never to a sponsor, with a
// link to the Sponsors tab. Each receipt is mentioned once. Sending the
// receipt itself still takes the tap in the app.
var RECEIPTS_PINGED_PROP = 'RECEIPTS_PINGED_' + SEASON;

function receiptPing() {
  var p = PropertiesService.getScriptProperties();
  var to = firstEmail_(p.getProperty('RECEIPTS_PING_TO') || '') || Session.getEffectiveUser().getEmail();
  if (!to) return;
  var pinged = {};
  try { pinged = JSON.parse(p.getProperty(RECEIPTS_PINGED_PROP) || '{}'); } catch (e) { pinged = {}; }
  var fresh = receiptRows_().filter(function (r) { return r.status === 'ready' && !pinged[r.key]; });
  if (!fresh.length) return;
  var n = fresh.length;
  var lines = fresh.map(function (r) { return '- ' + r.company + ', ' + money_(r.amount); });
  MailApp.sendEmail({
    to: to,
    subject: n + ' sponsor receipt' + (n === 1 ? '' : 's') + ' ready to send',
    body: (n === 1 ? 'A sponsor receipt is' : n + ' sponsor receipts are') + ' waiting for your tap:\n\n' + lines.join('\n') +
      '\n\nOpen the Sponsors tab to preview and send:\n' + APP_URL + '#sponsors\n\nNothing goes to a sponsor until someone taps Send.',
    name: 'LYBS Sponsors app'
  });
  fresh.forEach(function (r) { pinged[r.key] = dayOf_(new Date()); });
  p.setProperty(RECEIPTS_PINGED_PROP, JSON.stringify(pinged));
}

// Run once from the editor to start the hourly heads-up; run again to keep just one.
function installReceiptPing() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'receiptPing') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('receiptPing').timeBased().everyHours(1).create();
  console.log('Hourly receipt heads-up is on.');
}

function removeReceiptPing() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'receiptPing') ScriptApp.deleteTrigger(t);
  });
  console.log('Hourly receipt heads-up is off.');
}

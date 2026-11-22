/**
 * Every email the Sponsors app sends to a sponsor (receipts and follow-ups)
 * goes through leagueSend_, so it comes from the league's own address.
 * Lives next to Code.gs (Files → + → Script, name it "Mail").
 *
 *   SEND_FROM         the league's address. Best set up as a "Send mail as"
 *                     address in the Gmail of the account that owns this
 *                     script, so mail comes from it.
 *   SEND_AS_MY_GMAIL  "on" lets mail to sponsors go out before that is set
 *                     up: it comes from the owner's own Gmail under the
 *                     league's name, and replies go to SEND_FROM.
 *
 * With neither, nothing goes to a sponsor: live sends are refused, and test
 * sends (only ever to the test address) come from the owner's own Gmail with
 * the league address as the reply-to. Everything goes through sendGuarded_
 * below, which only sends this app's own emails to the sponsor's own
 * address. The script asks Google only to send email as the owner (not to
 * read or delete it), so the league address can't be used as "Send mail as"
 * from here: mail comes from the owner's Gmail under the league's name, and
 * replies go to the league address. No address is written in this public file.
 */

// The league logo for letterheads. It's the public league logo the app's own
// site serves; LEAGUE_LOGO_URL overrides it. Sends attach it inline so it
// shows even where a mail app blocks outside pictures.
var LEAGUE_LOGO_DEFAULT = 'https://lybs-sponsors.web.app/icons/lybs-wordmark.png';
function leagueLogoUrl_() {
  var u = String(PropertiesService.getScriptProperties().getProperty('LEAGUE_LOGO_URL') || '').trim();
  return /^https:\/\//.test(u) ? u : LEAGUE_LOGO_DEFAULT;
}

function inlineLogo_(html) {
  var url = leagueLogoUrl_();
  if (String(html).indexOf('src="' + url + '"') < 0) return { html: html, images: null };
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return { html: html, images: null };
    return { html: html.split('src="' + url + '"').join('src="cid:lybslogo"'), images: { lybslogo: res.getBlob().setName('lybs-logo.png') } };
  } catch (e) { console.log('logo: ' + e); return { html: html, images: null }; }
}

function logoDataUri_() {
  try {
    var res = UrlFetchApp.fetch(leagueLogoUrl_(), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return '';
    return 'data:image/png;base64,' + Utilities.base64Encode(res.getBlob().getBytes());
  } catch (e) { console.log('logo: ' + e); return ''; }
}

function senderSettings_() {
  var from = firstEmail_(PropertiesService.getScriptProperties().getProperty('SEND_FROM') || '');
  // Sending as the league address needs full Gmail access, which this script
  // no longer asks for. Mail goes from the owner's Gmail, replies to the league.
  var connected = false;
  var mine = String(PropertiesService.getScriptProperties().getProperty('SEND_AS_MY_GMAIL') || '').trim().toLowerCase() === 'on';
  // ready: something may go to a sponsor. via: how it would go out.
  var ready = connected || (mine && !!from);
  return { from: from, connected: connected, mine: mine, ready: ready, via: connected ? 'league' : ready ? 'mine' : '' };
}

// m: { kind, company, to, subject, text, html, live }. Returns { ok, from } or { ok: false, error }.
function leagueSend_(m) {
  var s = senderSettings_();
  if (m.live && !s.ready) {
    return { ok: false, error: s.from
      ? 'Turn on SEND_AS_MY_GMAIL to send from your Gmail under the league’s name, so nothing was sent.'
      : 'Set SEND_FROM to the league address before anything goes to a sponsor.' };
  }
  var lg = inlineLogo_(m.html);
  // The owner's own Gmail, under the league's name, replies to the league.
  var sent = sendGuarded_(m.kind, { company: m.company, to: m.to, cc: m.cc, editorCc: m.editorCc, test: !m.live, subject: (m.live ? '' : '[TEST] ') + m.subject,
    text: m.text, html: lg.html, name: RECEIPT_ORG, replyTo: s.from, attachments: m.attachments, inlineImages: lg.images });
  return sent.ok ? { ok: true, from: '' } : sent;
}

// A heads-up to the board member who owns this script (never a sponsor).
// The run's log says whether it went, so a missing alert can be traced.
function ownerAlert_(to, subject, body, name) {
  if (!to) { console.log('alert not sent, no address: ' + subject); return false; }
  try {
    var r = sendGuarded_('notice', { to: to, subject: subject, text: body, name: name || 'LYBS Sponsors app' });
    console.log((r.ok ? 'alert sent: ' : 'alert refused: ') + subject);
    return r.ok;
  } catch (e) { console.log('alert failed: ' + subject + ': ' + e); return false; }
}

// ---------- the one way out: every email this script sends ----------
// Google's "send email as you" access can't be limited to some addresses, so
// the limit is here. Every email goes through sendGuarded_, which sends only:
//   - one of this app's own emails (MAIL_KINDS below), one at a time
//   - a sponsor email only to an address on that sponsor's own row (the
//     board sheet's row, or the 2027 banners row for the info request), with
//     a CC only to another address on that same row or the league address
//     (a receipt also takes the CC a sponsorship editor typed in its box)
//   - a notice only to the script owner (or the RECEIPTS_PING_TO address
//     the owner set in Script Properties)
//   - a test only to the test address (RECEIPTS_TEST_TO) or the owner
// Never a BCC. Anything else is refused, sends nothing, and is logged
// (MAIL_REFUSED in Script Properties keeps the last 50).
var MAIL_KINDS = { receipt: 'sponsor', followup: 'sponsor', outreach: 'sponsor', welcome: 'sponsor', inforequest: 'sponsor', notice: 'owner' };
var MAIL_REFUSED_PROP = 'MAIL_REFUSED';
var EMAIL_RE_G = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

function emailsIn_(s) { return (String(s || '').match(EMAIL_RE_G) || []).map(function (a) { return a.toLowerCase(); }); }

// Every address written anywhere on this sponsor's row(s).
function sponsorRowAddresses_(company) {
  var key = companyKey_(company), out = [];
  if (!key) return out;
  try {
    var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
    if (tab) {
      var c = -1;
      tab.headers.forEach(function (h, i) { if (c < 0 && /^(company|business)/i.test(String(h).trim())) c = i; });
      tab.rows.forEach(function (r) {
        if (c >= 0 && companyKey_(r.cells[c]) === key) r.cells.forEach(function (v) { out = out.concat(emailsIn_(v)); });
      });
    }
  } catch (e) { console.log('mail guard, board row: ' + e); }
  try {
    readSeason_().rows.forEach(function (r) { if (String(r.key) === key) out = out.concat(emailsIn_(r.contactEmail)); });
  } catch (e) { console.log('mail guard, 2027 row: ' + e); }
  return out;
}

function refuseMail_(kind, m, why) {
  var line = { at: new Date().toISOString(), kind: String(kind), company: String(m.company || ''), why: why };
  console.log('MAIL REFUSED: ' + JSON.stringify(line));
  try {
    var p = PropertiesService.getScriptProperties();
    var list = JSON.parse(p.getProperty(MAIL_REFUSED_PROP) || '[]');
    list.push(line);
    p.setProperty(MAIL_REFUSED_PROP, JSON.stringify(list.slice(-50)));
  } catch (e) { }
  return { ok: false, error: 'This app can’t send that email: ' + why + ' Nothing was sent.' };
}

// The check alone, for a send and for a draft. Returns null when it's allowed.
function mailCheck_(kind, m) {
  var who = MAIL_KINDS[kind];
  if (!who) return 'it isn’t one of this app’s own emails.';
  if (m.bcc) return 'it has a BCC.';
  var to = emailsIn_(m.to), cc = emailsIn_(m.cc);
  if (to.length !== 1 || String(m.to).split(/[,;]/).length > 1) return 'it must go to exactly one address.';
  if (!String(m.subject || '').trim() || !String(m.text || '').trim()) return 'it has no subject or text.';
  var owner = '';
  try { owner = String(myEmail_() || '').toLowerCase(); } catch (e) { console.log('mail guard, owner: ' + e); }
  var p = PropertiesService.getScriptProperties();
  if (who === 'owner') {
    // The owner, or the heads-up address the owner set in Script Properties.
    var ok = [owner].concat(emailsIn_(p.getProperty('RECEIPTS_PING_TO'))).filter(String);
    if (ok.indexOf(to[0]) < 0 || cc.length) return 'a notice only goes to the script owner.';
    return null;
  }
  var test = firstEmail_(p.getProperty('RECEIPTS_TEST_TO') || '').toLowerCase();
  if (m.test) {
    if (cc.length || (to[0] !== test && to[0] !== owner)) return 'a test only goes to the test address.';
    return null;
  }
  if (!m.company) return 'it doesn’t say which sponsor it’s for.';
  var mine = sponsorRowAddresses_(m.company);
  if (mine.indexOf(to[0]) < 0) return to[0] + ' isn’t on ' + m.company + '’s row on the sheet.';
  var league = emailsIn_(p.getProperty('SEND_FROM')).concat(emailsIn_(typeof LEAGUE_CC === 'string' ? LEAGUE_CC : ''));
  // A receipt may also CC the one or two addresses a sponsorship editor typed
  // in its CC box for this sponsor (checked and capped in Receipts.gs).
  var typed = kind === 'receipt' ? emailsIn_(m.editorCc).slice(0, 2) : [];
  var bad = cc.filter(function (a) { return mine.indexOf(a) < 0 && league.indexOf(a) < 0 && typed.indexOf(a) < 0; });
  if (bad.length) return 'the CC ' + bad.join(', ') + ' isn’t on ' + m.company + '’s row. Add it to their row first.';
  return null;
}

// m: { company, to, cc, subject, text, html, name, replyTo, attachments, inlineImages, test }
function sendGuarded_(kind, m) {
  var why = mailCheck_(kind, m);
  if (why) return refuseMail_(kind, m, why);
  var o = {};
  if (m.html) o.htmlBody = m.html;
  if (m.name) o.name = m.name;
  if (m.replyTo) o.replyTo = m.replyTo;
  if (m.cc) o.cc = emailsIn_(m.cc).join(',');
  if (m.attachments) o.attachments = m.attachments;
  if (m.inlineImages) o.inlineImages = m.inlineImages;
  MailApp.sendEmail(emailsIn_(m.to)[0], m.subject, m.text, o);
  return { ok: true };
}

// A Gmail draft for the owner to check and send: the same check, then saved
// with Gmail's own draft access (no reading or deleting mail).
function draftGuarded_(kind, m) {
  var why = mailCheck_(kind, m);
  if (why) return refuseMail_(kind, m, why);
  var enc = function (s) { return '=?UTF-8?B?' + Utilities.base64Encode(String(s), Utilities.Charset.UTF_8) + '?='; };
  var b = 'lybs' + Utilities.getUuid().replace(/-/g, '');
  var lines = ['MIME-Version: 1.0',
    'From: ' + (m.name ? enc(m.name) + ' ' : '') + '<' + myEmail_() + '>',
    'To: ' + emailsIn_(m.to)[0]];
  if (m.cc) lines.push('Cc: ' + emailsIn_(m.cc).join(', '));
  lines.push('Subject: ' + enc(m.subject), 'Content-Type: multipart/alternative; boundary="' + b + '"', '',
    '--' + b, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Utilities.base64Encode(m.text, Utilities.Charset.UTF_8),
    '--' + b, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Utilities.base64Encode(m.html || m.text, Utilities.Charset.UTF_8),
    '--' + b + '--');
  Gmail.Users.Drafts.create({ message: { raw: Utilities.base64EncodeWebSafe(lines.join('\r\n'), Utilities.Charset.UTF_8) } }, 'me');
  return { ok: true };
}


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
 * the league address as the reply-to. Everything goes through GmailApp, so a
 * copy of each email sits in the owner's Sent folder. No address is written
 * in this public file.
 */

// The league logo for letterheads. It's the public league logo the app's own
// site serves; LEAGUE_LOGO_URL overrides it. Sends attach it inline so it
// shows even where a mail app blocks outside pictures.
var LEAGUE_LOGO_DEFAULT = 'https://natesteele888.github.io/sponsor-banner-inventory/icons/lybs-wordmark.png';
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
  var connected = false;
  if (from) {
    try {
      connected = GmailApp.getAliases().map(function (a) { return String(a).toLowerCase(); }).indexOf(from) >= 0;
    } catch (e) { console.log('aliases: ' + e); }
  }
  var mine = String(PropertiesService.getScriptProperties().getProperty('SEND_AS_MY_GMAIL') || '').trim().toLowerCase() === 'on';
  // ready: something may go to a sponsor. via: how it would go out.
  var ready = connected || (mine && !!from);
  return { from: from, connected: connected, mine: mine, ready: ready, via: connected ? 'league' : ready ? 'mine' : '' };
}

// m: { to, subject, text, html, live }. Returns { ok, from } or { ok: false, error }.
function leagueSend_(m) {
  var s = senderSettings_();
  if (m.live && !s.ready) {
    return { ok: false, error: s.from
      ? 'The league address is not connected to this Gmail yet ("Send mail as"), so nothing was sent.'
      : 'Set SEND_FROM to the league address before anything goes to a sponsor.' };
  }
  var subject = (m.live ? '' : '[TEST] ') + m.subject;
  var lg = inlineLogo_(m.html);
  if (s.connected) {
    var g = { htmlBody: lg.html, name: RECEIPT_ORG, from: s.from, replyTo: s.from };
    if (lg.images) g.inlineImages = lg.images;
    if (m.attachments) g.attachments = m.attachments;
    GmailApp.sendEmail(m.to, subject, m.text, g);
    return { ok: true, from: s.from };
  }
  // The owner's own Gmail, under the league's name, replies to the league.
  var o = { htmlBody: lg.html, name: RECEIPT_ORG };
  if (lg.images) o.inlineImages = lg.images;
  if (m.attachments) o.attachments = m.attachments;
  if (s.from) o.replyTo = s.from;
  GmailApp.sendEmail(m.to, subject, m.text, o);
  return { ok: true, from: '' };
}

// A heads-up to the board member who owns this script (never a sponsor).
// GmailApp, not MailApp: it also keeps a copy in Sent, and the run's log says
// whether it went, so a missing alert can be traced.
function ownerAlert_(to, subject, body) {
  if (!to) { console.log('alert not sent, no address: ' + subject); return false; }
  try {
    GmailApp.sendEmail(to, subject, body, { name: 'LYBS Sponsors app' });
    console.log('alert sent: ' + subject);
    return true;
  } catch (e) { console.log('alert failed: ' + subject + ': ' + e); return false; }
}

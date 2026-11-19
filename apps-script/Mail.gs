/**
 * Every email the Sponsors app sends to a sponsor (receipts and follow-ups)
 * goes through leagueSend_, so it comes from the league's own address.
 * Lives next to Code.gs (Files → + → Script, name it "Mail").
 *
 *   SEND_FROM   the league's address. It must be set up as a "Send mail as"
 *               address in the Gmail of the account that owns this script.
 *
 * Until that address shows up in this Gmail's "Send mail as" list, nothing
 * goes to a sponsor: live sends are refused, and test sends (only ever to
 * the test address) come from the owner's own Gmail with the league address
 * as the reply-to. No address is written in this public file.
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

function senderSettings_() {
  var from = firstEmail_(PropertiesService.getScriptProperties().getProperty('SEND_FROM') || '');
  var connected = false;
  if (from) {
    try {
      connected = GmailApp.getAliases().map(function (a) { return String(a).toLowerCase(); }).indexOf(from) >= 0;
    } catch (e) { console.log('aliases: ' + e); }
  }
  return { from: from, connected: connected };
}

// m: { to, subject, text, html, live }. Returns { ok, from } or { ok: false, error }.
function leagueSend_(m) {
  var s = senderSettings_();
  if (m.live && !s.connected) {
    return { ok: false, error: s.from
      ? 'The league address is not connected to this Gmail yet ("Send mail as"), so nothing was sent.'
      : 'Set SEND_FROM to the league address before anything goes to a sponsor.' };
  }
  var subject = (m.live ? '' : '[TEST] ') + m.subject;
  var lg = inlineLogo_(m.html);
  if (s.connected) {
    var g = { htmlBody: lg.html, name: RECEIPT_ORG, from: s.from, replyTo: s.from };
    if (lg.images) g.inlineImages = lg.images;
    GmailApp.sendEmail(m.to, subject, m.text, g);
    return { ok: true, from: s.from };
  }
  var o = { to: m.to, subject: subject, body: m.text, htmlBody: lg.html, name: RECEIPT_ORG };
  if (lg.images) o.inlineImages = lg.images;
  if (s.from) o.replyTo = s.from;
  MailApp.sendEmail(o);
  return { ok: true, from: '' };
}

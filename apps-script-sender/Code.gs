/**
 * LYBS Sponsors app: the sender. A small Apps Script project of its own that
 * sends one email from the Gmail of whoever opens it, after they allow it once.
 * It sends only a ticket the Sponsors app signed (Allow.gs there): one email,
 * to one address, for the board member it was made for, once, within 15
 * minutes. It reads nothing and keeps nothing but which tickets were used.
 *
 * Set up (once, by the script owner):
 *   1. New Apps Script project, paste this file and appsscript.json.
 *   2. Script Properties: SENDER_SECRET, the same long random string as in
 *      the Sponsors app's project.
 *   3. Deploy → New deployment → Web app: Execute as "User accessing the web
 *      app", Who has access "Anyone with a Google account". Copy the /exec
 *      link into the Sponsors app's SENDER_URL.
 * Each board member's first send asks Google to let it "Send email as you".
 * That's the one-time Allow. Nothing about a sponsor is written in this file.
 */

var APP_URL_DEFAULT = 'https://lybs-sponsors.web.app/';
var KINDS = { outreach: 1, welcome: 1 };
var EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

function appUrl_() {
  var u = String(PropertiesService.getScriptProperties().getProperty('APP_URL') || '').trim();
  return /^https:\/\/[^\s"<>]+$/.test(u) ? u : APP_URL_DEFAULT;
}
function secret_() { return String(PropertiesService.getScriptProperties().getProperty('SENDER_SECRET') || ''); }
function sig_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(text), secret_())).replace(/=+$/, '');
}
function same_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function esc_(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Checks a ticket. Returns { t } or { error }.
function read_(body, s) {
  if (secret_().length < 24) return { error: 'The sender isn’t set up yet.' };
  if (!/^[A-Za-z0-9_\-]{20,12000}$/.test(String(body || '')) || !same_(sig_(body), s)) return { error: 'This link wasn’t made by the Sponsors app.' };
  var t;
  try { t = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(String(body) + '==='.slice((String(body).length + 3) % 4))).getDataAsString('UTF-8')); }
  catch (e) { return { error: 'This link wasn’t made by the Sponsors app.' }; }
  if (!t || t.v !== 1 || !KINDS[t.kind] || !EMAIL_RE.test(String(t.to)) || !/^[a-f0-9]{32}$/.test(String(t.nonce))) return { error: 'This link wasn’t made by the Sponsors app.' };
  if (!(Number(t.exp) > Date.now())) return { error: 'This link ran out. Go back to the app and tap Send again.' };
  var me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!me || me !== String(t.from).toLowerCase()) return { error: 'You’re signed in to Google as ' + (me || 'someone else') + ', and this email was made for ' + t.from + '. Switch accounts and try again.' };
  return { t: t };
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  var page = HtmlService.createTemplate(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>body{font:16px system-ui,sans-serif;margin:24px;max-width:560px;color:#1d2433}a.b,button{display:inline-block;margin-top:16px;padding:10px 16px;border-radius:8px;background:#1f4fbf;color:#fff;text-decoration:none;border:0;font:inherit}</style>' +
    '<div id="m"><?= msg ?></div><p id="back"><a class="b" target="_top" href="<?= back ?>">Back to the app</a></p>' +
    '<? if (ok) { ?><script>google.script.run.withSuccessHandler(function (r) {' +
    'document.getElementById("m").textContent = r.message;' +
    'if (r.back) document.querySelector("#back a").href = r.back;' +
    '}).withFailureHandler(function () { document.getElementById("m").textContent = "Gmail didn’t take it. Nothing was sent. Go back to the app and try again."; })' +
    '.send(<?!= JSON.stringify(t) ?>, <?!= JSON.stringify(s) ?>);</script><? } ?>');
  var r = p.t ? read_(p.t, p.s) : { error: 'This page sends one email from the Sponsors app. Open it from Send in the app.' };
  page.ok = !r.error;
  page.msg = r.error || ('Sending to ' + r.t.to + ' from your Gmail…');
  page.back = appUrl_() + '#sponsors';
  page.t = String(p.t || ''); page.s = String(p.s || '');
  return page.evaluate().setTitle('LYBS Sponsors: send');
}

// Called from the page above. Sends the one email, once.
function send(body, s) {
  var r = read_(body, s);
  if (r.error) return { message: r.error };
  var t = r.t, cache = CacheService.getScriptCache(), lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { message: 'Busy, nothing was sent. Go back and try again.' };
  try {
    if (cache.get('used_' + t.nonce)) return { message: 'This one already went.', back: appUrl_() + '#sponsors' };
    var html = '<div>' + String(t.text).split('\n\n').map(function (para) {
      return '<p>' + esc_(para).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') + '</p>';
    }).join('') + '</div>';
    var o = { htmlBody: html };
    if (t.name) o.name = String(t.name).slice(0, 80);
    MailApp.sendEmail(String(t.to), String(t.subject).slice(0, 200), String(t.text), o);   // one address, no CC or BCC
    cache.put('used_' + t.nonce, '1', 21600);
  } finally { lock.releaseLock(); }
  return { message: 'Sent to ' + t.to + ' from your Gmail.', back: appUrl_() + '#sent=' + t.nonce + '.' + sig_('sent|' + t.nonce) };
}

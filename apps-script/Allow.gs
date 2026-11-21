/**
 * One-time Allow: board members who don't own this script send outreach and
 * welcome emails from their own Gmail, with their own name, after allowing it
 * once. Lives next to Code.gs (Files → + → Script, name it "Allow").
 *
 *   the app (this project)              the sender (its own small project,
 *                                         apps-script-sender/ in this repo)
 *   checks the row and the email ──►     runs as whoever opens it, so the
 *   with the same guard as every         email goes from their own Gmail.
 *   send (Mail.gs), then signs a         Google asks them to Allow once,
 *   one-use ticket for that one          only "send email as you". It sends
 *   email, to that one address,          only a ticket this app signed, only
 *   for that one board member            to its one address, only once, only
 *                                         for the person it was made for
 *        ◄── "Back to the app" carries a signed note that it went, and the
 *            row is marked like any other send
 *
 * The sender can't send anything this app didn't make and sign, and this
 * app only signs what the mail guard allows. Receipts never go this way:
 * they stay from the script owner under the league's name.
 *
 * Script Properties (both, here and in the sender project):
 *   SENDER_SECRET   a long random string, the same in both projects
 * Here only:
 *   SENDER_URL      the sender's web app link (…/exec)
 * Without both, board members keep the open-in-Gmail way.
 */

var ALLOW_KINDS = { outreach: 1, welcome: 1 };
var ALLOW_TICKET_MINUTES = 15;

function allowSettings_() {
  var p = PropertiesService.getScriptProperties();
  var url = String(p.getProperty('SENDER_URL') || '').trim();
  var secret = String(p.getProperty('SENDER_SECRET') || '');
  var ready = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]+\/exec$/.test(url) && secret.length >= 24;
  return { url: url, secret: secret, ready: ready };
}

function allowSig_(secret, text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(text), secret)).replace(/=+$/, '');
}

function sameText_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var d = 0;
  for (var i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// One signed ticket for one email the guard allows. what: what to mark once
// it went ({ kind, row, company, email }). Returns { url } or { error }.
function allowTicket_(kind, m, what) {
  var a = allowSettings_();
  if (!a.ready) return { error: 'Sending from your own Gmail isn’t set up yet. Use Open in Gmail.' };
  if (!ALLOW_KINDS[kind]) return { error: 'That email can’t go this way.' };
  var me = String(WHO && WHO.email || '').toLowerCase();
  if (!me) return { error: 'Your sign-in has no verified email address.' };
  var why = mailCheck_(kind, m);
  if (why) return { error: refuseMail_(kind, m, why).error };
  var nonce = Utilities.getUuid().replace(/-/g, '');
  var t = { v: 1, kind: kind, to: emailsIn_(m.to)[0], subject: String(m.subject), text: String(m.text),
            name: String(m.name || ''), from: me, exp: Date.now() + ALLOW_TICKET_MINUTES * 60000, nonce: nonce };
  var body = Utilities.base64EncodeWebSafe(JSON.stringify(t), Utilities.Charset.UTF_8).replace(/=+$/, '');
  CacheService.getScriptCache().put('allow_' + nonce, JSON.stringify({ kind: kind, row: what.row, company: what.company, email: t.to, by: me }), 21600);
  return { url: a.url + '?t=' + body + '&s=' + allowSig_(a.secret, body) };
}

// "Back to the app" from the sender: { sent: 'nonce.proof' }. Marks the row
// sent for the board member who sent it, once.
function allowSent(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send these.');
  var a = allowSettings_(), parts = String(data && data.sent || '').split('.');
  if (!a.ready || parts.length !== 2 || !/^[a-f0-9]{32}$/.test(parts[0])) return fail('That link isn’t one this app made.');
  if (!sameText_(allowSig_(a.secret, 'sent|' + parts[0]), parts[1])) return fail('That link isn’t one this app made.');
  var cache = CacheService.getScriptCache(), raw = cache.get('allow_' + parts[0]);
  if (!raw) return ok({ message: 'Already marked.' });
  var w = JSON.parse(raw), me = String(WHO && WHO.email || '').toLowerCase();
  if (w.by !== me) return fail('That was sent by another board member.');
  var r = w.kind === 'outreach' ? outreachSent({ row: w.row, company: w.company, email: w.email, via: 'allow' })
        : welcomeSend({ row: w.row, company: w.company, email: w.email, sender: 'mine', composed: true, via: 'allow' });
  cache.remove('allow_' + parts[0]);
  return r;
}

/**
 * Outreach: the first "would you sponsor us?" email to businesses on the
 * board's sponsor sheet that nobody has reached yet. Lives next to Code.gs in
 * the same Apps Script project (Files → + → Script, name it "Outreach").
 *
 *   Sponsors tab → Outreach: rows still "Not contacted" on the sheet, with the
 *   sheet's own Status and LYBS Owner to filter by
 *        │  each row is checked before it can be picked (below)
 *        ▼
 *   a board member ticks the ones to send, picks who it's from, previews
 *   each email (To and the greeting side by side), and taps Send
 *        │  one email per sponsor, only their own address in To,
 *        │  never a shared To, CC or BCC
 *        ▼
 *   each sent row is marked Contacted on the sheet (Contacted? gets the
 *   sender's name, Status moves to Contacted) and remembered here, so it is
 *   never sent twice
 *
 * Nothing runs on a schedule and nothing goes out without that tap.
 *
 * Checks, per row, every time the list is read and again right before send:
 *   held (can't be picked): no email, an address that isn't one, no business
 *     name, already emailed from here, said no, walk-in only, or the league's
 *     links aren't set
 *   needs a look (unticked until someone ticks it): the contact's name doesn't
 *     match the address (a books person or front desk can be right, so it is
 *     a look, not a hold), more than one address in the cell, the same
 *     address on another row, or the row already says it was contacted
 *   On send, the row is read again and must still have the same business and
 *   address, so the greeting, business and address always come from one row.
 *
 * Who it's from: always whoever is signed in, signed by them.
 *   the script owner   straight from the app, from their own Gmail
 *   anyone else        from their own Gmail after a one-time Allow (Allow.gs),
 *                      or, until that's set up, filled in and opened in their
 *                      own Gmail for them to press Send
 * The league address is never a sender here: this script doesn't ask Gmail
 * for "Send mail as" access (see Mail.gs).
 *
 * Script Properties (all optional; nothing about a sponsor is in this file):
 *   OUTREACH_LEVELS_URL   the Become a Sponsor page (default below)
 *   OUTREACH_SIGNUP_URL   the sign-up form (default below)
 *   OUTREACH_PACKET_FILE  Drive file id of the packet PDF to attach
 *   OUTREACH_SIGN         the script owner's sign-off lines, e.g. "Nate Steele\nLYBS Director & Secretary"
 *   OUTREACH_SIGNS        optional sign-offs for other board members, as JSON:
 *                         {"their@email": "Their Name\nTheir title"}; without one,
 *                         their Google account name signs it
 *   OUTREACH_DAY_MAX      most outreach emails in a day (default 40)
 */

var OUTREACH_PROP = 'OUTREACH_' + SEASON;
var OUTREACH_BATCH_MAX = 15;
var OUTREACH_DAY_MAX = 40;
var OUTREACH_LEVELS_DEFAULT = 'https://www.lunenburgybs.com/about/become-a-sponsor/143708';
var OUTREACH_SIGNUP_DEFAULT = 'https://www.lunenburgybs.com/registration/79233';
var OUTREACH_SUBJECT = 'Sponsoring Lunenburg Youth Baseball & Softball in ' + SEASON;
// Shared inboxes: no person's name is expected in these.
var OUTREACH_GENERIC = /^(info|office|sales|team|contact|hello|hi|admin|frontdesk|front\.?desk|marketing|community|support|service|customerservice|orders|events|general|mail|email|inquiries|enquiries|reception|help|insure|insurance|accounts?|billing|bookkeeping|hr|jobs|careers|web|webmaster|shop|store|\d+)$/;

function outreachSettings_() {
  var p = PropertiesService.getScriptProperties();
  var url = function (k, d) { var v = String(p.getProperty(k) || d || '').trim(); return /^https:\/\/[^\s"<>]+$/.test(v) ? v : ''; };
  var s = {
    levels: url('OUTREACH_LEVELS_URL', OUTREACH_LEVELS_DEFAULT),
    signup: url('OUTREACH_SIGNUP_URL', OUTREACH_SIGNUP_DEFAULT),
    packetFile: String(p.getProperty('OUTREACH_PACKET_FILE') || '').trim(),
    sign: String(p.getProperty('OUTREACH_SIGN') || 'Nate Steele\nLYBS Director & Secretary').replace(/\r/g, '').trim(),
    dayMax: Number(p.getProperty('OUTREACH_DAY_MAX')) || OUTREACH_DAY_MAX
  };
  s.linksOk = !!(s.levels && s.signup);
  return s;
}

function outreachLog_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(OUTREACH_PROP) || '{}'); } catch (e) { return {}; }
}
function saveOutreachLog_(log) { PropertiesService.getScriptProperties().setProperty(OUTREACH_PROP, JSON.stringify(log)); }
function outreachSentToday_(log) {
  var today = dayOf_(new Date());
  return Object.keys(log).filter(function (k) { return log[k] && log[k].at === today; }).length;
}

// The person who owns this script, the only one who may send in their own name.
function outreachIsOwner_() {
  var me = String(myEmail_() || '').toLowerCase();
  return !!me && !!(WHO && WHO.email) && String(WHO.email).toLowerCase() === me;
}

// Whoever is signed in sends as themselves. The script owner's emails go
// straight from the app (it runs in their Gmail); anyone else's open as a
// filled-in email in their own Gmail, and they press Send there.
function outreachSenders_() {
  var owner = outreachIsOwner_(), me = String(WHO && WHO.email || '').toLowerCase();
  if (owner) return [{ id: 'mine', how: 'send', label: 'You (' + (me || myEmail_()) + ')', ok: true, why: '' }];
  var why = me ? '' : 'Your sign-in has no verified email address.';
  var out = [];
  if (allowSettings_().ready) out.push({ id: 'allow', how: 'allow', label: 'You (' + (me || 'your account') + '), from your Gmail', ok: !!me, email: me, why: why });
  out.push({ id: 'mine', how: 'compose', label: 'You (' + (me || 'your account') + '), opens in your Gmail', ok: !!me, email: me, why: why });
  return out;
}
function outreachPick_(id) {
  var sender = id === 'allow' ? 'allow' : id === 'mine' ? 'mine' : '';
  return outreachSenders_().filter(function (x) { return x.id === sender; })[0] || null;
}

// The sign-off of whoever is sending: their own line in OUTREACH_SIGNS, the
// owner's OUTREACH_SIGN, or their Google account name.
function outreachSign_() {
  var me = String(WHO && WHO.email || '').toLowerCase();
  try {
    var map = JSON.parse(PropertiesService.getScriptProperties().getProperty('OUTREACH_SIGNS') || '{}');
    var mine = me && map && map[me];
    if (mine) return String(mine).replace(/\r/g, '').trim();
  } catch (e) { console.log('outreach signs: ' + e); }
  if (outreachIsOwner_()) return outreachSettings_().sign;
  var n = String(WHO && WHO.name || '').replace(/[^A-Za-z\u00C0-\u017F .'’\-]/g, '').replace(/\s+/g, ' ').trim();
  return n.length > 50 ? '' : n;
}
// Settings with the sender's sign-off. An email opened in someone's own
// Gmail can't carry the packet PDF, so it links to the levels instead.
function outreachFor_(how) {
  var s = outreachSettings_();
  s.sign = outreachSign_();
  if (how === 'compose') s.packetFile = '';
  return s;
}

// "Hi Sam," from the contact cell when it reads as a person's name, else
// "Hi Alpha Bakery team," (outreachGreet_). Never "Hi there".
function outreachGreet_(r) {
  var n = outreachFirstName_(r.contact);
  if (n) return n;
  var b = String(r.company || '').replace(/,?\s+(llc|l\.l\.c\.|inc\.?|incorporated|co\.|corp\.?|ltd\.?|pc|p\.c\.)$/i, '').trim();
  return (b || 'Lunenburg') + ' team';
}
// Sponsored with us before: a level last season, or the sheet's "has sponsored in past".
function outreachPast_(r) {
  return !!((r.prevTier && !/^none/i.test(r.prevTier)) || isYes_(r.past));
}

function outreachFirstName_(contact) {
  var c = String(contact || '').trim();
  if (!c || /[^A-Za-z\u00C0-\u017F\s.'’\-\/&(),:]/.test(c) || /https?:|www\./i.test(c) || c.length > 60) return '';
  var after = c.split(':');
  if (after.length === 2) c = after[1].trim();                    // "Manager: Henry Smith"
  var paren = c.match(/\(([A-Za-z][A-Za-z'-]{1,20})\)/);
  if (paren && !/^(owner|cc|manager)$/i.test(paren[1])) return cap_(paren[1]);   // "Ke ai (Kim) Chen"
  var first = c.split(/[\s\/,&]+/)[0];
  if (!/^[A-Za-z][A-Za-z'’-]*\.?$/.test(first)) return '';
  first = first.replace(/\.$/, '');
  if (first.length < 2 || /^(mr|mrs|ms|dr|the|owner|manager|n\/a|na|none|tbd)$/i.test(first)) return '';
  return cap_(first);
}
function cap_(w) { w = String(w); return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(); }

// Does the address look like it belongs to the named contact (or a shared inbox)?
function outreachNameMatches_(contact, email) {
  var local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!local || OUTREACH_GENERIC.test(local)) return true;
  var words = String(contact || '').toLowerCase().replace(/\([^)]*\)/g, ' ').split(/[^a-z]+/)
    .filter(function (w) { return w.length >= 3 && !/^(the|and|owner|manager|farm|is)$/.test(w); });
  if (!words.length) return true;                                  // no name to compare
  var first = words[0], last = words[words.length - 1];
  if (words.some(function (w) { return local.indexOf(w) >= 0; })) return true;
  if (words.length > 1 && (local.indexOf(first.charAt(0) + last) >= 0 || local.indexOf(first + last.charAt(0)) >= 0)) return true;
  return false;
}

function outreachRows_() {
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return [];
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), email: col(/^email/), status: col(/^status$/),
            owner: col(/^lybs owner/), contacted: col(/^contacted/), walk: col(/^walk-?in/), paid: col(/^paid/),
            tier: col(new RegExp('^tier selected ' + SEASON)), prevTier: col(new RegExp('^tier selected ' + (Number(SEASON) - 1))),
            past: col(/^has sponsored in past/) };
  if (c.company < 0 || c.email < 0) return [];
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var out = [];
  tab.rows.forEach(function (r) {
    var company = get(r, 'company');
    if (!company) return;
    out.push({ row: r.row, company: company, contact: get(r, 'contact'), emailCell: get(r, 'email'),
               status: get(r, 'status'), owner: get(r, 'owner'), contacted: get(r, 'contacted'),
               walk: get(r, 'walk'), paid: get(r, 'paid'), tier: get(r, 'tier'), prevTier: get(r, 'prevTier'), past: get(r, 'past') });
  });
  return out;
}

// Only rows nobody has signed up, paid or said no on.
function outreachCandidate_(r) {
  if (/^(paid|signed up|not sponsoring)/i.test(r.status)) return false;
  if (isYes_(r.paid)) return false;
  if (r.tier && !/^none/i.test(r.tier)) return false;
  return true;
}

// Checks for one row. all: every candidate row (for repeated addresses).
function outreachCheck_(r, all, log, s) {
  var hold = [], look = [];
  var email = firstEmail_(r.emailCell);
  var found = String(r.emailCell || '').match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  if (!r.emailCell) hold.push('No email on the sheet.');
  else if (!email) hold.push('The email cell doesn’t hold an address ("' + r.emailCell.slice(0, 40) + '").');
  if (!s.linksOk) hold.push('The sponsor page and sign-up links aren’t set.');
  if (log[companyKey_(r.company)]) hold.push('Already emailed from here on ' + log[companyKey_(r.company)].at + '.');
  if (/not spons|declin|^pass/i.test(r.contacted)) hold.push('The sheet says they’re not sponsoring.');
  if (isYes_(r.walk) || /^walk-?in/i.test(r.status)) hold.push('Marked walk-in only.');
  if (email) {
    if (found.length > 1) look.push('The email cell has ' + found.length + ' addresses; this goes to the first one only.');
    if (r.contact && !outreachNameMatches_(r.contact, email)) look.push('The contact is ' + r.contact.slice(0, 40) + ', but the address may be someone else’s.');
    var twin = all.filter(function (o) { return o.row !== r.row && firstEmail_(o.emailCell).toLowerCase() === email.toLowerCase(); })[0];
    if (twin) look.push('The same address is on ' + twin.company + ' too.');
  }
  if (r.status && !/^not contacted$/i.test(r.status)) look.push('Status on the sheet is "' + r.status + '".');
  else if (r.contacted && !/^no$/i.test(r.contacted)) look.push('Contacted? on the sheet says "' + r.contacted + '".');
  return { email: email, hold: hold, look: look };
}

function outreachText_(r, greet, s) {
  var hi = 'Hi ' + (greet || outreachGreet_(r)) + ',';
  var packet = s.packetFile ? 'I’ve attached our ' + SEASON + ' sponsorship packet, and the levels are also on our site here:'
                            : 'Our ' + SEASON + ' sponsorship levels are on our site here:';
  var name = String(s.sign || '').split('\n')[0].trim();
  var me = name ? 'My name is ' + name + ', and I’m on the board.' : 'I’m on the board.';
  var past = outreachPast_(r);
  var paras = [
    hi,
    past
      ? 'Thank you for sponsoring Lunenburg Youth Baseball & Softball last season. Having ' + r.company + ' behind our kids made a real difference, and I’m reaching out about the ' + SEASON + ' season.'
      : 'I’m reaching out from Lunenburg Youth Baseball & Softball about sponsoring our ' + SEASON + ' season.',
    me + ' We’re a volunteer run, nonprofit league for kids in Lunenburg, and we’re starting to plan for the ' + SEASON + ' season.',
    (past ? 'We’d love to have ' + r.company + ' back with us this year.' : 'I wanted to see if ' + r.company + ' would have any interest in sponsoring the league this year.') +
      ' Sponsors help us cover uniforms, equipment and field upkeep, and this year we’re working on new dugouts at Powell Field and fixing the scoreboard at McNally Field. ' + packet + '\n' + s.levels,
    'If it’s a fit, the sign-up form is here:\n' + s.signup,
    'We’re a 501(c)(3), so it’s tax deductible too. Thanks for taking a look, and let me know if you have any questions.',
    s.sign || 'Lunenburg Youth Baseball & Softball'
  ];
  return paras.join('\n\n');
}

function outreachHtml_(text) {
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  return '<div>' + text.split('\n\n').map(function (p) {
    return '<p>' + esc(p).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') + '</p>';
  }).join('') + '</div>';
}

// ---------- the app's calls ----------

function outreachList() {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  var s = outreachSettings_(), log = outreachLog_();
  var all = outreachRows_().filter(outreachCandidate_);
  var items = all.map(function (r) {
    var ck = outreachCheck_(r, all, log, s), sent = log[companyKey_(r.company)] || null;
    return { row: r.row, company: r.company, contact: r.contact, email: ck.email, status: r.status || 'Not contacted',
             owner: r.owner, greet: outreachGreet_(r), past: outreachPast_(r), hold: ck.hold, look: ck.look,
             sent: sent ? { at: sent.at, by: sent.by } : null };
  });
  return ok({ items: items, senders: outreachSenders_(), packet: !!s.packetFile, linksOk: s.linksOk,
              batchMax: OUTREACH_BATCH_MAX, dayLeft: Math.max(0, s.dayMax - outreachSentToday_(log)) });
}

function outreachFind_(data) {
  var row = Number(data && data.row);
  var all = outreachRows_().filter(outreachCandidate_);
  var r = all.filter(function (x) { return x.row === row; })[0];
  if (!r || companyKey_(r.company) !== companyKey_(data.company)) return { all: all, r: null };
  return { all: all, r: r };
}

function outreachPreview(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  var f = outreachFind_(data);
  if (!f.r) return fail('That row changed on the sheet. Refresh the list.');
  var pick = outreachPick_(data.sender === 'allow' ? 'allow' : 'mine');
  var s = outreachFor_(pick && pick.how), ck = outreachCheck_(f.r, f.all, outreachLog_(), s);
  var greet = outreachGreet_(f.r), text = outreachText_(f.r, greet, s);
  return ok({ subject: OUTREACH_SUBJECT, text: text, html: outreachHtml_(text), to: ck.email, greet: greet, past: outreachPast_(f.r),
              company: f.r.company, contact: f.r.contact, hold: ck.hold, look: ck.look, packet: !!s.packetFile,
              sign: s.sign.split('\n')[0] || '' });
}

// data: { sender, items: [{ row, company, email, looked }] }. One email each.
function outreachSend(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var pick = outreachPick_(data && data.sender), sender = pick ? pick.id : '';
  if (!pick) return fail('Pick who it’s from.');
  if (!pick.ok) return fail(pick.why);
  if (pick.how !== 'send') return fail('Your emails go one at a time from your own Gmail. Use Send on each row. Nothing was sent.');
  var items = (data && data.items) || [];
  if (!items.length) return fail('Tick at least one sponsor.');
  if (items.length > OUTREACH_BATCH_MAX) return fail('Send ' + OUTREACH_BATCH_MAX + ' at most at a time.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail('Someone else is sending right now. Try again in a moment.');
  try {
    var s = outreachFor_('send'), log = outreachLog_();
    var left = Math.max(0, s.dayMax - outreachSentToday_(log));
    var all = outreachRows_().filter(outreachCandidate_);
    var pdf = null;
    if (s.packetFile) {
      try { pdf = DriveApp.getFileById(s.packetFile).getBlob(); }
      catch (e) { return fail('The packet PDF (OUTREACH_PACKET_FILE) doesn’t open. Nothing was sent.'); }
    }
    var mail = senderSettings_(), who = sponsorMe_() || String(WHO.email || '').split('@')[0];
    var results = [], seen = {}, marks = [];
    items.forEach(function (it) {
      var res = { row: Number(it.row), company: String(it.company || '') };
      results.push(res);
      var r = all.filter(function (x) { return x.row === res.row; })[0];
      if (!r || companyKey_(r.company) !== companyKey_(res.company)) { res.error = 'The row changed on the sheet. Not sent.'; return; }
      var ck = outreachCheck_(r, all, log, s);
      if (String(it.email || '').toLowerCase() !== ck.email.toLowerCase()) { res.error = 'The address on the sheet changed. Not sent.'; return; }
      if (ck.hold.length) { res.error = ck.hold[0] + ' Not sent.'; return; }
      if (ck.look.length && it.looked !== true) { res.error = 'Needs a look first. Not sent.'; return; }
      var to = ck.email.toLowerCase();
      if (seen[to]) { res.error = 'Same address as another one in this batch. Not sent.'; return; }
      if (left <= 0) { res.error = 'Today’s limit of ' + s.dayMax + ' is reached. Not sent.'; return; }
      var text = outreachText_(r, outreachGreet_(r), s);
      var o = { company: r.company, to: ck.email, subject: OUTREACH_SUBJECT, text: text, html: outreachHtml_(text),
                name: String(s.sign.split('\n')[0] || RECEIPT_ORG) };
      if (pdf) o.attachments = [pdf];
      try {   // one sponsor, one To, no CC or BCC
        var sent = sendGuarded_('outreach', o);
        if (!sent.ok) { res.error = sent.error; return; }
      } catch (e) { res.error = 'Gmail refused it: ' + String(e.message || e).slice(0, 120); return; }
      seen[to] = 1; left--;
      log[companyKey_(r.company)] = { at: dayOf_(new Date()), by: String(WHO.email || ''), via: sender, to: to };
      saveOutreachLog_(log);
      res.sent = true; res.to = ck.email;
      marks.push(r);
    });
    var marked = outreachMark_(marks, who);
    return ok({ results: results, sent: marks.length, marked: marked,
                message: marks.length ? 'Sent ' + marks.length + ' email' + (marks.length === 1 ? '' : 's') + ', one per sponsor.' : 'Nothing was sent.' });
  } finally {
    lock.releaseLock();
  }
}

// For a board member who isn't the script owner: the filled-in email for one
// sponsor, to open in their own Gmail. Nothing is sent or marked here.
// data: { row, company, email, looked }
function outreachCompose(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  var pick = outreachPick_('mine');
  if (!pick || pick.how !== 'compose' || !pick.ok) return fail(pick && pick.why || 'This is for sending from your own Gmail.');
  var f = outreachFind_(data);
  if (!f.r) return fail('That row changed on the sheet. Refresh the list.');
  var s = outreachFor_('compose'), ck = outreachCheck_(f.r, f.all, outreachLog_(), s);
  if (!s.linksOk) return fail('The sponsor page and sign-up links aren’t set.');
  if (ck.hold.length) return fail(ck.hold[0]);
  if (String(data.email || '').toLowerCase() !== ck.email.toLowerCase()) return fail('The address on the sheet changed. Refresh the list.');
  if (ck.look.length && data.looked !== true) return fail('This one needs a look first.');
  return ok({ to: ck.email, subject: OUTREACH_SUBJECT, text: outreachText_(f.r, outreachGreet_(f.r), s), from: pick.email });
}

// After the one-time Allow: a signed ticket for this one email, which opens
// in the sender and goes from their own Gmail (Allow.gs). Nothing is sent or
// marked here. data: { row, company, email, looked }
function outreachTicket(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var pick = outreachPick_('allow');
  if (!pick || !pick.ok) return fail(pick && pick.why || 'Sending from your own Gmail isn’t set up yet. Use Open in Gmail.');
  var f = outreachFind_(data);
  if (!f.r) return fail('That row changed on the sheet. Refresh the list.');
  var log = outreachLog_(), s = outreachFor_('compose'), ck = outreachCheck_(f.r, f.all, log, s);
  if (!s.linksOk) return fail('The sponsor page and sign-up links aren’t set.');
  if (ck.hold.length) return fail(ck.hold[0]);
  if (String(data.email || '').toLowerCase() !== ck.email.toLowerCase()) return fail('The address on the sheet changed. Refresh the list.');
  if (ck.look.length && data.looked !== true) return fail('This one needs a look first.');
  if (outreachSentToday_(log) >= s.dayMax) return fail('Today’s limit of ' + s.dayMax + ' is reached.');
  var t = allowTicket_('outreach', { company: f.r.company, to: ck.email, subject: OUTREACH_SUBJECT, text: outreachText_(f.r, outreachGreet_(f.r), s),
                                     name: String(s.sign.split('\n')[0] || '') }, { row: f.r.row, company: f.r.company, email: ck.email });
  return t.error ? fail(t.error) : ok({ open: t.url });
}

// They pressed Send in their Gmail: record it and mark the row Contacted.
// data: { row, company, email }
function outreachSent(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send outreach.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var f = outreachFind_(data);
    if (!f.r) return fail('That row changed on the sheet. Nothing was marked.');
    var log = outreachLog_(), key = companyKey_(f.r.company);
    if (log[key]) return fail(f.r.company + ' is already marked as emailed.');
    var email = firstEmail_(f.r.emailCell);
    if (!email || String(data.email || '').toLowerCase() !== email.toLowerCase()) return fail('The address on the sheet changed. Nothing was marked.');
    log[key] = { at: dayOf_(new Date()), by: String(WHO.email || ''), via: 'gmail', to: email.toLowerCase() };
    saveOutreachLog_(log);
    outreachMark_([f.r], sponsorMe_() || String(WHO.email || '').split('@')[0]);
    return ok({ message: f.r.company + ' is marked as emailed.' });
  } finally {
    lock.releaseLock();
  }
}

// Contacted? gets who sent it; Status follows to Contacted. Returns how many rows changed.
function outreachMark_(rows, who) {
  if (!rows.length) return 0;
  forgetBoardRows_();
  var sh;
  try { sh = writableSponsorSheet_(); } catch (e) { console.log('outreach mark: ' + e); return 0; }
  if (!sh) return 0;
  var t = sponsorHead_(sh), n = 0;
  var cCon = -1, cCo = -1;
  t.head.forEach(function (h, i) {
    if (cCon < 0 && /^contacted/i.test(h)) cCon = i;
    if (cCo < 0 && /^(company|business)/i.test(h)) cCo = i;
  });
  if (cCon < 0 || cCo < 0) return 0;
  rows.forEach(function (r) {
    var i = r.row - 1, before = t.v[i];
    if (!before || companyKey_(before[cCo]) !== companyKey_(r.company)) return;
    try {
      if (sh.getRange(r.row, cCon + 1).getFormulas()[0][0]) return;
      var after = before.slice(); after[cCon] = who;
      sh.getRange(r.row, cCon + 1).setValue(who);
      logChanges_(sh, [{ company: r.company, what: t.head[cCon], from: before[cCon] || '', to: who }]);
      followStatus_(sh, t, r.row, before, after, r.company);
      n++;
    } catch (e) { console.log('outreach mark row ' + r.row + ': ' + e); }
  });
  SpreadsheetApp.flush();
  return n;
}

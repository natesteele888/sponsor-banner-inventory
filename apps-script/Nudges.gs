/**
 * Follow-up emails to sponsors the board has contacted who haven't paid and
 * haven't said no. Lives next to Code.gs (Files → + → Script, "Nudges").
 *
 * A few set dates in the season are "rounds". From a round's date until the
 * next one, everyone who fits shows in the Sponsors tab under Follow-ups to
 * send. Nothing is ever sent on a schedule: a board member previews it and
 * taps Send, one sponsor at a time. Each sponsor gets each round once.
 *
 * Who fits: Contacted? has a name or "Yes" (not blank, "No" or "Not
 * sponsoring"), Paid? is not yes, and the row has an email.
 *
 * Script Properties (nothing private is written in this public file):
 *   NUDGE_DATES       the round dates, e.g. 2026-12-10, 2027-01-14 (default:
 *                     Dec 10, Jan 14, Feb 11 and Mar 6 of the season)
 *   NUDGE_SIGN        the sign-off, e.g. "Name, Title"
 *   SPONSOR_DEADLINE  the last day for sponsors as written in the emails
 *                     (default "March 20")
 *   NUDGES_LIVE       "on" sends to sponsors; anything else sends tests to
 *                     RECEIPTS_TEST_TO only
 *
 * Every round starts off. Its list shows only once a sponsorship editor taps
 * "Start this round" (nudgeRound), and even then each email waits for
 * Preview and Send. Which rounds were started is kept in NUDGES_ON_<season>.
 *   RECEIPT_ORG_ADDRESS  where checks go (shared with receipts)
 * Sends go through leagueSend_ (Mail.gs), so they come from the league address.
 */

var NUDGES_PROP = 'NUDGES_' + SEASON;
var NUDGE_KINDS = {
  holiday: { label: 'Holiday hello', subject: 'Happy holidays from LYBS', body: [
    'Thinking about you this holiday season and wanted to say thanks again for hearing us out about sponsoring {org}. If {company} is still interested, we\'d love to have you with us this spring.',
    'Just reply to this email with any questions. Checks or money orders can go to {address}.'], close: 'Happy holidays,' },
  checkin: { label: 'New year check-in', subject: 'Checking in about sponsoring LYBS', body: [
    'Happy new year! I wanted to check in and see if {company} is still interested in sponsoring LYBS this spring. Sponsors keep our fees down and get the kids the gear they need.',
    'If you have any questions, just reply here and I\'ll get right back to you.'], close: 'Thanks,' },
  jersey: { label: 'Before jerseys', subject: 'Getting {company} on a jersey', body: [
    'We\'re starting to plan jerseys and banners for the spring. If {company} would like to sponsor this year, the sooner we hear from you, the easier it is to get your name on a jersey.',
    'Our last day for sponsors is {deadline}. Checks or money orders can go to {address}.'], close: 'Thanks so much,' },
  last: { label: 'Last call', subject: 'Last call for LYBS sponsors', body: [
    'Quick heads up that our last day for sponsors is {deadline}. After that the jerseys go to print and we can\'t add new names.',
    'If {company} would still like to be part of the season, just reply here or mail a check to {address} by then.'], close: 'Thank you,' }
};

function nudgeSettings_() {
  var p = PropertiesService.getScriptProperties();
  var s = {
    sign: String(p.getProperty('NUDGE_SIGN') || '').trim(),
    deadline: String(p.getProperty('SPONSOR_DEADLINE') || 'March 20').trim(),
    address: String(p.getProperty('RECEIPT_ORG_ADDRESS') || '').replace(/\s*\n\s*/g, ', ').trim(),
    testTo: firstEmail_(p.getProperty('RECEIPTS_TEST_TO') || ''),
    live: String(p.getProperty('NUDGES_LIVE') || '').trim().toLowerCase() === 'on'
  };
  s.missing = [];
  if (!s.sign) s.missing.push('NUDGE_SIGN');
  if (!s.address) s.missing.push('RECEIPT_ORG_ADDRESS');
  return s;
}

// The rounds, oldest first: [{ date: 'yyyy-mm-dd', kind, label }].
function nudgeRounds_() {
  var raw = PropertiesService.getScriptProperties().getProperty('NUDGE_DATES') || '';
  var y = Number(SEASON);
  var dates = (raw.match(/\d{4}-\d{2}-\d{2}/g) || [(y - 1) + '-12-10', y + '-01-14', y + '-02-11', y + '-03-06']).slice().sort();
  return dates.map(function (d, i) {
    var kind = i === dates.length - 1 && dates.length > 1 ? 'last'
      : i === 0 ? 'holiday' : i === dates.length - 2 ? 'jersey' : 'checkin';
    return { date: d, kind: kind, label: NUDGE_KINDS[kind].label };
  });
}

function currentNudgeRound_(today) {
  var r = nudgeRounds_(), now = today || dayOf_(new Date()), cur = null, next = null;
  r.forEach(function (x) { if (x.date <= now) cur = x; else if (!next) next = x; });
  return { current: cur, next: next, rounds: r };
}

function nudgeLog_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(NUDGES_PROP) || '{}'); } catch (e) { return {}; }
}
function saveNudgeLog_(log) { PropertiesService.getScriptProperties().setProperty(NUDGES_PROP, JSON.stringify(log)); }

// Rounds a board member started by hand: { 'yyyy-mm-dd': { by, at } }.
var NUDGES_ON_PROP = 'NUDGES_ON_' + SEASON;
function nudgesOn_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(NUDGES_ON_PROP) || '{}'); } catch (e) { return {}; }
}
function roundStarted_(round) { return !!(round && nudgesOn_()[round.date]); }

function contactedState_(v) {
  v = String(v || '').trim();
  if (/not spons|declin|^pass/i.test(v)) return 'not';
  return !v || /^no$/i.test(v) ? 'none' : 'yes';
}

// Everyone who fits today, with their state for the current round.
function nudgeRows_(round) {
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return [];
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), email: col(/^email/), contacted: col(/^contacted/), paid: col(/^paid/),
            status: col(/^status$/) };
  if (c.company < 0 || c.email < 0 || c.contacted < 0) return [];
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var done = round ? (nudgeLog_()[round.date] || {}) : {};
  var out = [];
  tab.rows.forEach(function (r) {
    var row = { row: r.row, company: get(r, 'company'), contact: get(r, 'contact'), email: firstEmail_(get(r, 'email')) };
    if (!row.company || !row.email || contactedState_(get(r, 'contacted')) !== 'yes' || isYes_(get(r, 'paid'))) return;
    // On the board's sheet a typed Status says it too: no nudge after a no or a payment.
    if (/^(paid|not sponsoring)$/i.test(get(r, 'status'))) return;
    row.key = companyKey_(row.company) + '|' + row.email.toLowerCase();
    var d = done[row.key];
    row.status = d ? d.how : 'ready';
    row.at = d ? d.at : '';
    out.push(row);
  });
  return out;
}

function nudgeEmail_(round, r, s) {
  var k = NUDGE_KINDS[round.kind];
  var first = String(r.contact || '').trim().split(/\s+/)[0] || '';
  var fill = function (t) {
    return t.replace(/\{org\}/g, RECEIPT_ORG).replace(/\{company\}/g, r.company || 'your business')
      .replace(/\{deadline\}/g, s.deadline).replace(/\{address\}/g, s.address || 'our PO Box');
  };
  var e = function (v) { return String(v).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; }); };
  var hi = 'Hi ' + (first || 'there') + ',';
  var paras = k.body.map(fill);
  var sign = [k.close].concat(String(s.sign || 'SIGN-OFF NOT SET').split(/\s*,\s*/));
  var text = [hi, ''].concat(paras.join('\n\n')).concat(['', sign.join('\n')]).join('\n');
  var p = 'margin:0 0 14px;font-size:15px;line-height:1.5';
  var html = '<div style="font-family:Arial,Helvetica,sans-serif;color:#0B1120;max-width:560px">' +
    '<img src="' + e(leagueLogoUrl_()) + '" width="110" height="46" alt="LYBS" style="display:block;width:110px;height:46px;border:0;margin:0 0 18px">' +
    '<p style="' + p + '">' + e(hi) + '</p>' + paras.map(function (x) { return '<p style="' + p + '">' + e(x) + '</p>'; }).join('') +
    '<p style="' + p + '">' + sign.map(e).join('<br>') + '</p></div>';
  return { subject: fill(k.subject), text: text, html: html };
}

// ---------- the app's actions ----------

function nudgeList() {
  var s = nudgeSettings_(), r = currentNudgeRound_();
  return {
    settings: { missing: s.missing, live: s.live, testTo: !!s.testTo, sender: senderSettings_().connected },
    current: r.current, next: r.next, rounds: r.rounds, started: roundStarted_(r.current),
    items: nudgeRows_(r.current).map(function (x) { return { key: x.key, row: x.row, company: x.company, email: x.email, status: x.status, at: x.at }; })
  };
}

function findNudgeRow_(round, key) {
  return nudgeRows_(round).filter(function (r) { return r.key === String(key || ''); })[0] || null;
}

// A preview of one sponsor's email this round, or of any round with a sample sponsor.
function nudgePreview(data) {
  var s = nudgeSettings_(), r = currentNudgeRound_();
  var round = r.rounds.filter(function (x) { return x.date === data.round; })[0] || r.current;
  if (!round) return fail('No follow-up round has started yet.');
  var row = data.key ? findNudgeRow_(round, data.key) : { company: 'Your Business', contact: '' };
  if (!row) return fail('That sponsor no longer fits this follow-up. Refresh.');
  var m = nudgeEmail_(round, row, s);
  return ok({ subject: m.subject, html: m.html, round: round.label });
}

// One tap from a board member sends one follow-up. Never called on a schedule.
function nudgeSend(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var s = nudgeSettings_(), r = currentNudgeRound_();
  if (!r.current) return fail('No follow-up round has started yet.');
  if (!roundStarted_(r.current)) return fail('Follow-ups are off for this round. Tap Start this round first.');
  if (s.missing.length) return fail('Follow-ups are not set up yet: missing ' + s.missing.join(', ') + ' (Script Properties).');
  if (!s.live && !s.testTo) return fail('Follow-ups are in test mode with no test address set.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is sending one right now. Try again in a moment.');
  try {
    var row = findNudgeRow_(r.current, data.key);
    if (!row) return fail('That sponsor no longer fits this follow-up. Refresh.');
    if (row.status !== 'ready') return fail('This one was already ' + (row.status === 'sent' ? 'sent' : 'skipped') + ' this round.');
    var m = nudgeEmail_(r.current, row, s);
    var how = leagueSend_({ to: s.live ? row.email : s.testTo, subject: m.subject, text: m.text, html: m.html, live: s.live });
    if (!how.ok) return fail(how.error);
    var at = dayOf_(new Date());
    if (s.live) { var log = nudgeLog_(); log[r.current.date] = log[r.current.date] || {}; log[r.current.date][row.key] = { how: 'sent', at: at }; saveNudgeLog_(log); noteOnBoardCopy_(row.company, 'Last follow-up', at + ' ' + r.current.label); }
    return ok({ message: s.live ? 'Follow-up sent to ' + row.email + '.' : 'Test follow-up sent to the test address. The row stays ready.', status: s.live ? 'sent' : 'ready', at: at });
  } finally {
    lock.releaseLock();
  }
}

// Start this round's follow-ups by hand, or turn them back off. Editors only.
// Starting sends nothing: it only lets the round's list show, one Preview and
// Send at a time.
function nudgeRound(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can start follow-ups.');
  var r = currentNudgeRound_();
  if (!r.current) return fail('No follow-up round has started yet.');
  if (String(data.round || '') !== r.current.date) return fail('That round changed. Refresh.');
  var on = nudgesOn_(), how = String(data.how || '');
  if (how === 'start') on[r.current.date] = { by: WHO && WHO.email ? String(WHO.email) : '', at: dayOf_(new Date()) };
  else if (how === 'stop') delete on[r.current.date];
  else return fail('Unknown choice.');
  PropertiesService.getScriptProperties().setProperty(NUDGES_ON_PROP, JSON.stringify(on));
  return ok({ message: how === 'start' ? r.current.label + ' is on. Each follow-up still waits for Preview and Send.' : r.current.label + ' is off. Nothing will go out.', started: how === 'start' });
}

// Skip a sponsor this round, or undo a skip.
function nudgeMark(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var r = currentNudgeRound_();
  if (!r.current) return fail('No follow-up round has started yet.');
  var key = String(data.key || ''), log = nudgeLog_(), day = log[r.current.date] = log[r.current.date] || {};
  if (data.how === 'undo') {
    if (day[key] && day[key].how === 'sent') return fail('A sent follow-up stays marked sent.');
    delete day[key];
  } else if (data.how === 'skip') {
    if (!findNudgeRow_(r.current, key)) return fail('That sponsor no longer fits this follow-up. Refresh.');
    day[key] = { how: 'skip', at: dayOf_(new Date()) };
  } else return fail('Unknown choice.');
  saveNudgeLog_(log);
  return ok({ message: 'Saved.' });
}

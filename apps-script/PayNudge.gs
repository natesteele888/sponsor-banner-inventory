/**
 * Payment nudges: sponsors who signed up at a level and haven't paid two
 * weeks later. Lives next to Code.gs (Files → + → Script, "PayNudge").
 *
 * They show in the Sponsors tab under "Needs a payment nudge", each with a
 * reminder ready: thanks for signing up, plus how to pay. Nothing is ever
 * sent on a schedule: a board member previews it and taps Send. (Nate, Nov 23)
 *
 * Who fits: Status is "Signed up, not paid", Paid? is not yes, the row has an
 * amount and an email, and the row's "Signed up" day (or its "Last follow-up"
 * day, whichever is later) is PAY_NUDGE_DAYS or more ago. So after a
 * reminder goes out the clock starts over.
 *
 * "Signed up" is filled in by the app the first time a row's Status becomes
 * "Signed up, not paid" (Edits.gs). A row with no day there never shows here.
 *
 * Script Properties (nothing private is written in this public file):
 *   PAY_NUDGE_URL        the page where sponsors pay online (default: the
 *                        league's own donate page)
 *   RECEIPT_ORG_ADDRESS  where checks go (shared with receipts)
 *   SPONSOR_DEADLINE     the last day for sponsors (shared with follow-ups)
 *   NUDGES_LIVE          "on" sends to sponsors; anything else sends tests to
 *                        RECEIPTS_TEST_TO only (shared with follow-ups)
 */

var PAY_NUDGE_DAYS = 14;
var PAY_NUDGE_URL_DEFAULT = 'https://www.lunenburgybs.com/donate';

function payNudgeSettings_() {
  var s = nudgeSettings_();
  var u = String(PropertiesService.getScriptProperties().getProperty('PAY_NUDGE_URL') || '').trim();
  s.payUrl = /^https:\/\/[^\s<>"]+$/.test(u) ? u : PAY_NUDGE_URL_DEFAULT;
  return s;
}

// A day as the sheet shows it ("2026-11-23", "11/23/2026", "2026-11-23 Holiday
// hello") as yyyy-mm-dd, or '' when there's no day in it.
function sheetDay_(v) {
  v = String(v == null ? '' : v).trim();
  var p2 = function (n) { return ('0' + Number(n)).slice(-2); };
  var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (m) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + p2(m[1]) + '-' + p2(m[2]);
  return '';
}

function daysApart_(a, b) {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}

// Everyone signed up and unpaid, with whether a reminder is due today.
function payNudgeRows_(today) {
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return [];
  today = today || dayOf_(new Date());
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), email: col(/^email/), status: col(/^status$/),
            paid: col(/^paid\??$/), amount: col(/^amount/), tier: col(new RegExp('^tier selected ' + SEASON)),
            how: col(/^(paid how|payment method|paid by)/), signed: col(/^signed up/), last: col(/^last follow/) };
  if (c.company < 0 || c.email < 0 || c.status < 0 || c.signed < 0) return [];
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var out = [];
  tab.rows.forEach(function (r) {
    var row = { row: r.row, company: get(r, 'company'), contact: get(r, 'contact'), email: firstEmail_(get(r, 'email')),
                tier: get(r, 'tier'), amountText: get(r, 'amount'), amount: stAmount_(get(r, 'amount')) };
    if (!row.company || !row.email || !(row.amount > 0)) return;
    if (!/^signed up/i.test(get(r, 'status')) || isYes_(get(r, 'paid')) || /\bin.?kind\b/i.test(get(r, 'how'))) return;
    row.signed = sheetDay_(get(r, 'signed'));
    row.last = sheetDay_(get(r, 'last'));
    var from = row.last > row.signed ? row.last : row.signed;
    row.due = !!from && daysApart_(from, today) >= PAY_NUDGE_DAYS;
    row.key = companyKey_(row.company) + '|' + row.email.toLowerCase();
    out.push(row);
  });
  return out;
}

// The money as the email says it: "$500".
function payNudgeMoney_(n) {
  return '$' + (Math.round(n * 100) % 100 ? n.toFixed(2) : String(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// One sponsor's reminder: thanks for signing up, then how to pay.
function payNudgeEmail_(r, s) {
  var first = String(r.contact || '').trim().split(/\s+/)[0] || '';
  var level = String(r.tier || '').trim();
  var lines = [
    'Hi ' + (first || (r.company || 'there')) + ',',
    'Thank you again for signing up to sponsor ' + RECEIPT_ORG + (level && !/^none/i.test(level) ? ' at the ' + level + ' level' : '') +
      '! We\'re excited to have ' + (r.company || 'you') + ' with us this season.',
    'Just a friendly reminder on how to send your ' + payNudgeMoney_(r.amount) + ' sponsorship. You can pay online with ACH or a credit card at ' + s.payUrl +
      (s.address ? ', or mail a check payable to ' + RECEIPT_ORG + ' to ' + s.address : '') + '.',
    'Please send it by ' + s.deadline + ' so everything is ready for the season. If it\'s already on the way, thank you, and please ignore this note.',
    'If you have any questions, just reply to this email.',
    'Thanks,\n' + RECEIPT_ORG
  ];
  var text = lines.join('\n\n');
  return { subject: 'Thank you for sponsoring LYBS', text: text, html: nudgeHtml_(text, true) };
}

// ---------- the app's actions ----------

function payNudgeList() {
  var s = payNudgeSettings_();
  return {
    settings: { missing: s.missing, live: s.live, testTo: !!s.testTo, sender: senderSettings_().ready, via: senderSettings_().via, days: PAY_NUDGE_DAYS },
    items: payNudgeRows_().filter(function (x) { return x.due; }).map(function (x) {
      return { key: x.key, row: x.row, company: x.company, email: x.email, signed: x.signed, last: x.last };
    })
  };
}

function findPayNudgeRow_(key) {
  return payNudgeRows_().filter(function (r) { return r.key === String(key || ''); })[0] || null;
}

// A preview of one sponsor's reminder, by key or by sheet row.
function payNudgePreview(data) {
  var s = payNudgeSettings_();
  var row = data.key ? findPayNudgeRow_(data.key)
    : payNudgeRows_().filter(function (r) { return Number(r.row) === Number(data.row); })[0] || null;
  if (!row) return fail('That sponsor no longer needs a payment nudge. Refresh.');
  var m = payNudgeEmail_(row, s);
  return ok({ key: row.key, subject: m.subject, text: m.text, html: m.html, to: s.live ? row.email : s.testTo, live: s.live, due: row.due, via: senderSettings_().via });
}

// One tap from a sponsorship editor sends one reminder. Never called on a schedule.
function payNudgeSend(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can send a reminder.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var s = payNudgeSettings_();
  if (s.missing.length) return fail('Reminders are not set up yet: missing ' + s.missing.join(', ') + ' (Script Properties).');
  if (!s.live && !s.testTo) return fail('Reminders are in test mode with no test address set.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is sending one right now. Try again in a moment.');
  try {
    var row = findPayNudgeRow_(data.key);
    if (!row) return fail('That sponsor no longer needs a payment nudge. Refresh.');
    if (!row.due) return fail('A reminder went to them less than ' + PAY_NUDGE_DAYS + ' days ago.');
    var m = payNudgeEmail_(row, s);
    var ed = editedNudge_(data);
    if (ed && ed.error) return fail(ed.error);
    if (ed) m = { subject: ed.subject, text: ed.text, html: nudgeHtml_(ed.text, true) };
    var how = leagueSend_({ kind: 'followup', company: row.company, to: s.live ? row.email : s.testTo, subject: m.subject, text: m.text, html: m.html, live: s.live });
    if (!how.ok) return fail(how.error);
    var at = dayOf_(new Date());
    if (s.live) noteOnBoardCopy_(row.company, 'Last follow-up', at + ' Payment reminder');
    return ok({ message: s.live ? 'Reminder sent to ' + row.email + '.' : 'Test reminder sent to the test address. They stay in the list.', sent: !!s.live, at: at });
  } finally {
    lock.releaseLock();
  }
}

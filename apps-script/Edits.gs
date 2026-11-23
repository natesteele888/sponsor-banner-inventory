/**
 * Board edits to the sponsor tracker. Lives next to Code.gs in the same Apps
 * Script project (Files → + → Script, name it "Edits").
 *
 * Edits go to the one shared sheet the app reads (the sponsorship lead's
 * sheet, or the board copy once SPONSOR_SHEET_USE names it), so every board
 * member's app and the sheet itself show a change on the next load. Setting
 * the SPONSOR_EDITS Script Property to "off" turns every edit off.
 *
 * Every change is written to a "Change log" tab in that same sheet: when,
 * who, which sponsor, which column, old value and new value. The app shows
 * it on each sponsor.
 *
 *   Add a contact   any signed-in board member: a person or business they
 *                   reached out to becomes a new row
 *   Edit a row      only editors: every column, paid rows and amounts too
 *   Mark paid       only editors (when the treasurer says a check came in)
 *
 * Editors are the league admin account (by the same hashed address as in
 * Code.gs) plus the Google addresses in the SPONSOR_EDITORS Script Property
 * (comma or space separated). No address is written in this public file.
 */

function sponsorEditors_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SPONSOR_EDITORS') || '';
  return raw.split(/[\s,;]+/).map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

function canEditSponsors_() {
  var mail = WHO && WHO.email ? String(WHO.email).toLowerCase() : '';
  if (!mail) return false;
  return emailHash_(mail) === BOOTSTRAP_ADMIN_EMAIL_HASH || sponsorEditors_().indexOf(mail) >= 0;
}

// The sponsor tab of the one sheet the app reads, or null when edits are off.
function writableSponsorSheet_() {
  if (/^off$/i.test(PropertiesService.getScriptProperties().getProperty('SPONSOR_EDITS') || '')) return null;
  var ss = sponsorSpreadsheet_(), name = sponsorTabName_(ss);
  var sh = ss.getSheetByName(name);
  if (!sh) throw new Error('The sponsorship sheet has no "' + name + '" tab.');
  return sh;
}

// ---------- Status follows the change ----------
// The board's sheet has a typed Status column (a dropdown, not a formula).
// When a change clearly moves a sponsor along (marked paid, said no, signed up
// at a level, contacted, walk-in), Status moves with it. Never when the same
// change sets Status itself, and never on a sheet whose Status is a formula.

var STATUS_WORDS = ['Paid', 'Signed up, not paid', 'Contacted', 'Walk-in, not visited', 'Not contacted', 'Not sponsoring'];

function stYes_(v) { return /^\s*(y|yes|true|x|paid|✓)/i.test(String(v == null ? '' : v)); }
function stSaidNo_(v) { return /not spons|declin|^\s*pass/i.test(String(v == null ? '' : v)); }
function stReached_(v) { v = String(v == null ? '' : v).trim(); return !!v && !/^(no|false)$/i.test(v) && !stSaidNo_(v); }
function stAmount_(v) { return Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0; }

// head: the header texts. before/after: that row's cells. Returns the new
// Status, or '' when Status should stay as it is.
function statusAfter_(head, before, after) {
  var low = head.map(function (h) { return String(h).toLowerCase().trim(); });
  var col = function (re) { for (var i = 0; i < low.length; i++) if (re.test(low[i])) return i; return -1; };
  var c = { st: col(/^status$/), paid: col(/^paid/), con: col(/^contacted/), amt: col(/^amount/),
            tier: col(new RegExp('^tier selected ' + SEASON)), walk: col(/^walk-?in/) };
  if (c.st < 0) return '';
  var b = function (k) { return c[k] < 0 ? '' : String(before[c[k]] == null ? '' : before[c[k]]); };
  var a = function (k) { return c[k] < 0 ? '' : String(after[c[k]] == null ? '' : after[c[k]]); };
  var cur = b('st').trim(), next = '';
  var early = ['', 'Not contacted', 'Contacted', 'Walk-in, not visited'];
  var signedNow = stAmount_(a('amt')) > 0 || (!!a('tier').trim() && !/^none/i.test(a('tier').trim()));
  var signedBefore = stAmount_(b('amt')) > 0 || (!!b('tier').trim() && !/^none/i.test(b('tier').trim()));
  if (stYes_(a('paid')) && !stYes_(b('paid'))) next = 'Paid';
  else if (stSaidNo_(a('con')) && !stSaidNo_(b('con'))) next = 'Not sponsoring';
  else if (signedNow && !signedBefore && early.indexOf(cur) >= 0) next = 'Signed up, not paid';
  else if (stReached_(a('con')) && !stReached_(b('con')) && ['', 'Not contacted', 'Walk-in, not visited'].indexOf(cur) >= 0) next = 'Contacted';
  else if (stYes_(a('walk')) && !stYes_(b('walk')) && ['', 'Not contacted'].indexOf(cur) >= 0) next = 'Walk-in, not visited';
  else if (!cur && after.some(function (x) { return String(x || '').trim(); })) next = 'Not contacted';
  return next && next !== cur ? next : '';
}

// Write the followed Status on one row, logged like any other change.
function followStatus_(sh, t, row, before, after, company) {
  var c = -1;
  t.head.forEach(function (h, i) { if (c < 0 && /^status$/i.test(h)) c = i; });
  if (c < 0) return '';
  if (sh.getRange(row, c + 1).getFormulas()[0][0]) return '';
  var next = statusAfter_(t.head, before, after);
  if (!next) return '';
  sh.getRange(row, c + 1).setValue(next);
  logChanges_(sh, [{ company: company, what: t.head[c], from: before[c] || '', to: next }]);
  if (/^signed up/i.test(next)) stampSignedUp_(sh, t, row, company);
  return next;
}

// The day a sponsor signed up, for the payment nudge's two-week clock
// (PayNudge.gs). Written once, the first time Status becomes "Signed up, not
// paid", on a sheet with a "Signed up" column. Never written over.
function stampSignedUp_(sh, t, row, company) {
  var c = -1;
  t.head.forEach(function (h, i) { if (c < 0 && /^signed up/i.test(h)) c = i; });
  if (c < 0) return '';
  var cell = sh.getRange(row, c + 1);
  if (cell.getFormula() || String(cell.getDisplayValue()).trim()) return '';
  var day = dayOf_(new Date());
  cell.setValue(day);
  logChanges_(sh, [{ company: company, what: t.head[c], from: '', to: day }]);
  return day;
}

// ---------- change log ----------

var CHANGE_LOG_TAB = 'Change log';
var CHANGE_LOG_HEAD = ['When', 'Who', 'Sponsor', 'What', 'From', 'To'];

function changeLogSheet_(ss, make) {
  var sh = ss.getSheetByName(CHANGE_LOG_TAB);
  if (sh || !make) return sh;
  sh = ss.insertSheet(CHANGE_LOG_TAB);
  sh.getRange(1, 1, 1, CHANGE_LOG_HEAD.length).setValues([CHANGE_LOG_HEAD]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// entries: [{ company, what, from, to }]. A hiccup here never blocks the change.
function logChanges_(sh, entries) {
  if (!entries || !entries.length) return;
  try {
    var log = changeLogSheet_(sh.getParent(), true);
    var when = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm');
    var who = WHO && WHO.email ? String(WHO.email).toLowerCase() : 'unknown';
    var rows = entries.map(function (e) {
      return [when, who, String(e.company || ''), String(e.what || ''), String(e.from == null ? '' : e.from), String(e.to == null ? '' : e.to)]
        .map(function (v) { return /^[=+\-@]/.test(v) ? "'" + v : v; });
    });
    log.getRange(log.getLastRow() + 1, 1, rows.length, CHANGE_LOG_HEAD.length).setValues(rows);
  } catch (e) { console.log('change log: ' + e); }
}

// The newest changes, for the app. Never throws.
function sponsorChanges_(ss, max) {
  try {
    var log = changeLogSheet_(ss, false);
    if (!log || log.getLastRow() < 2) return [];
    var n = Math.min(log.getLastRow() - 1, max || 1000);
    var v = log.getRange(log.getLastRow() - n + 1, 1, n, CHANGE_LOG_HEAD.length).getDisplayValues();
    return v.reverse().map(function (r) {
      return { at: r[0], who: r[1], company: r[2], key: companyKey_(r[2]), what: r[3], from: r[4], to: r[5] };
    });
  } catch (e) { console.log('change log read: ' + e); return []; }
}

// Names in a Script Property ("Alex, Sam"), kept out of this public file.
function namesProp_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || '').split(/[,;\n]+/)
    .map(function (n) { return n.trim(); }).filter(Boolean);
}

// The signed-in person's name as the LYBS Owner column writes it, from the
// SPONSOR_PEOPLE Script Property ("Alex = their@address, Sam = ..."), so
// "My sponsors" can find their rows. Blank when they aren't listed.
function sponsorMe_() {
  var mail = WHO && WHO.email ? String(WHO.email).toLowerCase() : '';
  if (!mail) return '';
  var raw = PropertiesService.getScriptProperties().getProperty('SPONSOR_PEOPLE') || '';
  var hit = '';
  raw.split(/[,;\n]+/).forEach(function (pair) {
    var m = pair.split('=');
    if (m.length === 2 && m[1].trim().toLowerCase() === mail) hit = m[0].trim();
  });
  return hit;
}

// The sheet's own dropdowns and checkboxes on one row, column by column:
// { list: [...], strict } for a dropdown, { check: true } for a checkbox,
// null otherwise. Read from the sheet each time, so nothing about the
// choices is written in this public file.
function sponsorRules_(sh, row, n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push(null);
  var dv;
  try { dv = sh.getRange(row, 1, 1, n).getDataValidations()[0]; } catch (e) { return out; }
  var C = SpreadsheetApp.DataValidationCriteria || {};
  (dv || []).forEach(function (rule, i) {
    if (!rule || i >= n) return;
    try {
      var type = rule.getCriteriaType(), vals = rule.getCriteriaValues() || [];
      var strict = typeof rule.getAllowInvalid === 'function' ? !rule.getAllowInvalid() : false;
      if (type === C.CHECKBOX) { out[i] = { check: true }; return; }
      var list = null;
      if (type === C.VALUE_IN_LIST) list = vals[0] || [];
      else if (type === C.VALUE_IN_RANGE && vals[0] && typeof vals[0].getDisplayValues === 'function') {
        list = [].concat.apply([], vals[0].getDisplayValues());
      }
      if (list) {
        list = list.map(function (x) { return String(x == null ? '' : x).trim(); }).filter(function (x, k, a) { return x && a.indexOf(x) === k; }).slice(0, 60);
        if (list.length) out[i] = { list: list, strict: strict };
      }
    } catch (e) { /* an odd rule is just a text box */ }
  });
  return out;
}

// A checkbox cell's new value from the edit form or a typed word.
function checkWord_(v) {
  v = String(v == null ? '' : v).trim();
  if (/^(true|yes|y|x|✓|1|checked|on)$/i.test(v)) return true;
  if (/^(false|no|n|0|unchecked|off)?$/i.test(v)) return false;
  return null;
}

// What this person may do, and which columns are worked out by the sheet.
function sponsorPerms_() {
  var out = { writable: false, canAdd: false, canEdit: false, formulaCols: [], choices: [], me: sponsorMe_(), former: namesProp_('SPONSOR_FORMER_OWNERS') };
  var sh;
  try { sh = writableSponsorSheet_(); } catch (e) { console.log('board copy: ' + e); return out; }
  if (!sh) return out;
  out.writable = true;
  out.canAdd = true;
  out.canEdit = canEditSponsors_();
  var v = sh.getDataRange().getDisplayValues(), h0 = headerRow_(v);
  if (v.length > h0 + 1) {
    var f = sh.getRange(h0 + 2, 1, 1, v[h0].length).getFormulas()[0];
    f.forEach(function (x, i) { if (x) out.formulaCols.push(i); });
    out.choices = sponsorRules_(sh, h0 + 2, v[h0].length);
  }
  return out;
}

function sponsorHead_(sh) {
  var v = sh.getDataRange().getDisplayValues();
  var h0 = headerRow_(v);
  return { v: v, h0: h0, head: v[h0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); }) };
}

// A new contact. Any signed-in board member.
// Every write to the board sheet clears the sponsor pages' quick copy of it
// (SponsorPage.gs), so a sponsor's page never shows an old amount for long.
function boardRowsGen_() { try { return CacheService.getScriptCache().get('spBoardGen') || '0'; } catch (e) { return '0'; } }
function forgetBoardRows_() {
  try { CacheService.getScriptCache().put('spBoardGen', Date.now() + '.' + Math.floor(Math.random() * 1e6), 21600); } catch (e) { }
  if (typeof forgetSnaps_ === 'function') forgetSnaps_();
}

function sponsorAdd(data) {
  forgetBoardRows_();
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var sh = writableSponsorSheet_();
  if (!sh) return fail('Adding contacts is turned off right now.');
  var company = clean(String(data.company || '').trim(), 120);
  if (!company) return fail('Add the business or person’s name.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var t = sponsorHead_(sh);
    var low = t.head.map(function (h) { return h.toLowerCase(); });
    var col = function (re) { for (var i = 0; i < low.length; i++) if (re.test(low[i])) return i; return -1; };
    var cCo = col(/^(company|business)/);
    if (cCo < 0) return fail('The sheet has no Company column.');
    var key = companyKey_(company);
    for (var r = t.h0 + 1; r < t.v.length; r++) {
      if (companyKey_(t.v[r][cCo]) === key) return fail(company + ' is already on the sheet (row ' + (r + 1) + ').');
    }
    var vals = { company: company, contact: data.contact, phone: data.phone, email: data.email, owner: data.owner, contacted: data.contacted, notes: data.notes,
                 tier: data.tier, amount: data.amount, how: /^in kind$/i.test(String(data.how || '').trim()) ? 'In kind' : '' };
    var map = { company: cCo, contact: col(/^contact$/), phone: col(/^phone/), email: col(/^email/), owner: col(/^lybs owner/),
                contacted: col(/^contacted/), notes: col(/^notes?$/), tier: col(new RegExp('^tier selected ' + SEASON)), amount: col(/^amount/),
                how: col(/^(paid how|payment method|paid by)/) };
    var row = [];
    for (var i = 0; i < t.head.length; i++) row.push('');
    Object.keys(map).forEach(function (k) { if (map[k] >= 0 && vals[k]) row[map[k]] = clean(String(vals[k]).trim(), k === 'notes' ? 500 : 120); });
    // The new row goes right after the last sponsor, above a Total row or
    // anything else below the list.
    var last = t.h0 + 1;
    for (var q = t.v.length - 1; q > t.h0; q--) if (String(t.v[q][cCo]).trim()) { last = q + 1; break; }
    var at = last + 1;
    if (last < sh.getLastRow()) sh.insertRowAfter(last);
    sh.getRange(at, 1, 1, row.length).setValues([row]);
    // Columns the sheet works out (like "Owed a Banner") get the row above's formula.
    if (at - 1 > t.h0 + 1) {
      var f = sh.getRange(at - 1, 1, 1, row.length).getFormulasR1C1()[0];
      f.forEach(function (x, i) { if (x) sh.getRange(at, i + 1).setFormulaR1C1(x); });
    }
    logChanges_(sh, [{ company: company, what: 'Added', from: '', to: [data.contact, data.email].filter(Boolean).join(', ') }]);
    followStatus_(sh, t, at, t.head.map(function () { return ''; }), row, company);
    return ok({ message: company + ' added.', row: at });
  } finally {
    lock.releaseLock();
  }
}

// Change a row. Editors only. data.values is { header text: new value }.
function sponsorEdit(data) {
  forgetBoardRows_();
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can change a row.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var sh = writableSponsorSheet_();
  if (!sh) return fail('Editing is turned off right now.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var t = sponsorHead_(sh);
    var row = Number(data.row);
    if (!(row > t.h0 + 1) || row > t.v.length) return fail('That row is no longer on the sheet. Refresh and try again.');
    var cCo = -1;
    t.head.forEach(function (h, i) { if (cCo < 0 && /^(company|business)/i.test(h)) cCo = i; });
    // The row must still be the same sponsor, in case rows moved since the page loaded.
    if (cCo >= 0 && companyKey_(t.v[row - 1][cCo]) !== companyKey_(data.company)) return fail('That row changed since you opened it. Refresh and try again.');
    var values = data.values || {}, changed = 0, kept = [], log = [];
    var before = t.v[row - 1].slice(), after = before.slice();
    // A change that names Status itself keeps it as given, even unchanged.
    var setStatus = Object.keys(values).some(function (h) { return /^status$/i.test(String(h).replace(/\s+/g, ' ').trim()); });
    if (cCo >= 0 && Object.prototype.hasOwnProperty.call(values, t.head[cCo]) && !String(values[t.head[cCo]] || '').trim()) return fail('A row needs a company name.');
    var formulas = sh.getRange(row, 1, 1, t.head.length).getFormulas()[0];
    var rules = sponsorRules_(sh, row, t.head.length);
    // Check every value against the sheet's own dropdowns and checkboxes
    // first, so a refused value changes nothing and is never shown as saved.
    var plan = [], bad = '';
    Object.keys(values).forEach(function (h) {
      if (bad) return;
      var i = t.head.indexOf(String(h).replace(/\s+/g, ' ').trim());
      if (i < 0) return;
      if (formulas[i]) { kept.push(t.head[i]); return; }
      var nv = clean(String(values[h] == null ? '' : values[h]).trim(), 500), put = nv, was = String(t.v[row - 1][i]);
      var rule = rules[i];
      if (rule && rule.check) {
        var on = checkWord_(nv);
        if (on === null) { bad = t.head[i] + ' is a checkbox: tick it or leave it blank.'; return; }
        var wasOn = checkWord_(was) === true;
        if (on === wasOn) return;
        put = on; nv = on ? 'TRUE' : 'FALSE';
      } else if (rule && rule.list && nv) {
        var hit = rule.list.filter(function (x) { return x.toLowerCase() === nv.toLowerCase(); })[0];
        if (hit) { put = nv = hit; }
        else if (rule.strict) { bad = t.head[i] + ' has to be one of: ' + rule.list.join(', ') + '.'; return; }
      }
      if (nv === was) return;
      plan.push({ i: i, put: put, nv: nv, was: was });
    });
    if (bad) return fail(bad + ' Nothing was saved.');
    plan.forEach(function (p) {
      log.push({ company: t.v[row - 1][cCo >= 0 ? cCo : 0], what: t.head[p.i], from: p.was, to: p.nv });
      sh.getRange(row, p.i + 1).setValue(p.put);
      after[p.i] = p.nv;
      changed++;
    });
    // The sheet checks its own rules when the change lands. If it refuses,
    // say so rather than "Saved".
    if (changed) {
      try { SpreadsheetApp.flush(); }
      catch (e) { console.log('sponsorEdit refused: ' + e); return fail('The sheet refused that change, so it may not have saved. Refresh and check the row.'); }
    }
    logChanges_(sh, log);
    var st = changed && !setStatus ? followStatus_(sh, t, row, before, after, t.v[row - 1][cCo >= 0 ? cCo : 0]) : '';
    if (changed && setStatus) {
      var cSt = t.head.findIndex(function (h) { return /^status$/i.test(h); });
      if (cSt >= 0 && /^signed up/i.test(after[cSt]) && !/^signed up/i.test(before[cSt])) stampSignedUp_(sh, t, row, t.v[row - 1][cCo >= 0 ? cCo : 0]);
    }
    return ok({ message: changed ? 'Saved.' : 'Nothing changed.', changed: changed, kept: kept, status: st });
  } finally {
    lock.releaseLock();
  }
}

// After a live send, note it on the sponsor's row (a "Receipt sent" or
// "Last follow-up" column), when the sheet has that column.
// A hiccup here never undoes or blocks the send itself.
function noteOnBoardCopy_(company, header, value) {
  forgetBoardRows_();
  try {
    var sh = writableSponsorSheet_();
    if (!sh) return false;
    var t = sponsorHead_(sh);
    var low = t.head.map(function (h) { return h.toLowerCase(); });
    var cCo = -1, cAt = low.indexOf(String(header).toLowerCase());
    low.forEach(function (h, i) { if (cCo < 0 && /^(company|business)/.test(h)) cCo = i; });
    if (cCo < 0 || cAt < 0) return false;
    var key = companyKey_(company);
    for (var r = t.h0 + 1; r < t.v.length; r++) {
      if (companyKey_(t.v[r][cCo]) === key) {
        logChanges_(sh, [{ company: t.v[r][cCo], what: t.head[cAt], from: t.v[r][cAt], to: value }]);
        sh.getRange(r + 1, cAt + 1).setValue(value); return true;
      }
    }
  } catch (e) { console.log('note on board copy: ' + e); }
  return false;
}

// A note on a sponsor's row, from the Sponsors tab's "Add a note". Editors
// only. The new note goes on top of the Notes cell with the day and who
// wrote it ("Nov 21, Nate: ..."); older notes stay under it, so nobody's
// note is ever written over. Logged like any other change.
var NOTE_MAX = 500;         // one note
var NOTES_CELL_MAX = 5000;  // the whole cell; the oldest words drop off past this
function sponsorNote(data) {
  forgetBoardRows_();
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can add a note.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var text = String(data.text == null ? '' : data.text).replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  if (!text) return fail('Write the note first.');
  var sh = writableSponsorSheet_();
  if (!sh) return fail('Editing is turned off right now.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var t = sponsorHead_(sh);
    var row = Number(data.row);
    if (!(row > t.h0 + 1) || row > t.v.length) return fail('That row is no longer on the sheet. Refresh and try again.');
    var cCo = -1, cNote = -1;
    t.head.forEach(function (h, i) {
      if (cCo < 0 && /^(company|business)/i.test(h)) cCo = i;
      if (cNote < 0 && /^notes?$/i.test(String(h).trim())) cNote = i;
    });
    if (cCo >= 0 && companyKey_(t.v[row - 1][cCo]) !== companyKey_(data.company)) return fail('That row changed since you opened it. Refresh and try again.');
    if (cNote < 0) return fail('The sheet has no Notes column.');
    if (sh.getRange(row, cNote + 1).getFormula()) return fail('Notes on that row is a formula, so it can’t take a note.');
    var who = sponsorMe_() || (WHO && WHO.email ? String(WHO.email).split('@')[0] : 'Someone');
    var day = Utilities.formatDate(new Date(), 'America/New_York', 'MMM d');
    var was = String(t.v[row - 1][cNote] == null ? '' : t.v[row - 1][cNote]);
    var put = (day + ', ' + who + ': ' + text + (was.trim() ? '\n' + was : '')).slice(0, NOTES_CELL_MAX);
    put = /^[=+\-@]/.test(put) ? "'" + put : put;
    sh.getRange(row, cNote + 1).setValue(put);
    try { SpreadsheetApp.flush(); }
    catch (e) { console.log('sponsorNote refused: ' + e); return fail('The sheet refused that note, so it may not have saved. Refresh and check the row.'); }
    logChanges_(sh, [{ company: t.v[row - 1][cCo >= 0 ? cCo : 0], what: t.head[cNote], from: was, to: put }]);
    return ok({ message: 'Note saved.', notes: put });
  } finally {
    lock.releaseLock();
  }
}

// Walk-in only: someone has to stop by in person. Editors only. The sheet
// gets a "Walk-in only" column at the end the first time it's used.
var WALKIN_HEAD = 'Walk-in only';
function sponsorWalkIn(data) {
  forgetBoardRows_();
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can change a row.');
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var sh = writableSponsorSheet_();
  if (!sh) return fail('Editing is turned off right now.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return fail('Someone else is saving right now. Try again in a moment.');
  try {
    var t = sponsorHead_(sh), row = Number(data.row);
    if (!(row > t.h0 + 1) || row > t.v.length) return fail('That row is no longer on the sheet. Refresh and try again.');
    var cCo = -1;
    t.head.forEach(function (h, i) { if (cCo < 0 && /^(company|business)/i.test(h)) cCo = i; });
    if (cCo < 0 || companyKey_(t.v[row - 1][cCo]) !== companyKey_(data.company)) return fail('That row changed since you opened it. Refresh and try again.');
    var c = -1;
    t.head.forEach(function (h, i) { if (c < 0 && /^walk-?in/i.test(h)) c = i; });
    if (c < 0) {
      var width = 0;
      t.head.forEach(function (h, i) { if (h) width = i + 1; });
      c = width;
      if (c + 1 > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
      sh.getRange(t.h0 + 1, c + 1).setValue(WALKIN_HEAD);
    }
    var was = c < t.head.length ? String(t.v[row - 1][c] || '') : '';
    var nv = data.on ? 'Yes' : '';
    if (was === nv) return ok({ message: 'Nothing changed.', changed: 0 });
    sh.getRange(row, c + 1).setValue(nv);
    logChanges_(sh, [{ company: t.v[row - 1][cCo], what: WALKIN_HEAD, from: was, to: nv }]);
    var wb = t.v[row - 1].slice(), wa = wb.slice(), wh = t.head.slice();
    while (wh.length <= c) { wh.push(''); wb.push(''); wa.push(''); }
    wh[c] = WALKIN_HEAD; wb[c] = was; wa[c] = nv;
    followStatus_(sh, { head: wh }, row, wb, wa, t.v[row - 1][cCo]);
    return ok({ message: data.on ? 'Marked walk-in only.' : 'Walk-in label taken off.', changed: 1 });
  } finally {
    lock.releaseLock();
  }
}

// The printable sponsorship form for walk-ins. The file stays in the league's
// Drive (its id in the WALKIN_FORM_ID Script Property); signed-in board
// members get its bytes to open and print. Never stored in this public site.
function walkInForm() {
  var id = PropertiesService.getScriptProperties().getProperty('WALKIN_FORM_ID');
  if (!id) return fail('The printable form isn’t set up yet.');
  try {
    var f = DriveApp.getFileById(id), b = f.getBlob();
    if (b.getBytes().length > 8 * 1024 * 1024) return fail('The form file is too big to open here.');
    return ok({ name: f.getName(), mime: b.getContentType(), base64: Utilities.base64Encode(b.getBytes()) });
  } catch (e) { return fail('The printable form did not open.'); }
}

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
  var sh = sponsorSpreadsheet_().getSheetByName(SPONSOR_TAB);
  if (!sh) throw new Error('The sponsorship sheet has no "' + SPONSOR_TAB + '" tab.');
  return sh;
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

// What this person may do, and which columns are worked out by the sheet.
function sponsorPerms_() {
  var out = { writable: false, canAdd: false, canEdit: false, formulaCols: [], me: sponsorMe_(), former: namesProp_('SPONSOR_FORMER_OWNERS') };
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
  }
  return out;
}

function sponsorHead_(sh) {
  var v = sh.getDataRange().getDisplayValues();
  var h0 = headerRow_(v);
  return { v: v, h0: h0, head: v[h0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim(); }) };
}

// A new contact. Any signed-in board member.
function sponsorAdd(data) {
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
    var vals = { company: company, contact: data.contact, phone: data.phone, email: data.email, owner: data.owner, contacted: data.contacted, notes: data.notes };
    var map = { company: cCo, contact: col(/^contact$/), phone: col(/^phone/), email: col(/^email/), owner: col(/^lybs owner/),
                contacted: col(/^contacted/), notes: col(/^notes?$/) };
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
    return ok({ message: company + ' added.', row: at });
  } finally {
    lock.releaseLock();
  }
}

// Change a row. Editors only. data.values is { header text: new value }.
function sponsorEdit(data) {
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
    if (cCo >= 0 && Object.prototype.hasOwnProperty.call(values, t.head[cCo]) && !String(values[t.head[cCo]] || '').trim()) return fail('A row needs a company name.');
    var formulas = sh.getRange(row, 1, 1, t.head.length).getFormulas()[0];
    Object.keys(values).forEach(function (h) {
      var i = t.head.indexOf(String(h).replace(/\s+/g, ' ').trim());
      if (i < 0) return;
      if (formulas[i]) { kept.push(t.head[i]); return; }
      var nv = clean(String(values[h] == null ? '' : values[h]).trim(), 500);
      if (nv === String(t.v[row - 1][i])) return;
      log.push({ company: t.v[row - 1][cCo >= 0 ? cCo : 0], what: t.head[i], from: t.v[row - 1][i], to: nv });
      sh.getRange(row, i + 1).setValue(nv);
      changed++;
    });
    logChanges_(sh, log);
    return ok({ message: changed ? 'Saved.' : 'Nothing changed.', changed: changed, kept: kept });
  } finally {
    lock.releaseLock();
  }
}

// After a live send, note it on the sponsor's row (a "Receipt sent" or
// "Last follow-up" column), when the sheet has that column.
// A hiccup here never undoes or blocks the send itself.
function noteOnBoardCopy_(company, header, value) {
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

// Walk-in only: someone has to stop by in person. Editors only. The sheet
// gets a "Walk-in only" column at the end the first time it's used.
var WALKIN_HEAD = 'Walk-in only';
function sponsorWalkIn(data) {
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

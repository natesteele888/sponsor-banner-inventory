/**
 * Board edits to the sponsor tracker. Lives next to Code.gs in the same Apps
 * Script project (Files → + → Script, name it "Edits").
 *
 * The app only ever writes to the board's own copy of the sponsorship sheet,
 * named by the SPONSOR_SHEET_USE Script Property. Without that property the
 * app reads the sponsorship lead's sheet by name, as before, and every edit
 * is refused, so that sheet is never written from here. Deleting the
 * property switches the app back to it.
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

// The board copy, or null when the app is still on the lead's sheet.
function writableSponsorSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPONSOR_SHEET_USE');
  if (!id) return null;
  var sh = SpreadsheetApp.openById(id).getSheetByName(SPONSOR_TAB);
  if (!sh) throw new Error('The board copy has no "' + SPONSOR_TAB + '" tab.');
  return sh;
}

// What this person may do, and which columns are worked out by the sheet.
function sponsorPerms_() {
  var out = { writable: false, canAdd: false, canEdit: false, formulaCols: [] };
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
  if (!sh) return fail('Adding contacts turns on once the board copy of the sheet is switched on.');
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
  if (!sh) return fail('Editing turns on once the board copy of the sheet is switched on.');
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
    var values = data.values || {}, changed = 0, kept = [];
    if (cCo >= 0 && Object.prototype.hasOwnProperty.call(values, t.head[cCo]) && !String(values[t.head[cCo]] || '').trim()) return fail('A row needs a company name.');
    var formulas = sh.getRange(row, 1, 1, t.head.length).getFormulas()[0];
    Object.keys(values).forEach(function (h) {
      var i = t.head.indexOf(String(h).replace(/\s+/g, ' ').trim());
      if (i < 0) return;
      if (formulas[i]) { kept.push(t.head[i]); return; }
      var nv = clean(String(values[h] == null ? '' : values[h]).trim(), 500);
      if (nv === String(t.v[row - 1][i])) return;
      sh.getRange(row, i + 1).setValue(nv);
      changed++;
    });
    return ok({ message: changed ? 'Saved.' : 'Nothing changed.', changed: changed, kept: kept });
  } finally {
    lock.releaseLock();
  }
}

// After a live send, note it on the board copy's own row (a "Receipt sent" or
// "Last follow-up" column), when the copy is switched on and has that column.
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
      if (companyKey_(t.v[r][cCo]) === key) { sh.getRange(r + 1, cAt + 1).setValue(value); return true; }
    }
  } catch (e) { console.log('note on board copy: ' + e); }
  return false;
}

/**
 * Sponsor info packets: what sponsors send through the info packet page
 * (level, business, jersey name, write-up, socials, banner choice, logo).
 * Lives next to Code.gs in the same Apps Script project (Files → + → Script,
 * name it "Packets").
 *
 *   info packet page (its own Apps Script web app) → "LYBS Sponsor Info Packets"
 *   sheet, tab "Packets", plus a Drive folder of files for each submission
 *        │  read only from here, behind the board sign-in
 *        ▼
 *   Sponsors tab: "Sponsor info packets" list, logo shown from the files folder
 *
 * The sheet is found by its name the first time and remembered in Script
 * Properties, or set PACKET_SHEET_ID to point at it directly (for example
 * once it moves to the league's info account; that account must share the
 * sheet and its folder with the account this script runs as). The packet
 * page's own link is the SPONSOR_PACKET_URL Script Property (Receipts.gs
 * puts it in each receipt). No sheet id, folder or link is written here.
 */

var PACKET_SHEET_NAME = 'LYBS Sponsor Info Packets';
var PACKET_TAB = 'Packets';

function packetSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('PACKET_SHEET_ID') || props.getProperty('PACKET_SHEET_FOUND');
  if (id) {
    try { return SpreadsheetApp.openById(id); }
    catch (e) { props.deleteProperty('PACKET_SHEET_FOUND'); if (props.getProperty('PACKET_SHEET_ID')) throw new Error('PACKET_SHEET_ID does not open. Check that the sheet is shared with this account.'); }
  }
  var it = DriveApp.getFilesByName(PACKET_SHEET_NAME), best = null, bestAt = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    var at = f.getLastUpdated().getTime();
    if (at <= bestAt) continue;
    var ss;
    try { ss = SpreadsheetApp.openById(f.getId()); } catch (e) { continue; }
    if (!ss.getSheetByName(PACKET_TAB)) continue;
    best = ss; bestAt = at;
  }
  if (!best) return null;
  props.setProperty('PACKET_SHEET_FOUND', best.getId());
  return best;
}

// Run from the editor if the sheet is replaced: it is looked for again by name.
function forgetPacketSheet() {
  PropertiesService.getScriptProperties().deleteProperty('PACKET_SHEET_FOUND');
  console.log('Forgot the packets sheet. The next read looks for "' + PACKET_SHEET_NAME + '" again.');
}

// A Drive id out of a cell: its text, a HYPERLINK formula, or its link.
function driveIdIn_(range) {
  var tries = [range.getDisplayValue(), range.getFormula()];
  try { var rt = range.getRichTextValue(); if (rt && rt.getLinkUrl()) tries.push(rt.getLinkUrl()); } catch (e) { /* plain cell */ }
  for (var i = 0; i < tries.length; i++) {
    var m = String(tries[i] || '').match(/(?:folders\/|id=|\/d\/)([-\w]{20,})/) || String(tries[i] || '').match(/^\s*([-\w]{25,})\s*$/);
    if (m) return m[1];
  }
  return '';
}

// The whole Packets tab, as the sheet shows it. Read only.
function sponsorPackets() {
  var ss = packetSpreadsheet_();
  if (!ss) return { found: false, headers: [], rows: [] };
  var tab = bookTab_(ss, PACKET_TAB) || { headers: [], rows: [] };
  return { found: true, sheetName: ss.getName(), headers: tab.headers, rows: tab.rows };
}

// The newest image in one submission's files folder. Only a folder named on
// that row of the Packets tab, and only one inside the packets' own Drive
// folder, so this can't be pointed at any other file.
function packetLogo(data) {
  var ss = packetSpreadsheet_();
  if (!ss) return fail('The packets sheet was not found.');
  var sh = ss.getSheetByName(PACKET_TAB);
  var row = Number(data.row);
  if (!sh || !(row >= 2) || row > sh.getLastRow()) return fail('That packet is no longer on the sheet.');
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).toLowerCase().trim(); });
  var col = head.indexOf('files folder');
  if (col < 0) return ok({ logo: null });
  var id = driveIdIn_(sh.getRange(row, col + 1));
  if (!id) return ok({ logo: null });
  var folder;
  try { folder = DriveApp.getFolderById(id); } catch (e) { return ok({ logo: null }); }
  var home = DriveApp.getFileById(ss.getId()).getParents();
  var homeIds = [];
  while (home.hasNext()) homeIds.push(home.next().getId());
  var inside = false, up = folder.getParents(), hops = 0;
  while (up.hasNext() && hops++ < 3) {
    var p = up.next();
    if (homeIds.indexOf(p.getId()) >= 0) { inside = true; break; }
    up = p.getParents();
  }
  if (!inside && homeIds.indexOf(folder.getId()) < 0) return fail('That files folder is not in the packets folder.');
  var it = folder.getFiles(), best = null;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(f.getMimeType()) < 0) continue;
    if (!best || f.getLastUpdated() > best.getLastUpdated()) best = f;
  }
  return ok({ logo: best ? logoBlob_(best) : null, files: best ? 1 : 0 });
}

// Put one info packet on the sponsor list: the business, contact, email,
// phone and level from that packet's row, read here and not from the page.
// Any signed-in board member may, as with adding a contact. A business that
// is already on the list is refused, so nothing is entered twice. The packet
// itself stays on the packets sheet untouched.
function packetAdd(data) {
  var ss = packetSpreadsheet_();
  if (!ss) return fail('The packets sheet was not found.');
  var tab = bookTab_(ss, PACKET_TAB), row = Number(data.row), hit = null;
  (tab ? tab.rows : []).forEach(function (r) { if (r.row === row) hit = r; });
  if (!hit) return fail('That packet is no longer on the sheet.');
  var low = tab.headers.map(function (h) { return String(h).toLowerCase(); });
  var get = function (re) { for (var i = 0; i < low.length; i++) if (re.test(low[i])) return String(hit.cells[i] || '').trim(); return ''; };
  var company = get(/^business/);
  if (!company) return fail('That packet has no business name.');
  var level = get(/^level/), tier = tierFromText_(level);
  var amt = TIER_AMOUNTS[tier] || (Number(String(level).replace(/[^0-9.]/g, '')) || 0);
  var when = get(/^submitted/);
  return sponsorAdd({
    company: company, contact: get(/^contact name/), email: firstEmail_(get(/^email/)), phone: get(/^phone/),
    contacted: 'Yes', tier: tier || level, amount: amt ? '$' + String(Math.round(amt)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '',
    notes: 'Sent the info packet' + (when ? ' (' + when + ')' : '') + '.'
  });
}

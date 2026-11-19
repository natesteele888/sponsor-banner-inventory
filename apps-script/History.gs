/**
 * Year over year: this season's committed total next to last season's at
 * the same point of the year, for the thin strip on the Sponsors tab.
 *
 * Totals only (dollars committed, dollars paid, number of sponsors), never a
 * sponsor's name or row. Everything here stays in this private Apps Script
 * project's Script Properties; nothing is written to any sheet or repo.
 *
 * This season: a snapshot of today's totals is kept each day someone opens
 * the Sponsors tab (SPONSOR_SNAPS_<season>, one entry per day), so next year
 * has real dates to compare against.
 *
 * Last season: there was no dated log, so its points come from the saved
 * versions (revision history) of last season's sponsorship sheet in Drive.
 * Each point is that version's date and the total its sponsor tab showed.
 * Drive keeps older versions thinly, so the first point is the oldest saved
 * version, and the app says so. Worked out once and remembered
 * (SPONSOR_PREV_<season>); run forgetSponsorHistory() to work it out again.
 *
 * Counted the same way as the Sponsors tab: a row with a company and an
 * amount over $0 is a sponsor; its amount is committed; "Paid?" yes is paid.
 */

var SNAPS_PROP = 'SPONSOR_SNAPS_' + SEASON;
var PREV_SEASON = String(Number(SEASON) - 1);
var PREV_PROP = 'SPONSOR_PREV_' + PREV_SEASON;
var SNAPS_MAX = 300;          // about 7 KB, under the 9 KB a property can hold
var PREV_POINTS_MAX = 14;     // versions read for last season, at most

function amountOf_(v) { return Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0; }
function isYes_(v) { return /^\s*(y|yes|true|x|paid)/i.test(String(v == null ? '' : v)); }
function dayOf_(d) { return Utilities.formatDate(d, 'America/New_York', 'yyyy-MM-dd'); }

// Totals from a sponsor tab's values (header row found as bookTab_ does).
function sponsorTotals_(v, season) {
  var out = { committed: 0, paid: 0, count: 0, paidCount: 0 };
  if (!v || !v.length) return null;
  var h0 = headerRow_(v);
  var head = v[h0].map(function (h) { return String(h).replace(/\s+/g, ' ').trim().toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var cCo = col(/^(company|business)/), cAmt = col(/^amount/), cPaid = col(/^paid/);
  var cTier = col(new RegExp('^tier selected ' + season));
  if (cCo < 0 || cAmt < 0 || cTier < 0) return null;   // not that season's sponsor tab
  for (var r = h0 + 1; r < v.length; r++) {
    if (!String(v[r][cCo] || '').trim()) continue;
    var amt = amountOf_(v[r][cAmt]);
    if (amt <= 0) continue;
    out.count++; out.committed += amt;
    if (cPaid >= 0 && isYes_(v[r][cPaid])) { out.paidCount++; out.paid += amt; }
  }
  out.committed = Math.round(out.committed); out.paid = Math.round(out.paid);
  return out;
}

// ---------- this season: one snapshot a day ----------

function readSnaps_() {
  var raw = PropertiesService.getScriptProperties().getProperty(SNAPS_PROP) || '';
  return raw.split(';').filter(Boolean).map(function (s) {
    var p = s.split(',');
    return { date: p[0], committed: Number(p[1]) || 0, paid: Number(p[2]) || 0, count: Number(p[3]) || 0 };
  });
}

function logSnapshot_(t) {
  if (!t) return;
  var today = dayOf_(new Date());
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;           // a missed snapshot is fine; tomorrow's will land
  try {
    var snaps = readSnaps_().filter(function (s) { return s.date !== today; });
    snaps.push({ date: today, committed: t.committed, paid: t.paid, count: t.count });
    snaps = snaps.slice(-SNAPS_MAX);
    PropertiesService.getScriptProperties().setProperty(SNAPS_PROP, snaps.map(function (s) {
      return [s.date, s.committed, s.paid, s.count].join(',');
    }).join(';'));
  } finally {
    lock.releaseLock();
  }
}

function currentTotals_() {
  var ss = sponsorSpreadsheet_(), sh = ss.getSheetByName(sponsorTabName_(ss));
  return sh ? sponsorTotals_(sh.getDataRange().getDisplayValues(), SEASON) : null;
}

// ---------- last season: from the sheet's saved versions ----------

function prevSheetId_() {
  var name = PREV_SEASON + '_Sponsorship Sheet', tab = PREV_SEASON + ' sponsors';
  var it = DriveApp.getFilesByName(name), best = null, bestAt = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || f.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    var at = f.getLastUpdated().getTime();
    if (at <= bestAt) continue;
    try { if (!SpreadsheetApp.openById(f.getId()).getSheetByName(tab)) continue; } catch (e) { continue; }
    best = f; bestAt = at;
  }
  return best ? { id: best.getId(), created: dayOf_(best.getDateCreated()) } : null;
}

// Keep the last version of each half month. When that is still too many,
// keep the first and last and thin the ones between evenly, so the early
// weeks (when sponsors sign up) stay in.
function pickVersions_(revs) {
  var byHalf = {};
  revs.forEach(function (r) {
    var d = new Date(r.modifiedDate);
    var key = Utilities.formatDate(d, 'America/New_York', 'yyyy-MM') + (Number(Utilities.formatDate(d, 'America/New_York', 'd')) > 15 ? 'b' : 'a');
    if (!byHalf[key] || new Date(byHalf[key].modifiedDate) < d) byHalf[key] = r;
  });
  var picked = Object.keys(byHalf).sort().map(function (k) { return byHalf[k]; });
  if (picked.length <= PREV_POINTS_MAX) return picked;
  var out = [], step = (picked.length - 1) / (PREV_POINTS_MAX - 1);
  for (var i = 0; i < PREV_POINTS_MAX; i++) out.push(picked[Math.round(i * step)]);
  return out;
}

function prevSeasonHistory_() {
  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty(PREV_PROP);
  if (cached) { try { return JSON.parse(cached); } catch (e) { /* worked out again below */ } }

  var sheet = prevSheetId_();
  if (!sheet) return { season: PREV_SEASON, points: [], note: 'no sheet' };
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v2/files/' + sheet.id + '/revisions?maxResults=1000',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return { season: PREV_SEASON, points: [], note: 'no versions' };
  var revs = (JSON.parse(res.getContentText()).items || []).filter(function (r) {
    return r.exportLinks && r.exportLinks['text/csv'];
  });
  var points = [];
  pickVersions_(revs).forEach(function (r) {
    // A sheet's CSV is its first tab; a version whose first tab isn't the
    // sponsor tab is skipped rather than guessed at.
    var csv = UrlFetchApp.fetch(r.exportLinks['text/csv'], { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (csv.getResponseCode() !== 200) return;
    var t = sponsorTotals_(Utilities.parseCsv(csv.getContentText()), PREV_SEASON);
    if (t) points.push({ date: dayOf_(new Date(r.modifiedDate)), committed: t.committed, paid: t.paid, count: t.count });
  });
  // Last season's final total, read from the sheet as it is now.
  var fin = null;
  try {
    var tab = SpreadsheetApp.openById(sheet.id).getSheetByName(PREV_SEASON + ' sponsors');
    fin = tab ? sponsorTotals_(tab.getDataRange().getDisplayValues(), PREV_SEASON) : null;
  } catch (e) { console.log('prev season final failed: ' + e); }
  var out = { season: PREV_SEASON, sheetCreated: sheet.created, points: points, final: fin, workedOut: dayOf_(new Date()) };
  if (points.length || fin) props.setProperty(PREV_PROP, JSON.stringify(out));
  return out;
}

// Run from the editor to work last season's points out again.
function forgetSponsorHistory() {
  PropertiesService.getScriptProperties().deleteProperty(PREV_PROP);
  console.log('Forgot ' + PREV_PROP + '. The next Sponsors tab visit works it out again.');
}

// The action the Sponsors tab calls. Also logs today's snapshot.
function sponsorHistory() {
  var now = currentTotals_();
  logSnapshot_(now);
  var prev;
  try { prev = prevSeasonHistory_(); }
  catch (e) { console.log('prev season history failed: ' + e); prev = { season: PREV_SEASON, points: [], note: 'failed' }; }
  return { season: SEASON, today: dayOf_(new Date()), now: now, snaps: readSnaps_(), prev: prev };
}

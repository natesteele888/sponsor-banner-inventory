/**
 * Sponsor Banner Inventory — Google Apps Script backend.
 *
 * WHY THIS EXISTS
 *
 * The app's front end is a static page (GitHub Pages) with nowhere to write
 * data or store photos. Firebase would need the Blaze plan for Cloud
 * Functions; this project (like LYBS's others) stays on Spark. Apps Script
 * and Drive cost nothing and the photos already live in a Drive folder
 * ("Sponsor Banners") — same pattern as lybs-reporting's photo intake
 * (apps-script/Code.gs there), adapted for one person's private tool rather
 * than a public submission queue.
 *
 * WHAT IT DOES
 *
 * One Sheet ("Sponsor Banner Inventory (data)", tab Sheet1) is the database —
 * one row per banner. This script reads it for the app's list/detail views,
 * appends a row + Drive file when a new banner is uploaded from the app, and
 * updates a row when Nate edits a banner (hung toggle, map pin, contact info,
 * notes).
 *
 * SETUP — about five minutes, once
 *
 *  1. Open "Sponsor Banner Inventory (data)" in Google Sheets (Nate already
 *     has this — Claude created and seeded it from the Drive folder + the
 *     2026 sponsorship sheet). Extensions → Apps Script.
 *  2. Delete the placeholder code and paste this whole file in.
 *  3. SHEET_ID below should already match (it's bound to this sheet, so
 *     SpreadsheetApp.getActiveSpreadsheet() finds it automatically — no
 *     paste needed there). Just fill in ACCESS_TOKEN with a long random
 *     string of your choosing.
 *  4. Deploy → New deployment → Web app.
 *       Execute as:        Me
 *       Who has access:    Anyone
 *     "Anyone" is needed because the app has no sign-in. ACCESS_TOKEN below
 *     is a speed bump, not real security — anyone who reads app.js's source
 *     can find it. What it stops is a crawler stumbling on the /exec URL and
 *     scraping sponsor contact info or filling the Drive folder with junk.
 *     Treat it like a shared secret anyway: don't post the URL publicly.
 *  5. Copy the resulting /exec URL and ACCESS_TOKEN into config.js next to
 *     index.html.
 *  6. Run `listBanners` once from the editor (Run ▸ listBanners) to grant
 *     the Sheets/Drive permissions the first call will need.
 */

// Fill this in with a long random string, and the same value in config.js.
var ACCESS_TOKEN = 'PASTE_A_LONG_RANDOM_STRING_HERE';

// The "Sponsor Banners" Drive folder — where every banner photo lives.
var DRIVE_FOLDER_ID = '1jptziLDOEAp2MKAcP3wQKe9cVrT4BRS0';

var SHEET_NAME = 'Sheet1';

// A single upload larger than this is refused, so one giant photo can't fill
// the Drive folder's quota or blow past Apps Script's response-size limits.
var MAX_BYTES = 12 * 1024 * 1024;

// Uploads/edits accepted in any rolling hour. Generous — this is a one-person
// tool, not a public form — but it keeps a runaway client from writing
// hundreds of rows if something loops.
var MAX_WRITES_PER_HOUR = 120;

var COLUMNS = ['id', 'filename', 'driveFileId', 'sponsorName', 'onSponsorList',
               'tier', 'amountPaid', 'contactName', 'contactPhone', 'contactEmail',
               'address', 'condition', 'hung', 'lat', 'lng', 'locationLabel',
               'notes', 'updatedAt'];


function doGet(e) {
  var p = e.parameter || {};
  if (String(p.token || '') !== ACCESS_TOKEN) return fail('Not authorized.');
  var action = String(p.action || 'list');
  try {
    if (action === 'list') return ok({ banners: listBanners() });
    if (action === 'image') return ok(getImage(p.id, p.size));
    return fail('Unknown action.');
  } catch (err) {
    console.log('doGet failed: ' + err);
    return fail('Something went wrong loading that.');
  }
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return fail('Malformed request.');
  }
  if (String(data.token || '') !== ACCESS_TOKEN) return fail('Not authorized.');

  try {
    var action = String(data.action || '');
    if (action === 'update') return update(data);
    if (action === 'upload') return upload(data);
    return fail('Unknown action.');
  } catch (err) {
    console.log('doPost failed: ' + err);
    return fail('Could not save that. Try again, and check the Apps Script log if it keeps happening.');
  }
}


// ---------- reads ----------

function listBanners() {
  var sheet = getSheet();
  var range = sheet.getDataRange().getValues();
  var header = range[0];
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });
  return range.slice(1)
    .filter(function (row) { return String(row[idx.id] || '').length > 0; })
    .map(function (row) {
      var o = {};
      COLUMNS.forEach(function (col) {
        var v = idx[col] !== undefined ? row[idx[col]] : '';
        if (col === 'onSponsorList' || col === 'hung') v = String(v).toUpperCase() === 'TRUE';
        if (col === 'lat' || col === 'lng') v = v === '' ? null : Number(v);
        o[col] = v;
      });
      return o;
    });
}

// size: 'thumb' (fast, for the scrollable list) or 'full' (detail view).
function getImage(driveFileId, size) {
  if (!driveFileId) throw new Error('No file id given.');
  var file = DriveApp.getFileById(driveFileId);
  var blob = size === 'full' ? file.getBlob() : (file.getThumbnail() || file.getBlob());
  return {
    mime: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}


// ---------- writes ----------

function update(data) {
  if (!underRateLimit()) return fail('Too many changes in the last hour — try again shortly.');
  var id = String(data.id || '');
  if (!id) return fail('No banner id given.');

  var sheet = getSheet();
  var range = sheet.getDataRange().getValues();
  var header = range[0];
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });

  var rowNum = -1;
  for (var r = 1; r < range.length; r++) {
    if (String(range[r][idx.id]) === id) { rowNum = r + 1; break; }
  }
  if (rowNum < 0) return fail('That banner no longer exists — someone may have removed it.');

  // Only these fields are editable from the app. sponsorName/contact* are
  // editable too (a board member's contact changes more often than their
  // company does), but id/filename/driveFileId never are — they're how a row
  // is found again.
  var editable = ['sponsorName', 'onSponsorList', 'tier', 'amountPaid',
                   'contactName', 'contactPhone', 'contactEmail', 'address',
                   'condition', 'hung', 'lat', 'lng', 'locationLabel', 'notes'];
  editable.forEach(function (col) {
    if (!(col in data)) return;
    if (idx[col] === undefined) return;
    var v = data[col];
    if (col === 'sponsorName' || col === 'contactName' || col === 'contactPhone' ||
        col === 'contactEmail' || col === 'address' || col === 'condition' ||
        col === 'locationLabel' || col === 'notes' || col === 'tier' || col === 'amountPaid') {
      v = clean(v, col === 'notes' ? 2000 : 300);
    }
    if (col === 'hung' || col === 'onSponsorList') v = v ? 'TRUE' : 'FALSE';
    if (col === 'lat' || col === 'lng') v = (v === null || v === '' || v === undefined) ? '' : Number(v);
    sheet.getRange(rowNum, idx[col] + 1).setValue(v);
  });
  sheet.getRange(rowNum, idx.updatedAt + 1).setValue(todayStamp());

  return ok({ message: 'Saved.' });
}

function upload(data) {
  if (!underRateLimit()) return fail('Too many uploads in the last hour — try again shortly.');
  if (!data.photo) return fail('No photo received.');
  var sponsorName = clean(data.sponsorName);
  if (!sponsorName) return fail('Sponsor name is required.');

  var parts = String(data.photo).split(',');
  var bytes = Utilities.base64Decode(parts[parts.length - 1]);
  if (bytes.length > MAX_BYTES) {
    return fail('That photo is larger than 12 MB — try a smaller export from your phone.');
  }
  var type = sniffImage(bytes);
  if (!type) return fail('That does not look like a photo. JPEG, PNG, GIF, WebP and HEIC are all fine.');

  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
  var safeName = 'LYBS_sponsor_' + sponsorName.replace(/[^A-Za-z0-9]+/g, '') + '_' + stamp;
  var blob = Utilities.newBlob(bytes, type, safeName);
  var file = DriveApp.getFolderById(DRIVE_FOLDER_ID).createFile(blob);

  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var idx = {};
  header.forEach(function (h, i) { idx[h] = i; });

  // Ids so far are small sequential numbers (see the seed import); keep
  // handing out the next one rather than switching schemes mid-sheet.
  var ids = sheet.getRange(2, idx.id + 1, Math.max(lastRow - 1, 0), 1).getValues()
    .map(function (r) { return parseInt(r[0], 10); })
    .filter(function (n) { return !isNaN(n); });
  var nextId = (ids.length ? Math.max.apply(null, ids) : 0) + 1;

  var row = new Array(header.length).fill('');
  row[idx.id] = nextId;
  row[idx.filename] = file.getName();
  row[idx.driveFileId] = file.getId();
  row[idx.sponsorName] = sponsorName;
  row[idx.onSponsorList] = data.onSponsorList ? 'TRUE' : 'FALSE';
  row[idx.tier] = clean(data.tier, 100);
  row[idx.amountPaid] = clean(data.amountPaid, 50);
  row[idx.contactName] = clean(data.contactName, 300);
  row[idx.contactPhone] = clean(data.contactPhone, 100);
  row[idx.contactEmail] = clean(data.contactEmail, 300);
  row[idx.address] = clean(data.address, 300);
  row[idx.condition] = clean(data.condition, 300) || 'Good';
  row[idx.hung] = data.hung ? 'TRUE' : 'FALSE';
  row[idx.lat] = data.lat || '';
  row[idx.lng] = data.lng || '';
  row[idx.locationLabel] = clean(data.locationLabel, 300);
  row[idx.notes] = clean(data.notes, 2000);
  row[idx.updatedAt] = todayStamp();

  sheet.appendRow(row);
  return ok({ message: 'Added.', id: nextId, driveFileId: file.getId() });
}


// ---------- helpers ----------

function getSheet() {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
}

function todayStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// Every field from the client is untrusted text headed for a spreadsheet —
// a value starting with = would be read as a formula by Sheets.
function clean(v, max) {
  var s = String(v == null ? '' : v).slice(0, max || 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

/**
 * Identify an image by its leading bytes rather than trusting the data: URI's
 * label — same check as lybs-reporting's photo intake. SVG is deliberately
 * absent: it's a document that can carry script, not a banner photo.
 */
function sniffImage(b) {
  if (!b || b.length < 12) return '';
  function u(i) { return b[i] & 0xFF; }
  if (u(0) === 0xFF && u(1) === 0xD8) return 'image/jpeg';
  if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) return 'image/png';
  if (u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46) return 'image/gif';
  if (u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return 'image/webp';
  if (u(4) === 0x66 && u(5) === 0x74 && u(6) === 0x79 && u(7) === 0x70) return 'image/heic';
  return '';
}

function underRateLimit() {
  var props = PropertiesService.getScriptProperties();
  var key = 'writeTimestamps';
  var now = Date.now();
  var times = JSON.parse(props.getProperty(key) || '[]')
    .filter(function (t) { return now - t < 60 * 60 * 1000; });
  if (times.length >= MAX_WRITES_PER_HOUR) return false;
  times.push(now);
  props.setProperty(key, JSON.stringify(times));
  return true;
}

function ok(obj) {
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ ok: true }, obj)))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * LYBS Sponsors (was Sponsor Banner Inventory) — Google Apps Script backend.
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
 * SETUP
 *
 *  Deploy → Web app, Execute as: Me, Who has access: Anyone. "Anyone" only
 *  means Google lets the request reach this script. authorize() below is the
 *  real lock: every call must carry a Firebase sign-in token from the LYBS
 *  Dashboard, and that account must hold the board, director or admin role.
 *  To add or remove someone, change their role in Dashboard → Manage.
 *
 *  Sponsors-only access: someone who should see this app but not the
 *  Dashboard (no Dashboard role) can be let in by their Google address.
 *  Project Settings → Script Properties → SPONSORS_ONLY_EMAILS, addresses
 *  separated by commas. They sign in with Google, see every tab of this app,
 *  and the page hides its links to the Dashboard. Remove an address to take
 *  access away (it ends within five minutes). The list lives only in this
 *  private Apps Script project, never in this repo.
 */

// The LYBS Dashboard's Firebase project. The web API key is a public identifier
// (it ships in the Dashboard's own pages); it can't read anything by itself.
var FIREBASE_PROJECT = 'lybs-dashboard';
var FIREBASE_WEB_API_KEY = 'AIzaSyAnFzm4QNqrEtre71SbTjG45w0SlLQ-8QA';
var ALLOWED_ROLES = ['board', 'director', 'admin'];
// SHA-256 (web-safe base64) of the lowercased bootstrap admin email, so the
// address itself stays out of this public file. Make a new one with emailHash_().
var BOOTSTRAP_ADMIN_EMAIL_HASH = 'uohdwMkKg4ltUZSWMQgEvvsVW6-iK8HavFhPSKQjkGk=';

// The "Sponsor Banners" Drive folder — where every banner photo lives.
var DRIVE_FOLDER_ID = '1jptziLDOEAp2MKAcP3wQKe9cVrT4BRS0';

// "Sponsor Banner Inventory (data)" — the database sheet.
var SHEET_ID = '1lG860tUAPOy12itwcs9Yc48_7QZa3r9CPIKe-G9HTTQ';
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


function doGet() {
  return fail('Not authorized.');
}

function doPost(e) {
  var data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return fail('Malformed request.');
  }

  // The sponsor reply page (intake.html) is the one public door: no sign-in,
  // but every call needs the long random token from that sponsor's own email,
  // and it can only see or fill in that one sponsor's row. See intake section.
  var publicAction = String(data.action || '');
  if (publicAction === 'intakeGet' || publicAction === 'intakeSubmit') {
    try {
      return publicAction === 'intakeGet' ? intakeGet(data) : intakeSubmit(data);
    } catch (err) {
      console.log('intake failed: ' + err);
      return fail('Something went wrong on our end. Please try again, or just reply to the email.');
    }
  }

  // The sponsor's own info page (sponsor.html), linked from their receipt:
  // the same kind of door, keyed by that sponsor's own long random token.
  if (publicAction === 'sponsorPageGet' || publicAction === 'sponsorPageSubmit' || publicAction === 'sponsorReceiptGet') {
    try {
      if (publicAction === 'sponsorReceiptGet') return sponsorReceiptGet(data);
      if (publicAction === 'sponsorPageGet') return sponsorPageGet(data);
      var sent = sponsorPageSubmit(data);
      forgetSnaps_();   // packets and upgrades changed
      return sent;
    } catch (err) {
      console.log('sponsor page failed: ' + err);
      return fail('Something went wrong on our end. Please try again, or just reply to the email.');
    }
  }

  // Ballclub team pages are the next door: someone signed in to a team
  // there gets that team's "Sponsored by" names and logos, nothing else. It
  // has its own sign-in check (authorizeTeamViewer_ in Season.gs).
  if (publicAction === 'teamPageSponsor') {
    try {
      return teamPageSponsorRequest_(data);
    } catch (err) {
      console.log('teamPageSponsor failed: ' + err);
      return fail('Could not load the sponsor right now.');
    }
  }

  var who;
  try {
    who = authorize(String(data.idToken || ''));
  } catch (err) {
    console.log('authorize failed: ' + err);
    return fail('Could not check your sign-in. Try again in a minute.');
  }
  if (!who.ok) return fail(who.error);
  WHO = who;

  var asked = String(data.action || '');
  // Board members other than the sponsorship leads (the editors: the league
  // admin and SPONSOR_EDITORS) get the board view only: who's in, who's paid,
  // and how outreach stands. Every other call is refused for them here, so no
  // contact, note, amount or email ever reaches their device.
  if (!canEditSponsors_() && !BOARD_VIEW_ACTIONS[asked]) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, boardView: true,
      error: 'You have the board view of sponsors.' })).setMimeType(ContentService.MimeType.JSON);
  }
  var reply = route_(asked, data);
  // Anything that may have changed a sheet clears the quick copies of the reads.
  if (!SNAP_READ_ONLY[asked]) forgetSnaps_();
  return reply;
}

// What a board member outside the sponsorship leads may ask for: the board
// view, and the Dashboard's Uniforms and Jersey Order pages (no contact columns).
var BOARD_VIEW_ACTIONS = { sponsorBoardView: 1, sponsorSheet: 1 };

function route_(action, data) {
  try {
    if (action === 'sponsorBoardView') return ok(snapRead_('boardview', !!data.fresh, sponsorBoardView_));
    if (action === 'list') return ok(snapRead_('list', false, function () { return { banners: listBanners() }; }));
    if (action === 'image') return ok(getImage(data.id, data.size));
    if (action === 'update') return update(data);
    if (action === 'upload') return upload(data);
    if (action === 'seasonList') return ok(seasonList());
    if (action === 'seasonUpdate') return seasonUpdate(data);
    if (action === 'seasonAdd') return seasonAdd(data);
    if (action === 'seasonRequest') return seasonRequest(data);
    if (action === 'seasonScan') return ok({ added: scanForNewSponsors() });
    // The Sponsors tab: the sponsorship sheet, read live, and sponsor-to-team picks.
    if (action === 'sponsorBook') {
      // The sheet, the change log and the sheet's edit settings, shared by
      // everyone; then who this person is and whether they may edit.
      var bk = snapRead_('book', !!data.fresh, function () {
        var b = sponsorBook(), p = sponsorPerms_();
        b.changes = sponsorChanges_(sponsorSpreadsheet_(), 1000);
        ['writable', 'canAdd', 'formulaCols', 'choices', 'former'].forEach(function (k) { b[k] = p[k]; });
        return b;
      });
      // The sponsor pages' small map of the sheet comes from the same copy,
      // so a sponsor opening their page doesn't wait on a sheet read.
      if (bk.tabs && bk.tabs[0] && typeof cacheBoardRows_ === 'function') cacheBoardRows_(bk.tabs[0]);
      bk.me = sponsorMe_();
      bk.canEdit = !!bk.writable && canEditSponsors_();
      return ok(bk);
    }
    if (action === 'sponsorAdd') return sponsorAdd(data);
    if (action === 'sponsorEdit') return sponsorEdit(data);
    if (action === 'sponsorNote') return sponsorNote(data);
    if (action === 'outreachList') return outreachList(data);
    if (action === 'outreachPreview') return outreachPreview(data);
    if (action === 'outreachSend') return outreachSend(data);
    if (action === 'outreachCompose') return outreachCompose(data);
    if (action === 'outreachSent') return outreachSent(data);
    if (action === 'outreachTicket') return outreachTicket(data);
    if (action === 'outreachReview') return outreachReview(data);
    if (action === 'allowSent') return allowSent(data);
    if (action === 'sponsorPacketLink') return sponsorPacketLink(data);
    if (action === 'welcomeList') return welcomeList(data);
    if (action === 'welcomePreview') return welcomePreview(data);
    if (action === 'welcomeSend') return welcomeSend(data);
    if (action === 'sponsorWalkIn') return sponsorWalkIn(data);
    if (action === 'walkInForm') return walkInForm();
    // This season's committed total next to last season's (History.gs). Totals only.
    if (action === 'sponsorHistory') return ok(snapRead_('history', false, sponsorHistory));
    if (action === 'receiptList') return ok(snapRead_('receipts', false, receiptList));
    if (action === 'receiptPreview') return receiptPreview(data);
    if (action === 'receiptCopyGet') return receiptCopyGet(data);
    if (action === 'receiptSend') return receiptSend(data);
    if (action === 'receiptMark') return receiptMark(data);
    if (action === 'receiptThanksPreview') return receiptThanksPreview(data);
    if (action === 'receiptThanksSend') return receiptThanksSend(data);
    if (action === 'receiptThanksMark') return receiptThanksMark(data);
    if (action === 'nudgeList') return ok(snapRead_('nudges', false, nudgeList));
    if (action === 'nudgePreview') return nudgePreview(data);
    if (action === 'nudgeSend') return nudgeSend(data);
    if (action === 'nudgeMark') return nudgeMark(data);
    if (action === 'nudgeRound') return nudgeRound(data);
    if (action === 'payNudgeList') return ok(payNudgeList());
    if (action === 'payNudgePreview') return payNudgePreview(data);
    if (action === 'payNudgeSend') return payNudgeSend(data);
    if (action === 'sponsorPackets') return ok(snapRead_('packets', false, sponsorPackets));
    if (action === 'packetAdd') return packetAdd(data);
    if (action === 'sponsorUpgrades') return ok(snapRead_('upgrades', false, function () { return { upgrades: sponsorUpgrades() }; }));
    if (action === 'sponsorUpgradePaid') return sponsorUpgradePaid(data);
    if (action === 'packetLogo') return packetLogo(data);
    if (action === 'spotlightSponsors') return spotlightSponsors();
    if (action === 'spotlightLogo') return spotlightLogo(data);
    if (action === 'spotlightCardSave') return spotlightCardSave(data);
    if (action === 'sponsorTeamSave') return sponsorTeamSave(data);
    if (action === 'sponsorTeamLogo') return sponsorTeamLogo(data);
    // A small copy of each sponsor's logo from the league's Sponsor Logos folder.
    if (action === 'sponsorLogoList') return ok(snapRead_('logos', !!data.fresh, function () { return sponsorLogoList(!!data.fresh); }));
    // When the website was last looked at for sponsor payments, and whether each is on the sheet. Read only.
    if (action === 'websiteCheck') return ok(websiteCheck(!!data.fresh));
    // The LYBS Dashboard's Uniforms and Jersey Order pages: same sheet, no contact columns.
    if (action === 'sponsorSheet') return ok(sponsorSheet());
    return fail('Unknown action.');
  } catch (err) {
    console.log('doPost failed: ' + err);
    return fail('Could not complete that. Try again, and check the Apps Script log if it keeps happening.');
  }
}


// ---------- speed: quick copies of the reads ----------
// Each read took one to three seconds of opening and reading sheets, on
// every open by every board member. Now the answer is kept in Apps Script's
// private cache for ten minutes and shared by everyone signed in: any change
// made through the app clears it at once (doPost), Refresh in the app reads
// the sheet fresh, and a change typed straight into the sheet shows within
// ten minutes. Nothing about who is asking is kept in it.
var SNAP_TTL = 600;            // 10 minutes
var SNAP_CHUNK = 30000;        // characters per cache entry (each entry holds up to 100 KB)
var SNAP_READ_ONLY = { list: 1, image: 1, seasonList: 1, sponsorBook: 1, walkInForm: 1, sponsorHistory: 1, receiptList: 1,
  receiptPreview: 1, receiptCopyGet: 1, nudgeList: 1, nudgePreview: 1, sponsorPackets: 1, sponsorUpgrades: 1, spotlightSponsors: 1,
  sponsorLogoList: 1, websiteCheck: 1, sponsorSheet: 1, sponsorBoardView: 1, outreachList: 1, outreachPreview: 1, outreachCompose: 1, welcomeList: 1, welcomePreview: 1,
  payNudgeList: 1, payNudgePreview: 1 };

function snapGen_() { try { return CacheService.getScriptCache().get('snapGen') || '0'; } catch (e) { return '0'; } }
function forgetSnaps_() { try { CacheService.getScriptCache().put('snapGen', Date.now() + '.' + Math.floor(Math.random() * 1e6), 21600); } catch (e) { } }

function snapRead_(name, fresh, build) {
  var cache, key = 'snap_' + name + '_' + snapGen_();
  try { cache = CacheService.getScriptCache(); } catch (e) { return build(); }
  if (!fresh) {
    try { var hit = snapGet_(cache, key); if (hit) return JSON.parse(hit); } catch (e) { }
  }
  var v = build();
  try { snapPut_(cache, key, JSON.stringify(v)); } catch (e) { }
  return v;
}
function snapPut_(cache, key, s) {
  var n = Math.ceil(s.length / SNAP_CHUNK);
  if (!n || n > 30) return;   // too big to keep: read live each time
  var o = {};
  for (var i = 0; i < n; i++) o[key + '_' + i] = s.slice(i * SNAP_CHUNK, (i + 1) * SNAP_CHUNK);
  cache.putAll(o, SNAP_TTL);
  cache.put(key, String(n), SNAP_TTL);   // last, so a reader never sees half a copy
}
function snapGet_(cache, key) {
  var n = Number(cache.get(key) || 0);
  if (!n) return null;
  var keys = [];
  for (var i = 0; i < n; i++) keys.push(key + '_' + i);
  var got = cache.getAll(keys), s = '';
  for (var j = 0; j < n; j++) { if (got[keys[j]] == null) return null; s += got[keys[j]]; }
  return s;
}

// Optional: run every 5 minutes from a time trigger (Triggers, Add Trigger,
// warmSponsorReads, time-driven, every 5 minutes) so the quick copies are
// always ready and nobody waits on a cold read. Reads only; sends nothing.
function warmSponsorReads() {
  WHO = null;
  route_('sponsorBook', {});
  ['sponsorHistory', 'receiptList', 'nudgeList', 'sponsorPackets', 'sponsorUpgrades', 'sponsorLogoList', 'list']
    .forEach(function (a) { try { route_(a, {}); } catch (e) { console.log('warm ' + a + ': ' + e); } });
}

// ---------- sign-in ----------

// Run this once from the editor to grant or test the permissions authorize() needs.
function accessCheck() {
  console.log(UrlFetchApp.fetch('https://www.googleapis.com/discovery/v1/apis', { muteHttpExceptions: true }).getResponseCode());
  CacheService.getScriptCache().put('accessCheck', 'yes', 60);
  console.log(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'x').length);
}

// Google checks the token, and the Dashboard's own approved list supplies the
// role, so there is one list of who is on the board. An answer is remembered
// for five minutes, because each banner photo is its own request.
function authorize(idToken) {
  var denied = { ok: false, error: 'This account does not have board access to LYBS Sponsors.' };
  if (!idToken) return { ok: false, error: 'Please sign in.' };

  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken);
  var cacheKey = 'auth_' + Utilities.base64EncodeWebSafe(digest);
  var cache = CacheService.getScriptCache();
  var hit = cache.get(cacheKey);
  if (hit) {
    var hp = hit.split('|');
    var hn = hp[2] ? decodeURIComponent(hp[2]) : '';
    if (hp[0] === 'yes') return hp[1] ? (hn ? { ok: true, email: hp[1], name: hn } : { ok: true, email: hp[1] }) : { ok: true };
    if (hp[0] === 'sponsors') return hp[1] ? { ok: true, sponsorsOnly: true, email: hp[1] } : { ok: true, sponsorsOnly: true };
  }

  var lookup = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY,
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true });
  if (lookup.getResponseCode() !== 200) return { ok: false, error: 'Your sign-in expired. Please sign in again.' };
  var user = (JSON.parse(lookup.getContentText()).users || [])[0];
  if (!user || !user.localId) return denied;

  var allowed = false;
  if (user.emailVerified && emailHash_(user.email) === BOOTSTRAP_ADMIN_EMAIL_HASH) {
    allowed = true;
  } else {
    var doc = UrlFetchApp.fetch(
      'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT +
        '/databases/(default)/documents/lybs_bins/lybs-approved?mask.fieldPaths=uids',
      { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
    if (doc.getResponseCode() !== 200) return denied;
    allowed = ALLOWED_ROLES.indexOf(roleFromApproved(JSON.parse(doc.getContentText()), user.localId)) >= 0;
  }
  // Only an address Google has verified is kept; it decides who may edit sponsor rows.
  var mail = user.emailVerified ? String(user.email || '').toLowerCase() : '';
  // Their Google account name, for the sign-off on emails they send from the app.
  var name = String(user.displayName || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (allowed) {
    cache.put(cacheKey, 'yes' + (mail ? '|' + mail + (name ? '|' + encodeURIComponent(name) : '') : ''), 300);
    return mail ? (name ? { ok: true, email: mail, name: name } : { ok: true, email: mail }) : { ok: true };
  }
  if (mail && sponsorsOnlyEmails_().indexOf(mail) >= 0) {
    cache.put(cacheKey, 'sponsors|' + mail, 300);
    return { ok: true, sponsorsOnly: true, email: mail };
  }
  return denied;
}

// Google addresses let into this app without a Dashboard role (see SETUP).
function sponsorsOnlyEmails_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SPONSORS_ONLY_EMAILS') || '';
  return raw.split(/[\s,;]+/).map(function (e) { return e.trim().toLowerCase(); }).filter(Boolean);
}

function emailHash_(email) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    String(email || '').toLowerCase(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}

// A stored entry is either a role string or a map holding role plus assignments.
function roleFromApproved(doc, uid) {
  var uids = doc && doc.fields && doc.fields.uids && doc.fields.uids.mapValue && doc.fields.uids.mapValue.fields;
  var entry = uids && uids[uid];
  if (!entry) return '';
  if (entry.stringValue) return String(entry.stringValue).toLowerCase();
  var fields = entry.mapValue && entry.mapValue.fields;
  return fields && fields.role && fields.role.stringValue ? String(fields.role.stringValue).toLowerCase() : '';
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
        // Sheets silently turns a typed "$500.00" into a currency-formatted
        // number — format it back to a string so the app always shows money
        // consistently, whether a row came from the seed import or the app's
        // own update/upload (which already send strings).
        if (col === 'amountPaid') v = formatMoney(v);
        o[col] = v;
      });
      return o;
    });
}

// size: 'thumb' (fast, for the scrollable list) or 'full' (detail view).
// Only ids in the Sheet's driveFileId column are served. The script runs as
// Nate, so without this check any Drive file id would open any of his files.
function getImage(driveFileId, size) {
  driveFileId = String(driveFileId || '');
  if (!driveFileId) throw new Error('No file id given.');
  if (!isBannerPhoto(driveFileId)) throw new Error('Not a banner photo: ' + driveFileId);
  var file = DriveApp.getFileById(driveFileId);
  var blob = size === 'full' ? file.getBlob() : (file.getThumbnail() || file.getBlob());
  return {
    mime: blob.getContentType(),
    base64: Utilities.base64Encode(blob.getBytes())
  };
}

function isBannerPhoto(driveFileId) {
  var sheet = getSheet();
  var lastRow = sheet.getLastRow();
  var col = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].indexOf('driveFileId');
  if (col < 0 || lastRow < 2) return false;
  var ids = sheet.getRange(2, col + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === driveFileId) return true;
  }
  return false;
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
    if (col === 'lat' || col === 'lng') v = toCoord(v);
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
  row[idx.lat] = toCoord(data.lat);
  row[idx.lng] = toCoord(data.lng);
  row[idx.locationLabel] = clean(data.locationLabel, 300);
  row[idx.notes] = clean(data.notes, 2000);
  row[idx.updatedAt] = todayStamp();

  sheet.appendRow(row);
  return ok({ message: 'Added.', id: nextId, driveFileId: file.getId() });
}


// ---------- helpers ----------

function getSheet() {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
}

function formatMoney(v) {
  if (v === '' || v === null || v === undefined) return '';
  if (typeof v === 'number') return '$' + v.toFixed(2);
  return String(v);
}

function todayStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// lat/lng are stored as numbers or left blank, never as client text.
function toCoord(v) {
  return (v === null || v === '' || v === undefined) ? '' : Number(v);
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

// ---------- the board view ----------
// For board members outside the sponsorship leads: this season's sponsors by
// name and level, which have paid, and outreach as counts. No contact, email,
// phone, note, amount or owner ever goes in this answer.
function sponsorBoardView_() {
  var out = { season: SEASON, sponsors: [], counts: { sponsors: 0, paid: 0, inKind: 0, waiting: 0, toContact: 0 } };
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return out;
  var head = tab.headers.map(function (h) { return h.toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), status: col(/^status$/), tier: col(new RegExp('^tier selected ' + SEASON)),
            amount: col(/^amount/), paid: col(/^paid\??$/), how: col(/^(paid how|payment method|paid by)/), notes: col(/^notes?$/) };
  if (c.company < 0) return out;
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  tab.rows.forEach(function (r) {
    var company = get(r, 'company'), status = get(r, 'status');
    if (!company || /^total/i.test(company)) return;
    var amount = Number(get(r, 'amount').replace(/[^0-9.]/g, '')) || 0;
    var inKind = /\bin.?kind\b/i.test(get(r, 'how')) || /\bpaid in.?kind\b/i.test(get(r, 'notes'));
    if (amount > 0) {   // the same test the full app uses for "in"
      var paid = isYes_(get(r, 'paid')) || /^paid/i.test(status);
      out.sponsors.push({ company: company.slice(0, 80), level: get(r, 'tier').slice(0, 30), paid: paid && !inKind, inKind: inKind });
      out.counts.sponsors++;
      if (inKind) out.counts.inKind++; else if (paid) out.counts.paid++;
    } else if (/^contacted/i.test(status)) out.counts.waiting++;
    else if (/^not contacted/i.test(status)) out.counts.toContact++;
  });
  out.sponsors.sort(function (a, b) { return a.company.toLowerCase() < b.company.toLowerCase() ? -1 : 1; });
  return out;
}

// Who this request is for, so every answer can tell the page to hide the
// Dashboard links for sponsors-only accounts.
var WHO = null;

function ok(obj) {
  var extra = WHO && WHO.sponsorsOnly ? { dashboard: false } : {};
  return ContentService.createTextOutput(JSON.stringify(Object.assign({ ok: true }, obj, extra)))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail(message) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

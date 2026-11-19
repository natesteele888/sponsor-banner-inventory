/**
 * Paid sponsors for the Dashboard's year-long Facebook posting plan.
 * Lives next to Code.gs in the same Apps Script project (Files → + → Script,
 * name it "Spotlights").
 *
 * The Sponsors app itself shows none of this: it stays sponsors and banners.
 * Marking a sponsor paid here is the whole trigger. The Dashboard's Social
 * Studio (lybs-reporting, social/spotlights.js) asks this script for the
 * sponsors that are paid, with their level and logo, plans their spotlight
 * posts, draws the logo-on-white card and hands it back to be filed in a
 * private Drive folder. Nothing here, or there, ever posts to Facebook.
 *
 *   Sponsors app: Mark paid  →  sponsor sheet, Paid? = Yes / Status = Paid
 *        │  spotlightSponsors (level, team, jersey name, write-up)
 *        │  spotlightLogo     (the logo, one sponsor at a time)
 *        ▼
 *   Dashboard, Social Studio: spotlight posts in the posting plan
 *        │  spotlightCardSave (the card it drew, PNG)
 *        ▼
 *   "Sponsor Spotlight Cards" folder in the Drive of the account this script
 *   runs as. Made private and never shared from here.
 *
 * Social Studio is open to the league admin only, so these three actions are
 * too: anyone else signed in gets "not allowed", the same as that page.
 *
 * Script Properties (all optional, none hold sponsor data):
 *   SPOTLIGHT_CARD_FOLDER_ID  the cards folder, remembered after the first card
 */

var SPOTLIGHT_FOLDER_NAME = 'Sponsor Spotlight Cards';
// Levels that get spotlight posts. All-Star and Game Day sponsors are named
// in the group thank-you posts instead, which the posting plan already has.
var SPOTLIGHT_TIERS = ['Championship', 'MVP'];
var SPOTLIGHT_MAX_CARD_BYTES = 3 * 1024 * 1024;

function spotlightAllowed_() {
  return !!(WHO && WHO.email && emailHash_(WHO.email) === BOOTSTRAP_ADMIN_EMAIL_HASH);
}

function spotlightPaid_(r) {
  return stYes_(r.paid) || /^\s*paid\b/i.test(String(r.status || ''));
}

function spotlightTier_(r) {
  return tierFromText_(r.tier) || tierFromAmount_(parseAmount_(r.amount));
}

// What last season's sheet says decides "welcome" or "welcome back".
function spotlightReturning_(r) {
  var past = String(r.pastSponsor || '').trim(), prev = String(r.tierPrev || '').trim();
  return stYes_(past) || (!!prev && !/^(none|no|n\/a|-)$/i.test(prev));
}

// Name on jersey, write-up and banner choice from the info packet, matched to
// the sponsor by business name. Read only.
function spotlightPackets_() {
  var out = {};
  var pk;
  try { pk = sponsorPackets(); } catch (e) { console.log('spotlight packets: ' + e); return out; }
  if (!pk || !pk.found) return out;
  var low = pk.headers.map(function (h) { return String(h).toLowerCase().trim(); });
  var at = function (re) { for (var i = 0; i < low.length; i++) if (re.test(low[i])) return i; return -1; };
  var cBiz = at(/^business/), cJer = at(/^name on jersey/), cWrite = at(/^write-?up/), cBan = at(/^banner$/);
  pk.rows.forEach(function (r) {
    var key = cBiz >= 0 ? companyKey_(r.cells[cBiz]) : '';
    if (!key) return;
    out[key] = {
      row: r.row,
      jerseyName: cJer >= 0 ? String(r.cells[cJer] || '').trim().slice(0, 80) : '',
      writeUp: cWrite >= 0 ? String(r.cells[cWrite] || '').trim().slice(0, 1000) : '',
      banner: cBan >= 0 ? String(r.cells[cBan] || '').trim().slice(0, 120) : ''
    };
  });
  return out;
}

// Every paid sponsor at a spotlight level, for the posting plan. No contact
// details: only what a post or its card needs.
function spotlightList_() {
  var ss = sponsorSpreadsheet_();
  var season = Number(SEASON);
  var main = sheetRows_(ss, sponsorTabName_(ss), {
    company: /^(company|business)/,
    status: /^status$/,
    tier: new RegExp('^tier selected ' + season),
    tierPrev: new RegExp('^tier selected ' + (season - 1)),
    amount: /^amount/,
    paid: /^paid/,
    pastSponsor: /sponsored in past/,
    team: /^(associated team|team)/
  });
  var picks = {};
  sponsorTeams_().rows.forEach(function (t) { picks[String(t.key)] = t; });
  var packets = spotlightPackets_();
  var cards = spotlightCards_();
  var seen = {}, list = [], otherPaid = 0;
  main.rows.forEach(function (r) {
    var key = companyKey_(r.company);
    if (!key || seen[key] || !spotlightPaid_(r)) return;
    seen[key] = 1;
    var tier = spotlightTier_(r);
    if (SPOTLIGHT_TIERS.indexOf(tier) < 0) { otherPaid++; return; }
    var p = picks[key], pk = packets[key] || {};
    var team = p && (p.division || p.team) ? [p.division, p.team].filter(Boolean).join(' ') : String(r.team || '');
    list.push({
      key: key,
      name: String(r.company).trim().slice(0, 120),
      tier: tier,
      returning: spotlightReturning_(r),
      team: team.slice(0, 120),
      jerseyName: pk.jerseyName || '',
      writeUp: pk.writeUp || '',
      banner: pk.banner || '',
      card: cards[key] || null
    });
  });
  return { season: SEASON, readAt: new Date().toISOString(), sponsors: list, otherPaid: otherPaid,
           missing: main.missing };
}

function spotlightSponsors() {
  if (!spotlightAllowed_()) return fail('not allowed');
  return ok(spotlightList_());
}

function spotlightFind_(key) {
  var hit = null;
  spotlightList_().sponsors.forEach(function (s) { if (s.key === key) hit = s; });
  return hit;
}

// One paid sponsor's logo: the one picked for their team page first, then the
// newest one in their info packet, then one they sent on the reply page.
function spotlightLogo(data) {
  if (!spotlightAllowed_()) return fail('not allowed');
  var key = String(data.key || '').slice(0, 120);
  var s = key && spotlightFind_(key);
  if (!s) return fail('That sponsor is not marked paid at a spotlight level.');
  var img = null, from = '';
  try {
    var t = null;
    sponsorTeams_().rows.forEach(function (r) { if (String(r.key) === key) t = r; });
    if (t && t.imageFileId) { img = teamLogoById_(t.imageFileId); from = img ? 'team page' : ''; }
    if (!img) {
      var pk = spotlightPackets_()[key];
      if (pk && pk.row) {
        var res = packetLogo({ row: pk.row });
        if (res && typeof res.getContent === 'function') res = JSON.parse(res.getContent());
        if (res && res.ok && res.logo) { img = res.logo; from = 'info packet'; }
      }
    }
    if (!img) {
      var folders = intakeFolders_();
      if (folders[key]) { img = intakeLogo_(folders[key]); from = img ? 'reply page' : ''; }
    }
  } catch (e) {
    console.log('spotlight logo for ' + key + ': ' + e);
  }
  return ok({ key: key, logo: img, from: from });
}

// The private cards folder, made the first time. If it has been shared with
// anyone, cards are not saved there until that is undone.
function spotlightFolder_(create) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SPOTLIGHT_CARD_FOLDER_ID');
  var folder = null;
  if (id) { try { folder = DriveApp.getFolderById(id); if (folder.isTrashed()) folder = null; } catch (e) { folder = null; } }
  if (!folder) {
    var it = DriveApp.getRootFolder().getFoldersByName(SPOTLIGHT_FOLDER_NAME);
    folder = it.hasNext() ? it.next() : null;
  }
  if (!folder && create) {
    folder = DriveApp.getRootFolder().createFolder(SPOTLIGHT_FOLDER_NAME);
    folder.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    folder.setDescription('Sponsor spotlight cards for the LYBS posting plan. Private: kept in this Drive and shared with nobody.');
  }
  if (folder) props.setProperty('SPOTLIGHT_CARD_FOLDER_ID', folder.getId());
  return folder;
}

function spotlightFolderShared_(folder) {
  return folder.getSharingAccess() !== DriveApp.Access.PRIVATE ||
         folder.getEditors().length > 0 || folder.getViewers().length > 0;
}

function spotlightCardName_(key) { return 'spotlight-' + key + '.png'; }

// key -> { fileId, url } for every card already in the folder.
function spotlightCards_() {
  var out = {};
  var folder;
  try { folder = spotlightFolder_(false); } catch (e) { return out; }
  if (!folder) return out;
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    var m = f.isTrashed() ? null : f.getName().match(/^spotlight-([a-z0-9]+)\.png$/);
    if (m && !out[m[1]]) out[m[1]] = { fileId: f.getId(), url: f.getUrl() };
  }
  return out;
}

// Files the card the Dashboard drew. Replaces that sponsor's earlier card.
function spotlightCardSave(data) {
  if (!spotlightAllowed_()) return fail('not allowed');
  if (!underRateLimit()) return fail('Too many changes in the last hour. Try again shortly.');
  var key = String(data.key || '').slice(0, 120);
  if (!key || !/^[a-z0-9]+$/.test(key) || !spotlightFind_(key)) return fail('That sponsor is not marked paid at a spotlight level.');
  var bytes;
  try { bytes = Utilities.base64Decode(String(data.base64 || '')); } catch (e) { return fail('That card did not come through.'); }
  if (!bytes.length || bytes.length > SPOTLIGHT_MAX_CARD_BYTES) return fail('That card is too big.');
  if (sniffImage(bytes) !== 'image/png') return fail('The card has to be a PNG.');
  var folder = spotlightFolder_(true);
  if (spotlightFolderShared_(folder)) {
    return fail('The ' + SPOTLIGHT_FOLDER_NAME + ' folder is shared with someone, so no card was saved. Make it private again in Drive.');
  }
  var name = spotlightCardName_(key);
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var file = folder.createFile(Utilities.newBlob(bytes, 'image/png', name));
  return ok({ key: key, fileId: file.getId(), url: file.getUrl() });
}

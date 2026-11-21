/**
 * The sponsor's own info page (sponsor.html), the link in their receipt.
 * Lives next to Code.gs in the same Apps Script project (Files → + → Script,
 * name it "SponsorPage").
 *
 *   receipt email: "Fill out your sponsor packet" opens sponsor.html?t=<token>
 *        │  the token is long and random, one per sponsor, and is kept only
 *        │  in the private data Sheet (tab "<season> Sponsor pages")
 *        ▼
 *   sponsor.html shows the level they paid for, locked as Paid, with their
 *   info form under it. Higher levels show as optional upgrades with only the
 *   difference owed. Picking one adds that level's fields and shows how to
 *   pay the difference (Venmo, cash, check, or online when that's set up).
 *        │
 *        ▼
 *   what they send becomes a row on the "LYBS Sponsor Info Packets" sheet
 *   (Packets tab) with their files in a folder inside the packets folder, so
 *   it shows in the Sponsors tab's packet list like any other packet. An
 *   upgrade is remembered as "Waiting on payment".
 *        │
 *        ▼
 *   An upgrade only counts once a sponsorship editor records the payment for
 *   the difference (Record a payment): then the sheet's amount and level go
 *   up, and the banner is owed only then. No payment, no banner.
 *
 * This door has no sign-in: the token in the link is the key, and it shows
 * that one sponsor's business, contact name, level and amount, nothing else.
 * It never writes to the sponsor sheet; only the board's own Record a
 * payment does. No sheet id, token, sponsor, price list or link beyond the
 * app's own page is written in this public file.
 *
 * Script Properties (all optional):
 *   SPONSOR_LEVELS          JSON list of levels, low to high, to override the
 *                           defaults below when the packet changes:
 *                           [{"name":"MVP","price":500,"jersey":true,"logo":true,"writeup":200,"banner":true}, …]
 *   SPONSOR_PAY_VENMO       the league's Venmo name, e.g. @Example-League
 *   SPONSOR_PAY_ONLINE_URL  the league's online payment page (https://…)
 * A check goes to the league at RECEIPT_ORG_ADDRESS. Cash is always offered.
 */

var SPONSOR_PAGE_URL = APP_URL + 'sponsor.html';
var SPONSOR_PAGE_TAB = SEASON + ' Sponsor pages';
var SPONSOR_PAGE_COLUMNS = ['token', 'key', 'company', 'createdAt', 'submittedAt',
  'upgradeTo', 'upgradeOwed', 'upgradeAt', 'upgradeStatus', 'upgradePaidAt', 'updatedAt',
  'packetAt', 'packetKind', 'packetNote'];
var UPGRADE_WAITING = 'Waiting on payment';
var UPGRADE_PAID = 'Paid';

// Low to high, as the league's Become a Sponsor page lists them. Gameday
// takes any amount and needs only the business name; Championship is $750
// and up (plus: shows as "$750+"). photo: a framed team photo; social:
// 0 none, 1 a spotlight, 2 two or three spotlights a year.
var DEFAULT_SPONSOR_LEVELS = [
  { name: 'Gameday', price: 0, jersey: false, logo: false, writeup: 0, banner: false, photo: false, social: 0 },
  { name: 'All-Star', price: 300, jersey: true, logo: true, writeup: 0, banner: false, photo: false, social: 0 },
  { name: 'MVP', price: 500, jersey: true, logo: true, writeup: 200, banner: true, photo: true, social: 1 },
  { name: 'Championship', price: 750, plus: true, jersey: true, logo: true, writeup: 800, banner: true, photo: true, social: 2 }
];

function sponsorLevels_() {
  var raw = PropertiesService.getScriptProperties().getProperty('SPONSOR_LEVELS');
  if (raw) {
    try {
      var list = JSON.parse(raw).filter(function (l) { return l && l.name && Number(l.price) >= 0; }).map(function (l) {
        return { name: String(l.name).slice(0, 40), price: Number(l.price), plus: !!l.plus, jersey: !!l.jersey, logo: !!l.logo,
          writeup: Math.max(0, Math.min(2000, Number(l.writeup) || 0)), banner: !!l.banner,
          photo: !!l.photo, social: Math.max(0, Math.min(2, Number(l.social) || 0)) };
      });
      if (list.length) return list.sort(function (a, b) { return a.price - b.price; });
    } catch (e) { console.log('SPONSOR_LEVELS is not valid JSON: ' + e); }
  }
  return DEFAULT_SPONSOR_LEVELS;
}

function levelNamed_(levels, name) {
  var want = tierFromText_(name) || String(name || '').trim();
  var k = String(want).toLowerCase().replace(/[^a-z+]/g, '');
  return levels.filter(function (l) { return l.name.toLowerCase().replace(/[^a-z+]/g, '') === k; })[0] || null;
}

// The level they paid for: the sheet's level when the amount covers it, else
// the highest level the amount reaches. Null when the row isn't paid.
function paidLevel_(levels, row) {
  if (!row || !isYes_(row.paid)) return null;
  var named = levelNamed_(levels, row.tier);
  if (named && row.amount >= named.price) return named;
  var best = null;
  levels.forEach(function (l) { if (row.amount >= l.price && (l.price > 0 || !best)) best = l; });
  return best;
}

// ---------- where the tokens live: the private data Sheet ----------

function pageSheet_() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sh = ss.getSheetByName(SPONSOR_PAGE_TAB);
  if (!sh) {
    sh = ss.insertSheet(SPONSOR_PAGE_TAB);
    sh.getRange(1, 1, 1, SPONSOR_PAGE_COLUMNS.length).setValues([SPONSOR_PAGE_COLUMNS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readPages_() {
  var sh = pageSheet_();
  var values = sh.getDataRange().getValues();
  var header = (values[0] || []).map(String);
  SPONSOR_PAGE_COLUMNS.forEach(function (c) {
    if (header.indexOf(c) < 0) { header.push(c); sh.getRange(1, header.length).setValue(c).setFontWeight('bold'); }
  });
  var rows = values.slice(1).map(function (v, i) {
    var o = { _row: i + 2 };
    header.forEach(function (h, j) { o[h] = v[j] == null ? '' : v[j]; });
    return o;
  });
  return { sheet: sh, header: header, rows: rows };
}

function newPageToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
}

// One token per sponsor, made the first time a receipt is shown or sent.
function sponsorPageToken_(company) {
  var key = companyKey_(company);
  if (!key) return '';
  var pages = readPages_();
  var hit = pages.rows.filter(function (r) { return r.key === key && /^[a-f0-9]{40}$/.test(String(r.token)); })[0];
  if (hit) { rememberPageRec_(hit); return String(hit.token); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return '';
  try {
    pages = readPages_();
    hit = pages.rows.filter(function (r) { return r.key === key && /^[a-f0-9]{40}$/.test(String(r.token)); })[0];
    if (hit) return String(hit.token);
    var rec = { token: newPageToken_(), key: key, company: clean(company, 200), createdAt: todayStamp(), updatedAt: todayStamp() };
    pages.sheet.appendRow(pages.header.map(function (h) { return rec[h] == null ? '' : rec[h]; }));
    return rec.token;
  } finally {
    lock.releaseLock();
  }
}

// The receipt's packet link for this sponsor, or '' if it can't be made.
function sponsorPageLink_(r) {
  try {
    var t = sponsorPageToken_(r && r.company);
    return t ? SPONSOR_PAGE_URL + '?t=' + t : '';
  } catch (e) { console.log('sponsor page link: ' + e); return ''; }
}

function pageByToken_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  var pages = readPages_();
  var hit = pages.rows.filter(function (r) { return String(r.token) === token; })[0];
  if (hit) rememberPageRec_(hit);
  return hit ? { pages: pages, rec: hit } : null;
}

// ---------- speed: the page is read far more than it changes ----------
// Opening and reading two whole sheets took about 1.7 seconds of every page
// load. So the page reads from Apps Script's private cache when it can: one
// sponsor's page record by its token, and a small map of the board sheet's
// sponsors. Anything that writes either one clears it, the board map is
// rebuilt whenever a board member opens the app, and a sponsor the map shows
// as not paid is always checked live, so a cached copy never hides a payment.
var PAGE_REC_TTL = 21600;      // 6 hours
var BOARD_ROWS_TTL = 1800;     // 30 minutes
var PAGE_REC_FIELDS = ['token', 'key', 'company', 'submittedAt', 'upgradeTo', 'upgradeOwed', 'upgradeStatus'];

function pageCache_() { return CacheService.getScriptCache(); }
function rememberPageRec_(rec) {
  try {
    var o = {}; PAGE_REC_FIELDS.forEach(function (f) { o[f] = rec[f] == null ? '' : String(rec[f]); });
    pageCache_().put('spTok_' + String(rec.token), JSON.stringify(o), PAGE_REC_TTL);
  } catch (e) { /* no cache: read the sheet next time */ }
}
function forgetPageRec_(token) { try { pageCache_().remove('spTok_' + String(token)); } catch (e) { } }
// Read only: the page record from the cache, else from the sheet.
function pageRecQuick_(token) {
  token = String(token || '');
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  try { var hit = pageCache_().get('spTok_' + token); if (hit) return JSON.parse(hit); } catch (e) { }
  var found = pageByToken_(token);
  return found ? found.rec : null;
}

// boardRowsGen_ and forgetBoardRows_ live in Edits.gs, next to the writes.
function boardRowsFrom_(tab, withEmail) {
  var head = tab.headers.map(function (h) { return String(h).toLowerCase(); });
  var col = function (re) { for (var i = 0; i < head.length; i++) if (re.test(head[i])) return i; return -1; };
  var c = { company: col(/^(company|business)/), contact: col(/^contact$/), amount: col(/^amount/), paid: col(/^paid\??$/),
            tier: col(new RegExp('^tier selected ' + SEASON)),
            prevTier: col(new RegExp('^tier selected ' + PREV_SEASON)), past: col(/^has sponsored in past/), email: col(/^email/) };
  if (c.tier < 0) c.tier = col(/^tier/);
  if (c.company < 0) return null;
  var get = function (r, k) { return c[k] < 0 ? '' : String(r.cells[c[k]] || '').trim(); };
  var map = {};
  tab.rows.forEach(function (r) {
    var key = companyKey_(get(r, 'company'));
    if (!key || map[key]) return;
    map[key] = { row: r.row, company: get(r, 'company'), contact: get(r, 'contact'), amount: parseAmount_(get(r, 'amount')),
                 paid: get(r, 'paid'), tier: get(r, 'tier') };
    // A paid sponsor's row also keeps last season's level, so a returning
    // sponsor can keep what we already have from last year.
    if (isYes_(map[key].paid)) {
      map[key].prevTier = get(r, 'prevTier'); map[key].past = isYes_(get(r, 'past'));
      // Only whether an email is on file. The address itself is read live,
      // on the server, when a returning sponsor keeps last year's info in
      // one tap (onFileEmail_); it is never cached or sent to the page.
      var mail = firstEmail_(get(r, 'email'));
      map[key].hasEmail = !!mail;
      if (withEmail) map[key].email = mail;
    }
  });
  return map;
}
// The app's own read of the board sheet keeps the map fresh (sponsorBook).
function cacheBoardRows_(tab) {
  try { var map = tab && boardRowsFrom_(tab); if (map) pageCache_().put('spBoard_' + boardRowsGen_(), JSON.stringify(map), BOARD_ROWS_TTL); } catch (e) { }
}

// ---------- the sponsor's row on the board's sheet (read only here) ----------

// The email on the board's sheet for one sponsor, read live. Server side only.
function onFileEmail_(company) {
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  var map = tab && boardRowsFrom_(tab, true);
  var hit = map && map[companyKey_(company)];
  return (hit && hit.email) || '';
}

function boardSponsorRow_(key, fresh) {
  if (!fresh) {
    try { var hit = pageCache_().get('spBoard_' + boardRowsGen_()); if (hit) return JSON.parse(hit)[key] || null; } catch (e) { }
  }
  var ss = sponsorSpreadsheet_(), tab = bookTab_(ss, sponsorTabName_(ss));
  if (!tab) return null;
  var map = boardRowsFrom_(tab);
  if (!map) return null;
  cacheBoardRows_(tab);
  return map[key] || null;
}

function payOptions_() {
  var p = PropertiesService.getScriptProperties();
  var venmo = String(p.getProperty('SPONSOR_PAY_VENMO') || '').trim().replace(/^@?/, '@');
  var online = String(p.getProperty('SPONSOR_PAY_ONLINE_URL') || '').trim();
  return {
    venmo: /^@[A-Za-z0-9_\-]{3,40}$/.test(venmo) ? venmo : '',
    online: /^https:\/\/[^\s"'<>]+$/.test(online) ? online : '',
    checkTo: RECEIPT_ORG,
    address: String(p.getProperty('RECEIPT_ORG_ADDRESS') || '').trim(),
    cash: true
  };
}

function levelView_(l, amount, paid) {
  return { name: l.name, price: l.price, plus: !!l.plus, jersey: l.jersey, logo: l.logo, writeup: l.writeup, banner: l.banner,
           photo: !!l.photo, social: l.social || 0,
           state: l === paid ? 'paid' : (l.price > amount && l.price > paid.price ? 'upgrade' : 'below'),
           owed: l === paid || l.price <= paid.price ? 0 : Math.max(0, l.price - amount) };
}

// Everything the page needs for one sponsor, or an error to show.
// quick: the read-only page load, from the cache where it can. A send or an
// upgrade always reads both sheets live.
function sponsorPageState_(token, quick) {
  var found = quick ? (function (rec) { return rec ? { rec: rec } : null; })(pageRecQuick_(token)) : pageByToken_(token);
  if (!found) return { error: 'This link is not valid. Please reply to the email you got from us instead.' };
  var row = boardSponsorRow_(found.rec.key, !quick);
  var levels = sponsorLevels_();
  var paid = paidLevel_(levels, row);
  // Never trust a cached "not paid": look again live.
  if (!paid && quick) { row = boardSponsorRow_(found.rec.key, true); paid = paidLevel_(levels, row); }
  if (!paid) return { error: "We don't have your payment marked yet. Once we do, this page shows your sponsorship. Questions? Just reply to the email." };
  var ups = levels.filter(function (l) { return l.price > row.amount && l.price > paid.price; });
  return { found: found, row: row, levels: levels, paid: paid, ups: ups };
}

// A returning sponsor: the level they had last season, or for one marked as
// a past sponsor with no level on file, the level they have now. Null for a
// new sponsor. "Same as last year" covers only what that level had.
function lastYearLevel_(levels, row) {
  if (!row) return null;
  var prev = row.prevTier ? levelNamed_(levels, row.prevTier) : null;
  if (prev) return prev;
  return row.past ? paidLevel_(levels, row) : null;
}

// ---------- public: what the page shows ----------

function sponsorPageGet(data) {
  var st = sponsorPageState_(data.t, true);
  if (st.error) return fail(st.error);
  var rec = st.found.rec, pending = null;
  if (rec.upgradeStatus === UPGRADE_WAITING && rec.upgradeTo) {
    var to = levelNamed_(st.levels, rec.upgradeTo);
    if (to && to.price > st.row.amount) pending = { to: to.name, owed: Math.max(0, to.price - st.row.amount) };
  }
  var last = lastYearLevel_(st.levels, st.row);
  return ok({
    season: SEASON, company: st.row.company, contactName: st.row.contact, deadline: INFO_DEADLINE,
    // Returning sponsor: what last season's level had, for "Same as last year".
    // contact: we have a name and email on file, so "Keep last year's info"
    // can send in one tap with nothing typed.
    lastYear: last ? { jersey: !!last.jersey, logo: !!last.logo, writeup: !!last.writeup, banner: !!last.banner,
                       contact: !!(st.row.contact && st.row.hasEmail) } : null,
    paid: { level: st.paid.name, amount: st.row.amount },
    // Every level, low to high: theirs marked paid, the ones above as
    // upgrades, the ones below shown for reference only.
    levels: st.levels.map(function (l) { return levelView_(l, st.row.amount, st.paid); }),
    upgrade: pending, sent: !!rec.submittedAt, pay: payOptions_()
  });
}

// ---------- public: what the sponsor sends ----------

var PAGE_BANNER_CHOICES = ['Reuse our banner from last season', "I'm attaching a new print-ready design", 'Please design one using our logo'];

function packetFolderFor_(packetSs, company) {
  var parents = DriveApp.getFileById(packetSs.getId()).getParents();
  if (!parents.hasNext()) throw new Error('The packets sheet has no folder.');
  var home = parents.next();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  var name = (String(company).replace(/[^A-Za-z0-9 &'.\-]+/g, ' ').trim().slice(0, 80) || 'Sponsor') + ' ' + stamp;
  return home.createFolder(name);
}

function sponsorPageSubmit(data) {
  var token = String(data.t || '');
  var st = sponsorPageState_(token);
  if (st.error) return fail(st.error);
  if (!underPublicLimit_(token)) return fail('Too many tries in the last hour. Please wait a bit, or reply to the email instead.');
  var rec = st.found.rec, row = st.row;

  // The level this info is for: the one they paid for, or an upgrade they picked.
  var level = st.paid, upgrade = null;
  if (data.upgradeTo) {
    upgrade = st.ups.filter(function (l) { return l.name === String(data.upgradeTo); })[0];
    if (!upgrade) return fail('That level is not one you can upgrade to. Refresh the page and pick again.');
    level = upgrade;
  }

  var f = data.fields || {};
  var v = {
    contactName: clean(f.contactName, 200), email: firstEmail_(f.contactEmail), phone: clean(f.contactPhone, 60),
    business: clean(f.business || row.company, 200), jersey: clean(f.jerseyName, 120), website: clean(f.website, 300),
    facebook: clean(f.facebook, 300), instagram: clean(f.instagram, 300), other: clean(f.otherSocial, 300),
    writeup: level.writeup ? clean(f.writeup, level.writeup) : '', sponsoring: clean(f.sponsoring, 200),
    banner: level.banner ? clean(f.bannerChoice, 80) : '', bannerText: level.banner ? clean(f.bannerText, 600) : '',
    fileLink: clean(f.fileLink, 500), more: clean(f.more, 1000)
  };
  // "Same as last year": a returning sponsor keeps what we have from last
  // season for each part last season's level had. A part their level didn't
  // have (say a banner, after moving up) still needs their answer.
  var last = f.same ? lastYearLevel_(st.levels, row) : null;
  // "Keep last year's info" in one tap sends no contact: use the one on file.
  if (last && !v.contactName) v.contactName = clean(String(row.contact || '').replace(/^(manager|owner)\s*:\s*/i, ''), 200);
  if (last && !v.email) v.email = onFileEmail_(row.company);
  if (!v.contactName || !v.email) return fail('Please fill in your name and email.');
  if (last) {
    if (level.jersey && last.jersey && !v.jersey) v.jersey = 'Same as last year';
    if (level.banner && last.banner && !v.banner) v.banner = PAGE_BANNER_CHOICES[0];
    if (level.writeup && last.writeup && !v.writeup) v.writeup = 'Same as last year';
  }
  if (level.jersey && !v.jersey) return fail('Please add the name for the jersey.');
  if (level.banner && PAGE_BANNER_CHOICES.indexOf(v.banner) < 0) return fail('Please pick what we should do for your banner.');
  if (String(f.writeup || '').length > level.writeup && level.writeup) return fail('Your write-up is longer than ' + level.writeup + ' characters.');

  var packetSs = packetSpreadsheet_();
  var sh = packetSs && packetSs.getSheetByName(PACKET_TAB);
  if (!sh) return fail('Something went wrong on our end. Please try again later, or reply to the email.');

  var files = (data.files || []).slice(0, INTAKE_MAX_FILES), total = 0, saved = [], folder = null;
  for (var i = 0; i < files.length; i++) {
    var parts = String(files[i].data || '').split(',');
    var bytes = Utilities.base64Decode(parts[parts.length - 1]);
    total += bytes.length;
    if (bytes.length > INTAKE_MAX_FILE) return fail('One file is larger than 15 MB. Paste a share link for it instead.');
    if (total > INTAKE_MAX_TOTAL) return fail('Your files add up to more than 30 MB. Paste a share link for the big ones instead.');
    var t = sniffDesign_(bytes);
    if (!t) return fail('We could not read one of your files. PNG, JPG, PDF, SVG, AI, EPS, PSD and TIFF all work.');
    var kind = files[i].kind === 'design' ? 'banner-design' : 'logo';
    folder = folder || packetFolderFor_(packetSs, row.company);
    var nm = String(row.company).replace(/[^A-Za-z0-9]+/g, '') + '_' + kind + '_' + (i + 1) + '.' + t.ext;
    folder.createFile(Utilities.newBlob(bytes, t.mime, nm));
    saved.push(nm);
  }
  var sameLogo = !!(last && last.logo);
  if (level.logo && saved.every(function (n) { return n.indexOf('_logo_') < 0; }) && !v.fileLink && !rec.submittedAt && !sameLogo) {
    return fail('Please attach your logo, or paste a link to it.');
  }

  var levelText = upgrade
    ? upgrade.name + ' (upgrade from ' + st.paid.name + ', ' + money_(upgrade.price - row.amount) + ' more owed)'
    : st.paid.name + ' (paid)';
  var out = {
    'submitted': Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm'), 'status': 'New',
    'level': levelText, 'business name (website)': v.business, 'name on jersey': v.jersey, 'contact name': v.contactName,
    'email': v.email, 'phone': v.phone, 'website': v.website, 'facebook': v.facebook, 'instagram': v.instagram,
    'other social': v.other, 'write-up': v.writeup, 'sponsoring a player/team/division': v.sponsoring,
    'banner': v.banner, 'banner notes': v.bannerText, 'files folder': folder ? folder.getUrl() : '',
    'files': (saved.join(', ') + (v.fileLink ? (saved.length ? '; ' : '') + 'link: ' + v.fileLink : '')) ||
      (level.logo && sameLogo ? 'Same as last year' : ''),
    'anything else': (last ? 'Same as last year: nothing changed, use what we have from last season.' + (v.more ? ' ' : '') : '') + v.more
  };
  var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(function (h) { return String(h).toLowerCase().trim(); });
  sh.appendRow(head.map(function (h) { return out[h] == null ? '' : out[h]; }));

  var notice;
  try {
    notice = packetNotice_({ row: row, v: v, level: level, last: last || lastYearLevel_(st.levels, row), upgrade: upgrade, saved: saved, levelText: levelText,
                             folderUrl: folder ? folder.getUrl() : '' });
  } catch (e) {
    console.log('packet notice: ' + e);
    notice = { kind: '', note: '', subject: SEASON + ' sponsor info received: ' + row.company,
               body: row.company + ' sent their sponsor info. Level: ' + levelText + '\n\n' + APP_URL + '#sponsors' };
  }
  var mark = { submittedAt: todayStamp(), updatedAt: todayStamp(), packetAt: out.submitted, packetKind: notice.kind, packetNote: notice.note };
  if (upgrade) {
    mark.upgradeTo = upgrade.name; mark.upgradeOwed = upgrade.price - row.amount;
    mark.upgradeAt = todayStamp(); mark.upgradeStatus = UPGRADE_WAITING; mark.upgradePaidAt = '';
  }
  writeFields_(st.found.pages.sheet, st.found.pages.header, rec._row, mark);
  forgetPageRec_(token);

  // The 2027 banners tab picks it up: packet in, banner from stock or to order, design needed or file in hand.
  try { seasonFromPacket_({ row: row, v: v, level: upgrade || level, upgrade: upgrade, notice: notice, folder: folder }); }
  catch (e) { console.log('packet to banners: ' + e); }

  // Always to the script owner, never to the sponsor.
  ownerAlert_(myEmail_(), notice.subject, notice.body);

  return ok({ message: 'Thank you! We have your info.', upgrade: upgrade ? { to: upgrade.name, owed: upgrade.price - row.amount } : null, pay: upgrade ? payOptions_() : null });
}

// ---------- the notice Nate gets for each packet ----------
// One email to the script owner (never the sponsor) saying which of three
// kinds it is: a returning sponsor with the same info as last year, a
// returning sponsor with changes (each one listed), or a new sponsor with
// everything they sent. The banner line says whether last year's banner is
// on file, their print-ready file came in, or the banner needs making.
// Last year's level, contact and email come from the board sheet, and
// whether a logo or banner is on file from the app's logo library and banner
// list. Jersey names and write-ups weren't kept last year, so those show as
// sent.
var PACKET_KIND_NOTE = { same: 'Same as last year, good to go', changes: 'changes from last year', 'new': 'New sponsor' };

function packetNotice_(o) {
  var row = o.row, v = o.v, level = o.level, key = companyKey_(row.company);
  var has = function (part) { return o.saved.some(function (n) { return n.indexOf('_' + part + '_') >= 0; }); };
  var newLogo = has('logo'), newDesign = has('banner-design');
  var logoOnFile = false, bannerOnFile = false;
  try { logoOnFile = !!logoPicks_(false)[key]; } catch (e) { console.log('packet notice logos: ' + e); }
  var bannerIds = [];
  try { bannerIds = listBanners().filter(function (b) { return companyKey_(b.sponsorName) === key; }).map(function (b) { return String(b.id); }); } catch (e) { console.log('packet notice banners: ' + e); }
  bannerOnFile = bannerIds.length > 0;

  var banner = '', bannerKind = '';
  if (level.banner) {
    if (v.banner === PAGE_BANNER_CHOICES[0]) {
      banner = bannerOnFile ? 'Reuse last year’s banner. It’s on file.'
                            : 'They want last year’s banner, but none is on file under this name. Check before you print.';
      bannerKind = bannerOnFile ? 'reuse' : 'check';
    } else if (v.banner === PAGE_BANNER_CHOICES[1]) {
      banner = newDesign ? 'Their print-ready banner file is in the files folder. Use it.'
             : v.fileLink ? 'They sent a link to their banner file (below).'
             : 'They said a print-ready design is attached, but no banner file came through. Ask them for it.';
      bannerKind = newDesign || v.fileLink ? 'file' : 'check';
    } else {
      banner = 'You need to make their banner, from their logo.';
      bannerKind = 'make';
    }
  }
  var logo = '';
  if (level.logo) {
    if (newLogo) logo = logoOnFile ? 'New logo sent. It replaces the one on file.' : 'Logo sent. It’s in the files folder.';
    else if (v.fileLink) logo = 'They sent a link to their logo (below).';
    else logo = logoOnFile ? 'No new logo. Use the one on file.' : 'No logo sent and none on file. Ask them for one.';
  }

  var changes = [];
  if (o.last) {
    if (o.last.name !== level.name) changes.push('Level: ' + o.last.name + ' last year, ' + level.name + ' now' + (o.upgrade ? ' (upgrade asked, not paid yet)' : '') + '.');
    if (v.business && companyKey_(v.business) !== key) changes.push('Business name for the website: "' + v.business + '" (the sheet has "' + row.company + '").');
    var onContact = String(row.contact || '').replace(/^(manager|owner)\s*:\s*/i, '').trim();
    if (v.contactName && v.contactName.toLowerCase() !== onContact.toLowerCase()) changes.push('Contact: ' + v.contactName + (onContact ? ' (was ' + onContact + ')' : '') + '.');
    var onEmail = '';
    try { onEmail = onFileEmail_(row.company); } catch (e) { }
    if (v.email && v.email.toLowerCase() !== String(onEmail).toLowerCase()) changes.push('Email: ' + v.email + (onEmail ? ' (was ' + onEmail + ')' : '') + '.');
    if (newLogo && logoOnFile) changes.push('New logo.');
    if (level.jersey && v.jersey && v.jersey !== 'Same as last year') changes.push('Jersey name: ' + v.jersey + ' (last year’s wasn’t recorded).');
    if (level.writeup && v.writeup && v.writeup !== 'Same as last year') changes.push('New write-up (below).');
    if (bannerKind && bannerKind !== 'reuse') changes.push('Banner: ' + banner);
  }
  var kind = !o.last ? 'new' : changes.length ? 'changes' : 'same';

  var who = row.company;
  var subject, head, note;
  if (kind === 'same') {
    subject = SEASON + ' packet: ' + who + ' is the same as last year, good to go';
    head = who + ' is a returning sponsor and kept everything from last year' + (level.banner ? ', including the banner' : '') + '. Good to proceed.';
    note = PACKET_KIND_NOTE.same;
  } else if (kind === 'changes') {
    subject = SEASON + ' packet: ' + who + ' has ' + changes.length + ' change' + (changes.length === 1 ? '' : 's') + ' from last year';
    head = who + ' is a returning sponsor. These changed from last year:\n' + changes.map(function (c) { return '- ' + c; }).join('\n');
    note = changes.length + ' ' + (changes.length === 1 ? 'change' : 'changes') + ' from last year';
  } else {
    var tail = bannerKind === 'file' ? 'banner file ready' : bannerKind === 'make' ? 'you make the banner' : bannerKind === 'check' ? 'check the banner' : 'everything they sent';
    subject = SEASON + ' packet: new sponsor ' + who + ', ' + tail;
    head = who + ' is a new sponsor. Everything they sent is below.';
    note = PACKET_KIND_NOTE['new'] + (bannerKind === 'file' ? ', banner file ready' : bannerKind === 'make' ? ', you make the banner' : bannerKind === 'check' ? ', check the banner' : '');
  }
  if (kind === 'same' && bannerKind === 'check') note = 'Same as last year, check the banner';

  var sent = [
    ['Level', o.levelText], ['Business name (website)', v.business], ['Name on jersey', v.jersey], ['Contact', v.contactName],
    ['Email', v.email], ['Phone', v.phone], ['Website', v.website], ['Facebook', v.facebook], ['Instagram', v.instagram],
    ['Other social', v.other], ['Write-up', v.writeup], ['Sponsoring a player/team/division', v.sponsoring],
    ['Banner choice', v.banner], ['Banner notes', v.bannerText], ['Files', o.saved.join(', ')], ['File link', v.fileLink],
    ['Files folder', o.folderUrl], ['Anything else', v.more]
  ].filter(function (p) { return p[1]; }).map(function (p) { return p[0] + ': ' + p[1]; });

  var body = [head];
  if (banner) body.push('Banner: ' + banner);
  if (logo) body.push('Logo: ' + logo);
  if (o.upgrade) body.push('They asked to upgrade to ' + o.upgrade.name + '. It counts once their payment for the difference is recorded (Record a payment). No banner change until then.');
  body.push('Everything they sent:\n' + sent.join('\n'));
  body.push('It’s on their card in the Sponsors app:\n' + APP_URL + '#sponsors');
  return { kind: kind, note: note, subject: subject, body: body.join('\n\n'), changes: changes,
           bannerKind: bannerKind, bannerId: bannerIds.length === 1 ? bannerIds[0] : '' };
}

// What the banner needs, from the packet. Shown on the 2027 banners tab.
var PACKET_DESIGN = { reuse: 'In stock', file: 'File in hand, ready to order', make: 'Design needed', check: 'Check with sponsor' };
// The banner status the packet may set. One Nate set himself (Reprint needed,
// Ordered, Ready to hang) stays as it is.
var PACKET_MAY_SET = ['', 'Not decided', 'Use banner from stock', 'Order new'];

function seasonFromPacket_(o) {
  if (!o.level.banner) return;
  var season = readSeason_();
  var got = upsertSponsor_(season, {
    company: o.row.company, tier: o.level.name, amount: o.upgrade ? o.level.price : o.row.amount,
    paid: !o.upgrade, paidVia: o.upgrade ? '' : 'Paid on the sponsor sheet', source: 'Sponsor page',
    contactName: o.v.contactName, contactEmail: o.v.email, contactPhone: o.v.phone
  });
  if (!got) return;
  var rec = got.rec, kind = o.notice.bannerKind;
  var fields = {
    requestStatus: 'Info received', submittedAt: todayStamp(),
    jerseyName: clean(o.v.jersey, 120), writeup: clean(o.v.writeup, 2000), website: clean(o.v.website, 300),
    bannerChoice: clean(o.v.banner, 80), bannerText: clean(o.v.bannerText, 600), fileLink: clean(o.v.fileLink, 500),
    design: PACKET_DESIGN[kind] || '', packetNote: o.notice.note || ''
  };
  if (o.folder) fields.fileFolderId = o.folder.getId();
  if (kind && PACKET_MAY_SET.indexOf(String(rec.bannerStatus || '')) >= 0) {
    if (kind === 'reuse') {
      fields.bannerStatus = 'Use banner from stock';
      var taken = o.notice.bannerId && season.rows.some(function (r) { return r !== rec && String(r.assignedBannerId) === o.notice.bannerId; });
      if (o.notice.bannerId && !rec.assignedBannerId && !taken) fields.assignedBannerId = o.notice.bannerId;
    } else {
      fields.bannerStatus = 'Order new';
    }
  }
  writeFields_(season.sheet, season.header, rec._row, fields);
}

// ---------- the board's side ----------

// Upgrades sponsors asked for, for the Sponsors tab. Signed-in board only.
function sponsorUpgrades() {
  var levels = sponsorLevels_();
  return readPages_().rows.filter(function (r) { return r.upgradeStatus === UPGRADE_WAITING && r.upgradeTo; }).map(function (r) {
    var to = levelNamed_(levels, r.upgradeTo);
    return { company: String(r.company), to: String(r.upgradeTo), price: to ? to.price : 0, banner: !!(to && to.banner),
             owed: Number(r.upgradeOwed) || 0, at: String(r.upgradeAt || '') };
  });
}

// After Record a payment raised the sheet's amount: the upgrade counts only if
// the sheet now shows it paid at that level's price. Editors only.
function sponsorUpgradePaid(data) {
  if (!canEditSponsors_()) return fail('Only the sponsorship editors can record a payment.');
  var key = companyKey_(data.company);
  var pages = readPages_();
  var rec = pages.rows.filter(function (r) { return r.key === key && r.upgradeStatus === UPGRADE_WAITING; })[0];
  if (!rec) return fail('No upgrade is waiting for that sponsor.');
  var to = levelNamed_(sponsorLevels_(), rec.upgradeTo);
  var row = boardSponsorRow_(key, true);
  if (!to || !row || !isYes_(row.paid) || row.amount < to.price) return fail('The sheet does not show the full ' + (to ? money_(to.price) : '') + ' paid yet, so the upgrade still waits.');
  writeFields_(pages.sheet, pages.header, rec._row, { upgradeStatus: UPGRADE_PAID, upgradePaidAt: todayStamp(), updatedAt: todayStamp() });
  forgetPageRec_(rec.token);
  return ok({ message: 'Upgrade to ' + to.name + ' counted.' });
}

/**
 * The Sponsors tab: everything on the season's sponsorship sheet, read live
 * through the signed-in backend (Season.gs sponsorBook), plus which team each
 * sponsor is lined up with.
 *
 *   sponsorship sheet (kept by the sponsorship lead, read only from here)
 *        │  sponsorBook, behind the Dashboard sign-in
 *        ▼
 *   this tab: who owns each sponsor, who contacted them, contacts, level,
 *             amount, paid, banner/plaque flags, every other column as it is
 *        │  sponsorTeamSave (the one write, to the backend's private Script Properties)
 *        ▼
 *   SPONSOR_TEAM_<season>_* entries  →  also read by the Dashboard's Uniforms and
 *                                       Jersey Order pages (sponsorSheet)
 *
 * Nothing from the sheet is stored on this phone or in this repo: the tab asks
 * again each time it opens or Refresh is pressed. Team names for the pickers
 * come from the Dashboard's own team list (lybs_bins/lybs-team-assignments),
 * read with the same sign-in; only division and team names are kept from it.
 */
(function () {
  'use strict';
  // Back from the sender page after a one-time-Allow send: "#sent=…" says it
  // went. Read it once, put the address back to #sponsors, and mark the row
  // once the sheet is in.
  var SENT_BACK = (function () {
    var m = /^#sent=([a-f0-9]{32}\.[A-Za-z0-9_\-]{20,80})$/.exec(String(location.hash || ''));
    if (!m) return '';
    try { history.replaceState(null, '', location.pathname + location.search + '#sponsors'); } catch (e) { location.hash = 'sponsors'; }
    return m[1];
  })();

  var A = function () { return window.BannerApp; };
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var S = {
    book: null, loading: null, filter: 'signed', area: '', me: '', // opens on this season's sponsors owner: '', search: '',
    current: null, entry: false, skipPop: false,
    teams: null, teamsYear: null // [{ sport, division, team }] from the Dashboard
  };

  // ---------- reading the sheet by its header text ----------

  function norm(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function colOf(tab, re) {
    for (var i = 0; i < tab.headers.length; i++) if (re.test(norm(tab.headers[i]))) return i;
    return -1;
  }
  function nameKey(s) {
    return String(s || '').toLowerCase().replace(/&/g, ' and ')
      .replace(/\b(inc|llc|co|corp|company|pc|p\.c|the|ltd)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, '');
  }
  function money(v) { return Number(String(v || '').replace(/[^0-9.]/g, '')) || 0; }
  function ticked(v) { return /^(true|yes|y|x|✓)$/i.test(String(v || '').trim()); }
  function yes(v) { return /^\s*(y|yes|true|x|paid)/i.test(String(v || '')); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  // "Alex " and "alex" are the same board member.
  // The town in an address, for splitting the list by area:
  // "12 Example St, Lunenburg, MA 01462" and "5 Sample Rd Fitchburg, MA" give
  // Lunenburg and Fitchburg.
  function townOf(addr) {
    var a = String(addr || '').replace(/,?\s*(united states|usa)\b.*$/i, '');
    var m = a.match(/^(.*?)[,\s]+(MA|RI|NH|CT|VT|ME|NY|Massachusetts)\b/i);
    if (!m) return '';
    var segs = m[1].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var last = segs.length ? segs[segs.length - 1] : '';
    if (/\d/.test(last) || /\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|suite)\b\.?$/i.test(last)) {
      var w = last.split(/\s+/); last = /\d/.test(w[w.length - 1]) ? '' : w[w.length - 1];
    }
    if (/^(po box|box|suite)/i.test(last)) last = '';
    return last ? last.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); }) : '';
  }

  // Is this sponsor one of mine? The LYBS Owner cell can name more than one
  // person ("Alex/Sam").
  function isMine(s) {
    var me = String(S.me || '').trim().toLowerCase();
    if (!me) return false;
    return String(s.owner || '').toLowerCase().split(/[\/,&+]|\band\b/).some(function (n) { return n.trim() === me; });
  }

  // A past sponsor not back yet whose owner is blank, not a person ("yes"),
  // or someone no longer on the board (the SPONSOR_FORMER_OWNERS setting), so
  // nobody is reaching out to them now. Who reached out before stays on the card.
  function needsOwner(s) {
    if (isIn(s) || contactState(s) === 'not') return false;
    if (!(s.past || s.tierPrev || String(s.prevContact || '').trim())) return false;
    var former = (S.former || []).map(function (n) { return String(n).toLowerCase(); });
    var names = String(s.owner || '').toLowerCase().split(/[\/,&+]|\band\b/).map(function (n) { return n.trim(); })
      .filter(function (n) { return n && !/^(yes|no|y|n|x|true|false)$/.test(n); });
    if (!names.length) return true;
    return names.every(function (n) { return former.indexOf(n) >= 0; });
  }

  function person(v) { var s = String(v || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

  function mainTab() { return S.book && S.book.tabs[0]; }

  // The sponsor rows with the columns this tab works with picked out by header.
  // Every column, these included, is still shown on the detail sheet as-is.
  function sponsors() {
    var t = mainTab();
    if (!t) return [];
    var season = Number(S.book.season);
    var c = {
      owner: colOf(t, /^lybs owner/),
      contacted: colOf(t, /^contacted/),
      prevContact: colOf(t, new RegExp('^' + (season - 1) + ' contact')),
      company: colOf(t, /^(company|business)/),
      contact: colOf(t, /^contact$/),
      phone: colOf(t, /^phone/),
      email: colOf(t, /^email/),
      past: colOf(t, /sponsored in past/),
      tierPrev: colOf(t, new RegExp('^tier selected ' + (season - 1))),
      tier: colOf(t, new RegExp('^tier selected ' + season)),
      amount: colOf(t, /^amount/),
      paid: colOf(t, /^paid/),
      owedBanner: colOf(t, /^owed a banner/),
      team: colOf(t, /^(associated team|team)/),
      owedPlaque: colOf(t, /^owed a plaque/),
      notes: colOf(t, /^notes?$/),
      address: colOf(t, /^address/),
      walkIn: colOf(t, /^walk.?in/),
      how: colOf(t, /^(paid how|payment method|paid by)/),
      signed: colOf(t, /^signed up/),
      lastFollow: colOf(t, /^last follow/)
    };
    var picks = {};
    (S.book.teams || []).forEach(function (p) { picks[p.key] = p; });
    return t.rows.map(function (r) {
      var get = function (k) { return c[k] < 0 ? '' : (r.cells[c[k]] || ''); };
      var company = get('company');
      if (!company) return null;
      var amount = money(get('amount'));
      var pick = picks[nameKey(company)] || null;
      return {
        row: r.row, cells: r.cells, key: nameKey(company), company: company,
        owner: person(get('owner')), contacted: get('contacted'), prevContact: get('prevContact'),
        contact: get('contact'), phone: get('phone'), email: get('email'),
        past: yes(get('past')), tierPrev: get('tierPrev'), tier: get('tier'),
        amount: amount, amountText: get('amount'), paid: yes(get('paid')), paidText: get('paid'),
        owedBanner: yes(get('owedBanner')), owedPlaque: yes(get('owedPlaque')),
        sheetTeam: get('team'), pick: pick, notes: get('notes'),
        address: get('address'), area: townOf(get('address')), walkIn: yes(get('walkIn')),
        how: get('how'), signed: sheetDay(get('signed')), lastFollow: sheetDay(get('lastFollow')), inKind: IN_KIND.test(get('how')) || PAID_IN_KIND.test(get('notes')),
        team: hasTeam(pick) ? [pick.division, pick.team].filter(Boolean).join(' · ') : get('team')
      };
    }).filter(Boolean);
  }

  // Signed up for this season: an amount on the sheet ("NONE"/$0 doesn't count).
  function isIn(s) { return s.amount > 0; }
  // A day as the sheet shows it ("2026-11-23", "11/23/2026", or "2026-11-23
  // Payment reminder") as yyyy-mm-dd, or ''.
  function sheetDay(v) {
    v = String(v || '').trim();
    var p2 = function (n) { return ('0' + Number(n)).slice(-2); };
    var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + '-' + p2(m[2]) + '-' + p2(m[3]);
    m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
    return m ? (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + p2(m[1]) + '-' + p2(m[2]) : '';
  }
  function todayDay() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  // Signed up, not paid, and two weeks or more since they signed up (or since
  // the last reminder): time for a payment nudge. Its own section, not Needs
  // attention. (Nate, Nov 23)
  var PAY_NUDGE_DAYS = 14;
  function payNudgeFrom(s) { return s.lastFollow > s.signed ? s.lastFollow : s.signed; }
  function payNudgeDue(s) {
    if (!s || !isIn(s) || s.paid || s.inKind || !/@/.test(String(s.email || ''))) return false;
    var from = payNudgeFrom(s);
    return !!from && Math.round((Date.parse(todayDay() + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5) >= PAY_NUDGE_DAYS;
  }
  // Paid in goods or services (Paid how says "In kind", or with no Paid how
  // column, the notes say "paid in kind"): counted on its own, never as cash.
  var IN_KIND = /\bin.?kind\b/i, PAID_IN_KIND = /\bpaid in.?kind\b/i;

  var FILTER_MORE = {};   // value: label, for views off the short Show list
  var FILTERS = {
    all: function () { return true; },
    signed: isIn,
    paid: function (s) { return isIn(s) && s.paid; },
    unpaid: function (s) { return isIn(s) && !s.paid && !s.inKind; },
    // Signed up, and one of Paid, Receipt sent, Packet sent is still No.
    todo: function (s) { if (!isIn(s)) return false; var st = stepsOf(s); return !st.paid.done || !st.receipt.done || !st.packet.done; },
    notContacted: function (s) { return !String(s.contacted).trim(); },
    lapsed: function (s) { return s.past && !isIn(s); },
    pastNotContacted: function (s) { return s.past && !isIn(s) && contactState(s) === 'none'; },
    walkIn: function (s) { return s.walkIn; },
    mine: function (s) { return isMine(s); },
    needsOwner: function (s) { return needsOwner(s); },
    noTeam: function (s) { return isIn(s) && !s.team; },
    needsReceipt: function (s) { var r = receiptState(s); return r === 'ready' || r === 'noEmail'; },
    // Behind the money counts: dollars only, and in kind on its own.
    committed: function (s) { return isIn(s) && !s.inKind; },
    paidCash: function (s) { return isIn(s) && s.paid && !s.inKind; },
    inKind: function (s) { return isIn(s) && s.inKind; },
    packetWaiting: function (s) { return isIn(s) && s.paid && !!S.packets && !packetFor(s); },
    needsWelcome: function (s) { var w = welcomeFor(s); return !!(w && !w.had); }
  };

  // Where a paid sponsor's receipt stands, from the receipts list: 'sent',
  // 'ready' (paid, receipt not sent yet), 'skip' (marked not needed),
  // 'noEmail' (paid, but no email on the sheet to send one to), or '' when
  // it doesn't apply or the list hasn't loaded.
  function receiptState(s) {
    if (!s || !isIn(s) || !s.paid || !S.receipts || !S.receipts.items) return '';
    var it = S.receipts.items.filter(function (i) { return Number(i.row) === Number(s.row); })[0];
    if (it) return it.status === 'sent' || it.status === 'skip' ? it.status : 'ready';
    return /@/.test(String(s.email || '')) ? '' : 'noEmail';
  }

  // ---------- the three steps of getting a sponsor in ----------
  // Paid (Yes, In kind or No), Receipt sent, Packet sent: one place works
  // them out, for the card, the list and the Receipts & packets tab. The
  // receipt from this app carries the packet link, so it counts for both.
  // (Nate, Nov 22)
  function rcItemFor(s) {
    return s ? ((S.receipts && S.receipts.items) || []).filter(function (i) { return Number(i.row) === Number(s.row); })[0] || null : null;
  }
  function sponsorAt(row) { return S.book ? sponsors().filter(function (x) { return Number(x.row) === Number(row); })[0] || null : null; }
  function stepsOf(s, it) {
    if (it === undefined) it = rcItemFor(s);
    var signed = s ? isIn(s) : !!it, paid = !!it || (signed && (s.paid || s.inKind));
    var kind = (s && s.inKind) || (it && it.inKind);
    var day = function (d) { return d ? fmtDay(String(d).slice(0, 10)) : ''; };
    var out = { it: it };
    out.paid = { done: paid, label: !signed ? 'Not signed up' : kind ? 'In kind' : paid ? 'Yes' : 'No' };
    var rc = { done: false, label: 'No', can: '' };
    if (!paid) rc.label = 'No, not paid yet';
    else if (!it) rc.label = 'No, add their email first';
    else if (it.status === 'sent') { rc.done = true; rc.label = 'Yes, ' + day(it.at); }
    else if (it.status === 'skip') { rc.done = true; rc.label = it.elsewhere ? 'Yes, ' + day(it.at) + ' (outside the app)' : 'Yes, marked done'; }
    else rc.can = 'send';
    var pk = { done: false, label: 'No', can: '' };
    if (it && it.thanked) { pk.done = true; pk.label = 'Yes, ' + day(it.thanked) + (it.thankedElsewhere ? ' (outside the app)' : ''); }
    else if (it && it.status === 'sent') { pk.done = true; pk.label = 'Yes, with the receipt'; }
    else if (s && packetFor(s)) { pk.done = true; pk.label = 'Yes, they sent theirs back'; }
    else if (!paid) pk.label = 'No, not paid yet';
    else if (!it) pk.label = 'No, add their email first';
    else if (it.status === 'ready') pk.label = 'No, it goes with the receipt';
    else pk.can = 'send';
    out.receipt = rc; out.packet = pk;
    return out;
  }
  // Where a sponsor stands, end point first (Nate, Nov 23): packet received,
  // packet sent, paid and needs their packet, needs a payment nudge, said yes
  // but not paid, contacted and waiting on a reply. '' for anyone not reached
  // out to yet (they live in Outreach) or who said no. Each section folds
  // shut; Contacted starts shut, since it's the long one.
  var STAGES = [
    { k: 'received', t: 'Packet received', s: 'Received', h: 'All done.' },
    { k: 'sent', t: 'Packet sent', s: 'Sent', h: 'Waiting for them to fill in their packet.' },
    { k: 'paid', t: 'Paid, needs packet', s: 'Paid', h: 'Send the receipt, which carries their packet link.' },
    { k: 'nudge', t: 'Needs a payment nudge', s: 'Nudge', h: 'Signed up 2 or more weeks ago and not paid. Preview the reminder, then tap Send.' },
    { k: 'yes', t: 'Said yes, not paid', s: 'Said yes', h: 'Signed up at a level. Mark paid when the money comes in.' },
    { k: 'contacted', t: 'Contacted, waiting on reply', s: 'Contacted', h: 'Reached out to, no answer yet.' }
  ];
  var SEC_SHUT_DEFAULT = { contacted: true };
  var SEC_KEY = 'lybsSpSecShut';
  function secShut() {
    var v = null;
    try { v = JSON.parse(localStorage.getItem(SEC_KEY) || 'null'); } catch (e) { }
    return v && typeof v === 'object' ? v : Object.assign({}, SEC_SHUT_DEFAULT);
  }
  function setSecShut(k, shut) {
    var v = secShut(); v[k] = !!shut;
    try { localStorage.setItem(SEC_KEY, JSON.stringify(v)); } catch (e) { }
  }
  // Fold one section open or shut in place, without redrawing the list.
  function showSec(k, open) {
    var sec = document.querySelector('#spList .sp-sec[data-stage="' + k + '"]');
    if (!sec) return;
    sec.classList.toggle('shut', !open);
    var b = sec.querySelector('.sp-sec-btn');
    if (b) b.setAttribute('aria-expanded', String(open));
    $$('#spList .season-card[data-stage="' + k + '"]').forEach(function (c) { c.hidden = !open; });
    setSecShut(k, !open);
  }
  function stageOf(s) {
    if (!s) return '';
    if (isIn(s)) {
      var st = stepsOf(s);
      if (!st.paid.done) return payNudgeDue(s) ? 'nudge' : 'yes';
      if (packetFor(s)) return 'received';
      return st.packet.done ? 'sent' : 'paid';
    }
    return contactState(s) === 'yes' ? 'contacted' : '';
  }

  // The list card's three little lines.
  function stepChips(s) {
    var st = stepsOf(s), esc = A().esc;
    var chip = function (q, x) { return '<span class="st-chip ' + (x.done ? 'ok' : 'no') + '"><span aria-hidden="true">' + (x.done ? '✓' : '✗') + '</span> ' + q + (x.done ? '' : ': No') + '</span>'; };
    var paidChip = '<span class="st-chip ' + (st.paid.done ? 'ok' : 'no') + '"><span aria-hidden="true">' + (st.paid.done ? '✓' : '✗') + '</span> ' + (st.paid.label === 'In kind' ? 'Paid in kind' : st.paid.done ? 'Paid' : 'Paid: No') + '</span>';
    return '<div class="st-chips">' + paidChip + chip('Receipt', st.receipt) + chip('Packet', st.packet) + '</div>';
  }
  // A first tap asks, a second does it. Never sends anything to a sponsor.
  function armed(btn, ask) {
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1'; btn.dataset.was = btn.textContent; btn.textContent = ask || 'Tap again to confirm';
    clearTimeout(btn._t); btn._t = setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.was; } }, 6000);
    return false;
  }
  // Read the receipts list fresh, then redraw everything that shows it.
  function refreshReceipts() {
    return A().apiPost({ action: 'receiptList' }).then(function (res) {
      if (!res || !res.ok) return;
      A().keep('receiptList', res);
      S.receipts = res; renderReceipts(); render();
      if (S.current) renderSteps(S.current);
    });
  }

  function matches(s) {
    if (!FILTERS[S.filter]) S.filter = 'signed';
    // The main list is the five sections; the Show list is for Teams only.
    // A search looks at everyone on the sheet.
    if (S.mode === 'teams') { if (!FILTERS[S.filter](s)) return false; }
    else if (!S.search && !stageOf(s)) return false;
    if (S.owner && s.owner !== S.owner) return false;
    if (S.area && s.area !== S.area) return false;
    if (S.search) {
      var q = S.search.toLowerCase();
      if ([s.company, s.contact, s.owner, s.contacted, s.team, s.notes].join(' ').toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }

  // ---------- load ----------

  // Speed: the sheet takes a few seconds to read, so the tab first draws
  // last time's copy kept on this device (A().kept), then the fresh read
  // replaces it. The side boxes (receipts, follow-ups, packets, logos...) are
  // read at the same time as the sheet, not after it, and each draws once
  // the sponsor list is there.
  function useBook(res) {
    S.book = res;
    S.me = res.me || '';
    S.former = res.former || [];
    $('#spStatus').textContent = '';
    render();
    renderAddBox();
  }
  function side(body, fn) {
    var early = S.early && A().kept(body.action);
    if (early && S.book) { try { fn(early); } catch (e) { } }
    return Promise.all([A().apiPost(body), S.bookReady]).then(function (out) {
      var res = out[0];
      A().keep(body.action, res);
      if (S.book) return fn(res);
    });
  }

  // fresh: Refresh was pressed, so read the sheet itself, not the quick copy.
  function load(fresh) {
    if (S.loading) return S.loading;
    var done, early = !S.book && A().kept('sponsorBook');
    S.bookReady = new Promise(function (r) { done = r; });
    if (early) { S.early = true; useBook(early); }
    else $('#spStatus').textContent = 'Reading the sponsorship sheet…';
    S.loading = A().apiPost(fresh ? { action: 'sponsorBook', fresh: true } : { action: 'sponsorBook' }).then(function (res) {
      if (!res.ok) {
        var msg = String(res.error || '');
        // The backend hasn't got this version yet (Apps Script still on the old code).
        if (/unknown action/i.test(msg)) msg = 'One setup step left: the Apps Script needs the new Code.gs and Season.gs and a new version deployed (steps in docs/sponsors-tab.md).';
        throw A().backendError(msg || 'Could not read the sponsorship sheet.');
      }
      A().keep('sponsorBook', res);
      S.early = false;
      useBook(res);
      if (SENT_BACK) markSentBack();
    }).catch(function (err) {
      A().noteProblem('Sponsorship sheet did not load', err);
      $('#spStatus').textContent = A().sendErrorText(err, "Can't reach the sponsorship sheet. Check your signal, then tap Refresh.");
    }).finally(function () { S.loading = null; done(); });
    loadHistory();
    loadReceipts();
    loadNudges();
    loadOutreach();
    loadWelcome();
    loadPackets();
    loadUpgrades();
    loadLogos(fresh);
    loadWebsite(false);
    loadTeams();
    return S.loading;
  }

  // This season's committed total next to last season's. Totals only; the
  // backend also keeps today's total so next year has real dates to compare.
  // If the backend doesn't have it yet, the strip just stays hidden.
  function loadHistory() {
    side({ action: 'sponsorHistory' }, function (res) {
      if (!res || !res.ok) return;
      S.history = res;
      renderYoY();
    }).catch(function () { /* the strip stays hidden */ });
  }

  // ---------- receipts ----------
  // Rows marked paid with an email get a donation receipt, sent only when a
  // board member taps Send. Online and check donors get the same receipt.

  function loadReceipts() {
    side({ action: 'receiptList' }, function (res) {
      if (!res || !res.ok) return;
      S.receipts = res;
      renderReceipts();
      render();
      if (S.current) renderSteps(S.current);
      if (S.packets) renderPackets();
    }).catch(function () { /* the box stays hidden */ });
  }

  // Receipts & packets: one row per paid sponsor with two lines, Receipt
  // and Packet, each Yes or No. Send shows only where it's still No, next to
  // "Mark as sent" for one done outside the app. Rows with both done fold
  // into Done, with nothing to send again up front. (Nate, Nov 22)
  function renderReceipts() {
    var box = $('#spReceipts'), esc = A().esc, R = S.receipts;
    renderQuick();
    if (!R) { box.classList.add('hidden'); return; }
    if (!R.items.length && !(R.copies || []).length) { box.classList.add('hidden'); return; }
    var set = R.settings || {};
    var notes = [];
    if (set.missing && set.missing.length) notes.push('Still needed before receipts can go out: ' + setupWords(set.missing) + '.');
    else if (!set.live) notes.push('Test mode: receipts go to the test address, not the sponsor.');
    if (!set.sender) notes.push('The league email address is not set up yet, so nothing can go to a sponsor.');
    var can = canEdit();
    var withSteps = R.items.map(function (i) { return { i: i, st: stepsOf(sponsorAt(i.row), i) }; });
    var todo = withSteps.filter(function (x) { return !x.st.receipt.done || !x.st.packet.done; });
    var done = withSteps.filter(function (x) { return x.st.receipt.done && x.st.packet.done; });
    var line = function (q, x, btns) {
      return '<div class="rc-line ' + (x.done ? 'ok' : 'no') + '"><span class="rc-q">' + q + '</span>' +
        '<b class="rc-a"><span aria-hidden="true">' + (x.done ? '✓ ' : '✗ ') + '</span>' + esc(x.label) + '</b>' +
        (btns ? '<span class="rc-acts">' + btns + '</span>' : '') + '</div>';
    };
    var row = function (x, isDone) {
      var i = x.i, st = x.st, rb = '', pb = '', tuck = [];
      if (can && st.receipt.can === 'send') rb = '<button class="btn small primary" data-rc="preview" type="button">Send receipt</button>' +
        '<button class="btn small" data-rc="rcmark" type="button">Mark as sent</button>';
      if (can && st.packet.can === 'send') pb = '<button class="btn small primary" data-rc="thanks" type="button">Send packet</button>' +
        '<button class="btn small" data-rc="pkmark" type="button">Mark as sent</button>';
      // The rarely needed ones, small and out of the way.
      if (i.status === 'sent') tuck.push('<button class="linkish" data-rc="preview" type="button">View receipt</button>');
      if (can && st.receipt.can === 'send') tuck.push('<button class="linkish" data-rc="rcnone" type="button">No receipt needed</button>');
      if (can && i.status === 'skip') tuck.push('<button class="linkish" data-rc="undo" type="button">Undo receipt</button>');
      if (can && i.thankedElsewhere) tuck.push('<button class="linkish" data-rc="pkundo" type="button">Undo packet</button>');
      return '<li class="rc-item rc-two" data-key="' + esc(i.key) + '">' +
        '<div class="rc-who"><b>' + esc(i.company) + '</b><span>' + esc(i.amount) + ' · ' + esc(i.email) + '</span></div>' +
        '<div class="rc-lines">' + line('Receipt', st.receipt, rb) + line('Packet', st.packet, pb) + '</div>' +
        (tuck.length && (isDone || can) ? '<div class="rc-tuck">' + tuck.join('<span class="sep"> · </span>') + '</div>' : '') +
        '<div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
    };
    box.innerHTML = '<details class="rc-box"' + (S.rcOpen ? ' open' : '') + '>' +
      '<summary class="rc-h">' + (todo.length ? 'Receipts &amp; packets to send ' + countBadge(todo.length) : 'Receipts &amp; packets: all done') + '</summary>' +
      (notes.length ? '<p class="hint rc-note">' + esc(notes.join(' ')) + '</p>' : '') +
      (todo.length ? '<ul class="rc-list">' + todo.map(function (x) { return row(x, false); }).join('') + '</ul>' : '<p class="hint">Every paid sponsor has their receipt and packet.</p>') +
      (done.length ? '<details class="rc-more"><summary>Done (' + done.length + ')</summary><ul class="rc-list">' +
        done.map(function (x) { return row(x, true); }).join('') + '</ul>' + copiesHtml(R.copies || []) + '</details>'
        : copiesHtml(R.copies || [])) +
      '</details>';
    keepOpen(box, 'rcOpen');
    box.classList.remove('hidden');
    applyMode();
  }

  // Every receipt that went out, newest first: a kept copy of the email as
  // sent, with who it was for, when, how much, the level, where it went and
  // who sent it. Test sends are marked.
  function copiesHtml(list) {
    if (!list.length) return '';
    var esc = A().esc;
    var when = function (at) { var d = fmtDay(String(at).slice(0, 10)); var t = String(at).slice(11, 16); return t ? d + ', ' + t : d; };
    return '<details class="rc-more rc-copies"><summary>Copies of receipts sent (' + list.length + ')</summary><ul class="rc-list">' +
      list.map(function (c) {
        return '<li class="rc-item" data-copy="' + esc(c.id) + '">' +
          '<div class="rc-who"><b>' + esc(c.company) + '</b>' +
          '<span>' + [when(c.at), c.amount, c.level].filter(Boolean).map(esc).join(' · ') + '</span>' +
          '<span>' + esc('To ' + (c.test ? 'the test address' : c.to)) + (c.by ? esc(' · sent by ' + c.by) : '') + '</span>' +
          (c.test ? '<span class="rc-path">Test send</span>' : '') + '</div>' +
          '<div class="rc-acts"><button class="btn small" data-rc="copy" type="button">Open copy</button></div>' +
          '<div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
      }).join('') + '</ul></details>';
  }

  // A kept copy in the same pane as the preview, to read or print. No Send.
  function showCopy(pv, id, msg) {
    msg.textContent = 'Opening the copy…';
    return A().apiPost({ action: 'receiptCopyGet', id: id }).then(function (res) {
      msg.textContent = res.ok ? '' : (res.error || 'Could not open that copy.');
      if (res.ok) framePane(pv, res.subject, res.html, '');
    }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; });
  }

  // The pane: subject, Print / Save as PDF, Close, then the email in a frame
  // that runs no scripts. extra: buttons that go before Print.
  function framePane(pv, subject, html, extra, note) {
    var esc = A().esc;
    pv.innerHTML = '<div class="rc-pv-top"><b>' + esc(subject) + '</b>' +
      '<span class="rc-pv-acts">' + (extra || '') +
      '<button class="btn small" type="button" data-pv="print">Print / Save as PDF</button>' +
      '<button class="btn small" type="button" data-pv="close">Close</button></span></div>' +
      (note || '') + '<div class="rc-pv-msg status" role="status"></div>';
    // No scripts run inside the receipt; same origin only so this page can
    // print it. A link in it (the sponsor packet) opens in its own tab, where
    // the page can run: opened inside this frame it would sit on "Loading".
    var f = document.createElement('iframe');
    f.className = 'rc-frame'; f.title = 'Receipt';
    f.setAttribute('sandbox', 'allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox');
    var doc = String(html), base = '<base target="_blank">';
    f.srcdoc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, function (h) { return h + base; }) : base + doc;
    pv.appendChild(f); pv.classList.remove('hidden');
    var said = pv.querySelector('.rc-pv-msg');
    pv.querySelector('[data-pv="print"]').addEventListener('click', function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { said.textContent = 'This browser would not print it. Try Send, then print the PDF in the email.'; } });
    pv.querySelector('[data-pv="close"]').addEventListener('click', function () { pv.classList.add('hidden'); pv.innerHTML = ''; });
    if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
    return said;
  }

  // One receipt, as the sponsor will get it, in a preview pane. With send on,
  // the pane has its own Send button: a first tap asks, the second sends.
  // Nothing goes out unless that button is tapped.
  function showReceipt(pv, key, msg, opts) {
    var esc = A().esc;
    msg.textContent = 'Building the preview…';
    return A().apiPost({ action: 'receiptPreview', key: key }).then(function (res) {
      msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
      if (!res.ok) return false;
      var set = (S.receipts && S.receipts.settings) || {};
      var item = ((S.receipts && S.receipts.items) || []).filter(function (i) { return i.key === key; })[0] || {};
      var canSend = !!(opts && opts.send) && !res.sent && item.status === 'ready';
      var to = res.live ? (item.email || res.to) : 'the test address (test mode)';
      var said = framePane(pv, res.subject, res.html,
        canSend ? '<button class="btn small primary" type="button" data-pv="send">Send</button>' : '',
        canSend ? '<p class="hint rc-pv-to">Goes to ' + esc(to) + (set.via === 'mine' ? ' under the league name (replies go to the league address)' : ' from the league address') + ', only when you tap Send.</p>' +
          (res.live ? (res.ccFixed
            ? '<p class="hint rc-pv-cc">CC: ' + esc(res.cc || 'nobody') + ' (from the sheet’s CC column)</p>'
            : '<label class="rc-pv-cc">CC <input type="email" multiple autocomplete="off" placeholder="Optional, e.g. the owner" value="' + esc(res.cc || '') + '"></label>')
            : '<p class="hint rc-pv-cc">CC is left off test receipts.</p>') : '');
      var sendBtn = pv.querySelector('[data-pv="send"]');
      if (sendBtn) sendBtn.addEventListener('click', function () {
        if (!sendBtn.dataset.armed) {
          sendBtn.dataset.armed = '1';
          var ccNow = pv.querySelector('.rc-pv-cc input'), ccv = ccNow ? ccNow.value.trim() : (res.ccFixed ? res.cc : '');
          sendBtn.textContent = set.live ? 'Tap again to send to ' + item.email + (ccv ? ' + CC' : '') : 'Tap again to send a test';
          setTimeout(function () { if (sendBtn.isConnected && !sendBtn.disabled) { delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; } }, 6000);
          return;
        }
        sendBtn.disabled = true; said.textContent = 'Sending…';
        var ccBox = pv.querySelector('.rc-pv-cc input'), post = { action: 'receiptSend', key: key };
        if (ccBox) post.cc = ccBox.value.trim();
        A().apiPost(post).then(function (r) {
          if (!r.ok) { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; said.textContent = r.error || 'That did not go through.'; return; }
          said.innerHTML = '<span class="sp-done">✓ ' + esc(r.message || 'Sent.') + '</span>';
          if (r.status === 'sent') sendBtn.remove();
          else { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; }
          loadReceipts();
        }).catch(function () { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; said.textContent = 'Could not reach the backend. Nothing was sent. Try again.'; });
      });
      if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
      return true;
    }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; return false; });
  }

  // The thank-you with the packet link and no receipt, for a receipt that went
  // out another way. Preview, then Send twice; only their own address in To.
  function showThanks(pv, key, msg) {
    var esc = A().esc;
    msg.textContent = 'Building the preview…';
    return A().apiPost({ action: 'receiptThanksPreview', key: key }).then(function (res) {
      msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
      if (!res.ok) return false;
      var item = ((S.receipts && S.receipts.items) || []).filter(function (i) { return i.key === key; })[0] || {};
      var can = canEdit() && !res.thanked && res.sendOn;
      var to = res.live ? (item.email || res.to) : 'the test address (test mode)';
      var said = framePane(pv, res.subject, res.html,
        can ? '<button class="btn small primary" type="button" data-pv="send">Send</button>' : '',
        can ? '<p class="hint rc-pv-to">Goes to ' + esc(to) + ' only, no CC, when you tap Send. No receipt in it.</p>'
            : (!res.sendOn && !res.thanked ? '<p class="hint rc-pv-to">Preview only. Sending turns on once the new sponsor link is live.</p>' : ''));
      var sendBtn = pv.querySelector('[data-pv="send"]');
      if (sendBtn) sendBtn.addEventListener('click', function () {
        if (!sendBtn.dataset.armed) {
          sendBtn.dataset.armed = '1';
          sendBtn.textContent = res.live ? 'Tap again to send to ' + item.email : 'Tap again to send a test';
          setTimeout(function () { if (sendBtn.isConnected && !sendBtn.disabled) { delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; } }, 6000);
          return;
        }
        sendBtn.disabled = true; said.textContent = 'Sending…';
        A().apiPost({ action: 'receiptThanksSend', key: key }).then(function (r) {
          if (!r.ok) { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; said.textContent = r.error || 'That did not go through.'; return; }
          said.innerHTML = '<span class="sp-done">✓ ' + esc(r.message || 'Sent.') + '</span>';
          if (r.live) sendBtn.remove(); else { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; }
          loadReceipts();
        }).catch(function () { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; said.textContent = 'Could not reach the backend. It may not have gone. Refresh before trying again.'; });
      });
      if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
      return true;
    }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; return false; });
  }

  // Right after Mark paid: that sponsor's receipt opens in the sponsor sheet,
  // ready to check and Send. Nothing is sent from here on its own.
  function receiptAfterPaid(row) {
    var pv = $('#spReceipt');
    doneNote('Paid. Opening the receipt…');
    return A().apiPost({ action: 'receiptList' }).then(function (res) {
      if (!res || !res.ok) { doneNote('Paid. The receipt is under Receipts to send.'); return; }
      S.receipts = res; renderReceipts(); render();
      if (!S.current || S.current.row !== row) return;
      var mine = res.items.filter(function (i) { return i.row === row; });
      var ready = mine.filter(function (i) { return i.status === 'ready'; })[0];
      if (!ready) {
        doneNote(mine.length ? 'Paid. Its receipt was already sent or marked done.'
          : 'Paid. No receipt yet: the row needs an email and an amount over $0.');
        return;
      }
      return showReceipt(pv, ready.key, $('#spEditStatus'), { send: true }).then(function (shown) {
        if (shown) doneNote('Paid. Check the receipt below, then tap Send.');
      });
    }).catch(function () { doneNote('Paid. The receipt is under Receipts to send.'); });
  }

  function receiptAct(btn) {
    var li = btn.closest('.rc-item'), key = li.dataset.key, how = btn.dataset.rc, msg = li.querySelector('.rc-msg');
    var item = S.receipts.items.filter(function (i) { return i.key === key; })[0];
    // Send lives in the preview, so every email is seen before it goes.
    if (how === 'copy') return showCopy(rowPreview(li), li.dataset.copy, msg);
    if (how === 'preview') return showReceipt(rowPreview(li), key, msg, { send: canEdit() && item && item.status === 'ready' });
    if (how === 'thanks') return showThanks(rowPreview(li), key, msg);
    var ask = { rcmark: 'Tap again: receipt already sent', rcnone: 'Tap again: no receipt needed', pkmark: 'Tap again: packet already sent',
      undo: 'Tap again to undo', pkundo: 'Tap again to undo' }[how];
    if (!ask) return;
    if (!armed(btn, ask)) return;
    markStep(how, key, msg);
  }
  // Mark as sent (or not needed, or undo) for a receipt or a packet. Changes
  // what the app shows only; nothing goes to the sponsor.
  function markStep(how, key, msg) {
    var body = how === 'pkmark' ? { action: 'receiptThanksMark', key: key }
      : how === 'pkundo' ? { action: 'receiptThanksMark', key: key, undo: true }
      : { action: 'receiptMark', key: key, how: how === 'undo' ? 'undo' : 'skip' };
    if (how === 'rcmark') body.elsewhere = true;
    msg.textContent = 'Saving…';
    return A().apiPost(body).then(function (res) {
      if (!res.ok) { msg.textContent = res.error || 'That did not go through.'; return; }
      msg.innerHTML = '<span class="sp-done">✓ ' + A().esc(res.message || 'Saved.') + '</span>';
      return refreshReceipts();
    }).catch(function () { msg.textContent = 'Could not reach the backend. Nothing changed. Try again.'; });
  }

  // ---------- follow-ups ----------
  // Contacted, unpaid sponsors who haven't said no get a short follow-up at a
  // few set dates. Each one waits here for Preview and a tap on Send.

  function fmtDay(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2]) - 1] + ' ' + Number(m[3]) : d;
  }

  function loadNudges() {
    side({ action: 'nudgeList' }, function (res) {
      if (!res || !res.ok) return;
      S.nudges = res;
      renderNudges();
    }).catch(function () { /* the box stays hidden */ });
  }

  // Plain words for the settings a card says are missing.
  var SETUP_WORDS = { RECEIPT_ORG_ADDRESS: 'the league’s mailing address',
    'mailing address': 'the league’s mailing address', EIN: 'the league’s tax ID', 'who issues it': 'who signs the receipts' };
  function setupWords(list) { return list.map(function (k) { return SETUP_WORDS[k] || k; }).join(', '); }

  function countBadge(n) { return '<span class="rc-badge" aria-label="' + n + ' ready">' + n + '</span>'; }
  // A box stays open or closed across refreshes, the way the person left it.
  function keepOpen(box, key) {
    var dt = box.querySelector('details.rc-box');
    if (dt) dt.addEventListener('toggle', function () { S[key] = dt.open; });
  }
  // A preview opens right under its own sponsor's row; any other one closes.
  function rowPreview(li) {
    var pv = li.querySelector('.rc-preview');
    document.querySelectorAll('.rc-item .rc-preview, .sp-card-rc .rc-preview').forEach(function (p) {
      if (p !== pv) { p.classList.add('hidden'); p.innerHTML = ''; }
    });
    pv.innerHTML = '';
    return pv;
  }

  function renderNudges() {
    var box = $('#spNudges'), esc = A().esc, N = S.nudges;
    // Paid sponsors still waiting on their info packet sit in this tab too.
    var pk = packetWaiting(), pkBox = pk ? '<div class="pk-box">' + pk + '</div>' : '';
    S.pkLast = pk;
    if (!N || !N.rounds || !N.rounds.length) {
      box.innerHTML = pkBox;
      box.classList.toggle('hidden', !pkBox);
      applyMode();
      return;
    }
    var ready = N.items.filter(function (i) { return i.status === 'ready'; });
    var done = N.items.filter(function (i) { return i.status !== 'ready'; });
    var set = N.settings || {}, notes = [];
    if (set.missing && set.missing.length) notes.push('Still needed before these can go out: ' + setupWords(set.missing) + '.');
    else if (!set.live) notes.push('Test mode: follow-ups go to the test address, not the sponsor.');
    if (!set.sender) notes.push('The league email address is not connected yet, so nothing can go to a sponsor.');
    var on = !!(N.current && N.started), can = canEdit();
    var head = !N.current ? 'Follow-ups: off. First round ' + esc(fmtDay(N.next && N.next.date))
      : !on ? 'Follow-ups: off · ' + esc(N.current.label)
      : (ready.length ? 'Follow-ups to send ' + countBadge(ready.length) : 'Follow-ups: all caught up') + ' · ' + esc(N.current.label);
    var count = N.items.length + ' contacted sponsor' + (N.items.length === 1 ? ' is' : 's are') + ' on the list right now.';
    var body = function () { return !N.current
      ? '<p class="hint">' + count + ' Follow-ups stay off until someone starts a round here. Even then, each one waits for Preview and Send.</p>'
      : !on
        ? '<p class="hint">' + count + ' Nothing goes out unless someone starts this round. Even then, each one waits for Preview and Send.</p>' +
          (can ? '<div class="rc-acts"><button class="btn small" data-nd="start" type="button">Start this round</button></div>' : '') +
          '<div class="rc-msg nd-msg" role="status"></div>'
        : '<ul class="rc-list">' + ready.map(row).join('') + '</ul>' +
          (can ? '<div class="rc-acts nd-off"><button class="btn small" data-nd="stop" type="button">Turn this round off</button></div>' : '') +
          '<div class="rc-msg nd-msg" role="status"></div>'; };
    var row = function (i) {
      var acts = i.status === 'ready'
        ? '<button class="btn small primary" data-nd="preview" type="button">Preview and send</button>' +
          '<button class="btn small" data-nd="skip" type="button">Skip</button>'
        : '<span class="rc-state">' + (i.status === 'sent' ? 'Sent' : 'Skipped') + (i.at ? ' ' + esc(i.at) : '') + '</span>' +
          (i.status === 'sent' ? '' : '<button class="btn small" data-nd="undo" type="button">Undo</button>');
      return '<li class="rc-item" data-key="' + esc(i.key) + '"><div class="rc-who"><b>' + esc(i.company) + '</b><span>' + esc(i.email) + '</span></div>' +
        '<div class="rc-acts">' + acts + '</div><div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
    };
    box.innerHTML = '<details class="rc-box"' + (S.ndOpen ? ' open' : '') + '><summary class="rc-h">' + head + '</summary>' +
      (notes.length ? '<p class="hint rc-note">' + esc(notes.join(' ')) + '</p>' : '') + body() +
      (done.length ? '<details class="rc-more"><summary>Sent or skipped this round (' + done.length + ')</summary><ul class="rc-list">' + done.map(row).join('') + '</ul></details>' : '') +
      '<details class="rc-more"><summary>Schedule</summary><ul class="rc-list">' + N.rounds.map(function (r) {
        return '<li class="rc-item" data-round="' + esc(r.date) + '"><div class="rc-who"><b>' + esc(fmtDay(r.date)) + '</b><span>' + esc(r.label) + '</span></div>' +
          '<div class="rc-acts"><button class="btn small" data-nd="sample" type="button">Preview</button></div><div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
      }).join('') + '</ul></details></details>' + pkBox;
    keepOpen(box, 'ndOpen');
    box.classList.remove('hidden');
    applyMode();
  }

  // Who is signed in here, for the personal version and their own email.
  function signedIn() {
    try { var u = firebase.auth().currentUser; return u ? { email: u.email || '', name: u.displayName || '' } : {}; } catch (e) { return {}; }
  }
  function gmailLink(from, to, subject, text) {
    var e = encodeURIComponent;
    return 'https://mail.google.com/mail/?' + (from ? 'authuser=' + e(from) + '&' : '') + 'view=cm&fs=1&to=' + e(to || '') + '&su=' + e(subject) + '&body=' + e(text);
  }
  function mailtoLink(to, subject, text) {
    var e = encodeURIComponent;
    return 'mailto:' + e(to || '').replace(/%40/g, '@') + '?subject=' + e(subject) + '&body=' + e(text);
  }

  // The follow-up as two editable versions: the league's, sent from the
  // league address on Send, or a personal one the board member sends from
  // their own email. Nothing goes out from here without a tap.
  function showNudgePreview(res, li, q) {
    var esc = A().esc, pv = rowPreview(li), me = signedIn();
    var item = li.dataset.key ? S.nudges.items.filter(function (i) { return i.key === li.dataset.key; })[0] : null;
    var canSend = !!(item && item.status === 'ready' && S.nudges.started);
    var kept = {}, voice = res.voice || 'league';
    kept[voice] = { subject: res.subject, text: res.text, to: res.to, live: res.live };
    pv.innerHTML = '<div class="rc-pv-top"><b>' + esc(res.round || 'Follow-up') + '</b><button class="btn small" type="button" data-pv="close">Close</button></div>' +
      '<div class="nd-voice" role="group" aria-label="Which version">' +
        '<button class="btn small" type="button" data-voice="league">League version<span>from info@</span></button>' +
        '<button class="btn small" type="button" data-voice="personal">Personal<span>from your email</span></button></div>' +
      '<label class="nd-field">Subject<input type="text" class="nd-subject" maxlength="200"></label>' +
      '<label class="nd-field">Message<textarea class="nd-text" rows="12" maxlength="6000"></textarea></label>' +
      '<p class="hint rc-pv-to nd-to"></p><div class="rc-pv-acts nd-acts"></div><div class="rc-pv-msg status" role="status"></div>';
    var sub = pv.querySelector('.nd-subject'), txt = pv.querySelector('.nd-text'), to = pv.querySelector('.nd-to'),
      acts = pv.querySelector('.nd-acts'), said = pv.querySelector('.rc-pv-msg');
    var save = function () { if (kept[voice]) { kept[voice].subject = sub.value; kept[voice].text = txt.value; } };
    var draw = function () {
      var k = kept[voice], live = !!k.live;
      pv.querySelectorAll('[data-voice]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.voice === voice)); b.classList.toggle('primary', b.dataset.voice === voice); });
      sub.value = k.subject; txt.value = k.text; said.textContent = '';
      var where = !item ? '' : live ? esc(item.email) : 'the test address (test mode)';
      if (voice === 'league') {
        to.innerHTML = item ? 'Goes to ' + where + ' from the league address, with the league logo on top, only when you tap Send.' : 'A sample. The league version goes from the league address.';
        acts.innerHTML = canSend ? '<button class="btn small primary" type="button" data-pv="send">Send from info@</button>' : '';
      } else {
        to.innerHTML = item ? 'Opens in your own email, addressed to ' + where + ', so it comes from you. Send it there, then tap I sent it.' : 'A sample. The personal version is sent from the board member’s own email.';
        acts.innerHTML = canSend ? '<a class="btn small primary" target="_blank" rel="noopener" data-pv="gmail" href="#">Open in Gmail</a>' +
          '<a class="btn small" data-pv="mailto" href="#">Other mail app</a>' +
          '<button class="btn small" type="button" data-pv="mine">I sent it</button>' : '';
      }
    };
    var pick = function (v) {
      save();
      if (v === voice) return;
      if (kept[v]) { voice = v; return draw(); }
      said.textContent = 'Loading that version…';
      A().apiPost(Object.assign({}, q, { voice: v, signName: me.name })).then(function (r) {
        if (!r.ok) { said.textContent = r.error || 'Could not load that version.'; return; }
        kept[v] = { subject: r.subject, text: r.text, to: r.to, live: r.live }; voice = v; draw();
      }).catch(function () { said.textContent = 'Could not reach the backend. Try again.'; });
    };
    pv.querySelectorAll('[data-voice]').forEach(function (b) { b.addEventListener('click', function () { pick(b.dataset.voice); }); });
    pv.querySelector('[data-pv="close"]').addEventListener('click', function () { pv.classList.add('hidden'); pv.innerHTML = ''; });
    acts.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pv]'); if (!b) return;
      save();
      var k = kept[voice];
      if (!k.subject.trim() || !k.text.trim()) { e.preventDefault(); said.textContent = 'The email needs a subject and a message.'; return; }
      if (b.dataset.pv === 'gmail') { b.href = gmailLink(me.email, k.to, k.subject, k.text); return; }
      if (b.dataset.pv === 'mailto') { b.href = mailtoLink(k.to, k.subject, k.text); return; }
      if (!b.dataset.armed) {
        b.dataset.armed = '1';
        var was = b.textContent;
        b.textContent = b.dataset.pv === 'send' ? (k.live ? 'Tap again to send to ' + item.email : 'Tap again to send a test') : 'Tap again if you sent it';
        setTimeout(function () { if (b.isConnected && !b.disabled) { delete b.dataset.armed; b.textContent = was; } }, 6000);
        return;
      }
      b.disabled = true; said.textContent = b.dataset.pv === 'send' ? 'Sending…' : 'Saving…';
      var req = b.dataset.pv === 'send' ? { action: 'nudgeSend', key: item.key, subject: k.subject, text: k.text } : { action: 'nudgeMark', key: item.key, how: 'personal' };
      A().apiPost(req).then(function (r) {
        if (!r.ok) { b.disabled = false; delete b.dataset.armed; draw(); said.textContent = r.error || 'That did not go through.'; return; }
        said.innerHTML = '<span class="sp-done">✓ ' + esc(r.message || 'Done.') + '</span>';
        if (r.status === 'sent') { $('#spStatus').textContent = r.message || 'Saved.'; setTimeout(loadNudges, 1200); }
        else { b.disabled = false; delete b.dataset.armed; draw(); said.innerHTML = '<span class="sp-done">✓ ' + esc(r.message || 'Done.') + '</span>'; }
      }).catch(function () { b.disabled = false; delete b.dataset.armed; draw(); said.textContent = 'Could not reach the backend. Nothing was sent. Try again.'; });
    });
    draw();
    pv.classList.remove('hidden');
    if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
  }

  // Start or turn off this round. Starting asks once more on the button.
  function nudgeRound(btn, how) {
    var msg = $('#spNudges .nd-msg');
    if (how === 'start' && !btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to start ' + S.nudges.current.label;
      setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Start this round'; } }, 6000);
      return;
    }
    btn.disabled = true;
    if (msg) msg.textContent = 'Saving…';
    A().apiPost({ action: 'nudgeRound', how: how, round: S.nudges.current.date }).then(function (res) {
      if (!res.ok) { btn.disabled = false; if (msg) msg.textContent = res.error || 'That did not go through.'; return; }
      $('#spStatus').textContent = res.message || 'Saved.';
      S.ndOpen = true;
      loadNudges();
    }).catch(function () { btn.disabled = false; if (msg) msg.textContent = 'Could not reach the backend. Try again.'; });
  }

  function nudgeAct(btn) {
    var how = btn.dataset.nd;
    if (how === 'start' || how === 'stop') return nudgeRound(btn, how);
    var li = btn.closest('.rc-item'), msg = li.querySelector('.rc-msg');
    if (how === 'preview' || how === 'sample') {
      msg.textContent = 'Building the preview…';
      var q = how === 'sample' ? { action: 'nudgePreview', round: li.dataset.round } : { action: 'nudgePreview', key: li.dataset.key };
      return A().apiPost(Object.assign({ voice: 'league', signName: signedIn().name }, q)).then(function (res) {
        msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
        if (res.ok) showNudgePreview(res, li, q);
      }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; });
    }
    if (how !== 'skip' && how !== 'undo') return;
    btn.disabled = true;
    msg.textContent = 'Saving…';
    A().apiPost({ action: 'nudgeMark', key: li.dataset.key, how: how }).then(function (res) {
      if (!res.ok) { btn.disabled = false; msg.textContent = res.error || 'That did not go through.'; return; }
      $('#spStatus').textContent = res.message || 'Saved.';
      loadNudges();
    }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the backend. Try again.'; });
  }

  // ---------- the website ----------
  // A fresh look at the league's website payment notices (Crossbar's
  // "Donation received from" emails), each matched to the sheet. It says when
  // it looked, and names any sponsor-level payment that isn't on the sheet yet
  // or isn't marked paid there. Read only: it changes nothing.
  function loadWebsite(fresh) {
    var box = $('#spWeb');
    if (fresh) box.querySelector('.sp-web-msg') && (box.querySelector('.sp-web-msg').textContent = 'Checking the website…');
    side({ action: 'websiteCheck', fresh: !!fresh }, function (res) {
      if (!res || !res.ok) { if (fresh) webLine('Couldn’t check the website just now. Try again in a minute.'); return; }
      S.web = res; renderWebsite();
    }).catch(function () { if (fresh) webLine('Couldn’t reach the backend to check the website. Try again.'); });
  }
  function webLine(t) { var m = $('#spWeb .sp-web-msg'); if (m) m.textContent = t; }
  function renderWebsite() {
    var box = $('#spWeb'), esc = A().esc, R = S.web;
    if (!R) { box.classList.add('hidden'); return; }
    var at = R.checkedAt ? new Date(R.checkedAt) : null;
    var when = at ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    var since = R.since ? new Date(String(R.since).replace(/\//g, '-') + 'T12:00:00') : null;
    var sinceTxt = since && !isNaN(since) ? ' since ' + since.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
    var pays = R.payments || [];
    var off = pays.filter(function (p) { return !p.company; });
    var unpaid = pays.filter(function (p) { return p.company && !p.paid; });
    var head = 'Website checked ' + when + ': ' + (pays.length
      ? pays.length + ' sponsor payment' + (pays.length > 1 ? 's' : '') + sinceTxt + (off.length || unpaid.length ? '.' : ', all on the sheet and marked paid.')
      : 'no sponsor payments' + sinceTxt + '.');
    var list = off.map(function (p) { return '<li><b>' + esc(p.donor) + '</b> paid ' + esc(p.amount) + ' on ' + esc(p.date) + ', not on the sheet yet</li>'; })
      .concat(unpaid.map(function (p) { return '<li><b>' + esc(p.company) + '</b> paid ' + esc(p.amount) + ' on ' + esc(p.date) + ', not marked paid on the sheet</li>'; }));
    box.innerHTML = '<p class="hint sp-web-msg' + (list.length ? ' warn' : '') + '">' + esc(head) + '</p>' +
      (list.length ? '<ul class="sp-web-list">' + list.join('') + '</ul>' : '') +
      '<button class="btn small" id="spWebCheck" type="button">Check now</button>';
    $('#spWebCheck').addEventListener('click', function () { this.disabled = true; loadWebsite(true); });
    box.classList.remove('hidden');
  }

  // ---------- info packets ----------
  // What sponsors sent on the info packet page, read live from its sheet.

  // Upgrades sponsors asked for on their own page. Each waits for the
  // difference to be paid (Record a payment), and only then counts.
  function loadUpgrades() {
    side({ action: 'sponsorUpgrades' }, function (res) {
      if (!res || !res.ok) return;
      S.upgrades = {};
      (res.upgrades || []).forEach(function (u) { S.upgrades[nameKey(u.company)] = u; });
      render();
    }).catch(function () { /* nothing waiting shows */ });
  }
  // Each sponsor's logo for its card, worked out by the backend: the one set
  // here with Upload logo, else the one they sent with their reply form, else
  // the league's Sponsor Logos folder match by name. Refresh reads Drive again.
  function loadLogos(fresh) {
    side(fresh ? { action: 'sponsorLogoList', fresh: true } : { action: 'sponsorLogoList' }, function (res) {
      if (!res || !res.ok || !res.logos) return;
      S.logos = res.logos;
      render();
    }).catch(function () { /* the cards show without logos */ });
  }
  function logoFor(s) {
    var img = s && S.logos ? S.logos[s.key] : null;
    return img && /^image\/(png|jpeg|gif|webp)$/.test(img.mime) && /^[A-Za-z0-9+\/=]+$/.test(img.base64) ? img : null;
  }

  // A paid sponsor's receipt, right on its card: Preview opens it there, and
  // Send (editors, ready ones only) still needs its own tap in the preview.
  function receiptItem(key) {
    return ((S.receipts && S.receipts.items) || []).filter(function (i) { return i.key === key; })[0] || null;
  }
  function cardReceipt(s) {
    if (!s || !s.paid || !S.receipts) return '';
    var it = (S.receipts.items || []).filter(function (i) { return i.row === s.row && i.status !== 'skip'; })[0];
    if (!it) return '';
    var esc = A().esc;
    var label = it.status === 'sent' ? 'Open receipt' : 'Preview Receipt';
    return '<div class="sp-card-rc">' +
      '<button class="btn small" type="button" data-card-rc="' + esc(it.key) + '">' + label + '</button>' +
      '<div class="rc-msg" role="status"></div></div>';
  }

  // A sponsor who needs a payment nudge: the reminder, right on its card.
  // Preview opens it there; Send still needs its own two taps. Never automatic.
  function cardPayNudge(s) {
    var esc = A().esc;
    return '<div class="sp-card-rc sp-card-nudge">' +
      '<button class="btn small" type="button" data-card-nudge="' + esc(String(s.row)) + '">Preview reminder</button>' +
      '<span class="hint"> ' + esc((s.lastFollow > s.signed ? 'Last reminder ' : 'Signed up ') + fmtDay(payNudgeFrom(s))) + '</span>' +
      '<div class="rc-msg" role="status"></div></div>';
  }
  function showPayNudge(pv, row, msg) {
    var esc = A().esc;
    msg.textContent = 'Building the preview…';
    return A().apiPost({ action: 'payNudgePreview', row: row }).then(function (res) {
      msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
      if (!res.ok) return false;
      var to = res.live ? res.to : 'the test address (test mode)';
      var can = canEdit() && res.due;
      var said = framePane(pv, res.subject, res.html,
        can ? '<button class="btn small primary" type="button" data-pv="send">Send</button>' : '',
        can ? '<p class="hint rc-pv-to">Goes to ' + esc(to) + (res.via === 'mine' ? ' under the league name (replies go to the league address)' : ' from the league address') + ', only when you tap Send.</p>' : '');
      var sendBtn = pv.querySelector('[data-pv="send"]');
      var reset = function () { sendBtn.disabled = false; delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; };
      if (sendBtn) sendBtn.addEventListener('click', function () {
        if (!sendBtn.dataset.armed) {
          sendBtn.dataset.armed = '1';
          sendBtn.textContent = res.live ? 'Tap again to send to ' + res.to : 'Tap again to send a test';
          setTimeout(function () { if (sendBtn.isConnected && !sendBtn.disabled) reset(); }, 6000);
          return;
        }
        sendBtn.disabled = true; said.textContent = 'Sending…';
        A().apiPost({ action: 'payNudgeSend', key: res.key }).then(function (r) {
          if (!r.ok) { reset(); said.textContent = r.error || 'That did not go through.'; return; }
          said.innerHTML = '<span class="sp-done">✓ ' + esc(r.message || 'Sent.') + '</span>';
          if (r.sent) sendBtn.hidden = true; else reset();
        }).catch(function () { reset(); said.textContent = 'Could not reach the backend. It may not have gone. Refresh before trying again.'; });
      });
      if (pv.scrollIntoView) pv.scrollIntoView({ block: 'nearest' });
      return true;
    }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; return false; });
  }

  function upgradeFor(s) { return s && S.upgrades ? S.upgrades[s.key] || null : null; }
  // What's still owed for an upgrade: the level's price less what the sheet shows paid.
  // Once the sheet shows them paid, the sheet decides: a difference already
  // paid in full (say through Edit) leaves nothing owed, not the old figure.
  function upgradeLeft(s, u) {
    if (s.paid && s.amount > 0 && u.price > 0) return Math.max(0, u.price - s.amount);
    return u.owed || Math.max(0, (u.price || 0) - (s.paid ? s.amount || 0 : 0));
  }

  function loadPackets() {
    side({ action: 'sponsorPackets' }, function (res) {
      if (!res || !res.ok || !res.found) return;
      S.packets = res;
      var t = { headers: res.headers }, bc = colOf(t, /^business/);
      S.packetKeys = {};
      res.rows.forEach(function (r) { if (bc >= 0 && r.cells[bc]) S.packetKeys[nameKey(r.cells[bc])] = true; });
      // Sent from their own receipt link: matched to the sponsor, whatever name they typed.
      S.packetRecv = {};
      (res.received || []).forEach(function (p) { S.packetRecv[nameKey(p.company)] = p; });
      renderPackets();
      render();
    }).catch(function () { /* the box stays hidden */ });
  }

  // A sponsor's info packet: the record of the one they sent from their
  // receipt link (when, and what kind), and its row on the Packets sheet.
  function packetFor(s) {
    if (!s || !S.packets) return null;
    var P = S.packets, t = { headers: P.headers };
    var c = { when: colOf(t, /^submitted/), biz: colOf(t, /^business/) };
    var rec = S.packetRecv ? S.packetRecv[s.key] || null : null;
    var row = null;
    if (rec && rec.packetAt && c.when >= 0) row = P.rows.filter(function (r) { return String(r.cells[c.when]) === rec.packetAt; }).pop() || null;
    if (!row && c.biz >= 0) {
      row = P.rows.filter(function (r) {
        var k = nameKey(r.cells[c.biz]);
        return k && (k === s.key || (k.length >= 6 && s.key.length >= 6 && (k.indexOf(s.key) === 0 || s.key.indexOf(k) === 0)));
      }).pop() || null;
    }
    if (!rec && !row) return null;
    return { rec: rec, row: row, when: rec ? rec.at : (row && c.when >= 0 ? String(row.cells[c.when]).slice(0, 10) : ''), note: rec ? rec.note : '' };
  }
  // What their packet said, for the card under the "Packet in" pill.
  function packetNote(s) { var p = packetFor(s); return p && p.note ? 'Packet: ' + p.note : ''; }
  function packetFact(s) {
    var p = packetFor(s);
    if (p) return 'Info packet in' + (p.when ? ' ' + fmtDay(p.when) : '') + (p.note ? ': ' + p.note : '');
    return isIn(s) && s.paid && S.packets ? 'Waiting on info packet' : '';
  }
  // Paid, but no packet back yet. The receipt carries their packet link, so
  // one whose receipt hasn't gone out hasn't got the link yet.
  function packetWaiting() {
    if (!S.book || !S.packets) return '';
    var esc = A().esc;
    var list = sponsors().filter(function (s) { return isIn(s) && s.paid && !packetFor(s); })
      .sort(function (a, b) { return a.company.localeCompare(b.company); });
    if (!list.length) return '';
    return '<h2 class="rc-h">Paid, waiting on their info packet (' + list.length + ')</h2><ul class="rc-list pk-wait">' +
      list.map(function (s) {
        // Matched by sheet row, the way the card's badge is; the key alone can miss.
        var rc = (S.receipts && S.receipts.items || []).filter(function (i) { return Number(i.row) === Number(s.row); })[0] || receiptItem(s.key);
        var how = rc && rc.status === 'sent' ? 'Receipt with their packet link sent' + (rc.at ? ' ' + fmtDay(String(rc.at).slice(0, 10)) : '')
          : 'Receipt not sent yet, so they don’t have the packet link';
        return '<li class="pk-item"><b>' + esc(s.company) + '</b> <span class="hint">' + esc((s.tier ? s.tier + '. ' : '') + how + '.') + '</span></li>';
      }).join('') + '</ul>';
  }

  // An in-kind sponsor never gets a receipt, so their packet link comes from
  // here: the same page, showing their level paid by an in-kind donation, with
  // no upgrades. Editors only; nothing is sent from here.
  function inKindLinkBox(s) {
    if (!canEdit() || !s.inKind || !s.tier) return '';
    return '<div class="sp-packet sp-pklink"><h3 class="ss-h">In-kind packet link</h3>' +
      '<p class="hint">Their page shows ' + A().esc(s.tier) + ', with their in-kind donation where the payment would be, no upgrades, and the usual form for their info.</p>' +
      '<div class="sheet-acts"><button class="btn small" type="button" data-pklink>Get their packet link</button></div>' +
      '<div class="pk-link" aria-live="polite"></div></div>';
  }
  function getPacketLink(s, btn) {
    var out = $('#spFields .pk-link'), esc = A().esc;
    btn.disabled = true; out.textContent = 'Making their link…';
    A().apiPost({ action: 'sponsorPacketLink', row: s.row, company: s.company }).then(function (res) {
      btn.disabled = false;
      if (!res.ok || !/^https:\/\/[^\s"'<>]+$/.test(res.link || '')) { out.textContent = res.error || 'The link couldn’t be made.'; return; }
      out.innerHTML = '<input class="pk-url" type="text" readonly value="' + esc(res.link) + '" aria-label="Their packet link">' +
        '<button class="btn small" type="button" data-pkcopy>Copy link</button>';
      var inp = out.querySelector('.pk-url');
      out.querySelector('[data-pkcopy]').addEventListener('click', function (e) {
        var b = e.currentTarget;
        var done = function () { b.textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(res.link).then(done, function () { inp.select(); });
        else { inp.select(); try { document.execCommand('copy'); done(); } catch (x) { } }
      });
    }).catch(function () { btn.disabled = false; out.textContent = 'Could not reach the backend. Try again.'; });
  }

  // The packet on the sponsor's own detail: what they sent, and their logo.
  function renderPacketDetail(s) {
    var p = packetFor(s), esc = A().esc;
    if (!p) {
      return isIn(s) && s.paid && S.packets ? '<div class="sp-packet"><h3 class="ss-h">Info packet</h3><p class="hint">Not in yet.</p></div>' : '';
    }
    var html = '<div class="sp-packet"><h3 class="ss-h">Info packet in' + (p.when ? ' ' + esc(fmtDay(p.when)) : '') + '</h3>' +
      (p.note ? '<p><b>' + esc(p.note) + '</b></p>' : '');
    if (p.row) {
      var P = S.packets, t = { headers: P.headers };
      var want = [/^level/, /^business/, /^name on jersey/, /^contact name/, /^email/, /^phone/, /^website/, /^facebook/, /^instagram/,
        /^other social/, /^banner$/, /^banner notes/, /^sponsoring/, /^write up/, /^anything else/];
      html += '<div class="pk-logo" data-row="' + p.row.row + '" aria-live="polite"></div>' + want.map(function (re) {
        var i = colOf(t, re), v = i < 0 ? '' : String(p.row.cells[i] || '');
        return v ? '<p class="ss-row"><span>' + esc(P.headers[i]) + '</span>' + linkify(P.headers[i], v) + '</p>' : '';
      }).join('');
      var fi = colOf(t, /^files folder/), f = fi < 0 ? '' : String(p.row.cells[fi] || '');
      if (/^https:\/\/drive\.google\.com\//.test(f)) html += '<p><a class="btn small" target="_blank" rel="noopener" href="' + esc(f) + '">Open their files in Drive</a></p>';
    }
    return html + '</div>';
  }
  function loadPacketLogo() {
    var spot = $('#spFields .sp-packet .pk-logo');
    if (!spot || spot.dataset.done) return;
    spot.dataset.done = '1';
    spot.textContent = 'Loading logo…';
    A().apiPost({ action: 'packetLogo', row: Number(spot.dataset.row) }).then(function (res) {
      spot.textContent = '';
      if (!res.ok || !res.logo) { spot.textContent = res.ok ? 'No logo image in their files.' : (res.error || 'Could not load the logo.'); return; }
      var img = document.createElement('img');
      img.className = 'sp-logo'; img.alt = 'Logo they sent';
      img.src = 'data:' + res.logo.mime + ';base64,' + res.logo.base64;
      spot.appendChild(img);
    }).catch(function () { spot.textContent = 'Could not load the logo.'; spot.dataset.done = ''; });
  }

  function renderPackets() {
    var box = $('#spPackets'), esc = A().esc, P = S.packets;
    if (!P) { box.classList.add('hidden'); return; }
    // The paid sponsors still waiting on theirs are listed under Follow-ups.
    renderNudges();
    if (!P.rows.length) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    var t = { headers: P.headers };
    var c = { when: colOf(t, /^submitted/), status: colOf(t, /^status/), level: colOf(t, /^level/), biz: colOf(t, /^business/) };
    var skip = [colOf(t, /^files folder/), colOf(t, /^files$/)];
    var get = function (r, k) { return c[k] < 0 ? '' : (r.cells[c[k]] || ''); };
    var fresh = function (r) { return !get(r, 'status') || /^new/i.test(get(r, 'status')); };
    var rows = P.rows.slice().reverse();   // newest first
    var nNew = rows.filter(fresh).length;
    // Which packets' businesses are already on the sponsor list.
    var mt = mainTab(), mc = mt ? colOf(mt, /^(company|business)/) : -1, listed = {};
    if (mt && mc >= 0) mt.rows.forEach(function (r) { if (r.cells[mc]) listed[nameKey(r.cells[mc])] = true; });
    var canAdd = !!(S.book && S.book.writable && S.book.canAdd);
    var onList = function (r) { return !!listed[nameKey(get(r, 'biz'))]; };
    box.innerHTML = '<h2 class="rc-h">Sponsor info packets (' + rows.length + ')' + (nNew ? ' · ' + nNew + ' new' : '') + '</h2>' +
      '<ul class="rc-list">' + rows.map(function (r) {
        var body = P.headers.map(function (h, i) {
          if (skip.indexOf(i) >= 0 || !r.cells[i] || i === c.biz) return '';
          return '<p class="ss-row"><span>' + esc(h) + '</span>' + esc(r.cells[i]) + '</p>';
        }).join('');
        return '<li class="pk-item"><details data-row="' + r.row + '"><summary><b>' + esc(get(r, 'biz') || 'No business name') + '</b>' +
          '<span>' + esc([get(r, 'level'), get(r, 'when')].filter(Boolean).join(' · ')) + '</span>' +
          A().badge(fresh(r) ? 'New' : get(r, 'status'), fresh(r) ? 'warn' : 'muted') + '</summary>' +
          '<div class="pk-logo" aria-live="polite"></div>' +
          (onList(r) ? '<p class="hint pk-on">On the sponsor list.</p>' :
            canAdd && get(r, 'biz') ? '<p class="pk-add"><button type="button" class="btn pk-add-btn" data-row="' + r.row + '">Add to sponsor list</button> <span class="hint" aria-live="polite"></span></p>' : '') +
          body + '</details></li>';
      }).join('') + '</ul>';
    box.classList.remove('hidden');
    $$('#spPackets .pk-add-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var note = btn.parentNode.querySelector('.hint');
        btn.disabled = true; note.textContent = 'Adding…';
        A().apiPost({ action: 'packetAdd', row: Number(btn.dataset.row) }).then(function (res) {
          if (!res.ok) { btn.disabled = false; note.textContent = res.error || 'That did not save.'; return; }
          note.textContent = res.message || 'Added.';
          load();
        }).catch(function () { btn.disabled = false; note.textContent = 'Could not reach the backend. Nothing was saved. Try again.'; });
      });
    });
    $$('#spPackets details').forEach(function (d) {
      d.addEventListener('toggle', function () {
        var spot = d.querySelector('.pk-logo');
        if (!d.open || spot.dataset.done) return;
        spot.dataset.done = '1';
        spot.textContent = 'Loading logo…';
        A().apiPost({ action: 'packetLogo', row: Number(d.dataset.row) }).then(function (res) {
          spot.textContent = '';
          if (!res.ok) { spot.textContent = res.error || 'Could not load the logo.'; return; }
          if (!res.logo) { spot.textContent = 'No logo image in the files yet.'; return; }
          var img = document.createElement('img');
          img.className = 'sp-logo'; img.alt = 'Logo they sent';
          img.src = 'data:' + res.logo.mime + ';base64,' + res.logo.base64;
          spot.appendChild(img);
        }).catch(function () { spot.textContent = 'Could not load the logo. Try again.'; spot.dataset.done = ''; });
      });
    });
  }

  // ---------- board edits ----------
  // Add a contact (any board member) and edit a row or mark it paid (editors),
  // only once the backend says the board copy of the sheet is switched on.

  function renderAddBox() {
    var box = $('#spAddBox');
    box.classList.toggle('hidden', !(S.book && S.book.writable && S.book.canAdd));
    $('#spPayBox').classList.toggle('hidden', !canEdit());
    applyMode();
  }

  function addContact(e) {
    e.preventDefault();
    var f = { company: $('#spa_company').value.trim(), contact: $('#spa_contact').value.trim(), phone: $('#spa_phone').value.trim(),
      email: $('#spa_email').value.trim(), owner: $('#spa_owner').value.trim(), notes: $('#spa_notes').value.trim() };
    var lvl = $('#spa_tier') ? $('#spa_tier').value : '', amt = $('#spa_amount') ? money($('#spa_amount').value) : 0;
    var how = $('#spa_how') ? $('#spa_how').value : '';
    var msg = $('#spaStatus');
    if (!f.company) { msg.textContent = 'Add the business or person’s name.'; return; }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email)) { msg.textContent = 'That email doesn’t look right.'; return; }
    if (lvl && !(amt > 0)) { msg.textContent = 'Add the amount for ' + lvl + '.'; return; }
    // A level makes it a sponsor for this season: Status follows to "Signed up, not paid".
    if (lvl) { f.tier = lvl; f.amount = fmtMoney(amt); if (!f.contacted) f.contacted = f.owner || 'Yes'; }
    if (lvl && how === 'inkind') f.how = PAY_HOW.inkind;
    msg.textContent = 'Saving…';
    $('#spaSave').disabled = true;
    A().apiPost(Object.assign({ action: 'sponsorAdd' }, f)).then(function (res) {
      $('#spaSave').disabled = false;
      if (!res.ok) { msg.textContent = res.error || 'That did not save.'; return; }
      msg.textContent = res.message || 'Added.';
      $('#spAddForm').reset();
      load().then(function () {
        if (!res.row) return;
        open(res.row);
        if (canEdit()) { startEdit(); $('#spEditStatus').textContent = 'Added. Fill in anything else below, then hold Save changes.'; }
      });
    }).catch(function () { $('#spaSave').disabled = false; msg.textContent = 'Could not reach the backend. Nothing was saved. Try again.'; });
  }

  // The levels a new sponsor can pick, with their usual price: the four on
  // the league's Become a Sponsor page (Championship is $750 and up).
  var ADD_LEVELS = [['Gameday', 0], ['All-Star', 300], ['MVP', 500], ['Championship', 750]];
  function addLevelPicked() {
    var lv = ADD_LEVELS.filter(function (l) { return l[0] === $('#spa_tier').value; })[0];
    if (lv && lv[1] && !money($('#spa_amount').value)) $('#spa_amount').value = fmtMoney(lv[1]);
    $('#spa_money').classList.toggle('hidden', !$('#spa_tier').value);
  }

  // Website sponsor forms: paste what the form says (the Registration Details
  // page, or the email), and the fields fill in for a check before Add.
  // Only reads the pasted words; nothing is saved until Add sponsor.
  function readSponsorForm(text) {
    var t = String(text || '').replace(/\r/g, ''), out = {};
    var line = function (re) {
      var m = t.match(new RegExp('^\\s*\\*?\\s*(?:' + re + ')\\s*\\*?\\s*[:\\-\\t]\\s*(.+)$', 'im'));
      return m ? m[1].replace(/\*+/g, '').trim() : '';
    };
    out.company = line('business(?: name)?|company(?: name)?|organi[sz]ation(?: name)?|sponsor(?: name)?');
    out.contact = line('contact(?: name| person)?|your name|full name|name');
    if (out.contact && out.company && out.contact === out.company) out.contact = '';
    var em = t.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); out.email = em ? em[0] : '';
    var ph = t.match(/\(?\b\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}\b/); out.phone = ph ? ph[0].trim() : '';
    var lvTxt = line('sponsorship(?: level| tier| package)?|level|tier|package') || t;
    var hits = ADD_LEVELS.map(function (l) { return l[0]; }).filter(function (n) {
      // An old form that says "Championship+" reads as Championship.
      return new RegExp('(^|[^A-Za-z])' + n.replace('-', '[- ]?') + '(?![A-Za-z])', 'i').test(lvTxt);
    });
    out.tier = hits.length ? hits[hits.length - 1] : '';
    var am = (line('amount|total|price') || lvTxt).match(/\$\s?([\d,]+(?:\.\d{2})?)/);
    out.amount = am ? money(am[1]) : 0;
    if (!out.amount && out.tier) out.amount = (ADD_LEVELS.filter(function (l) { return l[0] === out.tier; })[0] || [0, 0])[1];
    return out;
  }
  function fillFromForm() {
    var f = readSponsorForm($('#spa_paste').value), said = [];
    var put = function (id, v, label) { if (v) { $(id).value = v; said.push(label); } };
    put('#spa_company', f.company, 'business'); put('#spa_contact', f.contact, 'contact'); put('#spa_email', f.email, 'email'); put('#spa_phone', f.phone, 'phone');
    if (f.tier) { $('#spa_tier').value = f.tier; said.push('level'); }
    if (f.amount) { $('#spa_amount').value = fmtMoney(f.amount); said.push('amount'); }
    addLevelPicked();
    $('#spaStatus').textContent = said.length ? 'Filled in ' + said.join(', ') + '. Check them, then tap Add sponsor.' : 'Couldn’t find anything to fill in. Type it in below.';
  }

  // ---------- record a payment ----------
  // A payment came in (online or a check). Find who it's from on the sheet,
  // the likeliest first: signed up and waiting on money, then people someone
  // reached out to, then walk-ins, then everyone else. Picking one marks them
  // paid and opens their receipt preview; nothing is sent until Send is tapped.
  // How it was paid: the words that go in the sheet's Paid how column and on the receipt.
  var PAY_HOW = { online: 'Crossbar (online)', check: 'Check', cash: 'Cash', venmo: 'Venmo', inkind: 'In kind' };
  var PAY_SAID = { online: 'online through Crossbar', check: 'by check', cash: 'in cash', venmo: 'by Venmo', inkind: 'in kind (goods or services)' };
  var PAY_GROUPS = ['Upgrade waiting on payment', 'Signed up, waiting on payment', 'Contacted, not signed up yet', 'Walk-in', 'On the sheet', 'Already marked paid'];
  var PAY_SKIP = /^(the|and|of|inc|llc|co|corp|company|ltd|pc|p c|dba|group)$/;
  function payWords(v) { return norm(v).split(' ').filter(function (w) { return w.length > 1 && !PAY_SKIP.test(w); }); }
  function payScore(s, name, email) {
    if (email && s.email && String(s.email).toLowerCase().indexOf(email.toLowerCase()) >= 0) return 100;
    var q = nameKey(name), k = s.key, ck = nameKey(s.contact);
    if (!q) return 0;
    if (q === k || (ck && q === ck)) return 90;
    if (q.length >= 4 && (k.indexOf(q) >= 0 || q.indexOf(k) >= 0 && k.length >= 4)) return 70;
    if (q.length >= 4 && ck && (ck.indexOf(q) >= 0 || q.indexOf(ck) >= 0 && ck.length >= 4)) return 60;
    var mine = payWords(s.company + ' ' + s.contact), hit = 0;
    payWords(name).forEach(function (w) { if (mine.indexOf(w) >= 0) hit++; });
    return hit * 20;
  }
  function payGroup(s) {
    if (upgradeFor(s)) return 0;
    if (s.paid) return 5;
    if (isIn(s)) return 1;
    if (contactState(s) === 'yes') return 2;
    if (s.walkIn) return 3;
    return 4;
  }
  function payMatches(name, email) {
    // A same-name (or same-email) match goes first, whatever its group, so a
    // sponsor typed exactly is never listed under one that only shares a word.
    return sponsors().map(function (s) { var sc = payScore(s, name, email), g = payGroup(s); return { s: s, score: sc, g: g, t: sc >= 90 ? -1 : g }; })
      .filter(function (m) { return m.score > 0; })
      .sort(function (a, b) { return (a.t - b.t) || (a.g - b.g) || (b.score - a.score) || a.s.company.localeCompare(b.s.company); })
      .slice(0, 8);
  }
  function payForm() {
    var how = $('#spp_how').value;
    return { name: $('#spp_name').value.trim(), amount: money($('#spp_amount').value), how: PAY_HOW[how] ? how : 'online',
      ref: $('#spp_ref').value.trim(), email: $('#spp_email').value.trim() };
  }
  function findPayer(e) {
    if (e) e.preventDefault();
    var f = payForm(), msg = $('#sppStatus'), esc = A().esc, box = $('#spPayMatches');
    box.innerHTML = '';
    if (!f.name) { msg.textContent = 'Type who paid.'; return; }
    if (!(f.amount > 0)) { msg.textContent = 'Type the amount they paid.'; return; }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(f.email)) { msg.textContent = 'That email doesn’t look right.'; return; }
    var list = payMatches(f.name, f.email);
    msg.textContent = list.length ? 'Pick who it’s from.' : 'Nobody on the sheet matches that name.';
    var last = null;
    box.innerHTML = '<ul class="rc-list">' + list.map(function (m) {
      var s = m.s, head = m.t !== last ? '<li class="pay-g">' + esc(m.t < 0 ? 'Same name' : PAY_GROUPS[m.g]) + '</li>' : '';
      last = m.t;
      var u = upgradeFor(s);
      var said = [u ? 'upgrade to ' + u.to + ': ' + fmtMoney(upgradeLeft(s, u)) + ' to pay' : '', s.contact, s.amountText ? 'sheet says ' + s.amountText : '', s.owner ? s.owner + '’s' : ''].filter(Boolean).join(' · ');
      return head + '<li class="rc-item"><div class="rc-who"><b>' + esc(s.company) + '</b><span>' + esc(said) + '</span></div>' +
        '<div class="rc-acts"><button class="btn small' + (m.g === 5 ? '' : ' primary') + '" type="button" data-pay="' + s.row + '">This one</button></div></li>';
    }).join('') + '<li class="rc-item"><div class="rc-who"><b>Someone new</b><span>Adds ' + esc(f.name) + ' to the sheet as a paid sponsor</span></div>' +
      '<div class="rc-acts"><button class="btn small" type="button" data-pay="new">Add new sponsor</button></div></li></ul>';
  }
  function payNote(f) {
    var d = new Date(), when = MON[d.getMonth()] + ' ' + d.getDate();
    var ref = f.ref ? (f.how === 'check' && /^\d+$/.test(f.ref) ? 'check #' + f.ref : f.ref) : '';
    return 'Paid ' + PAY_SAID[f.how] + ' ' + when + ' (' + fmtMoney(f.amount) + (ref ? ', ' + ref : '') + ')';
  }
  // First tap asks; the second marks them paid.
  function pickPayer(btn) {
    var f = payForm(), msg = $('#sppStatus');
    if (!f.name || !(f.amount > 0)) { findPayer(); return; }
    var isNew = btn.dataset.pay === 'new', s = isNew ? null : sponsors().find(function (x) { return x.row === Number(btn.dataset.pay); });
    if (!isNew && !s) { msg.textContent = 'That row moved. Find them again.'; return; }
    if (!btn.dataset.armed) {
      $$('#spPayMatches [data-armed]').forEach(function (b) { delete b.dataset.armed; b.textContent = b.dataset.pay === 'new' ? 'Add new sponsor' : 'This one'; });
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again: ' + fmtMoney(f.amount) + ' paid';
      var up = isNew ? null : upgradeFor(s), left = up ? upgradeLeft(s, up) : 0;
      msg.textContent = isNew ? 'Adds ' + f.name + ' as a new sponsor, paid ' + fmtMoney(f.amount) + ' ' + PAY_SAID[f.how] + '.'
        : up ? (f.amount >= left
            ? 'Counts ' + fmtMoney(f.amount) + ' ' + PAY_SAID[f.how] + ' toward ' + s.company + '’s upgrade to ' + up.to + ': the sheet goes to ' + fmtMoney((s.amount || 0) + f.amount) + ' and ' + up.to + '.'
            : 'Adds ' + fmtMoney(f.amount) + ' to ' + s.company + '’s total. That’s less than the ' + fmtMoney(left) + ' the upgrade needs, so it stays at ' + (s.tier || 'its level') + ' for now.')
        : s.paid && s.amount > 0
          // A second payment adds a note; it never writes over the amount already on the sheet.
          ? s.company + ' is already marked paid. Tap again to add this ' + fmtMoney(f.amount) + ' payment to its notes. The amount stays ' + s.amountText + '; change it with Edit if this adds to it.'
          : 'Marks ' + s.company + ' paid ' + fmtMoney(f.amount) + ' ' + PAY_SAID[f.how] + (s.amount && s.amount !== f.amount ? ' (the sheet said ' + fmtMoney(s.amount) + ')' : '') + '.';
      setTimeout(function () { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = isNew ? 'Add new sponsor' : 'This one'; } }, 8000);
      return;
    }
    delete btn.dataset.armed;
    var t = mainTab(), head = function (re) { var c = colOf(t, re); return c < 0 ? '' : t.headers[c]; };
    var hPaid = head(/^paid\??$/), hAmt = head(/^amount/), hNotes = head(/^notes?$/), hEmail = head(/^email/), hHow = head(/^(paid how|payment method|paid by)/);
    if (!hPaid) { msg.textContent = 'The sheet has no Paid? column.'; return; }
    $$('#spPayMatches button').forEach(function (b) { b.disabled = true; });
    msg.textContent = 'Saving…';
    var note = payNote(f);
    var step = isNew
      ? A().apiPost({ action: 'sponsorAdd', company: f.name, email: f.email, amount: String(f.amount), notes: note }).then(function (res) {
          if (!res.ok) throw new Error(res.error || 'That did not save.');
          var v = {}; v[hPaid] = 'Yes';
          if (hHow) v[hHow] = PAY_HOW[f.how];
          return A().apiPost({ action: 'sponsorEdit', row: res.row, company: f.name, values: v }).then(function (r2) {
            if (!r2.ok) throw new Error(r2.error || 'Added, but not marked paid.');
            return res.row;
          });
        })
      : (function () {
          var v = {}; v[hPaid] = 'Yes';
          if (hHow) v[hHow] = PAY_HOW[f.how];
          var up = upgradeFor(s), done = up && f.amount >= upgradeLeft(s, up);
          if (up) {
            // An upgrade's difference adds to what they already gave. The level
            // and the banner change only once the whole difference is in.
            if (hAmt) v[hAmt] = String((s.amount || 0) + f.amount);
            note += done ? ', upgrade to ' + up.to : ', toward the upgrade to ' + up.to;
            var hTier = head(new RegExp('^tier selected ' + Number(S.book.season))), hBanner = head(/^owed a banner/);
            if (done && hTier) v[hTier] = up.to;
            if (done && up.banner && hBanner && !s.owedBanner) v[hBanner] = 'TRUE';
          } else if (hAmt && !(s.paid && s.amount > 0) && f.amount !== s.amount) v[hAmt] = String(f.amount);
          if (hNotes) v[hNotes] = s.notes ? s.notes + '; ' + note : note;
          if (hEmail && f.email && !s.email) v[hEmail] = f.email;
          return A().apiPost({ action: 'sponsorEdit', row: s.row, company: s.company, values: v }).then(function (res) {
            if (!res.ok) throw new Error(res.error || 'That did not save.');
            if (!done) return s.row;
            return A().apiPost({ action: 'sponsorUpgradePaid', company: s.company }).then(function (r2) {
              if (!r2.ok) throw new Error('The payment saved, but the upgrade did not count: ' + (r2.error || 'try again.'));
              return s.row;
            });
          });
        })();
    step.then(function (row) {
      return load().then(function () {
        $('#spPayForm').reset(); $('#spPayMatches').innerHTML = '';
        msg.textContent = 'Recorded.';
        loadUpgrades();
        open(row);
        receiptAfterPaid(row);
      });
    }).catch(function (err) {
      $$('#spPayMatches button').forEach(function (b) { b.disabled = false; });
      msg.textContent = err && err.message && !/fetch|network/i.test(err.message) ? err.message : 'Could not reach the backend. Try again.';
    });
  }

  // Press and hold until the ring fills, or tap twice (the keyboard way), to
  // confirm a change. ask() names the change while it waits for the second tap.
  var HOLD_MS = 900;
  function holdable(btn, ask, run) {
    btn.classList.add('hold');
    var start = 0, raf = 0, fired = false;
    var raff = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    var caf = window.cancelAnimationFrame || clearTimeout;
    function stop() { caf(raf); start = 0; btn.classList.remove('holding'); btn.style.setProperty('--hold', '0'); }
    function disarm() { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.was; } clearTimeout(btn._t); }
    function go() { disarm(); run(); }
    function paint() {
      if (!start) return;
      var pct = Math.min(1, (Date.now() - start) / HOLD_MS);
      btn.style.setProperty('--hold', String(pct));
      if (pct >= 1) { stop(); fired = true; go(); } else raf = raff(paint);
    }
    btn.addEventListener('pointerdown', function (e) {
      if (btn.disabled || (e.button != null && e.button > 0)) return;
      fired = false; start = Date.now(); btn.classList.add('holding'); raf = raff(paint);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, function () { if (start) stop(); }); });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    btn.addEventListener('click', function () {
      if (fired) { fired = false; return; }
      if (btn.dataset.armed) return go();
      var q = ask();
      if (!q) return;
      btn.dataset.armed = '1'; btn.dataset.was = btn.textContent; btn.textContent = 'Tap again or hold: ' + q;
      clearTimeout(btn._t); btn._t = setTimeout(function () { if (btn.isConnected) disarm(); }, 6000);
    });
  }

  // A clear "done" line after a change.
  function doneNote(text) {
    var html = '<span class="sp-done">✓ ' + A().esc(text) + '</span>';
    $('#spEditStatus').innerHTML = html;
    var m = $('#spStepMsg'); if (m) m.innerHTML = html;
  }
  // A line for the card that also shows when the details are folded.
  function say(text) {
    $('#spEditStatus').textContent = text;
    var m = $('#spStepMsg'); if (m) m.textContent = text;
  }

  function canEdit() { return !!(S.book && S.book.writable && S.book.canEdit); }

  function showEditActs(s) {
    var can = canEdit();
    $('#spEditActs').classList.toggle('hidden', !can);
    $('#spPaidBtn').classList.add('hidden');   // on the card's Paid line now
    var st = contactState(s);
    $('#spContactBtn').classList.toggle('hidden', !can || st !== 'none');
    $('#spNoBtn').classList.toggle('hidden', !can || s.paid || st === 'not');
    $('#spWalkBtn').classList.toggle('hidden', !can);
    $('#spWalkBtn').textContent = s.walkIn ? 'Not walk-in only' : 'Walk-in only';
    $('#spAssign').classList.toggle('hidden', !can);
    $('#spAssignTo').value = s.owner || '';
    var owners = {};
    sponsors().forEach(function (x) { String(x.owner || '').split('/').forEach(function (n) { n = person(n); if (n && !/^(yes|no)$/i.test(n)) owners[n] = 1; }); });
    $('#spOwners').innerHTML = Object.keys(owners).sort().map(function (o) { return '<option value="' + A().esc(o) + '">'; }).join('');
    $('#spEditStatus').textContent = '';
    $('#spEditBtn').textContent = 'Edit row';
    $('#spSaveBtn').classList.add('hidden');
    $('#spEditActs').classList.remove('editing');
    S.editing = false;
  }

  function startEdit() {
    var s = S.current, t = mainTab(), esc = A().esc;
    if (!s) return;
    if (S.editing) { open(s.row); return; }
    S.editing = true;
    var fx = S.book.formulaCols || [], rules = S.book.choices || [];
    $('#spFields').innerHTML = '<div class="field-grid">' + t.headers.map(function (h, i) {
      if (!h) return '';
      var v = s.cells[i] || '', calc = fx.indexOf(i) >= 0, rule = rules[i];
      var wide = h.length > 22 || /^notes?$/i.test(h);
      if (!calc && rule && rule.check) {
        return '<label class="sp-check"><input type="checkbox" data-col="' + i + '" data-check="1"' + (ticked(v) ? ' checked' : '') + '> ' + esc(h) + '</label>';
      }
      if (!calc && rule && rule.list && rule.list.length) {
        var opts = [''].concat(rule.list);
        if (v && opts.indexOf(v) < 0) opts.push(v);
        return '<label' + (wide ? ' class="full"' : '') + '>' + esc(h) + '<select data-col="' + i + '">' +
          opts.map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + (o ? esc(o) : '(blank)') + '</option>'; }).join('') +
          '</select></label>';
      }
      return '<label' + (wide ? ' class="full"' : '') + '>' + esc(h) +
        '<input type="text" data-col="' + i + '" value="' + esc(v) + '"' + (calc ? ' disabled title="Worked out by the sheet"' : '') + '></label>';
    }).join('') + '</div><p class="hint">Row ' + s.row + '. Dropdowns and checkboxes are the sheet’s own. Grey boxes are worked out by the sheet. Hold Save changes to confirm.</p>';
    $('#spEditBtn').textContent = 'Cancel';
    $('#spSaveBtn').classList.remove('hidden');
    // While editing, only Cancel and Save show, so the one thing to do is clear.
    $('#spEditActs').classList.add('editing');
  }

  function saveRow(values, done) {
    var s = S.current;
    say('Saving…');
    return A().apiPost({ action: 'sponsorEdit', row: s.row, company: s.company, values: values }).then(function (res) {
      if (!res.ok) { say(res.error || 'That did not save.'); return; }
      say(res.message || 'Saved.');
      S.editing = false;
      return load().then(function () { if (done) done(); });
    }).catch(function () { say('Could not reach the backend. Nothing was saved. Try again.'); });
  }

  // What the open edit form would change, column by column.
  function pendingEdits() {
    var t = mainTab(), out = [];
    $$('#spFields [data-col]').forEach(function (inp) {
      if (inp.disabled) return;
      var i = Number(inp.dataset.col), was = S.current.cells[i] || '';
      if (inp.dataset.check) {
        if (inp.checked !== ticked(was)) out.push({ h: t.headers[i], to: inp.checked ? 'TRUE' : 'FALSE', said: inp.checked ? 'ticked' : 'unticked' });
        return;
      }
      if (inp.value !== was) out.push({ h: t.headers[i], from: was, to: inp.value });
    });
    return out;
  }
  function describe(list) {
    return list.map(function (c) { return c.said ? c.h + ': ' + c.said : c.h + ': ' + (c.from || 'blank') + ' → ' + (c.to || 'blank'); }).join('; ');
  }
  function askSave() {
    var list = pendingEdits();
    if (!list.length) { $('#spEditStatus').textContent = 'Nothing changed.'; return ''; }
    $('#spEditStatus').textContent = describe(list);
    return 'save ' + list.length + (list.length === 1 ? ' change' : ' changes');
  }
  function saveEdit() {
    var list = pendingEdits(), values = {};
    if (!list.length) { S.editing = false; open(S.current.row); return; }
    list.forEach(function (c) { values[c.h] = c.to; });
    var row = S.current.row, said = describe(list);
    saveRow(values, function () { open(row); doneNote('Saved. ' + said); });
  }

  // The Contacted? column: blank (or "No") means nobody has reached out yet;
  // a name or "Yes" means someone has; "Not sponsoring" means they said no,
  // which also takes them off the follow-up emails.
  function contactState(s) {
    var c = colOf(mainTab(), /^contacted/);
    var v = c < 0 ? '' : String(s.cells[c] || '').trim();
    if (/not spons|declin|^pass/i.test(v)) return 'not';
    return !v || /^no$/i.test(v) ? 'none' : 'yes';
  }

  function setColumn(re, missing, value, said, after) {
    var t = mainTab(), c = colOf(t, re), row = S.current.row;
    if (c < 0) { say(missing); return; }
    var values = {}; values[t.headers[c]] = value;
    saveRow(values, function () { open(row); doneNote(said); if (after) after(row); });
  }

  function markContacted() { setColumn(/^contacted/, 'The sheet has no Contacted? column.', 'Yes', 'Contacted. Saved to the sheet.'); }
  function markNotSponsoring() { setColumn(/^contacted/, 'The sheet has no Contacted? column.', 'Not sponsoring', 'Not sponsoring. No follow-up emails go to them.'); }
  function markPaid() { setColumn(/^paid/, 'The sheet has no Paid? column.', 'Yes', 'Paid.', receiptAfterPaid); }
  // Paid with goods or services: Paid? Yes and Paid how "In kind".
  function markInKind() {
    var t = mainTab(), pc = colOf(t, /^paid\??$/), hc = colOf(t, /^(paid how|payment method|paid by)/), row = S.current.row;
    if (pc < 0 || hc < 0) { say('The sheet needs its Paid? and Paid how columns for this.'); return; }
    var values = {}; values[t.headers[pc]] = 'Yes'; values[t.headers[hc]] = 'In kind';
    saveRow(values, function () { open(row); doneNote('Marked paid in kind.'); receiptAfterPaid(row); });
  }

  // The card's three lines: Paid, Receipt sent, Packet sent. Yes or No, Send
  // only where it's still No, Mark as sent for one done outside the app.
  function renderSteps(s) {
    var box = $('#spSteps'), esc = A().esc;
    if (!box || !s) return;
    if (!isIn(s)) {
      box.innerHTML = '<p class="hint">Not signed up for ' + esc(S.book.season) + ' yet. Their contact details are below.</p>' +
        (canEdit() ? becameBox(s) : '');
      wireBecame(s);
      $('#spMoreBox').open = true;
      return;
    }
    var st = stepsOf(s), can = canEdit(), it = st.it;
    var line = function (q, x, btns) {
      return '<li class="st-line ' + (x.done ? 'ok' : 'no') + '"><span class="st-q">' + q + '</span>' +
        '<b class="st-a"><span aria-hidden="true">' + (x.done ? '✓ ' : '✗ ') + '</span>' + esc(x.label) + '</b>' +
        (btns ? '<span class="st-acts">' + btns + '</span>' : '') + '</li>';
    };
    var b = function (k, label, main) { return '<button class="btn small' + (main ? ' primary' : '') + '" type="button" data-st="' + k + '">' + label + '</button>'; };
    var pay = can && !st.paid.done ? b('paid', 'Mark as paid', true) + b('inkind', 'Mark as in kind') : '';
    var rc = can && st.receipt.can === 'send' ? b('rcsend', 'Send receipt', true) + b('rcmark', 'Mark as sent') : '';
    var pk = can && st.packet.can === 'send' ? b('pksend', 'Send packet', true) + b('pkmark', 'Mark as sent') : '';
    box.innerHTML = '<ul class="st-list">' + line('Paid', st.paid, pay) + line('Receipt sent', st.receipt, rc) + line('Packet sent', st.packet, pk) + '</ul>' +
      (it && it.status === 'sent' ? '<p class="st-tuck"><button class="linkish" type="button" data-st="rcview">View the receipt</button></p>' : '');
  }
  // ---------- became a sponsor ----------
  // Someone not signed up yet said yes (a check in the mail, a call): pick the
  // level, then whether they've paid and how, and save, without the edit
  // screen. (Nate, Nov 24) Status and the Signed up day follow on the sheet.
  var BC_LEVELS = [['Gameday', 0, 'Gameday', 'any amount'], ['All-Star', 300, 'All-Star', '$300'], ['MVP', 500, 'MVP', '$500'], ['Championship', 750, 'Championship', '$750+']];
  var BC_PAY = [['', 'Not yet'], ['check', 'Check'], ['cash', 'Cash'], ['venmo', 'Venmo'], ['online', 'Crossbar'], ['inkind', 'In kind']];
  function bcState(s) {
    if (!S.bc || S.bc.row !== s.row) S.bc = { row: s.row, open: false, lv: '', amt: '', pay: '', ref: '' };
    return S.bc;
  }
  function becameBox(s) {
    var esc = A().esc, b = bcState(s);
    if (!b.open) return '<p class="bc-open"><button class="btn primary" type="button" data-st="bcopen">Became a sponsor</button></p>';
    var chip = function (k, v, label, sub, on) {
      return '<button type="button" class="bc-chip" data-st="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + on + '">' + esc(label) +
        (sub ? ' <span>' + esc(sub) + '</span>' : '') + '</button>';
    };
    var paid = !!b.pay;
    return '<div class="bc-form">' +
      '<p class="bc-q">Which level?</p>' +
      '<div class="bc-chips">' + BC_LEVELS.map(function (l) { return chip('bclv', l[0], l[2], l[3], b.lv === l[0]); }).join('') + '</div>' +
      (b.lv ? '<label class="bc-field">Amount<input id="spBcAmt" type="text" inputmode="decimal" autocomplete="off" placeholder="$" value="' + esc(b.amt) + '"></label>' : '') +
      '<p class="bc-q">Paid yet?</p>' +
      '<div class="bc-chips">' + BC_PAY.map(function (p) { return chip('bcpay', p[0], p[1], '', b.pay === p[0]); }).join('') + '</div>' +
      (b.pay === 'check' ? '<label class="bc-field">Check number (optional)<input id="spBcRef" type="text" inputmode="numeric" autocomplete="off" value="' + esc(b.ref) + '"></label>' : '') +
      '<p class="bc-acts"><button class="btn primary" type="button" data-st="bcsave">' + (paid ? 'Save as paid' : 'Save as signed up') + '</button>' +
      '<button class="btn" type="button" data-st="bccancel">Cancel</button></p>' +
      '<p class="hint">' + (paid ? 'Saves the level and the payment, then opens their receipt to look over. Nothing goes to them until you tap Send.'
        : 'Saves the level. They move to Said yes, not paid, and Mark as paid is here when the money comes in.') + '</p>' +
      '</div>';
  }
  function wireBecame(s) {
    var b = S.bc;
    var amt = $('#spBcAmt'); if (amt) amt.addEventListener('input', function () { b.amt = amt.value; });
    var ref = $('#spBcRef'); if (ref) ref.addEventListener('input', function () { b.ref = ref.value; });
  }
  function becameAct(btn, s) {
    var b = bcState(s), k = btn.dataset.st, msg = $('#spStepMsg');
    msg.textContent = '';
    if (k === 'bcopen') { b.open = true; renderSteps(s); return; }
    if (k === 'bccancel') { S.bc = null; renderSteps(s); return; }
    if (k === 'bclv') {
      var lv = BC_LEVELS.filter(function (l) { return l[0] === btn.dataset.v; })[0];
      var was = BC_LEVELS.filter(function (l) { return l[0] === b.lv; })[0];
      // The level's usual price fills in, unless an amount was typed by hand.
      if (!b.amt || (was && money(b.amt) === was[1])) b.amt = lv[1] ? fmtMoney(lv[1]) : '';
      b.lv = lv[0]; renderSteps(s);
      if (!b.amt) { var a = $('#spBcAmt'); if (a) a.focus(); }
      return;
    }
    if (k === 'bcpay') { b.pay = btn.dataset.v; renderSteps(s); return; }
    if (k !== 'bcsave') return;
    var amt = money(b.amt);
    if (!b.lv) { msg.textContent = 'Pick the level first.'; return; }
    if (!(amt > 0)) { msg.textContent = 'Type the amount for ' + b.lv + '.'; var a2 = $('#spBcAmt'); if (a2) a2.focus(); return; }
    if (!armed(btn, 'Tap again: ' + b.lv + ' ' + fmtMoney(amt) + (b.pay ? ', paid' : ''))) return;
    var t = mainTab(), head = function (re) { var c = colOf(t, re); return c < 0 ? '' : t.headers[c]; };
    var hTier = head(new RegExp('^tier selected ' + Number(S.book.season))), hAmt = head(/^amount/), hCon = head(/^contacted/);
    var hPaid = head(/^paid\??$/), hHow = head(/^(paid how|payment method|paid by)/), hNotes = head(/^notes?$/);
    if (!hAmt) { msg.textContent = 'The sheet has no Amount column.'; return; }
    if (b.pay && !hPaid) { msg.textContent = 'The sheet has no Paid? column.'; return; }
    var v = {};
    v[hAmt] = String(amt);
    if (hTier) v[hTier] = b.lv;
    // Signing up means they answered: Contacted stays as it is, unless it was blank or said no.
    if (hCon && contactState(s) !== 'yes') v[hCon] = 'Yes';
    if (b.pay) {
      v[hPaid] = 'Yes';
      if (hHow) v[hHow] = PAY_HOW[b.pay];
      var note = payNote({ how: b.pay, amount: amt, ref: b.pay === 'check' ? String(b.ref || '').trim() : '' });
      if (hNotes) v[hNotes] = s.notes ? s.notes + '; ' + note : note;
    }
    var row = s.row, paid = !!b.pay, said = s.company + ' signed up at ' + b.lv + ', ' + fmtMoney(amt) + (paid ? ', paid ' + PAY_SAID[b.pay] + '.' : '. Not paid yet.');
    S.bc = null;
    saveRow(v, function () { open(row); doneNote(said); if (paid) receiptAfterPaid(row); });
  }

  function stepAct(btn) {
    var s = S.current; if (!s) return;
    var k = btn.dataset.st, it = rcItemFor(s), msg = $('#spStepMsg'), pv = $('#spReceipt');
    if (/^bc/.test(k)) return becameAct(btn, s);
    if (k === 'rcsend' || k === 'rcview') { pv.innerHTML = ''; return it && showReceipt(pv, it.key, msg, { send: k === 'rcsend' && canEdit() && it.status === 'ready' }); }
    if (k === 'pksend') { pv.innerHTML = ''; return it && showThanks(pv, it.key, msg); }
    var ask = { paid: 'Tap again: ' + s.company + ' paid', inkind: 'Tap again: paid in kind', rcmark: 'Tap again: receipt already sent', pkmark: 'Tap again: packet already sent' }[k];
    if (!ask || !armed(btn, ask)) return;
    if (k === 'paid') return markPaid();
    if (k === 'inkind') return markInKind();
    if (it) markStep(k, it.key, msg);
  }

  function assignTo() {
    var who = person($('#spAssignTo').value.trim()), s = S.current;
    if (who === person(s.owner)) { $('#spEditStatus').textContent = who ? 'Already ' + who + '’s.' : 'Pick someone first.'; return; }
    setColumn(/^lybs owner/, 'The sheet has no LYBS Owner column.', who, who ? 'Assigned to ' + who + '.' : 'Nobody is assigned now.');
  }
  function askAssign() {
    var who = person($('#spAssignTo').value.trim()), s = S.current;
    if (who === person(s.owner)) { $('#spEditStatus').textContent = who ? 'Already ' + who + '’s.' : 'Type a name first.'; return ''; }
    return who ? 'give ' + s.company + ' to ' + who : 'unassign ' + s.company;
  }

  function toggleWalkIn() {
    var s = S.current, row = s.row, on = !s.walkIn;
    $('#spEditStatus').textContent = 'Saving…';
    A().apiPost({ action: 'sponsorWalkIn', row: row, company: s.company, on: on }).then(function (res) {
      if (!res.ok) { $('#spEditStatus').textContent = res.error || 'That did not save.'; return; }
      return load().then(function () { open(row); doneNote(res.message || 'Saved.'); });
    }).catch(function () { $('#spEditStatus').textContent = 'Could not reach the backend. Nothing was saved. Try again.'; });
  }

  // The printable sponsorship form for walk-ins, served to signed-in board
  // members from the league's Drive (never stored in this public site).
  function printForm() {
    var b = $('#spFormBtn'); b.disabled = true; var was = b.textContent; b.textContent = 'Opening…';
    var w = window.open('', '_blank');
    A().apiPost({ action: 'walkInForm' }).then(function (res) {
      b.disabled = false; b.textContent = was;
      if (!res.ok || !res.base64) { if (w) w.close(); $('#spEditStatus').textContent = res.error || 'The form isn’t set up yet.'; return; }
      var bin = atob(res.base64), bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([bytes], { type: res.mime || 'application/pdf' }));
      if (w) w.location = url; else window.location = url;
    }).catch(function () { b.disabled = false; b.textContent = was; if (w) w.close(); $('#spEditStatus').textContent = 'Could not reach the backend. Try again.'; });
  }

  // Who changed what on this sponsor, newest first, from the sheet's Change log tab.
  function renderChanges(s) {
    var esc = A().esc;
    var list = (S.book.changes || []).filter(function (c) { return nameKey(c.company) === s.key; });
    $('#spChanges').innerHTML = list.length ? '<ul class="sp-changes">' + list.slice(0, 30).map(function (c) {
      var who = String(c.who || '').split('@')[0];
      return '<li><span class="when">' + esc(c.at) + '</span> <b>' + esc(who) + '</b> ' +
        (c.what === 'Added' ? 'added this sponsor' : esc(c.what) + ': ' + esc(c.from || 'blank') + ' → ' + esc(c.to || 'blank')) + '</li>';
    }).join('') + '</ul>' : '<p class="hint">No changes made in the app yet.</p>';
  }

  // ---------- year over year ----------

  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dayLabel(iso) { var p = iso.split('-'); return MON[Number(p[1]) - 1] + ' ' + Number(p[2]); }
  function lastYear(iso) { return (Number(iso.slice(0, 4)) - 1) + iso.slice(4); }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

  // Last season's committed total on a date: the latest saved version on or
  // before it. Before the sheet existed it was $0; between the sheet starting
  // and its first saved version nothing is known. More than a week from the
  // nearest saved version counts as an estimate.
  function prevOn(iso) {
    var prev = S.history.prev || {}, pts = (prev.points || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (prev.sheetCreated && iso < prev.sheetCreated) return { amount: 0, note: 'before last year\'s sheet was started' };
    var hit = null;
    pts.forEach(function (p) { if (p.date <= iso) hit = p; });
    if (!hit) return null;
    return { amount: hit.committed, est: daysBetween(hit.date, iso) > 7, from: hit.date };
  }

  // Two thin lines on one dollar scale, one on top of the other: last season
  // (grey) with a tick and a date at each saved total, so you can read off
  // "last year got here by Feb 9", and this season so far (blue). Always open;
  // nothing to expand or pick.
  function yoyWaypoints(prev, fin) {
    var pts = (prev.points || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.committed - b.committed; });
    var out = [], top = 0;
    pts.forEach(function (p) {
      // A running total only goes up: a later, lower figure is left out.
      if (!(p.committed > top) || p.committed >= fin) return;
      top = p.committed;
      out.push({ amount: p.committed, date: p.date });
    });
    return out;
  }

  function renderYoY() {
    var box = $('#spYoY');
    var h = S.history;
    if (!box || !h || !S.book || S.committed == null) return;
    var prev = h.prev || {};
    var fin = prev.final ? prev.final.committed : null;
    var pts = prev.points || [];
    if (fin == null && pts.length) fin = pts.reduce(function (m, p) { return Math.max(m, p.committed); }, 0);
    if (fin == null) { box.classList.add('hidden'); return; }

    var then = prevOn(lastYear(h.today));
    var now = S.committed;
    var scale = Math.max(fin, now, 1);
    var pct = function (v) { return Math.min(100, Math.round(v / scale * 1000) / 10); };
    var thenText = then == null ? 'no record this early' : (then.est ? 'about ' : '') + fmtMoney(then.amount);
    var esc = A().esc;

    var way = yoyWaypoints(prev, fin);
    // When last year's drive hadn't started yet, say when last year reached today's total.
    var reached = way.filter(function (w) { return now > 0 && w.amount >= now; })[0];
    if ((!then || !then.amount) && reached) thenText += ' (last year got here by ' + dayLabel(reached.date) + ')';

    // Every saved total gets a tick; dates are written only where they have room.
    var GAP = 11, END = 13, kept = [], last = -100;
    way.forEach(function (w) {
      var x = pct(w.amount);
      if (x - last >= GAP && pct(fin) - x >= END) { kept.push(w); last = x; }
    });
    var ticks = way.map(function (w) { return '<i class="yoy-tick" style="left:' + pct(w.amount) + '%"></i>'; }).join('');
    var dates = kept.map(function (w) {
      return '<span class="yoy-date" style="left:' + pct(w.amount) + '%">' + esc(dayLabel(w.date)) + '</span>';
    }).join('') + '<span class="yoy-date end" style="left:' + pct(fin) + '%">Final</span>';
    var thenTick = then && then.amount > 0 ? '<i class="yoy-tick today" style="left:' + pct(then.amount) + '%" title="This date last year"></i>' : '';

    var label = prev.season + ' sponsor money ' + fmtMoney(fin) + ' by the end' +
      (way.length ? ', reaching ' + way.map(function (w) { return fmtMoney(w.amount) + ' by ' + dayLabel(w.date); }).join(', ') : '') +
      '. ' + h.season + ' so far ' + fmtMoney(now) + '.';

    box.innerHTML =
      '<div class="yoy-line"><b>' + fmtMoney(now) + '</b> committed · this time last year ' + thenText + ' · ' + esc(prev.season) + ' final ' + fmtMoney(fin) + '</div>' +
      '<div class="yoy-chart" role="img" aria-label="' + esc(label) + '">' +
        '<div class="yoy-dates" aria-hidden="true">' + dates + '</div>' +
        '<div class="yoy-lines" aria-hidden="true">' +
          '<i class="yoy-l prev" style="width:' + pct(fin) + '%"></i>' +
          '<i class="yoy-l now" style="width:' + pct(now) + '%"></i>' +
          ticks + thenTick +
        '</div>' +
        '<div class="yoy-key" aria-hidden="true"><span class="k prev">' + esc(prev.season) + '</span><span class="k now">' + esc(h.season) + ' so far</span></div>' +
      '</div>';
    box.classList.remove('hidden');
  }

  // Division and team names from the Dashboard (this season's draft, or the
  // last one before it). The doc also carries players' first names; only the
  // division and team names are kept.
  function loadTeams() {
    if (S.teams) return;
    var cfg = window.APP_CONFIG || {};
    var project = cfg.FIREBASE && cfg.FIREBASE.projectId;
    if (!project || typeof firebase === 'undefined' || !firebase.auth().currentUser) return;
    firebase.auth().currentUser.getIdToken().then(function (tok) {
      return fetch('https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(project) +
        '/databases/(default)/documents/lybs_bins/lybs-team-assignments', { headers: { Authorization: 'Bearer ' + tok } });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (doc) {
      var f = doc && doc.fields;
      var rows = (f && f.rows && f.rows.arrayValue && f.rows.arrayValue.values) || [];
      var seen = {}, out = [];
      rows.forEach(function (v) {
        var m = (v.mapValue && v.mapValue.fields) || {};
        var str = function (k) { return m[k] && m[k].stringValue ? String(m[k].stringValue).trim() : ''; };
        var t = { sport: str('sport'), division: str('division'), team: str('team') };
        var k = t.sport + '|' + t.division + '|' + t.team;
        if (t.team && !seen[k]) { seen[k] = 1; out.push(t); }
      });
      S.teams = out;
      S.teamsYear = f && f.year ? (f.year.integerValue || f.year.doubleValue || f.year.stringValue || '') : '';
      fillPickers();
    }).catch(function () { /* the pickers stay free text */ });
  }

  // ---------- list ----------

  // Under the name: the level in its own color, then short status pills.
  // The money status stays the colored badge at the card's right.
  function levelKey(t) {
    t = String(t || '').toLowerCase();
    return /champ/.test(t) ? 'champ' : /mvp/.test(t) ? 'mvp' : /all.?star/.test(t) ? 'allstar' : /game.?day/.test(t) ? 'gameday' : 'other';
  }
  function pill(text, cls) { return text ? '<span class="pill' + (cls ? ' ' + cls : '') + '">' + A().esc(text) + '</span>' : ''; }
  function cardPills(s) {
    var p = packetFor(s), w = welcomeFor(s), out = [];
    if (s.tier) out.push(pill(s.tier + (s.amountText && !s.inKind ? ' ' + s.amountText : ''), 'lv lv-' + levelKey(s.tier)));
    else if (s.tierPrev) out.push(pill('Last year: ' + s.tierPrev, 'lv-prev'));
    if (isIn(s) && s.inKind) out.push(pill('In kind', 'kind'));
    // Who reached out only matters until they're in; after that the card is
    // just the three lines (Nate, Nov 22).
    if (!isIn(s)) {
      if (String(s.contacted).trim()) out.push(pill('Contacted' + (/^(y|yes|x|true)$/i.test(String(s.contacted).trim()) ? '' : ': ' + String(s.contacted).trim()), 'done'));
      else out.push(pill('Not contacted', 'dim'));
      if (String(s.prevContact || '').trim()) out.push(pill('Reached out last year: ' + String(s.prevContact).trim(), 'dim'));
    }
    if (needsOwner(s) && !isIn(s)) out.push(pill('Needs a new owner', 'todo'));
    return out.length ? '<div class="pills">' + out.join('') + '</div>' : '';
  }
  function cardWho(s) {
    var esc = A().esc, bits = [];
    if (s.owner) bits.push('<b>Owner</b> ' + esc(s.owner));
    if (s.contact) bits.push('<b>Contact</b> ' + esc(String(s.contact).replace(/^(manager|owner)\s*:\s*/i, '')));
    return bits.length ? '<div class="sp-who">' + bits.join('<span class="sep"> · </span>') + '</div>' : '';
  }

  // The one thing to know about a sponsor, in color only when money is involved.
  function cardBadge(s) {
    var badge = A().badge;
    if (isIn(s) && s.paid) {
      // Paid: say whether the receipt went out, so who needs an email shows at a glance.
      var rc = receiptState(s);
      return rc === 'sent' ? badge('Paid, receipt sent', 'ok')
        : rc === 'ready' ? badge('Paid, needs receipt', 'warn')
        : rc === 'noEmail' ? badge('Paid, no email', 'warn')
        : badge('Paid', 'ok');
    }
    if (isIn(s)) return s.inKind ? badge('In kind', 'ok') : badge('Not paid yet', 'warn');
    if (FILTERS.lapsed(s)) return badge('Past sponsor', 'muted');
    if (!String(s.contacted).trim()) return badge('Not contacted', 'muted');
    return badge('Contacted', 'muted');
  }

  // Every count is a button that shows who's behind it.
  function stat(n, label, cls, show) {
    return '<button type="button" class="stat stat-tap' + (cls ? ' ' + cls : '') + '" data-show="' + show + '" aria-label="Show ' + A().esc(n + ' ' + label) + '"><b>' + n + '</b><span>' + label + '</span></button>';
  }
  // A count was tapped: the list filtered to them, or the box where they're worked.
  function showCount(k) {
    if (/^stage:/.test(k)) {
      S.owner = ''; S.area = ''; S.search = '';
      var sb0 = $('#spSearch'); if (sb0) sb0.value = '';
      if (S.mode) goList(); else render();
      var sec = $('#spList .sp-sec[data-stage="' + k.slice(6) + '"]');
      if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (k === 'outreach' && canEdit() && S.outreach) { goOutreachReady(); return; }
    if (k === 'outreach') k = 'notContacted';
    if (!FILTERS[k]) return;
    S.filter = k; S.owner = ''; S.area = ''; S.search = '';
    var sb = $('#spSearch'); if (sb) sb.value = '';
    if (S.mode) goList(); else render();
    var list = $('#spList'); if (list && list.scrollIntoView) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function goList() {
    var b = document.querySelector('.tab-btn[data-view="sponsors"]:not([data-sp])');
    if (b) b.click(); else if (window.Sponsors) window.Sponsors.show('');
  }
  // Not contacted: straight to Outreach, showing the ones ready to send.
  function goOutreachReady() {
    S.orFilter = { status: 'Not contacted', owner: '' };
    goSub('outreach');
    renderOutreach();
  }

  function render() {
    if (!S.book) return;
    var esc = A().esc, badge = A().badge, facts = A().facts;
    var all = sponsors();
    var inn = all.filter(isIn), cash = inn.filter(function (s) { return !s.inKind; });
    var kind = inn.filter(function (s) { return s.inKind; });
    var paid = cash.filter(function (s) { return s.paid; });
    var committed = cash.reduce(function (n, s) { return n + s.amount; }, 0);
    var paidAmt = paid.reduce(function (n, s) { return n + s.amount; }, 0);
    var kindAmt = kind.reduce(function (n, s) { return n + s.amount; }, 0);
    // How many have committed first (Nate, Nov 24: "eighteen have committed"),
    // then the dollar amounts, wider so five-digit totals fit as well as three.
    $('#spSummary').classList.toggle('k3', kind.length > 0);
    $('#spSummary').innerHTML =
      stat(inn.length, inn.length === 1 ? 'sponsor committed' : 'sponsors committed', 'money count', 'signed') +
      stat(fmtMoney(committed), 'committed', 'money', 'committed') +
      stat(fmtMoney(paidAmt), 'paid (' + paid.length + ')', 'money', 'paidCash') +
      (kind.length ? stat(fmtMoney(kindAmt), 'in kind (' + kind.length + ')', 'money', 'inKind') : '') +
      STAGES.map(function (g) {
        return stat(all.filter(function (s) { return stageOf(s) === g.k; }).length, g.t.toLowerCase(), '', 'stage:' + g.k);
      }).join('');
    $$('#spSummary [data-show]').forEach(function (b) { b.addEventListener('click', function () { showCount(b.dataset.show); }); });
    S.committed = committed;
    renderYoY();
    $('#spReportsSum').innerHTML = 'Numbers and reports <span class="hint">' + inn.length + ' sponsors · ' + fmtMoney(committed) + ' committed · ' + fmtMoney(paidAmt) + ' paid</span>';
    applyMode();
    renderQuick();
    // The packet-waiting list under Follow-ups follows the sheet; redrawn only when it changes.
    if (packetWaiting() !== S.pkLast) renderNudges();

    // The default view is this season's sponsors; name it with the season.
    var yo = $('#spFilter option[value="signed"]');
    if (yo) yo.textContent = S.book.season + ' sponsors';
    // The short list, plus the older views once "More views…" is picked
    // (or a count asks for one of them).
    var sel = $('#spFilter');
    Object.keys(FILTER_MORE).forEach(function (v) {
      var o = sel.querySelector('option[value="' + v + '"]'), want = S.moreFilters || v === S.filter;
      if (want && !o) { o = document.createElement('option'); o.value = v; o.textContent = FILTER_MORE[v]; o.dataset.more = '1'; sel.appendChild(o); }
      else if (!want && o) sel.removeChild(o);
    });
    var mv = sel.querySelector('option[value="__more"]'); if (mv) mv.hidden = !!S.moreFilters;
    sel.value = S.filter;

    // Owner picker: whoever the sheet lists, as written there.
    var owners = {};
    all.forEach(function (s) { if (s.owner) owners[s.owner] = (owners[s.owner] || 0) + 1; });
    var ownerSel = $('#spOwner');
    ownerSel.innerHTML = '<option value="">Everyone</option>' + Object.keys(owners).sort().map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === S.owner ? ' selected' : '') + '>' + esc(o) + ' (' + owners[o] + ')</option>';
    }).join('');

    // Area picker: the towns in the sponsors' addresses.
    var areas = {};
    all.forEach(function (s) { if (s.area) areas[s.area] = (areas[s.area] || 0) + 1; });
    $('#spArea').innerHTML = '<option value="">Every town</option>' + Object.keys(areas).sort().map(function (a) {
      return '<option value="' + esc(a) + '"' + (a === S.area ? ' selected' : '') + '>' + esc(a) + ' (' + areas[a] + ')</option>';
    }).join('');
    var mo = $('#spFilter option[value="mine"]');
    if (mo) { mo.hidden = !S.me; mo.textContent = 'My sponsors' + (S.me ? ' (' + all.filter(isMine).length + ')' : ''); }

    var items = all.filter(matches).sort(function (a, b) {
      return (b.amount - a.amount) || a.company.localeCompare(b.company);
    });
    var shut = S.mode === 'teams' || S.search ? {} : secShut();
    var card = function (s) {
      var logo = logoFor(s);
      var nudgeHere = S.mode !== 'teams' && canEdit() && payNudgeDue(s);
      var stg = S.mode === 'teams' || S.search ? '' : stageOf(s);
      return '<li class="banner-card season-card" role="button" tabindex="0" data-row="' + s.row + '"' +
        (stg ? ' data-stage="' + stg + '"' + (shut[stg] ? ' hidden' : '') : '') + '>' +
        (logo ? '<img class="sp-card-logo" alt="" src="data:' + logo.mime + ';base64,' + logo.base64 + '">' : '') +
        '<div class="info">' +
          '<div class="name">' + esc(s.company) + '</div>' +
          cardPills(s) +
          // Teams tab: where they go. Everywhere else: the three lines, and
          // for someone not in yet, who has them. (Nate, Nov 22)
          (S.mode === 'teams'
            ? '<div class="sub">' + esc(s.team ? 'Team: ' + s.team : 'No team yet') + '</div>'
            : isIn(s) ? stepChips(s) + (upgradeFor(s) ? facts(['Upgrade to ' + upgradeFor(s).to + ' asked, ' + fmtMoney(upgradeLeft(s, upgradeFor(s))) + ' to pay']) : '')
            : cardWho(s) + (s.walkIn ? '<div class="sub sp-walkin">Walk-in only' + (s.address ? ': ' + esc(s.address) : '') + '</div>' : '')) +
          (nudgeHere ? cardPayNudge(s) : '') +
        '</div>' +
        (isIn(s) || S.mode === 'teams' ? '' : cardBadge(s)) +
        (nudgeHere ? '<div class="sp-card-pane"><div class="rc-preview hidden"></div></div>' : '') +
      '</li>';
    };
    var html;
    if (S.mode === 'teams' || S.search) html = items.map(card).join('');
    else {
      var byStage = {};
      STAGES.forEach(function (g) {
        byStage[g.k] = items.filter(function (s) { return stageOf(s) === g.k; });
        if (g.k === 'contacted') byStage[g.k].sort(function (a, b) { return a.company.localeCompare(b.company); });
      });
      // Jump chips: one per section with its count; a tap opens it and goes there.
      html = '<li class="sp-jump" aria-label="Jump to a section">' + STAGES.map(function (g) {
        return '<button type="button" class="sp-jump-chip" data-jump="' + g.k + '">' + esc(g.s) + ' <span class="sp-sec-n">' + byStage[g.k].length + '</span></button>';
      }).join('') + '</li>' +
      STAGES.map(function (g) {
        var rows = byStage[g.k], isShut = !!shut[g.k];
        return '<li class="sp-sec' + (isShut ? ' shut' : '') + '" data-stage="' + g.k + '" id="spSec-' + g.k + '">' +
          '<h3><button type="button" class="sp-sec-btn" aria-expanded="' + (!isShut) + '" data-sec="' + g.k + '">' +
            '<span class="sp-sec-chev" aria-hidden="true">▾</span>' + esc(g.t) + ' <span class="sp-sec-n">' + rows.length + '</span></button></h3>' +
          '<p class="hint">' + esc(rows.length ? g.h : 'Nobody here right now.') + '</p></li>' + rows.map(card).join('');
      }).join('');
    }
    $('#spList').innerHTML = html || '<p class="hint">' + (all.length ? 'No sponsors match that.' : 'The sheet has no sponsors on it yet.') + '</p>';

    $$('#spList .sp-sec-btn').forEach(function (b) {
      b.addEventListener('click', function () { showSec(b.dataset.sec, b.getAttribute('aria-expanded') !== 'true'); });
    });
    $$('#spList .sp-jump-chip').forEach(function (b) {
      b.addEventListener('click', function () {
        showSec(b.dataset.jump, true);
        var sec = document.getElementById('spSec-' + b.dataset.jump);
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Opening the notes stays on the card.
    $$('#spList .sp-more').forEach(function (d) {
      ['click', 'keydown'].forEach(function (ev) { d.addEventListener(ev, function (e) { e.stopPropagation(); }); });
    });
    $$('#spList .sp-card-rc').forEach(function (box) {
      // The receipt button and its preview stay on the card: no detail opens.
      ['click', 'keydown'].forEach(function (ev) { box.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      var btn = box.querySelector('button[data-card-rc]');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var key = btn.dataset.cardRc, item = receiptItem(key);
        // The preview opens full width under the card's own details.
        showReceipt(rowPreview(box.closest('.season-card').querySelector('.sp-card-pane')), key, box.querySelector('.rc-msg'), { send: canEdit() && item && item.status === 'ready' });
      });
    });
    $$('#spList .sp-card-nudge').forEach(function (box) {
      // The reminder and its preview stay on the card: no detail opens.
      var pane = box.closest('.season-card').querySelector('.sp-card-pane');
      [box, pane].forEach(function (el) {
        if (el) ['click', 'keydown'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      });
      var btn = box.querySelector('button[data-card-nudge]');
      if (btn && pane) btn.addEventListener('click', function () { showPayNudge(rowPreview(pane), Number(btn.dataset.cardNudge), box.querySelector('.rc-msg')); });
    });
    $$('#spList .season-card').forEach(function (card) {
      card.addEventListener('click', function () { open(Number(card.dataset.row)); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(Number(card.dataset.row)); }
      });
    });

    var read = S.book.readAt ? new Date(S.book.readAt) : null;
    $('#spSource').innerHTML = 'From "' + esc(S.book.sheetName) + '"' +
      (read ? ', read ' + esc(read.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '') +
      (S.book.sheetUrl && /^https:\/\/docs\.google\.com\//.test(S.book.sheetUrl)
        ? ' · <a href="' + esc(S.book.sheetUrl) + '" target="_blank" rel="noopener">Open the sheet</a>' : '');

    renderOtherTabs();
  }

  // The sheet's other tabs (website form log, jerseys, plaques), as they are.
  function renderOtherTabs() {
    var esc = A().esc;
    var tabs = S.book.tabs.slice(1).filter(function (t) { return t.headers.length; });
    $('#spOther').innerHTML = tabs.map(function (t) {
      var body = t.rows.length ? t.rows.map(function (r) {
        return '<div class="sp-rec">' + t.headers.map(function (h, i) {
          return r.cells[i] ? '<p class="ss-row"><span>' + esc(h) + '</span>' + esc(r.cells[i]) + '</p>' : '';
        }).join('') + '</div>';
      }).join('') : '<p class="hint">Nothing on this tab yet.</p>';
      return '<details class="sp-tab"><summary>' + esc(t.name) + ' (' + t.rows.length + ')</summary>' + body + '</details>';
    }).join('');
  }

  // ---------- detail ----------

  function linkify(header, value) {
    var esc = A().esc;
    var h = norm(header);
    if (/^email/.test(h) || /@/.test(value)) {
      return esc(value).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, function (m) {
        return '<a href="mailto:' + m + '">' + m + '</a>';
      });
    }
    if (/^address/.test(h) && /\d|,/.test(value)) {
      return '<a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(value) + '" target="_blank" rel="noopener">' + esc(value) + '</a>';
    }
    if (/^phone/.test(h)) {
      var digits = value.replace(/[^0-9+]/g, '');
      if (digits.length >= 10 && digits.length <= 12) return '<a href="tel:' + digits + '">' + esc(value) + '</a>';
    }
    return esc(value);
  }

  function open(row) {
    var s = sponsors().find(function (x) { return x.row === row; });
    if (!s) return;
    S.current = s;
    // Opened from Teams: where they go (team, banner). Anywhere else: getting
    // them in (the three lines). Never both. (Nate, Nov 22) The logo shows
    // in both, so it can be added from the main list too. (Nate, Nov 23)
    var teamsView = S.mode === 'teams';
    $('#sponsorSheet').classList.toggle('mode-teams', teamsView);
    $('#sponsorSheet').classList.toggle('mode-intake', !teamsView);
    $('#spMoreBox').open = false;
    $('#spStepMsg').textContent = '';
    renderSteps(s);
    var esc = A().esc, t = mainTab();
    $('#spTitle').textContent = s.company;
    A().setBadge($('#spBadge'), s.tier || (s.tierPrev ? 'Last year: ' + s.tierPrev : ''), 'muted');
    // The few facts the board looks for first, then every column on the
    // sheet, exactly as the sheet has it, one tap away.
    var season = Number(S.book.season), key = [], rest = [];
    var KEY = [/^contact$/, /^email/, /^phone/, /^address/, /^lybs owner/, /^contacted/, new RegExp('^tier selected ' + season),
      /^amount/, /^paid$/, /^(paid how|payment method|paid by)/, /^(associated team|team)$/, /^notes?$/];
    t.headers.forEach(function (h, i) {
      var v = s.cells[i] || '';
      if (!h || !v || /^false$/i.test(v)) return;
      var k = -1;
      KEY.forEach(function (re, n) { if (k < 0 && re.test(norm(h))) k = n; });
      (k >= 0 ? key : rest).push({ h: h, v: v, i: i, k: k });
    });
    key.sort(function (a, b) { return a.k - b.k; });
    var fact = function (f) { return '<div class="sp-fact' + (/^notes?$/i.test(f.h) || f.v.length > 60 ? ' full' : '') + '"><dt>' + esc(f.h) + '</dt><dd>' + linkify(f.h, f.v) + '</dd></div>'; };
    $('#spFields').innerHTML = inKindLinkBox(s) + renderPacketDetail(s) + (key.length ? '<dl class="sp-facts">' + key.map(fact).join('') + '</dl>' : '') +
      '<details class="sp-all"><summary>Everything on the sheet (' + (key.length + rest.length) + ')</summary>' +
      (rest.length ? '<dl class="sp-facts">' + rest.map(fact).join('') + '</dl>' : '') +
      '<p class="hint">Row ' + s.row + ' on the sheet.' + (S.book.writable ? '' : ' Changes to these go on the sheet itself.') + '</p></details>';
    loadPacketLogo();
    var lb = $('#spFields [data-pklink]'); if (lb) lb.addEventListener('click', function () { getPacketLink(s, lb); });
    renderMarks(s, []);
    renderBanner(s);
    showEditActs(s);
    $('#spReceipt').classList.add('hidden'); $('#spReceipt').innerHTML = '';
    if (!isIn(s)) $('#spMoreBox').open = true;
    var mapUrl = s.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.address) : '';
    $('#spWalkIn').classList.toggle('hidden', !s.walkIn);
    $('#spWalkIn').innerHTML = s.walkIn ? '<b>Walk-in only.</b> Stop by in person with the printed form; they mail it back with a check or money order.' +
      (s.address ? ' <a href="' + esc(mapUrl) + '" target="_blank" rel="noopener">' + esc(s.address) + '</a>' : ' No address on the sheet yet.') : '';
    $('#spFormBtn').classList.toggle('hidden', !s.walkIn);
    renderChanges(s);

    var p = s.pick || {};
    $('#sp_division').value = p.division || '';
    $('#sp_team').value = p.team || (hasTeam(s.pick) || p.note ? '' : s.sheetTeam);
    $('#sp_note').value = p.note || '';
    $('#spTeamHint').textContent = hasTeam(s.pick) || p.note
      ? 'Set here' + (p.updatedAt ? ' on ' + p.updatedAt : '') + '. The Dashboard’s Uniforms and Jersey Order pages see it too.'
      : (s.sheetTeam ? 'From the sheet’s team column. Save to set it here.' : 'Not lined up with a team yet.');
    fillPickers();
    $('#spSaveStatus').textContent = '';
    loadLogo(s);
    $('#detailScrim').classList.remove('hidden');
    $('#sponsorSheet').classList.remove('hidden');
    if (!S.entry) { history.pushState({ sponsorSheet: true }, ''); S.entry = true; }
  }

  // Returning sponsor, new this season, and whether a banner is on file.
  function returning(s) { return !!(s.past || String(s.tierPrev || '').trim()); }
  function renderMarks(s, banners) {
    var badge = A().badge, prev = Number(S.book && S.book.season) - 1, bits = [];
    if (returning(s)) bits.push(badge('Returning sponsor', 'ok') + '<span>' + (s.tierPrev ? A().esc('Sponsored in ' + prev + ' at ' + s.tierPrev) : 'Sponsored before') + '</span>');
    else if (isIn(s)) bits.push(badge('New sponsor', 'muted'));
    if (banners.length) bits.push(badge(banners.length > 1 ? banners.length + ' banners on file' : 'Banner on file', 'muted'));
    $('#spMarks').innerHTML = bits.map(function (b) { return '<span class="sp-mark">' + b + '</span>'; }).join('');
  }
  function bannersFor(s) {
    return (A().banners() || []).filter(function (b) { return nameKey(b.sponsorName) === s.key; });
  }
  // The banner photos on file for this sponsor, small, so the board can see
  // whether the banner is current. Photos load through the signed-in backend.
  function renderBanner(s) {
    var box = $('#spBanner'), esc = A().esc;
    box.innerHTML = '<p class="hint">Looking for a banner…</p>';
    A().whenBannersLoaded().then(function () {
      if (S.current !== s) return;
      var list = bannersFor(s);
      renderMarks(s, list);
      if (!list.length) {
        box.innerHTML = '<p class="hint">No banner on file' + (s.owedBanner ? '. The sheet says they’re owed one.' : '.') + '</p>';
        return;
      }
      box.innerHTML = list.slice(0, 4).map(function (b) {
        var when = /^\d{4}-\d{2}-\d{2}/.test(String(b.updatedAt || '')) ? 'Updated ' + fmtDay(String(b.updatedAt).slice(0, 10)) + ', ' + String(b.updatedAt).slice(0, 4) : '';
        return '<div class="sp-bn" data-file="' + esc(b.driveFileId || '') + '">' +
          '<button class="sp-bn-thumb" type="button" aria-label="See the banner photo larger"><span class="sp-bn-ph"></span></button>' +
          '<div class="sp-bn-info"><b>' + esc(b.tier ? b.tier + ' banner' : 'Banner') + '</b>' +
          A().facts([b.hung ? 'Hung' : 'Not hung', b.condition, when]) + '</div>' +
          '<img class="sp-bn-big hidden" alt="Banner photo"></div>';
      }).join('') + (list.length > 4 ? '<p class="hint">' + (list.length - 4) + ' more in Banner stock.</p>' : '') +
        '<p class="hint">Check the photo matches their current name and logo.</p>';
      box.querySelectorAll('.sp-bn').forEach(function (el) {
        var id = el.dataset.file;
        if (!id) return;
        A().image(id, 'thumb').then(function (uri) {
          if (!uri || S.current !== s) return;
          var img = document.createElement('img'); img.src = uri; img.alt = '';
          var ph = el.querySelector('.sp-bn-ph'); if (ph) ph.replaceWith(img);
        });
        el.querySelector('.sp-bn-thumb').addEventListener('click', function () {
          var big = el.querySelector('.sp-bn-big');
          if (!big.classList.contains('hidden')) { big.classList.add('hidden'); return; }
          big.classList.remove('hidden');
          if (big.getAttribute('src')) return;
          A().image(id, 'full').then(function (uri) { if (uri) big.src = uri; else big.classList.add('hidden'); });
        });
      });
    }).catch(function () { if (S.current === s) box.innerHTML = '<p class="hint">Could not load the banners right now.</p>'; });
  }

  function fillPickers() {
    if (!S.teams) return;
    var esc = A().esc;
    var label = function (t) { return [t.sport, t.division].filter(Boolean).join(' '); };
    var divs = {};
    S.teams.forEach(function (t) { divs[label(t)] = 1; });
    $('#spDivisions').innerHTML = Object.keys(divs).sort().map(function (d) { return '<option value="' + esc(d) + '">'; }).join('');
    var d = String(($('#sp_division') || {}).value || '').trim().toLowerCase();
    var names = {};
    S.teams.forEach(function (t) { if (!d || label(t).toLowerCase() === d) names[t.team] = 1; });
    $('#spTeams').innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    $('#spTeamsFrom').textContent = S.teams.length
      ? 'Suggestions are the Dashboard’s ' + (S.teamsYear || 'latest') + ' teams. Type any name for a team not drafted yet.' : '';
  }

  function hide() {
    $('#sponsorSheet').classList.add('hidden');
    if ($('#detailSheet').classList.contains('hidden') && $('#seasonSheet').classList.contains('hidden')) $('#detailScrim').classList.add('hidden');
    S.current = null;
  }

  function close() {
    hide();
    if (S.entry) { S.entry = false; S.skipPop = true; history.back(); }
  }

  function saveTeam() {
    var s = S.current;
    if (!s) return;
    var payload = { action: 'sponsorTeamSave', company: s.company,
      division: $('#sp_division').value.trim(), team: $('#sp_team').value.trim(), note: $('#sp_note').value.trim() };
    $('#spSaveStatus').textContent = 'Saving…';
    return A().apiPost(payload).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Save failed.');
      $('#spSaveStatus').textContent = res.message || 'Saved.';
      // Show it right away; the next Refresh reads it back from the backend.
      var old = (S.book.teams || []).filter(function (p) { return p.key === s.key; })[0] || {};
      S.book.teams = (S.book.teams || []).filter(function (p) { return p.key !== s.key; });
      if (payload.division || payload.team || payload.note || old.imageFileId) {
        S.book.teams.push({ key: s.key, company: s.company, division: payload.division, team: payload.team,
                            note: payload.note, imageFileId: old.imageFileId,
                            updatedAt: new Date().toISOString().slice(0, 10) });
      }
      render();
      setTimeout(close, 300);
    }).catch(function (err) {
      A().noteProblem('Sponsor team save failed', err);
      $('#spSaveStatus').textContent = A().sendErrorText(err, "Couldn't save. Check your signal, then tap Save again.");
    });
  }

  // A pick can hold only a logo; then the sheet's own team still counts.
  function hasTeam(p) { return !!(p && (p.division || p.team)); }

  // ---------- team page logo ----------
  //
  // The logo Ballclub shows as "Sponsored by" on the team's page. One the
  // board sets here wins; otherwise a PNG/JPG logo the sponsor sent through
  // their reply form, else the one in the league's Sponsor Logos folder whose
  // name matches. All stay in Drive, read through the backend.

  function showLogo(img, from) {
    var el = $('#spLogo');
    if (img && img.base64) {
      el.src = 'data:' + img.mime + ';base64,' + img.base64;
      el.classList.remove('hidden');
    } else {
      el.removeAttribute('src');
      el.classList.add('hidden');
    }
    $('#spLogoFrom').textContent = from === 'set' ? 'Set here.'
      : from === 'form' ? 'From the logo they sent with their reply form. Choose one to use a different one.'
      : from === 'library' ? "From the league's Sponsor Logos folder in Drive. Choose one to use a different one."
      : 'No logo yet. The team page shows just the name until one is set.';
    $('#spLogoRemove').classList.toggle('hidden', from !== 'set');
  }

  function loadLogo(s) {
    showLogo(null, '');
    $('#spLogoFrom').textContent = 'Loading logo…';
    $('#spLogoStatus').textContent = '';
    A().apiPost({ action: 'sponsorTeamLogo', company: s.company, get: true }).then(function (res) {
      if (S.current !== s) return;
      if (!res.ok) throw A().backendError(res.error || 'Could not load the logo.');
      showLogo(res.image, res.source);
    }).catch(function (err) {
      if (S.current !== s) return;
      $('#spLogoFrom').textContent = 'Could not load the logo.';
      A().noteProblem('Sponsor logo load failed', err);
    });
  }

  function saveLogo(photo) {
    var s = S.current;
    if (!s) return;
    $('#spLogoStatus').textContent = photo ? 'Saving…' : 'Removing…';
    return A().apiPost({ action: 'sponsorTeamLogo', company: s.company, photo: photo || '' }).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Save failed.');
      $('#spLogoStatus').textContent = res.message || 'Saved.';
      if (S.current === s) loadLogo(s);
      loadLogos();   // the card shows the new logo too
      setTimeout(function () { $('#spLogoStatus').textContent = res.message || 'Saved.'; }, 50);
    }).catch(function (err) {
      A().noteProblem('Sponsor logo save failed', err);
      $('#spLogoStatus').textContent = A().sendErrorText(err, "Couldn't save. Check your signal, then try again.");
    });
  }

  function pickLogo(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { $('#spLogoStatus').textContent = 'That logo is larger than 5 MB.'; return; }
    var reader = new FileReader();
    reader.onload = function () { saveLogo(String(reader.result)); };
    reader.onerror = function () { $('#spLogoStatus').textContent = 'Could not read that file.'; };
    reader.readAsDataURL(file);
  }

  // ---------- wire up ----------

  function wire() {
    // The short Show list; the older views come back when a count asks for one.
    var more = $('#spFilterMore');
    if (more && more.content) Array.prototype.forEach.call(more.content.querySelectorAll('option'), function (o) { FILTER_MORE[o.value] = o.textContent; });
    $('#spFilter').addEventListener('change', function (e) {
      if (e.target.value === '__more') { S.moreFilters = true; e.target.value = S.filter; render(); return; }
      S.filter = e.target.value; render();
    });
    $('#spSteps').addEventListener('click', function (e) { var b = e.target.closest('button[data-st]'); if (b) stepAct(b); });
    $('#spSearch').addEventListener('input', function (e) { S.search = e.target.value; render(); });
    $('#spOwner').addEventListener('change', function (e) { S.owner = e.target.value; render(); });
    $('#spRefresh').addEventListener('click', function () { load(true); });
    $('#spQuick').addEventListener('click', function (e) {
      var q = e.target.closest('[data-q]'); if (q) { quickTap(q.dataset.q); return; }
      var a = e.target.closest('[data-qa]'); if (a) quickAct(a);
    });
    keepReportsState();
    $('#spAddForm').addEventListener('submit', addContact);
    $('#spa_tier').addEventListener('change', addLevelPicked);
    $('#spaFill').addEventListener('click', fillFromForm);
    $('#spAddForm').addEventListener('reset', function () { setTimeout(addLevelPicked, 0); });
    $('#spPayForm').addEventListener('submit', findPayer);
    $('#spPayMatches').addEventListener('click', function (e) { var b = e.target.closest('button[data-pay]'); if (b) pickPayer(b); });
    $('#spEditBtn').addEventListener('click', startEdit);
    holdable($('#spSaveBtn'), askSave, saveEdit);
    holdable($('#spPaidBtn'), function () { return 'mark ' + S.current.company + ' paid'; }, markPaid);
    holdable($('#spContactBtn'), function () { return 'mark ' + S.current.company + ' contacted'; }, markContacted);
    holdable($('#spNoBtn'), function () { return S.current.company + ' is not sponsoring'; }, markNotSponsoring);
    holdable($('#spAssignBtn'), askAssign, assignTo);
    $('#spWalkBtn').addEventListener('click', toggleWalkIn);
    $('#spFormBtn').addEventListener('click', printForm);
    $('#spArea').addEventListener('change', function (e) { S.area = e.target.value; render(); });
    $('#spReceipts').addEventListener('click', function (e) { var b = e.target.closest('button[data-rc]'); if (b) receiptAct(b); });
    $('#spNudges').addEventListener('click', function (e) { var b = e.target.closest('button[data-nd]'); if (b) nudgeAct(b); });
    $('#spOutreach').addEventListener('click', function (e) { var b = e.target.closest('button[data-or]'); if (b) outreachAct(b); });
    $('#spOutreach').addEventListener('change', outreachChange);
    $('#spWelcome').addEventListener('click', function (e) { var b = e.target.closest('button[data-wl]'); if (b) welcomeAct(b); });
    $('#spWelcome').addEventListener('change', function (e) {
      var t = e.target; if (!t.matches('select[data-wl]')) return;
      S.wlLast = '';
      if (t.dataset.wl === 'sender') S.wlSender = t.value; else S.wlFilter = t.value;
      renderWelcome();
    });
    $('#spClose').addEventListener('click', close);
    $('#detailScrim').addEventListener('click', function () { if (S.current) close(); });
    $('#spSave').addEventListener('click', saveTeam);
    $('#spLogoFile').addEventListener('change', pickLogo);
    $('#spLogoRemove').addEventListener('click', function () { saveLogo(''); });
    $('#sp_division').addEventListener('input', fillPickers);
    window.addEventListener('popstate', function () {
      if (S.skipPop) { S.skipPop = false; return; }
      if (S.entry) { S.entry = false; hide(); }
    });
  }

  // ---------- outreach ----------
  // The first "would you sponsor us?" email, to businesses nobody has reached
  // yet. Pick who it's from, tick up to the batch limit, preview any of them
  // (To and the greeting side by side), and send on a second tap. Every
  // sponsor gets its own email with only their address in To. Rows the
  // server holds can't be ticked; rows that need a look start unticked.

  function loadOutreach() {
    if (S.book && !canEdit()) { var b = $('#spOutreach'); if (b) b.classList.add('hidden'); return; }
    side({ action: 'outreachList' }, function (res) {
      if (!res || !res.ok || !canEdit()) return;
      var keep = S.outreach ? S.outreach.picked : {};
      S.outreach = res; S.outreach.picked = keep || {};
      renderOutreach();
    }).catch(function () { /* the box stays hidden */ });
  }

  function markSentBack() {
    var h = SENT_BACK; SENT_BACK = '';
    A().apiPost({ action: 'allowSent', sent: h }).then(function (r) {
      var t = r.ok ? '✓ ' + (r.message || 'Marked as sent.') : (r.error || 'That send could not be marked. Tap I sent it on the row.');
      S.orLast = '<span class="' + (r.ok ? 'sp-done' : 'or-flag hold') + '">' + A().esc(t) + '</span>';
      S.wlLast = r.ok ? r.message : '';
      S.orOpen = {}; S.wlOpen = {};
      loadOutreach(); loadWelcome();
    }).catch(function () { S.orLast = 'Could not reach the backend to mark it. Tap I sent it on the row.'; loadOutreach(); });
  }

  function orKey(i) { return i.row + '|' + i.company; }
  // Not contacted, has an email, nothing holding it, not sent: ready to go.
  var OR_READY = '__ready';
  function orReady(i) { return i.status === 'Not contacted' && !!i.email && !i.hold.length && !i.sent && !i.review; }
  // Which group a row sits in (Nate, Nov 22): ready ones on top as the next
  // batch, then ones that need a look, then what's already gone; anything that
  // can't be sent goes to Needs attention at the end, and businesses set aside
  // go to For review at the very bottom.
  function orGroup(i) {
    if (i.sent) return 'sent';
    if (i.review) return 'review';
    if (!i.email || i.hold.length) return 'attn';
    if (i.look.length) return 'look';
    return 'ready';
  }
  function orShown() {
    var O = S.outreach, f = S.orFilter || { status: 'Not contacted', owner: '' };
    return O.items.filter(function (i) {
      if (f.status === OR_READY) { if (!orReady(i)) return false; }
      else if (f.status && i.status !== f.status && !i.review) return false;
      if (f.owner === '-') return !i.owner;
      if (f.owner && i.owner !== f.owner) return false;
      return true;
    });
  }
  function orPicked() {
    var O = S.outreach;
    return O.items.filter(function (i) { return O.picked[orKey(i)] && !i.hold.length && !i.sent && !i.review && !!i.email; });
  }
  function orSender() {
    var O = S.outreach, ok = O.senders.filter(function (x) { return x.ok; });
    var cur = O.senders.filter(function (x) { return x.id === S.orSender && x.ok; })[0];
    return cur || ok[0] || null;
  }

  function orRow(i, oneByOne) {
    var O = S.outreach, esc = A().esc, k = orKey(i), g = orGroup(i);
    var can = g === 'ready' || g === 'look', on = can && !!O.picked[orKey(i)];
    var tuck = [];
    if (!i.sent) tuck.push(i.review ? '<button class="linkish" type="button" data-or="unreview">Back to outreach</button>'
                                    : '<button class="linkish" type="button" data-or="review">Set aside for review</button>');
    return '<li class="or-item" data-k="' + esc(k) + '"><div class="or-row">' +
      (oneByOne ? '' : can ? '<input type="checkbox" aria-label="Send to ' + esc(i.company) + '"' + (on ? ' checked' : '') + '>' : '') +
      '<div class="or-main"><b>' + esc(i.company) + '</b>' +
      '<div class="or-to">' + (i.email ? 'To ' + esc(i.email) : 'No email') + ' · Hi ' + esc(i.greet) + ',' + (i.past === 'last' ? ' · sponsored last season' : i.past ? ' · past sponsor' : '') + (i.owner ? ' · ' + esc(i.owner) : '') + '</div>' +
      (i.sent ? '<p class="or-flag">Emailed ' + esc(fmtDay(i.sent.at)) + '.</p>' : '') +
      (g === 'review' ? '' : i.hold.map(function (t) { return '<p class="or-flag hold">' + esc(t) + '</p>'; }).join('')) +
      (g === 'look' || g === 'review' ? i.look.map(function (t) { return '<p class="or-flag look">Look: ' + esc(t) + '</p>'; }).join('') : '') +
      '</div>' + (can ? '<button class="btn small" type="button" data-or="preview">Preview</button>' : '') +
      '</div>' + (oneByOne && can && O.linksOk ? '<div class="rc-acts">' + (S.orOpen && S.orOpen[k]
        ? '<button class="btn small primary" type="button" data-or="done">I sent it</button>' + (S.orOpen[k].allow ? '' : gmailLinks(S.orOpen[k]))
        : oneByOne === 'allow' ? '<button class="btn small primary" type="button" data-or="allow">' + (i.look.length ? 'Looked, send from my Gmail' : 'Send from my Gmail') + '</button>'
        : '<button class="btn small primary" type="button" data-or="open">' + (i.look.length ? 'Looked, open in Gmail' : 'Open in Gmail') + '</button>') + '</div>' : '') +
      '<div class="or-tuck">' + tuck.join('') + '</div>' +
      '<div class="rc-preview hidden"></div></li>';
  }
  function orGroups(shown, oneByOne, lim) {
    var O = S.outreach, by = { ready: [], look: [], sent: [], attn: [], review: [] };
    shown.forEach(function (i) { by[orGroup(i)].push(i); });
    var list = function (rows) { return '<ul class="or-list">' + rows.map(function (i) { return orRow(i, oneByOne); }).join('') + '</ul>'; };
    var box = function (key, title, hint, rows, open) {
      if (!rows.length) return '';
      return '<details class="rc-box or-grp or-' + key + '"' + (open ? ' open' : '') + '><summary><b>' + title + ' (' + rows.length + ')</b></summary>' +
        (hint ? '<p class="hint">' + hint + '</p>' : '') + list(rows) + '</details>';
    };
    var n = orPicked().length;
    var out = '<section class="or-grp or-ready"><h4>Ready to send (' + by.ready.length + ')</h4>' +
      (by.ready.length
        ? (oneByOne ? '' : '<p class="hint">The next batch of ' + lim + ' is ticked. Send it, and the next batch comes up ticked.</p>' +
            '<div class="or-foot"><button class="btn primary" type="button" data-or="send"></button><span class="hint or-count"></span>' +
            (n ? '<button class="linkish" type="button" data-or="clear">Untick all</button>' : '<button class="linkish" type="button" data-or="pick">Tick the next ' + lim + '</button>') + '</div>') +
          list(by.ready)
        : '<p class="hint">Nothing is ready to send right now.</p>') + '</section>';
    out += box('look', 'Needs a look first', 'Preview each one and tick it if it looks right. It goes with the next batch.', by.look, false);
    out += box('sent', 'Already emailed', '', by.sent, false);
    out += box('attn', 'Needs attention, can’t be sent', 'These have no email address or something on the sheet stops them. Fix the sheet and they move up.', by.attn, false);
    out += box('review', 'For review', 'Set aside. Nothing goes to these until you put them back.', by.review, true);
    return out;
  }

  function renderOutreach() {
    var box = $('#spOutreach'), esc = A().esc, O = S.outreach;
    if (!box) return;
    if (!O || !canEdit()) { box.classList.add('hidden'); syncSpTabs(); return; }
    box.classList.remove('hidden');
    var f = S.orFilter || (S.orFilter = { status: 'Not contacted', owner: '' });
    var notYet = O.items.filter(function (i) { return i.status === 'Not contacted' && !i.sent; });
    var noMail = notYet.filter(function (i) { return !i.email; }).length;
    var statuses = [], owners = [];
    O.items.forEach(function (i) {
      if (statuses.indexOf(i.status) < 0) statuses.push(i.status);
      if (i.owner && owners.indexOf(i.owner) < 0) owners.push(i.owner);
    });
    owners.sort();
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    var sender = orSender(), compose = !!(sender && sender.how === 'compose'), allow = !!(sender && sender.how === 'allow');
    var oneByOne = allow ? 'allow' : compose ? 'compose' : '';
    var shown = orShown();
    var lim = Math.min(O.batchMax, O.dayLeft);
    // The next batch comes ticked, so sending is Send and Tap again.
    if (!oneByOne && !S.orUnpicked && !orPicked().length) {
      shown.filter(function (i) { return orGroup(i) === 'ready'; }).slice(0, lim).forEach(function (i) { O.picked[orKey(i)] = 1; });
    }
    var nReady = shown.filter(function (i) { return orGroup(i) === 'ready'; }).length;
    var html = '<h3>Outreach · ' + nReady + ' ready to send' + (noMail ? ' · ' + noMail + ' with no email' : '') + '</h3>' +
      (allow
        ? '<p class="hint">Each email goes from your own Gmail, signed by you. The first time, Google asks you to Allow it once (only "send email as you"). Tap Send on a row, then Back to the app on the page that opens. Your emails link to the levels on the league site.</p>'
        : compose
        ? '<p class="hint">Each email opens filled in, in your own Gmail, so it comes from you and is signed by you. Press Send there, then tap I sent it here so the sheet shows Contacted. Your emails link to the levels on the league site.</p>'
        : '<p class="hint">Each business gets its own email with only its address in To. Nothing goes out until you tap Send twice. ' +
          'Sent rows are marked Contacted on the sheet.' + (O.packet ? ' The packet PDF is attached.' : ' The packet isn’t attached; the email links to the levels on the league site.') + '</p>') +
      (O.linksOk ? '' : '<p class="or-flag hold">The sponsor page and sign-up links aren’t set, so nothing can go out.</p>') +
      '<div class="or-top">' +
        '<label>From <select data-or="sender">' + O.senders.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (sender && x.id === sender.id ? ' selected' : '') + (x.ok ? '' : ' disabled') + '>' + esc(x.label) + (x.ok ? '' : ' (not set up)') + '</option>';
        }).join('') + '</select></label>' +
        '<label>Status <select data-or="status">' + opt('', 'Any', f.status) + statuses.map(function (s) { return opt(s, s, f.status); }).join('') + '</select></label>' +
        '<label>Owner <select data-or="owner">' + opt('', 'Anyone', f.owner) + opt('-', 'No owner', f.owner) + owners.map(function (s) { return opt(s, s, f.owner); }).join('') + '</select></label>' +
      '</div>' +
      (sender ? '' : '<p class="or-flag hold">' + esc(O.senders.map(function (x) { return x.why; }).filter(Boolean).join(' ')) + '</p>') +
      orGroups(shown, oneByOne, lim) +
      '<div class="rc-msg or-msg" role="status">' + (S.orLast || '') + '</div>';
    box.innerHTML = html;
    orFoot();
    syncSpTabs();
  }
  function orFoot() {
    var O = S.outreach, n = orPicked().length, btn = $('#spOutreach [data-or="send"]');
    if (!btn) return;
    delete btn.dataset.armed;
    btn.disabled = !(n && orSender() && O.linksOk);
    btn.textContent = 'Send ' + n + ' separate email' + (n === 1 ? '' : 's');
    $('#spOutreach .or-count').textContent = n + ' ticked · up to ' + O.batchMax + ' at a time · ' + O.dayLeft + ' left today';
  }

  function outreachChange(e) {
    var t = e.target, O = S.outreach;
    if (t.matches('select[data-or]')) {
      var k = t.dataset.or;
      S.orLast = '';
      if (k === 'sender') S.orSender = t.value;
      else S.orFilter[k] = t.value;
      renderOutreach();
      return;
    }
    if (t.matches('.or-item input[type=checkbox]')) {
      var li = t.closest('.or-item'), key = li.dataset.k;
      if (t.checked && orPicked().length >= Math.min(O.batchMax, O.dayLeft)) {
        t.checked = false;
        $('#spOutreach .or-msg').textContent = 'That’s the most for one batch. Send these first.';
        return;
      }
      if (t.checked) O.picked[key] = 1; else { delete O.picked[key]; if (!orPicked().length) S.orUnpicked = true; }
      orFoot();
    }
  }

  function outreachAct(btn) {
    var O = S.outreach, esc = A().esc, msg = $('#spOutreach .or-msg'), k = btn.dataset.or;
    if (k === 'pick') {
      var room = Math.min(O.batchMax, O.dayLeft) - orPicked().length;
      S.orUnpicked = false;
      orShown().forEach(function (i) {
        if (room > 0 && orGroup(i) === 'ready' && !O.picked[orKey(i)]) { O.picked[orKey(i)] = 1; room--; }
      });
      renderOutreach();
      return;
    }
    if (k === 'clear') { O.picked = {}; S.orUnpicked = true; renderOutreach(); return; }
    if (k === 'review' || k === 'unreview') {
      var rl = btn.closest('.or-item'), ri = O.items.filter(function (i) { return orKey(i) === rl.dataset.k; })[0];
      if (!ri) return;
      btn.disabled = true; msg.textContent = 'Saving…';
      A().apiPost({ action: 'outreachReview', row: ri.row, company: ri.company, undo: k === 'unreview' }).then(function (r) {
        if (!r.ok) { btn.disabled = false; msg.textContent = r.error || 'That did not save.'; return; }
        delete O.picked[orKey(ri)];
        S.orLast = '<span class="sp-done">✓ ' + esc(r.message) + '</span>';
        loadOutreach();
      }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the backend. Try again.'; });
      return;
    }
    if (k === 'preview') {
      var li = btn.closest('.or-item'), it = O.items.filter(function (i) { return orKey(i) === li.dataset.k; })[0];
      var pv = rowPreview(li), sender = orSender();
      msg.textContent = 'Building the preview…';
      A().apiPost({ action: 'outreachPreview', row: it.row, company: it.company, sender: sender ? sender.id : 'mine' }).then(function (res) {
        msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
        if (!res.ok) return;
        framePane(pv, res.subject, res.html, '',
          '<dl class="or-side"><dt>To</dt><dd>' + esc(res.to || 'no address') + '</dd>' +
          '<dt>Greeting</dt><dd>Hi ' + esc(res.greet) + ',</dd>' +
          '<dt>Contact</dt><dd>' + esc(res.contact || 'none on the sheet') + '</dd>' +
          '<dt>From</dt><dd>' + esc(sender ? sender.label : 'nobody set up yet') + '</dd></dl>' +
          res.hold.concat(res.look).map(function (t) { return '<p class="or-flag look">' + esc(t) + '</p>'; }).join(''));
      }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; });
      return;
    }
    if (k === 'allow') {
      var al = btn.closest('.or-item'), ai = O.items.filter(function (i) { return orKey(i) === al.dataset.k; })[0], ak = al.dataset.k;
      if (!ai) return;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1'; btn.dataset.was = btn.textContent;
        btn.textContent = 'Tap again to send to ' + ai.email;
        setTimeout(function () { if (btn.isConnected && btn.dataset.armed && !btn.disabled) { delete btn.dataset.armed; btn.textContent = btn.dataset.was; } }, 6000);
        return;
      }
      var aw = gmailWindow();
      btn.disabled = true; msg.textContent = 'Getting it ready…';
      A().apiPost({ action: 'outreachTicket', row: ai.row, company: ai.company, email: ai.email, looked: ai.look.length > 0 }).then(function (r) {
        if (!r.ok || !r.open) { if (aw) aw.close(); btn.disabled = false; delete btn.dataset.armed; btn.textContent = btn.dataset.was; msg.textContent = r.error || 'That did not go through. Nothing was sent.'; return; }
        S.orOpen = S.orOpen || {}; S.orOpen[ak] = { allow: true, open: r.open };
        var went = sendWindowGo(aw, r.open);
        S.orLast = esc(went ? 'Sending ' + ai.company + ' from your Gmail in the new tab. Tap Back to the app there when it says Sent.'
                            : 'Your browser blocked the new tab. Allow pop-ups for this site and tap Send again.');
        if (!went) delete S.orOpen[ak];
        renderOutreach();
      }).catch(function () { if (aw) aw.close(); btn.disabled = false; msg.textContent = 'Could not reach the backend. Nothing was sent.'; });
      return;
    }
    if (k === 'open' || k === 'done') {
      var ol = btn.closest('.or-item'), oi = O.items.filter(function (i) { return orKey(i) === ol.dataset.k; })[0], ok2 = ol.dataset.k;
      if (!oi) return;
      S.orOpen = S.orOpen || {};
      if (k === 'open') {
        var win = gmailWindow();
        btn.disabled = true; msg.textContent = 'Filling in the email…';
        A().apiPost({ action: 'outreachCompose', row: oi.row, company: oi.company, email: oi.email, looked: oi.look.length > 0 }).then(function (r) {
          if (!r.ok) { if (win) win.close(); btn.disabled = false; msg.textContent = r.error || 'Could not fill in the email.'; return; }
          S.orOpen[ok2] = r;
          var went = gmailGo(win, r);
          S.orLast = esc((went ? 'Opened ' + oi.company + ' in your Gmail.' : 'Tap Open in Gmail again for ' + oi.company + '.') + ' Press Send there, then tap I sent it.');
          renderOutreach();
        }).catch(function () { if (win) win.close(); btn.disabled = false; msg.textContent = 'Could not reach the backend. Try again.'; });
        return;
      }
      btn.disabled = true; msg.textContent = 'Saving…';
      A().apiPost({ action: 'outreachSent', row: oi.row, company: oi.company, email: oi.email }).then(function (r) {
        if (!r.ok) { btn.disabled = false; msg.textContent = r.error || 'That did not save.'; return; }
        delete S.orOpen[ok2];
        S.orLast = '<span class="sp-done">✓ ' + esc(r.message) + '</span>';
        msg.innerHTML = S.orLast;
        load(true);
      }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the backend. Try again.'; });
      return;
    }
    if (k === 'send') {
      var list = orPicked(), sd = orSender();
      if (!list.length || !sd) return;
      if (!btn.dataset.armed) {
        btn.dataset.armed = '1';
        btn.textContent = 'Tap again to send ' + list.length + ' email' + (list.length === 1 ? '' : 's') + ', one per business';
        msg.textContent = 'From ' + sd.label + ' to: ' + list.map(function (i) { return i.company; }).join(', ') + '.';
        setTimeout(function () { if (btn.isConnected && !btn.disabled && btn.dataset.armed) { orFoot(); msg.textContent = ''; } }, 8000);
        return;
      }
      btn.disabled = true; msg.textContent = 'Sending, one at a time…';
      A().apiPost({ action: 'outreachSend', sender: sd.id, items: list.map(function (i) {
        return { row: i.row, company: i.company, email: i.email, looked: i.look.length > 0 };
      }) }).then(function (r) {
        if (!r.ok) { btn.disabled = false; delete btn.dataset.armed; msg.textContent = r.error || 'That did not go through. Nothing was sent.'; return; }
        O.picked = {};
        var bad = (r.results || []).filter(function (x) { return !x.sent; });
        S.orLast = '<span class="sp-done">✓ ' + esc(r.message) + '</span>' +
          (bad.length ? '<ul class="or-res">' + bad.map(function (x) { return '<li>' + esc(x.company) + ': ' + esc(x.error) + '</li>'; }).join('') + '</ul>' : '');
        msg.innerHTML = S.orLast;
        if (r.sent) load(true);
        else loadOutreach();
      }).catch(function () { btn.disabled = false; delete btn.dataset.armed; msg.textContent = 'Could not reach the backend. Some may have gone. Refresh before sending again.'; });
    }
  }

  // ---------- welcome emails ----------
  // The website's thank-you and next steps, for sponsors who didn't sign up
  // on the website (checks, and anyone added by hand). Each one waits for
  // Preview and two taps on Send; "Already had it" marks one without sending.

  function loadWelcome() {
    if (S.book && !canEdit()) { var b = $('#spWelcome'); if (b) b.classList.add('hidden'); return; }
    side({ action: 'welcomeList' }, function (res) {
      if (!res || !res.ok || !canEdit()) return;
      S.welcome = res;
      renderWelcome();
      render();
    }).catch(function () { /* the box stays hidden */ });
  }
  function welcomeFor(s) {
    if (!s || !S.welcome) return null;
    return S.welcome.items.filter(function (i) { return i.row === s.row && i.company === s.company; })[0] || null;
  }
  function welcomeFact(s) {
    var w = welcomeFor(s);
    if (!w) return '';
    if (!w.had) return 'Needs welcome email';
    return w.had.how === 'website' ? 'Welcome email: from the website' : w.had.how === 'sent' ? 'Welcome email sent ' + fmtDay(w.had.at) : 'Welcome email: marked done';
  }
  function welcomeSender() {
    var W = S.welcome, okd = W.senders.filter(function (x) { return x.ok; });
    return W.senders.filter(function (x) { return x.id === S.wlSender && x.ok; })[0] || okd[0] || null;
  }
  function renderWelcome() {
    var box = $('#spWelcome'), esc = A().esc, W = S.welcome;
    if (!box) return;
    if (!W || !canEdit()) { box.classList.add('hidden'); syncSpTabs(); return; }
    box.classList.remove('hidden');
    var f = S.wlFilter || 'needs', sender = welcomeSender(), compose = !!(sender && sender.how === 'compose'), allow = !!(sender && sender.how === 'allow');
    var shown = W.items.filter(function (i) { return f === 'all' || (f === 'needs' ? !i.had : !!i.had); });
    var opt = function (v, label) { return '<option value="' + v + '"' + (v === f ? ' selected' : '') + '>' + label + '</option>'; };
    box.innerHTML = '<h3>Welcome emails · ' + W.needs + ' sponsor' + (W.needs === 1 ? '' : 's') + ' still need' + (W.needs === 1 ? 's' : '') + ' one</h3>' +
      '<p class="hint">The thank-you and next steps the website sends, for sponsors who signed up any other way. Website signups already got it. ' +
        (allow ? 'Each one goes from your own Gmail, signed by you, after you Allow it once. Tap Send twice, then Back to the app on the page that opens.'
          : compose ? 'Each one opens filled in, in your own Gmail, from you and signed by you. Press Send there, then tap I sent it here.' : 'Nothing goes out until you tap Send twice.') + '</p>' +
      (S.wlLast ? '<p class="sp-done">✓ ' + esc(S.wlLast) + '</p>' : '') +
      '<div class="or-top">' +
        '<label>From <select data-wl="sender">' + W.senders.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (sender && x.id === sender.id ? ' selected' : '') + (x.ok ? '' : ' disabled') + '>' + esc(x.label) + (x.ok ? '' : ' (not set up)') + '</option>';
        }).join('') + '</select></label>' +
        '<label>Show <select data-wl="filter">' + opt('needs', 'Needs it') + opt('had', 'Had it') + opt('all', 'Everyone') + '</select></label>' +
      '</div>' +
      '<ul class="or-list">' + (shown.length ? shown.map(function (i) {
        var k = i.row + '|' + i.company, can = !i.had && !i.hold.length && !!sender;
        var had = i.had ? (i.had.how === 'website' ? 'Signed up on the website, so the website sent it.'
          : i.had.how === 'sent' ? 'Sent ' + fmtDay(i.had.at) + '.' : 'Marked as already welcomed ' + fmtDay(i.had.at) + '.') : '';
        return '<li class="or-item" data-k="' + esc(k) + '"><div class="or-row"><div class="or-main"><b>' + esc(i.company) + '</b>' +
          '<div class="or-to">' + (i.email ? 'To ' + esc(i.email) : 'No email') + ' · Hi ' + esc(i.greet) + ',' +
            (i.tier ? ' · ' + esc(i.tier) : '') + ' · ' + (i.paid ? 'paid' : 'not paid yet') + '</div>' +
          (had ? '<p class="or-flag">' + esc(had) + '</p>' : '') +
          (i.had ? '' : i.hold.map(function (t) { return '<p class="or-flag hold">' + esc(t) + '</p>'; }).join('') +
            i.look.map(function (t) { return '<p class="or-flag look">Look: ' + esc(t) + '</p>'; }).join('')) +
          '</div></div>' +
          (i.had ? '' : '<div class="rc-acts">' +
            (i.email ? '<button class="btn small" type="button" data-wl="preview">Preview</button>' : '') +
            (can && (compose || allow) && S.wlOpen && S.wlOpen[k] ? '<button class="btn small primary" type="button" data-wl="done">I sent it</button>' + (S.wlOpen[k].allow ? '' : gmailLinks(S.wlOpen[k])) : '') +
            (can && compose && !(S.wlOpen && S.wlOpen[k]) ? '<button class="btn small primary" type="button" data-wl="open">' + (i.look.length ? 'Looked, open in Gmail' : 'Open in Gmail') + '</button>' : '') +
            (can && !compose && !(allow && S.wlOpen && S.wlOpen[k]) ? '<button class="btn small primary" type="button" data-wl="send">' + (i.look.length ? 'Looked, send' : 'Send') + (allow ? ' from my Gmail' : '') + '</button>' : '') +
            '<button class="btn small" type="button" data-wl="mark">Already had it</button></div>') +
          '<div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
      }).join('') : '<li class="or-item hint">' + (f === 'needs' ? 'Every sponsor has had one.' : 'Nobody here.') + '</li>') + '</ul>';
    syncSpTabs();
  }
  function welcomeAct(btn) {
    var W = S.welcome, esc = A().esc, li = btn.closest('.or-item'), k = btn.dataset.wl;
    var it = W.items.filter(function (i) { return i.row + '|' + i.company === li.dataset.k; })[0];
    var msg = li.querySelector('.rc-msg'), sender = welcomeSender();
    if (!it) return;
    if (k === 'preview') {
      var pv = rowPreview(li);
      msg.textContent = 'Building the preview…';
      A().apiPost({ action: 'welcomePreview', row: it.row, company: it.company }).then(function (res) {
        msg.textContent = res.ok ? '' : (res.error || 'Could not build the preview.');
        if (!res.ok) return;
        framePane(pv, res.subject, res.html, '',
          '<dl class="or-side"><dt>To</dt><dd>' + esc(res.to || 'no address') + '</dd>' +
          '<dt>Greeting</dt><dd>Hi ' + esc(res.greet) + ',</dd>' +
          '<dt>Contact</dt><dd>' + esc(res.contact || 'none on the sheet') + '</dd>' +
          '<dt>From</dt><dd>' + esc(sender ? sender.label : 'nobody set up yet') + '</dd></dl>');
      }).catch(function () { msg.textContent = 'Could not reach the backend. Try again.'; });
      return;
    }
    if (k === 'open' || k === 'done') {
      var wk = li.dataset.k, body0 = { action: 'welcomeSend', row: it.row, company: it.company, email: it.email, sender: 'mine', looked: it.look.length > 0 };
      S.wlOpen = S.wlOpen || {};
      var win = k === 'open' ? gmailWindow() : null;
      if (k === 'done') body0.composed = true;
      btn.disabled = true; msg.textContent = k === 'open' ? 'Filling in the email…' : 'Saving…';
      A().apiPost(body0).then(function (r) {
        if (!r.ok || (k === 'open' && !r.compose)) { if (win) win.close(); btn.disabled = false; msg.textContent = r.error || 'That did not go through.'; return; }
        if (k === 'open') {
          S.wlOpen[wk] = r.compose;
          var went = gmailGo(win, r.compose);
          S.wlLast = (went ? 'Opened ' + it.company + ' in your Gmail.' : 'Tap Open in Gmail again for ' + it.company + '.') + ' Press Send there, then tap I sent it.';
          renderWelcome();
          return;
        }
        delete S.wlOpen[wk];
        S.wlLast = r.message;
        loadWelcome();
      }).catch(function () { if (win) win.close(); btn.disabled = false; msg.textContent = 'Could not reach the backend. Try again.'; });
      return;
    }
    if (!btn.dataset.armed) {
      $$('#spWelcome [data-armed]').forEach(function (b) { delete b.dataset.armed; b.textContent = b.dataset.was; });
      btn.dataset.armed = '1'; btn.dataset.was = btn.textContent;
      btn.textContent = k === 'send' ? 'Tap again to send to ' + it.email : 'Tap again: already had it';
      setTimeout(function () { if (btn.isConnected && btn.dataset.armed && !btn.disabled) { delete btn.dataset.armed; btn.textContent = btn.dataset.was; } }, 6000);
      return;
    }
    var viaAllow = k === 'send' && sender && sender.how === 'allow', aw = viaAllow ? gmailWindow() : null;
    btn.disabled = true; msg.textContent = k === 'send' ? (viaAllow ? 'Getting it ready…' : 'Sending…') : 'Saving…';
    var body = { action: 'welcomeSend', row: it.row, company: it.company, email: it.email };
    if (k === 'mark') body.mark = true;
    else { body.sender = sender ? sender.id : ''; body.looked = it.look.length > 0; }
    A().apiPost(body).then(function (r) {
      if (!r.ok || (viaAllow && !r.open)) { if (aw) aw.close(); btn.disabled = false; delete btn.dataset.armed; btn.textContent = btn.dataset.was; msg.textContent = r.error || 'That did not go through.'; return; }
      if (viaAllow) {
        var went = sendWindowGo(aw, r.open);
        S.wlOpen = S.wlOpen || {};
        if (went) S.wlOpen[li.dataset.k] = { allow: true };
        S.wlLast = went ? 'Sending ' + it.company + ' from your Gmail in the new tab. Tap Back to the app there when it says Sent.'
                        : 'Your browser blocked the new tab. Allow pop-ups for this site and tap Send again.';
        renderWelcome();
        return;
      }
      S.wlLast = r.message;
      loadWelcome();
    }).catch(function () { if (aw) aw.close(); btn.disabled = false; delete btn.dataset.armed; btn.textContent = btn.dataset.was; msg.textContent = 'Could not reach the backend. Refresh before trying again.'; });
  }

  // ---------- emails sent from your own Gmail ----------
  // A board member who isn't the script owner sends as themselves: the app
  // fills the email in, it opens in their own Gmail, and they press Send there.
  function gmailUrl(c) {
    return 'https://mail.google.com/mail/?' + (c.from ? 'authuser=' + encodeURIComponent(c.from) + '&' : '') +
      'view=cm&fs=1&to=' + encodeURIComponent(c.to) + '&su=' + encodeURIComponent(c.subject) + '&body=' + encodeURIComponent(c.text);
  }
  function mailtoUrl(c) {
    return 'mailto:' + encodeURIComponent(c.to) + '?subject=' + encodeURIComponent(c.subject) + '&body=' + encodeURIComponent(c.text);
  }
  // Opened on the tap itself, so the browser doesn't block it; filled in once the email is ready.
  function gmailWindow() {
    try { var w = window.open('', '_blank'); if (w) w.opener = null; return w || null; } catch (e) { return null; }
  }
  function gmailGo(win, c) {
    if (win && !win.closed) { try { win.location.href = gmailUrl(c); return true; } catch (e) { /* use the link */ } }
    return false;
  }
  // The sender's page, in the tab opened on the tap (so a pop-up blocker lets it through).
  function sendWindowGo(win, url) {
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_\-]+\/exec\?t=[A-Za-z0-9_\-]+&s=[A-Za-z0-9_\-]+$/.test(String(url))) { if (win) win.close(); return false; }
    if (win && !win.closed) { try { win.location.href = url; return true; } catch (e) { /* fall through */ } }
    return false;
  }
  function gmailLinks(c) {
    var esc = A().esc;
    return '<a class="btn small" target="_blank" rel="noopener" href="' + esc(gmailUrl(c)) + '">Open in Gmail again</a>' +
      '<a class="btn small" href="' + esc(mailtoUrl(c)) + '">Use my mail app</a>';
  }

  // ---------- one-tap jobs ----------
  // The three things the board does most sit at the top of the Sponsors tab:
  // add a sponsor, mark one paid, add a note. Each is a tap, a name and a
  // confirm. Same roles as everywhere else: anyone who can add sees Add,
  // the sponsorship editors see Mark paid and Add a note. Marking paid opens
  // that sponsor's receipt to check; it only goes out when someone taps Send.
  var QUICK_MAX = 8;
  function renderQuick() {
    var box = $('#spQuick');
    if (!box || !S.book) return;
    var canAdd = !!(S.book.writable && S.book.canAdd), ed = canEdit();
    box.classList.toggle('hidden', !canAdd && !ed);
    $$('#spQuick .sp-q').forEach(function (b) {
      var k = b.dataset.q;
      b.classList.toggle('hidden', k === 'add' ? !canAdd : !ed);
      b.setAttribute('aria-pressed', String(S.quick === k));
    });
    // What's waiting shows as a number on its own tab (syncSpTabs), not as links here.
    syncSpTabs();
    if (ed && !S.toOrderAsked && window.Season && window.Season.counts) {
      S.toOrderAsked = true;
      window.Season.counts().then(function (c) { if (c && c.order !== S.toOrder) { S.toOrder = c.order; syncSpTabs(); } }).catch(function () { });
    }
    if (S.quick && !ed) closeQuick();
  }
  function goSub(sub) {
    if (TAB_OF[sub]) S.focusJob = sub;
    var b = document.querySelector('.tab-btn[data-view="sponsors"][data-sp="' + (TAB_OF[sub] || sub) + '"]');
    if (b) b.click(); else if (window.Sponsors) window.Sponsors.show(sub);
  }
  function closeQuick() {
    S.quick = ''; S.quickRow = 0; S.quickQ = '';
    var pn = $('#spQuickPanel'); pn.classList.add('hidden'); pn.innerHTML = '';
    $$('#spQuick .sp-q').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
  }
  function quickTap(k) {
    if (k === 'add') { closeQuick(); goSub('add'); setTimeout(function () { var f = $('#spa_company'); if (f) f.focus(); }, 50); return; }
    if (k === 'receipts') { closeQuick(); goSub('receipts'); return; }
    if (k === 'welcome') { closeQuick(); S.wlFilter = 'needs'; goSub('welcome'); renderWelcome(); return; }
    if (k === 'outreach') { closeQuick(); goOutreachReady(); return; }
    if (S.quick === k) { closeQuick(); return; }
    S.quick = k; S.quickRow = 0; S.quickQ = '';
    $$('#spQuick .sp-q').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.q === k)); });
    drawQuick(true);
  }
  function quickMatches(q) {
    var words = norm(q).split(' ').filter(Boolean);
    var list = sponsors().filter(function (s) {
      if (!words.length) return S.quick === 'paid' ? isIn(s) && !s.paid : isIn(s);
      var hay = norm([s.company, s.contact, s.owner, s.email].join(' '));
      return words.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    if (S.quick === 'paid') list = list.filter(function (s) { return !s.paid; });
    list.sort(function (a, b) { return (isIn(b) - isIn(a)) || a.company.localeCompare(b.company); });
    return list;
  }
  function drawQuick(focus) {
    var pn = $('#spQuickPanel'), esc = A().esc;
    if (!S.quick) { closeQuick(); return; }
    var paid = S.quick === 'paid';
    var picked = S.quickRow ? sponsors().find(function (x) { return x.row === S.quickRow; }) : null;
    if (picked && !paid) {
      var last = String(picked.notes || '').split('\n')[0];
      pn.innerHTML = '<p class="sp-q-who"><b>' + esc(picked.company) + '</b> <button class="linkish" type="button" data-qa="back">Pick someone else</button></p>' +
        (last ? '<p class="hint">Last note: ' + esc(last.length > 140 ? last.slice(0, 140) + '…' : last) + '</p>' : '<p class="hint">No notes on this one yet.</p>') +
        '<label class="full">Note <textarea id="spQuickNote" rows="3" maxlength="500" placeholder="Called, wants an MVP banner. Check coming next week."></textarea></label>' +
        '<div class="sheet-acts"><button class="btn primary" type="button" data-qa="save">Save note</button>' +
        '<button class="btn small" type="button" data-qa="close">Cancel</button><span class="status sp-q-msg" role="status"></span></div>' +
        '<p class="hint">It goes on top of the Notes column on the sheet with today’s date and your name. Older notes stay under it.</p>';
      pn.classList.remove('hidden');
      if (focus) $('#spQuickNote').focus();
      return;
    }
    var list = quickMatches(S.quickQ), shown = list.slice(0, QUICK_MAX);
    var row = function (s) {
      var bits = [s.tier ? s.tier + (s.amountText ? ' ' + s.amountText : '') : (isIn(s) ? s.amountText : ''), s.owner ? 'Owner: ' + s.owner : '']
        .filter(Boolean).join(' · ');
      return '<li class="sp-q-row" data-row="' + s.row + '"><div><b>' + esc(s.company) + '</b>' + (bits ? '<span class="hint"> ' + esc(bits) + '</span>' : '') + '</div>' +
        '<button class="btn small' + (paid ? ' primary' : '') + '" type="button" data-qa="' + (paid ? 'paid' : 'pick') + '">' + (paid ? 'Paid' : 'Note') + '</button></li>';
    };
    var empty = S.quickQ ? 'Nobody on the sheet matches that.' : (paid ? 'Everyone signed up this season is marked paid.' : 'Type a name to find a sponsor.');
    var keep = $('#spQuickFind');
    if (!keep) {
      pn.innerHTML = '<label class="full sp-q-find">' + (paid ? 'Who paid?' : 'Note on who?') +
        ' <input id="spQuickFind" type="search" autocomplete="off" placeholder="Type a sponsor’s name"></label>' +
        '<ul class="sp-q-list"></ul><p class="sp-q-foot hint"></p><span class="status sp-q-msg" role="status"></span>';
      $('#spQuickFind').addEventListener('input', function (e) { S.quickQ = e.target.value; drawQuick(); });
    }
    $('#spQuickFind').value = S.quickQ;
    pn.querySelector('.sp-q-find').firstChild.textContent = (paid ? 'Who paid?' : 'Note on who?') + ' ';
    pn.querySelector('.sp-q-list').innerHTML = shown.length ? shown.map(row).join('') : '<li class="hint">' + empty + '</li>';
    pn.querySelector('.sp-q-foot').innerHTML = (list.length > shown.length ? (list.length - shown.length) + ' more: type more of the name. ' : '') +
      (paid ? (S.quickQ ? '' : 'Signed up, not paid yet. ') + 'Different amount, or not on the sheet? <button class="linkish" type="button" data-qa="pay">Record a payment</button>' : '');
    pn.classList.remove('hidden');
    if (focus) $('#spQuickFind').focus();
  }
  function quickAct(btn) {
    var act = btn.dataset.qa, li = btn.closest('[data-row]'), pn = $('#spQuickPanel');
    var msg = pn.querySelector('.sp-q-msg');
    if (act === 'close') { closeQuick(); return; }
    if (act === 'back') { S.quickRow = 0; pn.innerHTML = ''; drawQuick(true); return; }
    if (act === 'pay') { closeQuick(); goSub('pay'); return; }
    if (act === 'pick') { S.quickRow = Number(li.dataset.row); pn.innerHTML = ''; drawQuick(true); return; }
    if (act === 'paid') {
      var s = sponsors().find(function (x) { return x.row === Number(li.dataset.row); });
      if (!s) return;
      // Second tap confirms, so a slip of the thumb changes nothing.
      if (!btn.dataset.armed) {
        $$('#spQuickPanel [data-armed]').forEach(function (b) { delete b.dataset.armed; b.textContent = 'Paid'; });
        btn.dataset.armed = '1'; btn.textContent = 'Tap again: paid';
        clearTimeout(btn._t); btn._t = setTimeout(function () { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Paid'; } }, 6000);
        return;
      }
      closeQuick();
      open(s.row);
      markPaid();   // saves Paid? = Yes, then opens the receipt to check. Send is a separate tap.
      return;
    }
    if (act === 'save') {
      var p = sponsors().find(function (x) { return x.row === S.quickRow; }), text = $('#spQuickNote').value.trim();
      if (!p) return;
      if (!text) { msg.textContent = 'Write the note first.'; return; }
      btn.disabled = true; msg.textContent = 'Saving…';
      A().apiPost({ action: 'sponsorNote', row: p.row, company: p.company, text: text }).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { msg.textContent = res.error || 'That did not save.'; return; }
        var who = p.company;
        return load().then(function () {
          S.quickRow = 0; S.quickQ = ''; pn.innerHTML = ''; drawQuick();
          var m = pn.querySelector('.sp-q-msg');
          if (m) m.innerHTML = '<span class="sp-done">✓ Note saved on ' + A().esc(who) + '.</span>';
        });
      }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the backend. Nothing was saved. Try again.'; });
    }
  }
  function keepReportsState() {
    var d = $('#spReports');
    if (!d) return;
    try { d.open = localStorage.getItem('lybsSpReportsOpen') === '1'; } catch (e) { }
    d.addEventListener('toggle', function () { try { localStorage.setItem('lybsSpReportsOpen', d.open ? '1' : '0'); } catch (e) { } });
  }

  // ---------- the Sponsors tab's own tabs ----------
  // Receipts, Follow-ups, Add sponsor and Record payment sit in the top bar
  // next to Sponsors. Each shows only its own box, opened; Sponsors shows the
  // list without them. A tab shows only when its box can be used.
  var SP_BOX = { receipts: '#spReceipts', followups: '#spNudges', outreach: '#spOutreach', welcome: '#spWelcome', add: '#spAddBox', pay: '#spPayBox' };
  // The tabs and the jobs on each (Nate, Nov 22: far fewer tabs). Teams is
  // the sponsor list again, opening each one on where it goes.
  var SP_TAB = { receipts: ['receipts'], outreach: ['outreach'], more: ['followups', 'welcome', 'add', 'pay'], teams: [] };
  var TAB_OF = { followups: 'more', welcome: 'more', add: 'more', pay: 'more' };
  function applyMode() {
    var view = $('#view-sponsors'), tab = SP_TAB[S.mode] ? S.mode : '', jobs = SP_TAB[tab] || [];
    if (!view) return;
    view.classList.toggle('sp-sub', jobs.length > 0);
    view.classList.toggle('sp-teams', tab === 'teams');
    var focus = S.focusJob && jobs.indexOf(S.focusJob) >= 0 ? S.focusJob : jobs.length === 1 ? jobs[0] : '';
    Object.keys(SP_BOX).forEach(function (k) {
      var box = $(SP_BOX[k]); if (!box) return;
      box.classList.toggle('sp-on', jobs.indexOf(k) >= 0);
      if (k === focus) {
        var d = box.tagName === 'DETAILS' ? box : box.querySelector('details.rc-box');
        if (d && !d.open) d.open = true;
        if (S.focusJob === k) { S.focusJob = ''; setTimeout(function () { if (box.scrollIntoView) box.scrollIntoView({ block: 'start' }); }, 30); }
      }
    });
    var shown = jobs.some(function (k) { var b = $(SP_BOX[k]); return b && !b.classList.contains('hidden'); });
    $('#spModeEmpty').classList.toggle('hidden', !jobs.length || shown);
    syncSpTabs();
  }
  // What's waiting on each tab, as a blue circle with the number on it.
  function tabCounts() {
    var c = {};
    c.receipts = S.receipts && S.receipts.items ? S.receipts.items.filter(function (i) {
      var st = stepsOf(sponsorAt(i.row), i); return !st.receipt.done || !st.packet.done;
    }).length : 0;
    c.outreach = S.outreach ? S.outreach.items.filter(orReady).length : 0;
    var nd = S.nudges && S.nudges.current && S.nudges.started ? S.nudges.items.filter(function (i) { return i.status === 'ready'; }).length : 0;
    c.more = nd + (S.welcome ? S.welcome.items.filter(function (i) { return !i.had; }).length : 0);
    c.banners = S.toOrder || 0;
    return c;
  }
  function tabBadge(b, n, what) {
    if (!b.dataset.label) b.dataset.label = b.textContent.replace(/\s*\(\d+\)$/, '').trim();
    b.textContent = b.dataset.label;
    if (n) {
      var i = document.createElement('span');
      i.className = 'tab-badge';
      i.textContent = n > 99 ? '99+' : String(n);
      i.setAttribute('aria-label', n + ' ' + what);
      b.appendChild(i);
    }
  }
  function syncSpTabs() {
    $$('.tab-btn[data-sp]').forEach(function (b) {
      var t = b.dataset.sp, jobs = SP_TAB[t] || [];
      var can = t === S.mode || (t === 'teams' ? !!S.book : jobs.some(function (k) { var x = $(SP_BOX[k]); return x && !x.classList.contains('hidden'); }));
      b.classList.toggle('hidden', !can);
    });
    var c = tabCounts();
    var what = { receipts: 'to send', outreach: 'ready for outreach', more: 'waiting' };
    Object.keys(what).forEach(function (k) {
      var b = document.querySelector('.tab-btn[data-sp="' + k + '"]');
      if (b) tabBadge(b, c[k] || 0, what[k]);
    });
    var bb = document.querySelector('.tab-btn[data-group="banners"]');
    if (bb) tabBadge(bb, c.banners || 0, 'banners to order');
  }

  window.Sponsors = {
    show: function (sub) {
      if (TAB_OF[sub]) S.focusJob = sub;
      sub = TAB_OF[sub] || sub;
      S.mode = SP_TAB[sub] ? sub : '';
      applyMode();
      if (typeof firebase === 'undefined' || !firebase.apps.length || !firebase.auth().currentUser) return;
      if (!S.book) load(); else render();
    },
    reset: function () {
      S.book = null; S.outreach = null; S.welcome = null; S.orOpen = null; S.wlOpen = null; S.teams = null; S.current = null; S.history = null; S.committed = null; S.early = false;
      $('#spYoY').classList.add('hidden'); $('#spYoY').innerHTML = '';
      $('#spList').innerHTML = ''; $('#spSummary').innerHTML = ''; $('#spOther').innerHTML = ''; $('#spSource').innerHTML = ''; $('#spWeb').classList.add('hidden'); S.web = null;
    }
  };

  document.addEventListener('DOMContentLoaded', wire);
})();

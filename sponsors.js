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
      how: colOf(t, /^(paid how|payment method|paid by)/)
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
        how: get('how'), inKind: IN_KIND.test(get('how')),
        team: hasTeam(pick) ? [pick.division, pick.team].filter(Boolean).join(' · ') : get('team')
      };
    }).filter(Boolean);
  }

  // Signed up for this season: an amount on the sheet ("NONE"/$0 doesn't count).
  function isIn(s) { return s.amount > 0; }
  // Paid in goods or services (Paid how says "In kind"): counted on its own, never as cash.
  var IN_KIND = /\bin.?kind\b/i;

  var FILTERS = {
    all: function () { return true; },
    signed: isIn,
    paid: function (s) { return isIn(s) && s.paid; },
    unpaid: function (s) { return isIn(s) && !s.paid; },
    notContacted: function (s) { return !String(s.contacted).trim(); },
    lapsed: function (s) { return s.past && !isIn(s); },
    pastNotContacted: function (s) { return s.past && !isIn(s) && contactState(s) === 'none'; },
    walkIn: function (s) { return s.walkIn; },
    mine: function (s) { return isMine(s); },
    needsOwner: function (s) { return needsOwner(s); },
    noTeam: function (s) { return isIn(s) && !s.team; },
    needsReceipt: function (s) { var r = receiptState(s); return r === 'ready' || r === 'noEmail'; }
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

  function matches(s) {
    if (!FILTERS[S.filter](s)) return false;
    if (S.owner && s.owner !== S.owner) return false;
    if (S.area && s.area !== S.area) return false;
    if (S.search) {
      var q = S.search.toLowerCase();
      if ([s.company, s.contact, s.owner, s.contacted, s.team, s.notes].join(' ').toLowerCase().indexOf(q) < 0) return false;
    }
    return true;
  }

  // ---------- load ----------

  function load() {
    if (S.loading) return S.loading;
    $('#spStatus').textContent = 'Reading the sponsorship sheet…';
    S.loading = A().apiPost({ action: 'sponsorBook' }).then(function (res) {
      if (!res.ok) {
        var msg = String(res.error || '');
        // The backend hasn't got this version yet (Apps Script still on the old code).
        if (/unknown action/i.test(msg)) msg = 'One setup step left: the Apps Script needs the new Code.gs and Season.gs and a new version deployed (steps in docs/sponsors-tab.md).';
        throw A().backendError(msg || 'Could not read the sponsorship sheet.');
      }
      S.book = res;
      S.me = res.me || '';
      S.former = res.former || [];
      $('#spStatus').textContent = '';
      render();
      renderAddBox();
      loadHistory();
      loadReceipts();
      loadNudges();
      loadPackets();
      loadUpgrades();
      loadLogos();
      loadWebsite(false);
    }).catch(function (err) {
      A().noteProblem('Sponsorship sheet did not load', err);
      $('#spStatus').textContent = A().sendErrorText(err, "Can't reach the sponsorship sheet. Check your signal, then tap Refresh.");
    }).finally(function () { S.loading = null; });
    loadTeams();
    return S.loading;
  }

  // This season's committed total next to last season's. Totals only; the
  // backend also keeps today's total so next year has real dates to compare.
  // If the backend doesn't have it yet, the strip just stays hidden.
  function loadHistory() {
    A().apiPost({ action: 'sponsorHistory' }).then(function (res) {
      if (!res || !res.ok) return;
      S.history = res;
      renderYoY();
    }).catch(function () { /* the strip stays hidden */ });
  }

  // ---------- receipts ----------
  // Rows marked paid with an email get a donation receipt, sent only when a
  // board member taps Send. Online and check donors get the same receipt.

  function loadReceipts() {
    A().apiPost({ action: 'receiptList' }).then(function (res) {
      if (!res || !res.ok) return;
      S.receipts = res;
      renderReceipts();
      render();
    }).catch(function () { /* the box stays hidden */ });
  }

  function renderReceipts() {
    var box = $('#spReceipts'), esc = A().esc, R = S.receipts;
    if (!R) { box.classList.add('hidden'); return; }
    var ready = R.items.filter(function (i) { return i.status === 'ready'; });
    var web = [];
    var sent = R.items.filter(function (i) { return i.status === 'sent' || i.status === 'skip'; });
    if (!R.items.length) { box.classList.add('hidden'); return; }
    var set = R.settings || {};
    var notes = [];
    if (set.missing && set.missing.length) notes.push('Still needed before receipts can go out: ' + setupWords(set.missing) + '.');
    else if (!set.live) notes.push('Test mode: receipts go to the test address, not the sponsor.');
    if (!set.packet) notes.push('No sponsor packet link set, so receipts go without it.');
    var can = canEdit();
    var row = function (i) {
      var acts = !can ? '<button class="btn small" data-rc="preview" type="button">' + (i.status === 'sent' ? 'Open receipt' : 'Preview') + '</button>'
        : i.status === 'ready'
        ? '<button class="btn small primary" data-rc="preview" type="button">Preview and send</button>' +
          '<button class="btn small" data-rc="skip" type="button">Not needed</button>'
        : '<span class="rc-state">' + (i.status === 'sent' ? 'Receipt sent' : 'Marked done') + (i.at ? ' ' + esc(i.at) : '') + '</span>' +
            (i.status === 'sent' ? '<button class="btn small" data-rc="preview" type="button">Open receipt</button>' : '<button class="btn small" data-rc="undo" type="button">Undo</button>');
      return '<li class="rc-item" data-key="' + esc(i.key) + '">' +
        '<div class="rc-who"><b>' + esc(i.company) + '</b><span>' + esc(i.amount) + ' · ' + esc(i.email) + '</span>' +
        (i.online ? '<span class="rc-path">Paid online: send this one, not Crossbar’s receipt</span>' : '') +
        (i.inKind ? '<span class="rc-path">Paid in kind: the receipt describes the gift and shows no dollar amount</span>' : '') + '</div>' +
        '<div class="rc-acts">' + acts + '</div><div class="rc-msg" role="status"></div><div class="rc-preview hidden"></div></li>';
    };
    box.innerHTML = '<details class="rc-box"' + (S.rcOpen ? ' open' : '') + '>' +
      '<summary class="rc-h">' + (ready.length ? 'Receipts ready to send ' + countBadge(ready.length) : 'Receipts: all caught up') + '</summary>' +
      '<p class="hint rc-note">Sponsors get this receipt with the packet link, whether they paid by check or online. Plain donations that aren’t for a sponsorship keep Crossbar’s own receipt and never show here.</p>' +
      (notes.length ? '<p class="hint rc-note">' + esc(notes.join(' ')) + '</p>' : '') +
      '<ul class="rc-list">' + ready.map(row).join('') + '</ul>' +
      (web.length || sent.length ? '<details class="rc-more"><summary>Sent or not needed (' + (web.length + sent.length) + ')</summary><ul class="rc-list">' +
        web.concat(sent).map(row).join('') + '</ul></details>' : '') +
      '</details>';
    keepOpen(box, 'rcOpen');
    box.classList.remove('hidden');
    applyMode();
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
      pv.innerHTML = '<div class="rc-pv-top"><b>' + esc(res.subject) + '</b>' +
        '<span class="rc-pv-acts">' +
        (canSend ? '<button class="btn small primary" type="button" data-pv="send">Send</button>' : '') +
        '<button class="btn small" type="button" data-pv="print">Print / Save as PDF</button>' +
        '<button class="btn small" type="button" data-pv="close">Close</button></span></div>' +
        (canSend ? '<p class="hint rc-pv-to">Goes to ' + esc(to) + ' from the league address, only when you tap Send.</p>' : '') +
        '<div class="rc-pv-msg status" role="status"></div>';
      // No scripts run inside the receipt; same origin only so this page can
      // print it. A link in it (the sponsor packet) opens in its own tab, where
      // the page can run: opened inside this frame it would sit on "Loading".
      var f = document.createElement('iframe');
      f.className = 'rc-frame'; f.title = 'Receipt preview';
      f.setAttribute('sandbox', 'allow-same-origin allow-modals allow-popups allow-popups-to-escape-sandbox');
      var doc = String(res.html), base = '<base target="_blank">';
        f.srcdoc = /<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, function (h) { return h + base; }) : base + doc;
      pv.appendChild(f); pv.classList.remove('hidden');
      var said = pv.querySelector('.rc-pv-msg');
      pv.querySelector('[data-pv="print"]').addEventListener('click', function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { said.textContent = 'This browser would not print it. Try Send, then print the PDF in the email.'; } });
      pv.querySelector('[data-pv="close"]').addEventListener('click', function () { pv.classList.add('hidden'); pv.innerHTML = ''; });
      var sendBtn = pv.querySelector('[data-pv="send"]');
      if (sendBtn) sendBtn.addEventListener('click', function () {
        if (!sendBtn.dataset.armed) {
          sendBtn.dataset.armed = '1';
          sendBtn.textContent = set.live ? 'Tap again to send to ' + item.email : 'Tap again to send a test';
          setTimeout(function () { if (sendBtn.isConnected && !sendBtn.disabled) { delete sendBtn.dataset.armed; sendBtn.textContent = 'Send'; } }, 6000);
          return;
        }
        sendBtn.disabled = true; said.textContent = 'Sending…';
        A().apiPost({ action: 'receiptSend', key: key }).then(function (r) {
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
    // Send lives in the preview, so every receipt is seen before it goes.
    if (how === 'preview') return showReceipt(rowPreview(li), key, msg, { send: canEdit() && item && item.status === 'ready' });
    if (how !== 'skip' && how !== 'undo') return;
    btn.disabled = true;
    msg.textContent = 'Saving…';
    A().apiPost({ action: 'receiptMark', key: key, how: how }).then(function (res) {
      if (!res.ok) { btn.disabled = false; msg.textContent = res.error || 'That did not go through.'; return; }
      $('#spStatus').textContent = res.message || 'Saved.';
      loadReceipts();
    }).catch(function () { btn.disabled = false; msg.textContent = 'Could not reach the backend. Nothing was sent. Try again.'; });
  }

  // ---------- follow-ups ----------
  // Contacted, unpaid sponsors who haven't said no get a short follow-up at a
  // few set dates. Each one waits here for Preview and a tap on Send.

  function fmtDay(d) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
    return m ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2]) - 1] + ' ' + Number(m[3]) : d;
  }

  function loadNudges() {
    A().apiPost({ action: 'nudgeList' }).then(function (res) {
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
    document.querySelectorAll('.rc-item .rc-preview').forEach(function (p) {
      if (p !== pv) { p.classList.add('hidden'); p.innerHTML = ''; }
    });
    pv.innerHTML = '';
    return pv;
  }

  function renderNudges() {
    var box = $('#spNudges'), esc = A().esc, N = S.nudges;
    if (!N || !N.rounds || !N.rounds.length) { box.classList.add('hidden'); return; }
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
      }).join('') + '</ul></details></details>';
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
    A().apiPost({ action: 'websiteCheck', fresh: !!fresh }).then(function (res) {
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
    A().apiPost({ action: 'sponsorUpgrades' }).then(function (res) {
      if (!res || !res.ok) return;
      S.upgrades = {};
      (res.upgrades || []).forEach(function (u) { S.upgrades[nameKey(u.company)] = u; });
      render();
    }).catch(function () { /* nothing waiting shows */ });
  }
  // Logos from the league's Sponsor Logos folder in Drive, matched to the
  // sponsors by name on the backend. A sponsor with one shows it on its card.
  function loadLogos() {
    A().apiPost({ action: 'sponsorLogoList' }).then(function (res) {
      if (!res || !res.ok || !res.logos) return;
      S.logos = res.logos;
      render();
    }).catch(function () { /* the cards show without logos */ });
  }
  function logoFor(s) {
    var img = s && S.logos ? S.logos[s.key] : null;
    return img && /^image\/(png|jpeg|gif|webp)$/.test(img.mime) && /^[A-Za-z0-9+\/=]+$/.test(img.base64) ? img : null;
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
    A().apiPost({ action: 'sponsorPackets' }).then(function (res) {
      if (!res || !res.ok || !res.found) return;
      S.packets = res;
      var t = { headers: res.headers }, bc = colOf(t, /^business/);
      S.packetKeys = {};
      res.rows.forEach(function (r) { if (bc >= 0 && r.cells[bc]) S.packetKeys[nameKey(r.cells[bc])] = true; });
      renderPackets();
      render();
    }).catch(function () { /* the box stays hidden */ });
  }

  function renderPackets() {
    var box = $('#spPackets'), esc = A().esc, P = S.packets;
    if (!P || !P.rows.length) { box.classList.add('hidden'); return; }
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

  // The levels a new sponsor can pick, with their usual price.
  var ADD_LEVELS = [['Gameday', 0], ['All-Star', 300], ['MVP', 500], ['Championship', 750], ['Championship+', 1000]];
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
      return new RegExp('(^|[^A-Za-z])' + n.replace(/[+]/g, '\\+').replace('-', '[- ]?') + (n === 'Championship' ? '(?!\\s*\\+|\\s*plus)' : '') + '(?![A-Za-z])', 'i').test(lvTxt);
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
    var st = $('#spEditStatus');
    st.innerHTML = '<span class="sp-done">✓ ' + A().esc(text) + '</span>';
  }

  function canEdit() { return !!(S.book && S.book.writable && S.book.canEdit); }

  function showEditActs(s) {
    var can = canEdit();
    $('#spEditActs').classList.toggle('hidden', !can);
    $('#spPaidBtn').classList.toggle('hidden', !can || s.paid);
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
    $('#spEditStatus').textContent = 'Saving…';
    return A().apiPost({ action: 'sponsorEdit', row: s.row, company: s.company, values: values }).then(function (res) {
      if (!res.ok) { $('#spEditStatus').textContent = res.error || 'That did not save.'; return; }
      $('#spEditStatus').textContent = res.message || 'Saved.';
      S.editing = false;
      return load().then(function () { if (done) done(); });
    }).catch(function () { $('#spEditStatus').textContent = 'Could not reach the backend. Nothing was saved. Try again.'; });
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
    if (c < 0) { $('#spEditStatus').textContent = missing; return; }
    var values = {}; values[t.headers[c]] = value;
    saveRow(values, function () { open(row); doneNote(said); if (after) after(row); });
  }

  function markContacted() { setColumn(/^contacted/, 'The sheet has no Contacted? column.', 'Yes', 'Contacted. Saved to the sheet.'); }
  function markNotSponsoring() { setColumn(/^contacted/, 'The sheet has no Contacted? column.', 'Not sponsoring', 'Not sponsoring. No follow-up emails go to them.'); }
  function markPaid() { setColumn(/^paid/, 'The sheet has no Paid? column.', 'Yes', 'Paid.', receiptAfterPaid); }

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

  // This season on a date: today's live total, or the day's kept snapshot.
  function nowOn(iso) {
    var h = S.history;
    if (iso >= h.today) return S.committed;
    var hit = null;
    (h.snaps || []).forEach(function (s) { if (s.date <= iso) hit = s; });
    return hit && daysBetween(hit.date, iso) <= 7 ? hit.committed : null;
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
    var pct = function (v) { return Math.min(100, Math.round(v / scale * 1000) / 10) + '%'; };
    var thenText = then == null ? 'no record this early' : (then.est ? 'about ' : '') + fmtMoney(then.amount);

    // Last year's month-start waypoints as ticks on the bar.
    var season = Number(h.season), ticks = '';
    var marks = ['11-01', '12-01', '01-01', '02-01', '03-01', '04-01', '05-01'].map(function (md) {
      var y = md >= '07' ? season - 1 : season;
      return y + '-' + md;
    });
    var rows = marks.map(function (iso) {
      var p = prevOn(lastYear(iso));
      if (p && p.amount > 0) ticks += '<i class="yoy-tick" style="left:' + pct(p.amount) + '" title="' + dayLabel(iso) + ' last year: ' + fmtMoney(p.amount) + '"></i>';
      var n = nowOn(iso);
      var prevCell = p == null ? 'no record' : (p.est ? 'about ' : '') + fmtMoney(p.amount);
      var nowCell = iso > h.today ? '' : (n == null ? 'not kept' : fmtMoney(n));
      return '<tr><td>' + dayLabel(iso) + '</td><td>' + nowCell + '</td><td>' + prevCell + '</td></tr>';
    }).join('');
    if (then && then.amount > 0) ticks += '<i class="yoy-then" style="left:' + pct(then.amount) + '"></i>';

    var est = [];
    if (prev.sheetCreated) est.push('Last year\'s sheet was started ' + dayLabel(prev.sheetCreated) + '.');
    if (pts.length) est.push('Its totals come from the sheet\'s saved versions, the first on ' + dayLabel(pts.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[0].date) + ', so "about" means the nearest saved version was more than a week away.');
    else est.push('Its saved versions couldn\'t be read, so only its final total shows.');
    est.push('This year\'s totals are kept once a day from ' + dayLabel((h.snaps && h.snaps[0] && h.snaps[0].date) || h.today) + ' on.');

    box.innerHTML =
      '<summary>' +
        '<span class="yoy-line"><b>' + fmtMoney(now) + '</b> committed · this time last year ' + thenText + ' · ' + prev.season + ' final ' + fmtMoney(fin) + '</span>' +
        '<span class="yoy-bar" role="img" aria-label="' + h.season + ' committed ' + fmtMoney(now) + ' of last year\'s final ' + fmtMoney(fin) + '">' +
          '<span class="yoy-fill" style="width:' + pct(now) + '"></span>' + ticks +
        '</span>' +
      '</summary>' +
      '<table class="yoy-table"><thead><tr><th></th><th>' + h.season + '</th><th>' + prev.season + '</th></tr></thead><tbody>' + rows +
        '<tr class="yoy-final"><td>Final</td><td></td><td>' + fmtMoney(fin) + '</td></tr></tbody></table>' +
      '<p class="yoy-note">' + est.join(' ') + '</p>';
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

  function stat(n, label, cls) { return '<div class="stat' + (cls ? ' ' + cls : '') + '"><b>' + n + '</b><span>' + label + '</span></div>'; }

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
    // Dollar amounts first and wider, so five-digit totals fit as well as three.
    $('#spSummary').classList.toggle('k3', kind.length > 0);
    $('#spSummary').innerHTML =
      stat(fmtMoney(committed), 'committed', 'money') +
      stat(fmtMoney(paidAmt), 'paid (' + paid.length + ')', 'money') +
      (kind.length ? stat(fmtMoney(kindAmt), 'in kind (' + kind.length + ')', 'money') : '') +
      stat(inn.length, S.book.season + ' sponsors') +
      stat(all.filter(FILTERS.notContacted).length, 'not contacted') +
      stat(all.filter(FILTERS.lapsed).length, 'past, not back yet') +
      stat(all.filter(needsOwner).length, 'need a new owner');
    S.committed = committed;
    renderYoY();
    applyMode();

    // The default view is this season's sponsors; name it with the season.
    var yo = $('#spFilter option[value="signed"]');
    if (yo) yo.textContent = S.book.season + ' sponsors';
    $('#spFilter').value = S.filter;

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
    $('#spList').innerHTML = items.map(function (s) {
      var logo = logoFor(s);
      return '<li class="banner-card season-card" role="button" tabindex="0" data-row="' + s.row + '">' +
        (logo ? '<img class="sp-card-logo" alt="" src="data:' + logo.mime + ';base64,' + logo.base64 + '">' : '') +
        '<div class="info">' +
          '<div class="name">' + esc(s.company) + '</div>' +
          facts([
            s.tier ? s.tier + (s.amountText ? ' ' + s.amountText : '') : (s.tierPrev ? 'Last year: ' + s.tierPrev : ''),
            s.owner ? 'Owner: ' + s.owner : '',
            s.area || '',
            String(s.prevContact || '').trim() ? 'Reached out last year: ' + s.prevContact : '',
            needsOwner(s) ? 'Needs a new owner' : '',
            String(s.contacted).trim() ? 'Contacted: ' + s.contacted : '',
            s.team ? 'Team: ' + s.team : '',
            S.packetKeys && S.packetKeys[s.key] ? 'Info packet in' : '',
            upgradeFor(s) ? 'Upgrade to ' + upgradeFor(s).to + ' asked, ' + fmtMoney(upgradeLeft(s, upgradeFor(s))) + ' to pay' : ''
          ]) +
          (s.walkIn ? '<div class="sub sp-walkin">Walk-in only' + (s.address ? ': ' + esc(s.address) : '') + '</div>' : '') +
          (s.notes ? '<div class="sub sp-note">' + esc(s.notes) + '</div>' : '') +
        '</div>' +
        cardBadge(s) +
      '</li>';
    }).join('') || '<p class="hint">' + (all.length ? 'No sponsors match that.' : 'The sheet has no sponsors on it yet.') + '</p>';

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
    $('#spFields').innerHTML = (key.length ? '<dl class="sp-facts">' + key.map(fact).join('') + '</dl>' : '') +
      '<details class="sp-all"><summary>Everything on the sheet (' + (key.length + rest.length) + ')</summary>' +
      (rest.length ? '<dl class="sp-facts">' + rest.map(fact).join('') + '</dl>' : '') +
      '<p class="hint">Row ' + s.row + ' on the sheet.' + (S.book.writable ? '' : ' Changes to these go on the sheet itself.') + '</p></details>';
    renderMarks(s, []);
    renderBanner(s);
    showEditActs(s);
    $('#spReceipt').classList.add('hidden'); $('#spReceipt').innerHTML = '';
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
    $('#spFilter').addEventListener('change', function (e) { S.filter = e.target.value; render(); });
    $('#spSearch').addEventListener('input', function (e) { S.search = e.target.value; render(); });
    $('#spOwner').addEventListener('change', function (e) { S.owner = e.target.value; render(); });
    $('#spRefresh').addEventListener('click', function () { load(); });
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

  // ---------- the Sponsors tab's own tabs ----------
  // Receipts, Follow-ups, Add sponsor and Record payment sit in the top bar
  // next to Sponsors. Each shows only its own box, opened; Sponsors shows the
  // list without them. A tab shows only when its box can be used.
  var SP_BOX = { receipts: '#spReceipts', followups: '#spNudges', add: '#spAddBox', pay: '#spPayBox' };
  function applyMode() {
    var view = $('#view-sponsors'), mode = SP_BOX[S.mode] ? S.mode : '';
    if (!view) return;
    view.classList.toggle('sp-sub', !!mode);
    Object.keys(SP_BOX).forEach(function (k) {
      var box = $(SP_BOX[k]); if (!box) return;
      box.classList.toggle('sp-on', k === mode);
      if (k === mode) {
        var d = box.tagName === 'DETAILS' ? box : box.querySelector('details.rc-box');
        if (d && !d.open) d.open = true;
      }
    });
    $('#spModeEmpty').classList.toggle('hidden', !mode || !$(SP_BOX[mode]).classList.contains('hidden'));
    syncSpTabs();
  }
  function syncSpTabs() {
    $$('.tab-btn[data-sp]').forEach(function (b) {
      var box = $(SP_BOX[b.dataset.sp]);
      var can = box && (!box.classList.contains('hidden') || b.dataset.sp === S.mode);
      b.classList.toggle('hidden', !can);
    });
    var rb = document.querySelector('.tab-btn[data-sp="receipts"]');
    if (rb) {
      var n = S.receipts && S.receipts.items ? S.receipts.items.filter(function (i) { return i.status === 'ready'; }).length : 0;
      rb.textContent = 'Receipts' + (n ? ' (' + n + ')' : '');
    }
  }

  window.Sponsors = {
    show: function (sub) {
      S.mode = SP_BOX[sub] ? sub : '';
      applyMode();
      if (typeof firebase === 'undefined' || !firebase.apps.length || !firebase.auth().currentUser) return;
      if (!S.book) load(); else render();
    },
    reset: function () {
      S.book = null; S.teams = null; S.current = null; S.history = null; S.committed = null;
      $('#spYoY').classList.add('hidden'); $('#spYoY').innerHTML = '';
      $('#spList').innerHTML = ''; $('#spSummary').innerHTML = ''; $('#spOther').innerHTML = ''; $('#spSource').innerHTML = ''; $('#spWeb').classList.add('hidden'); S.web = null;
    }
  };

  document.addEventListener('DOMContentLoaded', wire);
})();

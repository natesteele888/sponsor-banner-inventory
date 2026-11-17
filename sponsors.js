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
 *        │  sponsorTeamSave (the one write, to this app's private data Sheet)
 *        ▼
 *   "<season> Sponsor Teams" tab  →  also read by the Dashboard's Uniforms and
 *                                    Jersey Order pages (sponsorSheet)
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
    book: null, loading: null, filter: 'all', owner: '', search: '',
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
  function yes(v) { return /^\s*(y|yes|true|x|paid)/i.test(String(v || '')); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  // "Matt " and "matt" are the same board member.
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
      notes: colOf(t, /^notes?$/)
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
        team: pick ? [pick.division, pick.team].filter(Boolean).join(' · ') : get('team')
      };
    }).filter(Boolean);
  }

  // Signed up for this season: an amount on the sheet ("NONE"/$0 doesn't count).
  function isIn(s) { return s.amount > 0; }

  var FILTERS = {
    all: function () { return true; },
    signed: isIn,
    paid: function (s) { return isIn(s) && s.paid; },
    unpaid: function (s) { return isIn(s) && !s.paid; },
    notContacted: function (s) { return !String(s.contacted).trim(); },
    lapsed: function (s) { return s.past && !isIn(s); },
    noTeam: function (s) { return isIn(s) && !s.team; }
  };

  function matches(s) {
    if (!FILTERS[S.filter](s)) return false;
    if (S.owner && s.owner !== S.owner) return false;
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
      $('#spStatus').textContent = '';
      render();
    }).catch(function (err) {
      A().noteProblem('Sponsorship sheet did not load', err);
      $('#spStatus').textContent = A().sendErrorText(err, "Can't reach the sponsorship sheet. Check your signal, then tap Refresh.");
    }).finally(function () { S.loading = null; });
    loadTeams();
    return S.loading;
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

  function stat(n, label) { return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>'; }

  function render() {
    if (!S.book) return;
    var esc = A().esc, pill = A().pill;
    var all = sponsors();
    var inn = all.filter(isIn), paid = inn.filter(function (s) { return s.paid; });
    var committed = inn.reduce(function (n, s) { return n + s.amount; }, 0);
    var paidAmt = paid.reduce(function (n, s) { return n + s.amount; }, 0);
    $('#spSummary').innerHTML =
      stat(inn.length, S.book.season + ' sponsors') +
      stat(fmtMoney(committed), 'committed') +
      stat(fmtMoney(paidAmt), 'paid (' + paid.length + ')') +
      stat(all.filter(FILTERS.notContacted).length, 'not contacted') +
      stat(all.filter(FILTERS.lapsed).length, 'past, not back yet');

    // Owner picker: whoever the sheet lists, as written there.
    var owners = {};
    all.forEach(function (s) { if (s.owner) owners[s.owner] = (owners[s.owner] || 0) + 1; });
    var ownerSel = $('#spOwner');
    ownerSel.innerHTML = '<option value="">Everyone</option>' + Object.keys(owners).sort().map(function (o) {
      return '<option value="' + esc(o) + '"' + (o === S.owner ? ' selected' : '') + '>' + esc(o) + ' (' + owners[o] + ')</option>';
    }).join('');

    var items = all.filter(matches).sort(function (a, b) {
      return (b.amount - a.amount) || a.company.localeCompare(b.company);
    });
    $('#spList').innerHTML = items.map(function (s) {
      return '<li class="banner-card season-card" role="button" tabindex="0" data-row="' + s.row + '">' +
        '<div class="info">' +
          '<div class="name">' + esc(s.company) + '</div>' +
          '<div class="meta">' +
            (s.tier ? pill(s.tier + (s.amountText ? ' ' + s.amountText : ''), '') : (s.tierPrev ? pill('Last year: ' + s.tierPrev, '') : '')) +
            (isIn(s) ? (s.paid ? pill('Paid', 'on-list') : pill('Not paid yet', 'legacy')) : '') +
            (s.owner ? pill('Owner: ' + s.owner, '') : '') +
            (String(s.contacted).trim() ? pill('Contacted: ' + s.contacted, 'on-list') : pill('Not contacted', 'not-hung')) +
          '</div>' +
          (s.team ? '<div class="hint season-sub">Team: ' + esc(s.team) + '</div>' : '') +
          (s.notes ? '<div class="hint season-sub sp-note">' + esc(s.notes) + '</div>' : '') +
        '</div>' +
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
    $('#spBadge').textContent = s.tier || (s.tierPrev ? 'Last year: ' + s.tierPrev : '');
    $('#spBadge').className = 'pill';
    // Every column on the sheet, exactly as the sheet has it.
    $('#spFields').innerHTML = t.headers.map(function (h, i) {
      var v = s.cells[i] || '';
      if (!h || !v || /^false$/i.test(v)) return '';
      return '<p class="ss-row"><span>' + esc(h) + '</span>' + linkify(h, v) + '</p>';
    }).join('') + '<p class="hint">Row ' + s.row + ' on the sheet. Changes to these go on the sheet itself.</p>';

    var p = s.pick || {};
    $('#sp_division').value = p.division || '';
    $('#sp_team').value = p.team || (s.pick ? '' : s.sheetTeam);
    $('#sp_note').value = p.note || '';
    $('#spTeamHint').textContent = s.pick
      ? 'Set here' + (p.updatedAt ? ' on ' + p.updatedAt : '') + '. The Dashboard’s Uniforms and Jersey Order pages see it too.'
      : (s.sheetTeam ? 'From the sheet’s team column. Save to set it here.' : 'Not lined up with a team yet.');
    fillPickers();
    $('#spSaveStatus').textContent = '';
    $('#detailScrim').classList.remove('hidden');
    $('#sponsorSheet').classList.remove('hidden');
    if (!S.entry) { history.pushState({ sponsorSheet: true }, ''); S.entry = true; }
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
      S.book.teams = (S.book.teams || []).filter(function (p) { return p.key !== s.key; });
      if (payload.division || payload.team || payload.note) {
        S.book.teams.push({ key: s.key, company: s.company, division: payload.division, team: payload.team,
                            note: payload.note, updatedAt: new Date().toISOString().slice(0, 10) });
      }
      render();
      setTimeout(close, 300);
    }).catch(function (err) {
      A().noteProblem('Sponsor team save failed', err);
      $('#spSaveStatus').textContent = A().sendErrorText(err, "Couldn't save. Check your signal, then tap Save again.");
    });
  }

  // ---------- wire up ----------

  function wire() {
    $$('[data-spfilter]').forEach(function (chip) {
      chip.addEventListener('click', function () {
        S.filter = chip.dataset.spfilter;
        $$('[data-spfilter]').forEach(function (c) { c.classList.toggle('active', c === chip); });
        render();
      });
    });
    $('#spSearch').addEventListener('input', function (e) { S.search = e.target.value; render(); });
    $('#spOwner').addEventListener('change', function (e) { S.owner = e.target.value; render(); });
    $('#spRefresh').addEventListener('click', function () { load(); });
    $('#spClose').addEventListener('click', close);
    $('#detailScrim').addEventListener('click', function () { if (S.current) close(); });
    $('#spSave').addEventListener('click', saveTeam);
    $('#sp_division').addEventListener('input', fillPickers);
    window.addEventListener('popstate', function () {
      if (S.skipPop) { S.skipPop = false; return; }
      if (S.entry) { S.entry = false; hide(); }
    });
  }

  window.Sponsors = {
    show: function () {
      if (typeof firebase === 'undefined' || !firebase.apps.length || !firebase.auth().currentUser) return;
      if (!S.book) load(); else render();
    },
    reset: function () {
      S.book = null; S.teams = null; S.current = null;
      $('#spList').innerHTML = ''; $('#spSummary').innerHTML = ''; $('#spOther').innerHTML = ''; $('#spSource').innerHTML = '';
    }
  };

  document.addEventListener('DOMContentLoaded', wire);
})();

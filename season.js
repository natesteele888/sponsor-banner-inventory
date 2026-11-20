/**
 * The 2027 tab: every banner-level sponsor for the season ($500 and up),
 * however they came in, with what's left to do for each banner.
 *
 *   found by the hourly scan (Season.gs)  →  info email  →  sponsor fills the form
 *                                         →  banner from stock, or one to order
 *
 * Rows live on the "2027 Banners" tab of the private data Sheet and only come
 * through the signed-in backend, like the rest of the app.
 */
(function () {
  'use strict';

  var A = function () { return window.BannerApp; };
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  var S = { rows: [], statuses: [], loaded: false, loading: null, filter: 'all', current: null, entry: false, skipPop: false };

  function isMatchNeeded(r) { return String(r.company).indexOf('Needs a match') === 0; }
  // No payment, no email and no banner (Nate's rule).
  function isPaid(r) { return String(r.paid).toUpperCase() === 'TRUE'; }
  function isUnpaid(r) { return !isMatchNeeded(r) && !isPaid(r); }
  function isWaiting(r) { return !isMatchNeeded(r) && isPaid(r) && r.requestStatus !== 'Info received'; }
  function isOrder(r) { return r.bannerStatus === 'Order new' || r.bannerStatus === 'Reprint needed'; }
  function isStock(r) { return r.bannerStatus === 'Use banner from stock' || !!r.assignedBannerId; }

  function matches(r) {
    if (S.filter === 'order') return isOrder(r);
    if (S.filter === 'stock') return isStock(r);
    if (S.filter === 'unpaid') return isUnpaid(r);
    if (S.filter === 'waiting') return isWaiting(r);
    if (S.filter === 'received') return r.requestStatus === 'Info received';
    if (S.filter === 'match') return isMatchNeeded(r);
    return true;
  }

  function load() {
    if (S.loading) return S.loading;
    $('#seasonStatus').textContent = 'Loading 2027 sponsors…';
    S.loading = Promise.all([A().apiPost({ action: 'seasonList' }), A().whenBannersLoaded()]).then(function (out) {
      var res = out[0];
      if (!res.ok) throw A().backendError(res.error || 'Could not load the 2027 list.');
      S.rows = res.rows;
      S.statuses = res.statuses;
      S.loaded = true;
      $('#seasonStatus').textContent = '';
      render();
    }).catch(function (err) {
      A().noteProblem('2027 list did not load', err);
      $('#seasonStatus').textContent = A().sendErrorText(err, "Can't reach the 2027 list. Check your signal, then open the tab again.");
    }).finally(function () { S.loading = null; });
    return S.loading;
  }

  function count(fn) { return S.rows.filter(fn).length; }

  function render() {
    var esc = A().esc, badge = A().badge, facts = A().facts;
    $('#seasonSummary').innerHTML =
      stat(S.rows.length, 'banner sponsors') +
      stat(count(isUnpaid), 'waiting on payment') +
      stat(count(isOrder), 'to order') +
      stat(count(isStock), 'from stock') +
      stat(count(isWaiting), 'waiting on info');

    // "1000" on the sheet reads as $1,000; anything else shows as written.
    var dollars = function (v) {
      var t = String(v).trim(), n = Number(t.replace(/[$,]/g, ''));
      return /^\$?[\d,]+(\.\d+)?$/.test(t) && isFinite(n) ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : t;
    };
    var items = S.rows.filter(matches).sort(function (a, b) { return String(a.company).localeCompare(String(b.company)); });
    $('#seasonList').innerHTML = items.map(function (r) {
      var banner = r.assignedBannerId ? bannerName(r.assignedBannerId) : '';
      return '<li class="banner-card season-card" role="button" tabindex="0" data-key="' + esc(r.key) + '">' +
        '<div class="info">' +
          '<div class="name">' + esc(r.company) + '</div>' +
          facts([
            r.tier ? r.tier + (r.amount ? ' ' + dollars(r.amount) : '') : '',
            'Banner: ' + (banner ? 'from stock (' + banner + ')' : (r.bannerStatus || 'Not decided'))
          ]) +
        '</div>' +
        (isUnpaid(r) ? badge('Waiting on payment', 'warn') :
          isMatchNeeded(r) ? badge('Needs a match', 'warn') :
          r.requestStatus === 'Info received' ? badge('Info received', 'ok') :
          badge(requestLabel(r), 'muted')) +
      '</li>';
    }).join('') || '<p class="hint">' + (S.rows.length ? 'No sponsors match that filter.' :
      'No 2027 banner sponsors yet. They show up here as they are logged on the sponsorship sheet, sent in from the website, or paid online.') + '</p>';

    $$('#seasonList .season-card').forEach(function (card) {
      card.addEventListener('click', function () { open(card.dataset.key); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card.dataset.key); }
      });
    });
  }

  function stat(n, label) {
    return '<div class="stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }

  function requestLabel(r) {
    if (isMatchNeeded(r)) return 'Needs a match';
    if (r.requestStatus === 'Info received') return 'Info received';
    if (r.requestStatus) return 'Email: ' + r.requestStatus.replace('Draft in Gmail', 'draft');
    return r.contactEmail ? 'Paid, email not made yet' : 'Paid, no email on file';
  }

  function bannerName(id) {
    var b = A().banners().find(function (x) { return String(x.id) === String(id); });
    return b ? b.sponsorName : 'banner #' + id;
  }

  function nameKey(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ''); }

  // Banners in stock that look like this sponsor's, best guess first.
  function suggestions(r) {
    var k = nameKey(r.company).slice(0, 8);
    if (k.length < 4) return [];
    return A().banners().filter(function (b) { return nameKey(b.sponsorName).indexOf(k) === 0 || nameKey(r.company).indexOf(nameKey(b.sponsorName).slice(0, 8)) === 0; });
  }

  function takenBy(bannerId, exceptKey) {
    var hit = S.rows.find(function (x) { return x.key !== exceptKey && String(x.assignedBannerId) === String(bannerId); });
    return hit ? hit.company : '';
  }

  function open(key) {
    var r = S.rows.find(function (x) { return x.key === key; });
    if (!r) return;
    S.current = r;
    var esc = A().esc;
    $('#ssTitle').textContent = r.company;
    A().setBadge($('#ssBadge'), r.tier || '', 'muted');
    $('#ssSource').textContent = 'Came in by: ' + (r.source || 'unknown') + (r.addedAt ? ' · added ' + r.addedAt : '');
    ['company', 'amount', 'contactName', 'contactEmail', 'contactPhone', 'notes'].forEach(function (k) { $('#s_' + k).value = r[k] || ''; });
    // Championship+ was folded into Championship (it is $750 and up now), but
    // rows filed before that still say Championship+. Show it as Championship,
    // and keep any other level the list doesn't have, so Save never blanks it.
    var tier = /^championship\s*(\+|plus)$/i.test(r.tier || '') ? 'Championship' : (r.tier || '');
    var tierSel = $('#s_tier');
    if (tier && !Array.prototype.some.call(tierSel.options, function (o) { return o.value === tier; })) {
      var o = document.createElement('option'); o.textContent = tier; tierSel.appendChild(o);
    }
    tierSel.value = tier;
    $('#s_paid').checked = isPaid(r);
    $('#ssPaidVia').textContent = isPaid(r) ? (r.paidVia || '') : 'Not paid yet. Tick this once their payment is in, then Save.';

    $('#s_bannerStatus').innerHTML = S.statuses.map(function (s) {
      return '<option' + (s === (r.bannerStatus || 'Not decided') ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');

    var sugg = suggestions(r);
    var others = A().banners().slice().sort(function (a, b) { return String(a.sponsorName).localeCompare(String(b.sponsorName)); });
    var opt = function (b) {
      var taken = takenBy(b.id, r.key);
      return '<option value="' + esc(b.id) + '"' + (String(b.id) === String(r.assignedBannerId) ? ' selected' : '') + '>' +
        esc(b.sponsorName) + (b.condition && b.condition !== 'Good' ? ' (' + esc(b.condition) + ')' : '') +
        (taken ? ' — already for ' + esc(taken) : '') + '</option>';
    };
    $('#s_assignedBannerId').innerHTML = '<option value="">None</option>' +
      (sugg.length ? '<optgroup label="Looks like theirs">' + sugg.map(opt).join('') + '</optgroup>' : '') +
      '<optgroup label="All banners">' + others.map(opt).join('') + '</optgroup>';
    $('#ssSuggest').textContent = (!r.assignedBannerId && sugg.length)
      ? 'There is a banner in stock that looks like theirs: ' + sugg.map(function (b) { return b.sponsorName; }).join(', ') + '.'
      : (!r.assignedBannerId ? 'No banner in stock matches their name.' : '');

    $('#ssRequest').textContent = isMatchNeeded(r)
      ? 'This was a website payment with no form. Put in the company and email, save, then make the email.'
      : (r.requestStatus ? r.requestStatus + (r.requestAt ? ' (' + r.requestAt + ')' : '') + (r.requestStatus === 'Draft in Gmail' ? '. Check it, then press Send in Gmail.' : '') :
          (!isPaid(r) ? 'Waiting on their payment. No email goes to them until it is in.' :
            (r.contactEmail ? 'Not made yet. The next hourly check puts it in your Gmail Drafts for you to check and send.' : 'Add their email to make it.')));
    $('#ssDraftBtn').disabled = !r.contactEmail || isMatchNeeded(r) || !isPaid(r);
    $('#ssCopyBtn').disabled = !r.intakeLink || !isPaid(r);

    var got = $('#ssReceived');
    if (r.submittedAt) {
      got.classList.remove('hidden');
      got.innerHTML = '<h3 class="ss-h">What they sent (' + esc(r.submittedAt) + ')</h3>' +
        row('Jersey name', r.jerseyName) + row('Website', r.website) + row('Write-up', r.writeup) +
        row('Banner', r.bannerChoice) + row('Banner notes', r.bannerText) +
        (r.fileFolderId ? '<p><a class="btn small" target="_blank" rel="noopener" href="https://drive.google.com/drive/folders/' +
          encodeURIComponent(r.fileFolderId) + '">Open their files in Drive</a></p>' : '') +
        (r.fileLink ? row('Link they pasted (check it before opening)', r.fileLink) : '');
    } else {
      got.classList.add('hidden');
      got.innerHTML = '';
    }

    $('#ssStatus').textContent = '';
    $('#detailScrim').classList.remove('hidden');
    $('#seasonSheet').classList.remove('hidden');
    if (!S.entry) { history.pushState({ seasonSheet: true }, ''); S.entry = true; }
  }

  function row(label, val) {
    if (!val) return '';
    return '<p class="ss-row"><span>' + A().esc(label) + '</span>' + A().esc(val) + '</p>';
  }

  function hide() {
    $('#seasonSheet').classList.add('hidden');
    if ($('#detailSheet').classList.contains('hidden')) $('#detailScrim').classList.add('hidden');
    S.current = null;
  }

  function close() {
    hide();
    if (S.entry) { S.entry = false; S.skipPop = true; history.back(); }
  }

  function save() {
    var r = S.current;
    if (!r) return;
    var payload = { action: 'seasonUpdate', key: r.key };
    ['company', 'tier', 'amount', 'contactName', 'contactEmail', 'contactPhone', 'bannerStatus', 'assignedBannerId', 'notes'].forEach(function (k) {
      payload[k] = $('#s_' + k).value;
    });
    payload.paid = $('#s_paid').checked;
    // Picking a banner from stock with no plan yet means the plan is "use it".
    if (payload.assignedBannerId && payload.bannerStatus === 'Not decided') payload.bannerStatus = 'Use banner from stock';
    var taken = payload.assignedBannerId && takenBy(payload.assignedBannerId, r.key);
    if (taken && !confirmTaken(taken)) return;
    $('#ssStatus').textContent = 'Saving…';
    return A().apiPost(payload).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Save failed.');
      $('#ssStatus').textContent = 'Saved.';
      return reload().then(function () { setTimeout(close, 300); });
    }).catch(function (err) {
      A().noteProblem('2027 sponsor save failed', err);
      $('#ssStatus').textContent = A().sendErrorText(err, "Couldn't save. Check your signal, then tap Save again.");
    });
  }

  // A plain in-page note rather than a browser pop-up.
  function confirmTaken(company) {
    var el = $('#ssStatus');
    if (el.dataset.warned === company) { el.dataset.warned = ''; return true; }
    el.dataset.warned = company;
    el.textContent = 'That banner is already picked for ' + company + '. Tap Save again to move it here.';
    return false;
  }

  function makeDraft() {
    var r = S.current;
    if (!r) return;
    $('#ssStatus').textContent = 'Making the draft…';
    A().apiPost({ action: 'seasonRequest', key: r.key }).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Could not make the email.');
      $('#ssStatus').textContent = res.message;
      return reload();
    }).catch(function (err) {
      A().noteProblem('2027 sponsor email failed', err);
      $('#ssStatus').textContent = A().sendErrorText(err, "Couldn't make the email. Check your signal and try again.");
    });
  }

  function copyLink() {
    var r = S.current;
    if (!r || !r.intakeLink) return;
    var done = function () { $('#ssStatus').textContent = 'Form link copied. It only works for ' + r.company + '.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(r.intakeLink).then(done, function () { $('#ssStatus').textContent = r.intakeLink; });
    else $('#ssStatus').textContent = r.intakeLink;
  }

  function reload() {
    S.loaded = false;
    return load();
  }

  function scan() {
    $('#seasonStatus').textContent = 'Checking the sponsorship sheet, website form and payments…';
    $('#seasonScanBtn').disabled = true;
    A().apiPost({ action: 'seasonScan' }).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Check failed.');
      return reload().then(function () {
        $('#seasonStatus').textContent = res.added ? res.added + ' new sponsor' + (res.added > 1 ? 's' : '') + ' added.' : 'No new sponsors.';
      });
    }).catch(function (err) {
      A().noteProblem('2027 scan failed', err);
      $('#seasonStatus').textContent = A().sendErrorText(err, "Couldn't check right now. Try again in a minute.");
    }).finally(function () { $('#seasonScanBtn').disabled = false; });
  }

  function add(e) {
    e.preventDefault();
    var payload = { action: 'seasonAdd' };
    ['company', 'tier', 'amount', 'source', 'contactName', 'contactEmail', 'contactPhone', 'notes'].forEach(function (k) {
      payload[k] = $('#sa_' + k).value;
    });
    payload.paid = $('#sa_paid').checked;
    $('#sa_status').textContent = 'Adding…';
    A().apiPost(payload).then(function (res) {
      if (!res.ok) throw A().backendError(res.error || 'Could not add.');
      $('#seasonAddForm').reset();
      $('#seasonAddForm').classList.add('hidden');
      $('#sa_status').textContent = '';
      return reload();
    }).catch(function (err) {
      A().noteProblem('2027 add failed', err);
      $('#sa_status').textContent = A().sendErrorText(err, "Couldn't add. Check your signal and try again.");
    });
  }

  function wire() {
    $('#seasonFilter').addEventListener('change', function (e) { S.filter = e.target.value; render(); });
    $('#seasonScanBtn').addEventListener('click', scan);
    $('#seasonAddBtn').addEventListener('click', function () { $('#seasonAddForm').classList.toggle('hidden'); });
    $('#sa_cancel').addEventListener('click', function () { $('#seasonAddForm').classList.add('hidden'); });
    $('#seasonAddForm').addEventListener('submit', add);
    $('#ssClose').addEventListener('click', close);
    $('#detailScrim').addEventListener('click', function () { if (S.current) close(); });
    $('#ssSave').addEventListener('click', save);
    $('#ssDraftBtn').addEventListener('click', makeDraft);
    $('#ssCopyBtn').addEventListener('click', copyLink);
    window.addEventListener('popstate', function () {
      if (S.skipPop) { S.skipPop = false; return; }
      if (S.entry) { S.entry = false; hide(); }
    });
  }

  window.Season = {
    show: function () { if (!S.loaded) load(); else render(); },
    reset: function () { S.rows = []; S.loaded = false; $('#seasonList').innerHTML = ''; $('#seasonSummary').innerHTML = ''; }
  };

  document.addEventListener('DOMContentLoaded', wire);
})();

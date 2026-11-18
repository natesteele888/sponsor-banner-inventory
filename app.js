(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var NOT_CONFIGURED = !CFG.APPS_SCRIPT_URL || CFG.APPS_SCRIPT_URL.indexOf('PASTE_') === 0;

  var state = {
    banners: [],
    loaded: false,
    filter: 'all',
    search: '',
    imageCache: {},   // driveFileId:size -> data URI
    currentId: null,
    sheetEntry: false, // the open sheet added a history entry for the Back gesture
    skipPop: false     // the next popstate is us giving that entry back
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function currentToken() {
    var u = firebase.auth().currentUser;
    if (!u) return Promise.reject(new Error('Please sign in.'));
    return u.getIdToken();
  }

  function apiGet(params) {
    return apiPost(params);
  }

  function apiPost(body) {
    return currentToken().then(function (idToken) {
      return fetch(CFG.APPS_SCRIPT_URL, {
        method: 'POST',
        // text/plain avoids a CORS preflight against the Apps Script /exec
        // endpoint, which doesn't handle OPTIONS.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ idToken: idToken }, body))
      });
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res && res.ok === false && NO_ACCESS.test(String(res.error || ''))) lockOut(true);
      // Sponsors-only accounts (no Dashboard role): no links to the Dashboard.
      if (res && res.ok) document.body.classList.toggle('no-dash', res.dashboard === false);
      return res;
    });
  }

  // ---------- sign-in: the same accounts and roles as the LYBS Dashboard ----------

  // The backend checks the Dashboard role (board, director or admin) on every
  // call. When it says no, show one plain screen instead of empty tabs.
  var NO_ACCESS = /does not have board access/i;
  function lockOut(on) {
    document.body.classList.toggle('locked', !!on);
    $('#noAccess').classList.toggle('hidden', !on);
  }

  function setSignedIn(user) {
    $('#signin').classList.toggle('hidden', !!user);
    $('.topbar').classList.toggle('hidden', !user);
    $('#app').classList.toggle('hidden', !user);
  }

  function signInError(err) {
    var c = err && err.code;
    if (c === 'auth/popup-closed-by-user') return '';
    if (c === 'auth/invalid-credential' || c === 'auth/wrong-password' || c === 'auth/user-not-found' || c === 'auth/invalid-login-credentials') return 'That email or password is not right.';
    if (c === 'auth/unauthorized-domain') return 'This site is not allowed to sign in yet.';
    return 'Could not sign in. Please try again.';
  }

  function wireSignIn() {
    // No signal: the sign-in library never loaded. Say so instead of leaving a blank screen.
    if (typeof firebase === 'undefined') {
      $('#signin').classList.remove('hidden');
      $('#googleBtn').classList.add('hidden');
      $('#emailForm').classList.add('hidden');
      var m = $('#signinMsg');
      m.textContent = "Can't reach sign-in. Check your signal, then tap Try again.";
      var retry = document.createElement('button');
      retry.type = 'button'; retry.className = 'btn primary'; retry.textContent = 'Try again';
      retry.addEventListener('click', function () { location.reload(); });
      m.parentNode.insertBefore(retry, m.nextSibling);
      return;
    }
    firebase.initializeApp(CFG.FIREBASE);
    var auth = firebase.auth();
    var msg = $('#signinMsg');
    auth.getRedirectResult().catch(function (err) { msg.textContent = signInError(err); });
    $('#googleBtn').addEventListener('click', function () {
      msg.textContent = '';
      var provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      auth.signInWithPopup(provider).catch(function (err) {
        // A pop-up can fail inside an installed phone app; a full-page redirect still works there.
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].indexOf(err.code) >= 0) {
          return auth.signInWithRedirect(provider);
        }
        msg.textContent = signInError(err);
      });
    });
    $('#emailForm').addEventListener('submit', function (e) {
      e.preventDefault();
      msg.textContent = '';
      auth.signInWithEmailAndPassword($('#signinEmail').value.trim(), $('#signinPass').value)
        .catch(function (err) { msg.textContent = signInError(err); });
    });
    $('#signOutBtn').addEventListener('click', function () { auth.signOut(); });
    auth.onAuthStateChanged(function (user) {
      setSignedIn(user);
      $('#whoAmI').textContent = user ? 'Signed in as ' + (user.email || user.displayName || '') : '';
      lockOut(false);
      document.body.classList.remove('no-dash');
      if (!user) {
        state.banners = [];
        state.imageCache = {};
        state.loaded = false;
        $('#bannerList').innerHTML = '';
        if (window.Season) window.Season.reset();
        if (window.Sponsors) window.Sponsors.reset();
        return;
      }
      if (!state.loaded) loadBanners();
      if (window.Sponsors && !$('#view-sponsors').classList.contains('hidden')) window.Sponsors.show();
    });
  }

  // ---------- bootstrap ----------

  function showConfigWarning() {
    $('#status').textContent =
      'Not set up yet: paste your Apps Script Web App URL and access token into config.js (see README.md).';
  }

  function loadBanners() {
    $('#status').textContent = 'Loading…';
    $('#loadRetry').classList.add('hidden');
    return apiGet({ action: 'list' }).then(function (res) {
      if (!res.ok) {
        var denied = new Error(res.error || 'Could not load banners.');
        denied.fromBackend = true;
        throw denied;
      }
      state.banners = res.banners;
      state.loaded = true;
      $('#status').textContent = '';
      renderList();
      if (!$('#view-fields').classList.contains('hidden') && window.Fields) window.Fields.render();
    }).catch(function (err) {
      // The browser's own text ("Failed to fetch", "Unexpected token <") means
      // nothing to a person; only the backend's messages are worth showing.
      var fromBackend = err && err.fromBackend;
      noteProblem('Banner list did not load', err);
      $('#status').textContent = fromBackend ? err.message : "Can't reach the banner list. Check your signal, then tap Try again.";
      $('#loadRetry').classList.remove('hidden');
    });
  }

  // Saving and adding: same idea as the banner list above. Keep the backend's
  // own messages; swap the browser's text ("Failed to fetch") for a plain one.
  function backendError(text) {
    var e = new Error(text);
    e.fromBackend = true;
    return e;
  }
  // Log the failure on this phone for the Something wrong? report: a fixed
  // message only, never a sponsor's name or details.
  function noteProblem(what, err) {
    if (window.nateHealth) window.nateHealth.note('sync', what + (err && err.fromBackend ? ' (refused by the backend)' : ' (no answer)'));
  }
  function sendErrorText(err, noSignalText) {
    return err && err.fromBackend ? err.message : noSignalText;
  }

  // ---------- list view ----------

  function matchesFilter(b) {
    if (state.filter === 'hung') return b.hung;
    if (state.filter === 'notHung') return !b.hung;
    if (state.filter === 'onList') return b.onSponsorList;
    if (state.filter === 'legacy') return !b.onSponsorList;
    return true;
  }

  function matchesSearch(b) {
    if (!state.search) return true;
    return (b.sponsorName || '').toLowerCase().indexOf(state.search.toLowerCase()) > -1;
  }

  function renderList() {
    var list = $('#bannerList');
    var items = state.banners.filter(matchesFilter).filter(matchesSearch)
      .sort(function (a, b) { return (a.sponsorName || '').localeCompare(b.sponsorName || ''); });

    list.innerHTML = items.map(function (b) {
      return '<li class="banner-card" role="button" tabindex="0" data-id="' + esc(b.id) + '">' +
        '<div class="thumb-placeholder" data-thumb="' + b.driveFileId + '"></div>' +
        '<div class="info">' +
          '<div class="name">' + esc(b.sponsorName || '(unnamed)') + '</div>' +
          facts([b.tier, b.onSponsorList ? '2026 sponsor' : 'Past sponsor', spotText(b)]) +
        '</div>' +
        badge(b.hung ? 'Hung' : 'Not hung', b.hung ? 'ok' : 'muted') +
      '</li>';
    }).join('') || '<p class="hint">No banners match that filter.</p>';

    $$('#bannerList .banner-card').forEach(function (card) {
      card.addEventListener('click', function () { openDetail(card.dataset.id); });
      // A keyboard or screen reader opens a banner the same way a tap does.
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(card.dataset.id); }
      });
    });

    lazyLoadThumbs();
  }

  // One status per card, at its right edge; color only where it calls for
  // action (ok = done, warn = needs doing, muted = just so you know).
  function badge(text, tone) {
    return text ? '<span class="badge ' + (tone || 'muted') + '">' + esc(text) + '</span>' : '';
  }
  // The card's other facts: plain text in one line, not a row of pills.
  function facts(list) {
    var t = list.filter(function (x) { return x != null && String(x).trim(); }).map(esc).join(' · ');
    return t ? '<div class="facts">' + t + '</div>' : '';
  }
  function setBadge(el, text, tone) {
    el.textContent = text || '';
    el.className = 'badge ' + (tone || 'muted') + (text ? '' : ' hidden');
  }
  function spotText(b) {
    var s = window.Fields && window.Fields.parse(b.locationLabel);
    return s ? 'At ' + window.Fields.byId(s.field).name : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function lazyLoadThumbs() {
    var placeholders = $$('[data-thumb]');
    if (!('IntersectionObserver' in window)) {
      placeholders.forEach(loadThumb);
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          loadThumb(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '200px' });
    placeholders.forEach(function (el) { io.observe(el); });
  }

  function loadThumb(el) {
    var fileId = el.dataset.thumb;
    if (!fileId) return;
    fetchImage(fileId, 'thumb').then(function (dataUri) {
      if (!dataUri) return;
      var img = document.createElement('img');
      img.src = dataUri;
      img.alt = '';
      el.replaceWith(img);
    });
  }

  function fetchImage(driveFileId, size) {
    var key = driveFileId + ':' + size;
    if (state.imageCache[key]) return Promise.resolve(state.imageCache[key]);
    return apiGet({ action: 'image', id: driveFileId, size: size }).then(function (res) {
      if (!res.ok) return null;
      var uri = 'data:' + res.mime + ';base64,' + res.base64;
      state.imageCache[key] = uri;
      return uri;
    }).catch(function () { return null; });
  }

  // ---------- detail sheet ----------

  function openDetail(id) {
    var b = state.banners.find(function (x) { return String(x.id) === String(id); });
    if (!b) return;
    state.currentId = b.id;

    setBadge($('#detailBadge'), b.hung ? 'Hung' : 'Not hung', b.hung ? 'ok' : 'muted');
    $('#detailImg').removeAttribute('src');
    $('#detailImgStatus').textContent = 'Loading photo…';

    $('#f_sponsorName').value = b.sponsorName || '';
    $('#f_tier').value = b.tier || '';
    $('#f_amountPaid').value = b.amountPaid || '';
    $('#f_condition').value = b.condition || '';
    $('#f_contactName').value = b.contactName || '';
    $('#f_contactPhone').value = b.contactPhone || '';
    $('#f_contactEmail').value = b.contactEmail || '';
    $('#f_address').value = b.address || '';
    $('#f_onSponsorList').checked = !!b.onSponsorList;
    $('#f_hung').checked = !!b.hung;
    $('#f_notes').value = b.notes || '';

    if (window.Fields) window.Fields.pickerOpen(b);

    $('#detailStatus').textContent = '';
    $('#detailScrim').classList.remove('hidden');
    $('#detailSheet').classList.remove('hidden');
    // Without its own history entry, Back on a phone leaves the installed app.
    if (!state.sheetEntry && !state.skipPop) addSheetEntry();

    fetchImage(b.driveFileId, 'full').then(function (uri) {
      if (uri) {
        $('#detailImg').src = uri;
        $('#detailImgStatus').textContent = '';
      } else {
        $('#detailImgStatus').textContent = 'Could not load the photo.';
      }
    });
  }

  function addSheetEntry() {
    history.pushState({ bannerSheet: true }, '');
    state.sheetEntry = true;
  }

  function hideDetail() {
    $('#detailScrim').classList.add('hidden');
    $('#detailSheet').classList.add('hidden');
    state.currentId = null;
  }

  function closeDetail() {
    hideDetail();
    if (state.sheetEntry) {
      state.sheetEntry = false;
      state.skipPop = true;
      history.back();
    }
  }

  function onPopState() {
    if (state.skipPop) {
      state.skipPop = false;
      // A banner opened while the old entry was still being given back.
      if (state.currentId != null && !state.sheetEntry) addSheetEntry();
      return;
    }
    if (state.sheetEntry) {
      state.sheetEntry = false;
      hideDetail();
    }
  }

  function saveDetail() {
    var b = state.banners.find(function (x) { return String(x.id) === String(state.currentId); });
    if (!b) return;
    var payload = {
      action: 'update',
      id: b.id,
      sponsorName: $('#f_sponsorName').value,
      tier: $('#f_tier').value,
      amountPaid: $('#f_amountPaid').value,
      condition: $('#f_condition').value,
      contactName: $('#f_contactName').value,
      contactPhone: $('#f_contactPhone').value,
      contactEmail: $('#f_contactEmail').value,
      address: $('#f_address').value,
      onSponsorList: $('#f_onSponsorList').checked,
      hung: $('#f_hung').checked,
      notes: $('#f_notes').value
    };
    // Where it hangs: only sent when it changed, so a Save never wipes it by accident.
    var spot = window.Fields ? window.Fields.pickerValue() : undefined;
    if (spot !== undefined) payload.locationLabel = spot;
    $('#detailStatus').textContent = 'Saving…';
    apiPost(payload).then(function (res) {
      if (!res.ok) throw backendError(res.error || 'Save failed.');
      Object.keys(payload).forEach(function (k) { if (k !== 'action') b[k] = payload[k]; });
      $('#detailStatus').textContent = 'Saved.';
      renderList();
      if (!$('#view-fields').classList.contains('hidden') && window.Fields) window.Fields.render();
      setTimeout(function () { closeDetail(); }, 400);
    }).catch(function (err) {
      noteProblem('Banner save failed', err);
      $('#detailStatus').textContent = sendErrorText(err, "Couldn't save. Check your signal, then tap Save again.");
    });
  }

  // ---------- add view ----------

  function resetAddForm() {
    $('#addForm').reset();
    $('#addPreview').classList.add('hidden');
    $('#addCondition').value = 'Good';
    $('#addStatus').textContent = '';
  }

  function submitAdd(e) {
    e.preventDefault();
    var fileInput = $('#addPhoto');
    var file = fileInput.files[0];
    if (!file) { $('#addStatus').textContent = 'Choose a photo first.'; return; }

    var reader = new FileReader();
    reader.onload = function () {
      $('#addStatus').textContent = 'Uploading…';
      $('#addSubmit').disabled = true;
      apiPost({
        action: 'upload',
        photo: reader.result,
        sponsorName: $('#addSponsorName').value,
        tier: $('#addTier').value,
        amountPaid: $('#addAmount').value,
        contactName: $('#addContactName').value,
        contactPhone: $('#addContactPhone').value,
        contactEmail: $('#addContactEmail').value,
        address: $('#addAddress').value,
        condition: $('#addCondition').value,
        onSponsorList: $('#addOnList').checked,
        hung: $('#addHung').checked,
        notes: $('#addNotes').value
      }).then(function (res) {
        if (!res.ok) throw backendError(res.error || 'Upload failed.');
        resetAddForm();
        $('#addStatus').textContent = 'Added!';
        return loadBanners();
      }).catch(function (err) {
        noteProblem('New banner upload failed', err);
        $('#addStatus').textContent = sendErrorText(err, "Couldn't add the banner. Check your signal, then tap Add banner again.");
      }).finally(function () {
        $('#addSubmit').disabled = false;
      });
    };
    reader.readAsDataURL(file);
  }

  // ---------- navigation ----------

  function showView(name) {
    $$('.view').forEach(function (v) { v.classList.add('hidden'); });
    $('#view-' + name).classList.remove('hidden');
    var tab = name === 'add' ? 'list' : name; // adding a banner is part of Banner stock
    $$('.tab-btn').forEach(function (b) {
      var on = b.dataset.view === tab;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (name === 'fields' && window.Fields) window.Fields.show();
    if (name === 'season' && window.Season) window.Season.show();
    if (name === 'sponsors' && window.Sponsors) window.Sponsors.show();
  }

  // ---------- wire up ----------

  function init() {
    if (NOT_CONFIGURED) { showConfigWarning(); }

    $$('.tab-btn[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { showView(btn.dataset.view); });
    });

    $('#search').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderList();
    });
    $('#bannerFilter').addEventListener('change', function (e) {
      state.filter = e.target.value;
      renderList();
    });
    $('#addOpen').addEventListener('click', function () { showView('add'); });
    $('#addBack').addEventListener('click', function () { showView('list'); });

    window.addEventListener('popstate', onPopState);
    $('#loadRetry').addEventListener('click', loadBanners);
    $('#detailClose').addEventListener('click', closeDetail);
    $('#detailScrim').addEventListener('click', closeDetail);
    $('#detailSave').addEventListener('click', saveDetail);
    $('#f_hung').addEventListener('change', function () {
      var on = $('#f_hung').checked;
      setBadge($('#detailBadge'), on ? 'Hung' : 'Not hung', on ? 'ok' : 'muted');
    });

    $('#addForm').addEventListener('submit', submitAdd);
    $('#addPhoto').addEventListener('change', function () {
      var file = $('#addPhoto').files[0];
      if (!file) { $('#addPreview').classList.add('hidden'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        $('#addPreview').src = reader.result;
        $('#addPreview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });

    // A home-screen shortcut (manifest.json) opens a tab by its #name.
    var start = String(location.hash || '').slice(1);
    showView(['sponsors', 'season', 'list', 'fields'].indexOf(start) >= 0 ? start : 'sponsors');
    wireSignIn();
  }

  // The 2027 tab (season.js) shares the sign-in, backend and banner list.
  window.BannerApp = {
    apiPost: apiPost,
    esc: esc,
    badge: badge,
    facts: facts,
    setBadge: setBadge,
    openDetail: openDetail,
    refreshList: function () { renderList(); },
    loadThumbs: lazyLoadThumbs,
    backendError: backendError,
    noteProblem: noteProblem,
    sendErrorText: sendErrorText,
    banners: function () { return state.banners; },
    whenBannersLoaded: function () { return state.loaded ? Promise.resolve() : loadBanners(); }
  };

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  document.addEventListener('DOMContentLoaded', init);
})();

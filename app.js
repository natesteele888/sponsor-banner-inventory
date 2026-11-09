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
    map: null,
    mapMarkers: [],
    pinPicker: null,
    pendingPin: null,  // {lat,lng} chosen in the picker, not yet saved
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
    }).then(function (r) { return r.json(); });
  }

  // ---------- sign-in: the same accounts and roles as the LYBS Dashboard ----------

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
      if (!user) {
        state.banners = [];
        state.imageCache = {};
        state.loaded = false;
        $('#bannerList').innerHTML = '';
        return;
      }
      if (!state.loaded) loadBanners();
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
    }).catch(function (err) {
      // The browser's own text ("Failed to fetch", "Unexpected token <") means
      // nothing to a person; only the backend's messages are worth showing.
      var fromBackend = err && err.fromBackend;
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
      return '<li class="banner-card" data-id="' + b.id + '">' +
        '<div class="thumb-placeholder" data-thumb="' + b.driveFileId + '"></div>' +
        '<div class="info">' +
          '<div class="name">' + esc(b.sponsorName || '(unnamed)') + '</div>' +
          '<div class="meta">' +
            pill(b.hung ? 'Hung' : 'Not hung', b.hung ? 'hung' : 'not-hung') +
            (b.onSponsorList ? pill('2026 sponsor', 'on-list') : pill('Legacy', 'legacy')) +
            (b.tier ? pill(b.tier, '') : '') +
          '</div>' +
        '</div>' +
      '</li>';
    }).join('') || '<p class="hint">No banners match that filter.</p>';

    $$('.banner-card').forEach(function (card) {
      card.addEventListener('click', function () { openDetail(card.dataset.id); });
    });

    lazyLoadThumbs();
  }

  function pill(text, cls) {
    return '<span class="pill ' + cls + '">' + esc(text) + '</span>';
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
    state.pendingPin = null;

    $('#detailBadge').textContent = b.hung ? 'Hung' : 'Not hung';
    $('#detailBadge').className = 'pill ' + (b.hung ? 'hung' : 'not-hung');
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

    updatePinStatus(b);
    $('#pinPicker').classList.add('hidden');
    // Leaflet refuses to start twice on one element unless the old map is removed.
    if (state.pinPicker) { state.pinPicker.remove(); state.pinPicker = null; }
    $('#pinPicker').innerHTML = '';

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

  function updatePinStatus(b) {
    var lat = state.pendingPin ? state.pendingPin.lat : b.lat;
    var lng = state.pendingPin ? state.pendingPin.lng : b.lng;
    $('#pinStatus').textContent = (lat != null && lng != null)
      ? 'Pinned at ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5)
      : 'No pin dropped yet.';
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
    if (state.pendingPin) {
      payload.lat = state.pendingPin.lat;
      payload.lng = state.pendingPin.lng;
    }
    $('#detailStatus').textContent = 'Saving…';
    apiPost(payload).then(function (res) {
      if (!res.ok) throw backendError(res.error || 'Save failed.');
      Object.assign(b, payload);
      if (state.pendingPin) { b.lat = state.pendingPin.lat; b.lng = state.pendingPin.lng; }
      $('#detailStatus').textContent = 'Saved.';
      renderList();
      setTimeout(function () { closeDetail(); }, 400);
    }).catch(function (err) {
      $('#detailStatus').textContent = sendErrorText(err, "Couldn't save. Check your signal, then tap Save again.");
    });
  }

  function openPinPicker() {
    var picker = $('#pinPicker');
    picker.classList.remove('hidden');
    if (state.pinPicker) { state.pinPicker.invalidateSize(); return; }

    var b = state.banners.find(function (x) { return String(x.id) === String(state.currentId); });
    var start = state.pendingPin || (b.lat != null ? { lat: b.lat, lng: b.lng } : { lat: 42.6757, lng: -71.7323 }); // Lunenburg, MA

    var map = L.map(picker, { attributionControl: true }).setView([start.lat, start.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    var marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map);
    marker.on('dragend', function () {
      var p = marker.getLatLng();
      state.pendingPin = { lat: p.lat, lng: p.lng };
      updatePinStatus(b);
    });
    map.on('click', function (e) {
      marker.setLatLng(e.latlng);
      state.pendingPin = { lat: e.latlng.lat, lng: e.latlng.lng };
      updatePinStatus(b);
    });

    state.pinPicker = map;
  }

  // ---------- map view ----------

  function renderMap() {
    if (!state.map) {
      state.map = L.map('map').setView([42.6757, -71.7323], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(state.map);
    } else {
      state.map.invalidateSize();
    }
    state.mapMarkers.forEach(function (m) { state.map.removeLayer(m); });
    state.mapMarkers = [];

    var pinned = state.banners.filter(function (b) { return b.lat != null && b.lng != null; });
    pinned.forEach(function (b) {
      var marker = L.marker([b.lat, b.lng]).addTo(state.map);
      marker.bindPopup(
        '<b>' + esc(b.sponsorName) + '</b><br>' + (b.hung ? 'Hung' : 'Not hung') +
        '<br><a href="#" data-open-id="' + b.id + '">Open</a>'
      );
      marker.on('popupopen', function () {
        var link = document.querySelector('[data-open-id="' + b.id + '"]');
        if (link) link.addEventListener('click', function (e) { e.preventDefault(); openDetail(b.id); });
      });
      state.mapMarkers.push(marker);
    });

    if (pinned.length) {
      state.map.fitBounds(L.latLngBounds(pinned.map(function (b) { return [b.lat, b.lng]; })), { padding: [30, 30], maxZoom: 17 });
    }
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
    $$('.tab-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.view === name); });
    if (name === 'map') renderMap();
  }

  // ---------- wire up ----------

  function init() {
    if (NOT_CONFIGURED) { showConfigWarning(); }

    // Sign out is styled as a tab but has no view of its own.
    $$('.tab-btn[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () { showView(btn.dataset.view); });
    });

    $('#search').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderList();
    });
    $$('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.dataset.filter;
        $$('.chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        renderList();
      });
    });

    window.addEventListener('popstate', onPopState);
    $('#loadRetry').addEventListener('click', loadBanners);
    $('#detailClose').addEventListener('click', closeDetail);
    $('#detailScrim').addEventListener('click', closeDetail);
    $('#detailSave').addEventListener('click', saveDetail);
    $('#f_hung').addEventListener('change', function () {
      $('#detailBadge').textContent = $('#f_hung').checked ? 'Hung' : 'Not hung';
      $('#detailBadge').className = 'pill ' + ($('#f_hung').checked ? 'hung' : 'not-hung');
    });
    $('#dropPinBtn').addEventListener('click', openPinPicker);

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

    showView('list');
    wireSignIn();
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  document.addEventListener('DOMContentLoaded', init);
})();

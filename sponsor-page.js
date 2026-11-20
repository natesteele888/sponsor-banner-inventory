/**
 * The sponsor's own info page, opened from the link in their receipt.
 * Public: no sign-in, only the personal token in the link (?t=...). The
 * backend shows this page that one sponsor's business, contact name, the
 * level they paid for and the levels above it, and nothing else.
 */
(function () {
  'use strict';

  var URL_ = (window.APP_CONFIG || {}).APPS_SCRIPT_URL;
  var MAX_FILE = 15 * 1024 * 1024;
  var token = new URLSearchParams(location.search).get('t') || '';
  var $ = function (id) { return document.getElementById(id); };
  var P = null;          // what the backend sent
  var pick = '';         // the upgrade they picked, or '' for the level they paid for

  function call(body) {
    return fetch(URL_, {
      method: 'POST',
      // text/plain skips a CORS preflight, which Apps Script /exec can't answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ t: token }, body))
    }).then(function (r) { return r.json(); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    n = Number(n) || 0;
    return '$' + (n % 1 ? n.toFixed(2) : String(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function readFile(input, kind) {
    var f = input.files && input.files[0];
    if (!f) return Promise.resolve(null);
    if (f.size > MAX_FILE) return Promise.reject(new Error(f.name + ' is larger than 15 MB. Paste a share link for it instead.'));
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () { resolve({ kind: kind, data: rd.result }); };
      rd.onerror = function () { reject(new Error('Could not read ' + f.name + '.')); };
      rd.readAsDataURL(f);
    });
  }

  function level() {
    var want = pick || P.paid.level;
    return P.levels.filter(function (l) { return l.name === want; })[0] || level0();
  }

  // What each level gets, in plain words, from what it asks for.
  function gets(l) {
    return [l.jersey ? 'Name on the jersey' : 'Business name only', l.logo ? 'your logo' : '',
      l.writeup ? 'a ' + l.writeup + '-character write-up' : '', l.banner ? '3x5 banner at the field' : '']
      .filter(Boolean).join(', ');
  }

  // Each level's perks, as a check-list: what it has, and (greyed) what it doesn't.
  function perks(l) {
    var listing = l.writeup >= 800 ? 'Full-width spot on our sponsor page, ' + l.writeup + '-character write-up and link'
      : l.writeup ? 'Half-width spot on our sponsor page, ' + l.writeup + '-character write-up and link'
      : l.logo ? 'Logo and link on our sponsor page' : 'Name on our sponsor page';
    return [
      [true, 'Logo on our homepage'],
      [true, listing],
      [l.jersey, 'Business name on a team jersey'],
      [l.banner, "3' x 5' outfield banner"],
      [l.photo, 'Framed team photo'],
      [!!l.social, l.social > 1 ? '2 to 3 social media spotlights a year' : 'Social media spotlight']
    ];
  }
  // One short line: what this level adds over the one below it.
  function tagline(l, i) {
    var prev = i > 0 ? P.levels[i - 1] : null;
    if (!prev) return l.price ? 'Support the league' : 'Any amount helps';
    if (l.jersey && !prev.jersey) return 'Your name on a team jersey';
    if (l.banner && !prev.banner) return 'Adds a banner and a write-up';
    if (l.writeup > prev.writeup) return 'Our biggest spotlight';
    return 'More time in the spotlight';
  }
  function priceText(l) { return l.price ? money(l.price) + (l.plus ? '+' : '') : 'Any amount'; }

  // The levels side by side, low to high, like a price table: theirs
  // highlighted as paid, higher ones with an Upgrade button for the
  // difference, lower ones greyed with no button. On a phone they swipe.
  function renderLevels() {
    var html = P.levels.map(function (l, i) {
      var paid = l.state === 'paid', below = l.state === 'below', on = paid ? !pick : pick === l.name;
      var badge = paid ? '<span class="lv-badge">Your level · Paid</span>'
        : on ? '<span class="lv-badge lv-badge-up">Upgrade picked</span>' : '';
      var price = paid && P.paid.amount ? money(P.paid.amount) : priceText(l);
      var sub = paid ? 'Paid for the ' + esc(P.season || '') + ' season'
        : below ? 'Included in your level' : money(l.owed) + ' more than you paid';
      var act = paid
        ? (pick ? '<button type="button" class="btn small lv-act" data-keep="1">Keep ' + esc(l.name) + '</button>'
                : '<div class="lv-lock">Your info for this level goes below.</div>')
        : below ? ''
        : on ? '<div class="lv-lock lv-lock-up">Picked. How to pay the difference is below.</div>'
        : '<button type="button" class="btn primary lv-act" data-up="' + esc(l.name) + '">Upgrade for ' + money(l.owed) + '</button>';
      var list = perks(l).map(function (p) {
        return '<li class="' + (p[0] ? 'lv-yes' : 'lv-no') + '">' + esc(p[1]) + '</li>';
      }).join('');
      return '<li class="lv' + (paid ? ' lv-paid' : below ? ' lv-below' : ' lv-up') + (on ? ' lv-on' : '') + '"' + (on ? ' data-mine="1"' : '') + '>' +
        badge + '<div class="lv-head"><div class="lv-name">' + esc(l.name) + '</div><div class="lv-tag">' + esc(tagline(l, i)) + '</div>' +
        '<div class="lv-price">' + price + '</div><div class="lv-sub">' + sub + '</div></div>' +
        '<ul class="lv-perks">' + list + '</ul>' +
        // The button (or their level's note) sits at the bottom, so every
        // card's perk list starts at the same height.
        '<div class="lv-foot">' + act + '</div></li>';
    }).join('');
    $('levelList').innerHTML = html;
    alignRows();
    // On a phone, bring their level (or the upgrade they picked) into view.
    var mine = $('levelList').querySelector('[data-mine]'), list = $('levelList');
    if (mine && list.scrollWidth > list.clientWidth + 4) list.scrollLeft = mine.offsetLeft - (list.clientWidth - mine.offsetWidth) / 2;
    var lv = level();
    $('formFor').textContent = pick
      ? 'Your info for ' + lv.name + '. It counts once the ' + money(lv.owed) + ' difference is paid; until then you stay at ' + P.paid.level + '.'
      : 'Your info for ' + lv.name + '.';
    showFields();
    $('writeup').maxLength = lv.writeup || 0;
    $('writeupMax').textContent = lv.writeup || 0;
    if ($('writeup').value.length > lv.writeup) $('writeup').value = $('writeup').value.slice(0, lv.writeup);
    $('writeupCount').textContent = $('writeup').value.length;
    renderPay($('payBox'), pick ? lv : null);
  }

  // Line the cards up like a comparison table: the top part and each perk
  // row get the height of the tallest one across the four cards, so every
  // benefit sits on the same line on every card.
  function alignRows() {
    var cards = Array.prototype.slice.call(document.querySelectorAll('#levelList .lv'));
    if (!cards.length) return;
    var rows = [cards.map(function (c) { return c.querySelector('.lv-head'); })];
    var n = cards[0].querySelectorAll('.lv-perks li').length;
    for (var i = 0; i < n; i++) rows.push(cards.map(function (c) { return c.querySelectorAll('.lv-perks li')[i]; }));
    rows.forEach(function (row) {
      row.forEach(function (el) { if (el) el.style.minHeight = ''; });
      var h = Math.max.apply(null, row.map(function (el) { return el ? el.getBoundingClientRect().height : 0; }));
      if (h > 0) row.forEach(function (el) { if (el) el.style.minHeight = h + 'px'; });
    });
  }
  var alignT = 0;
  window.addEventListener('resize', function () { clearTimeout(alignT); alignT = setTimeout(alignRows, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { alignRows(); });

  // How to pay the difference for an upgrade.
  function renderPay(box, lv) {
    if (!lv) { box.classList.add('hidden'); box.innerHTML = ''; return; }
    var p = P.pay || {}, ways = [];
    if (p.venmo) ways.push('<li><b>Venmo:</b> ' + esc(p.venmo) + '. Put your business name in the note.</li>');
    if (p.online) ways.push('<li><b>Online:</b> <a href="' + esc(p.online) + '" target="_blank" rel="noopener">pay on our website</a>, with your business name.</li>');
    ways.push('<li><b>Check:</b> payable to ' + esc(p.checkTo || 'the league') + (p.address ? ', mailed to ' + esc(p.address) : '') + '. Put your business name on the memo line.</li>');
    if (p.cash) ways.push('<li><b>Cash:</b> hand it to any LYBS board member.</li>');
    box.innerHTML = '<h2>Pay the ' + esc(money(lv.owed)) + ' difference</h2>' +
      '<p>Your upgrade to ' + esc(lv.name) + ' counts once we get it. Any of these work:</p><ul class="lv-ways">' + ways.join('') + '</ul>' +
      '<p class="hint">Until then your sponsorship stays at ' + esc(P.paid.level) + (lv.banner && !level0().banner ? ', and the banner comes once the upgrade is paid' : '') + '.</p>';
    box.classList.remove('hidden');
  }
  function level0() { return P.levels.filter(function (l) { return l.state === 'paid'; })[0] || {}; }

  // "Same as last year" (returning sponsors): which parts of this level we
  // already have from last season. A part last year's level didn't have stays
  // a normal question.
  function sameCovers(need) { return !!(P && P.lastYear && $('sameLast').checked && P.lastYear[need]); }
  function sameOn() { return !!(P && P.lastYear && $('sameLast').checked); }

  // Only the fields this level uses, minus what "Same as last year" covers.
  function showFields() {
    var lv = level(), same = sameOn();
    Array.prototype.forEach.call(document.querySelectorAll('[data-need]'), function (el) {
      var need = el.getAttribute('data-need');
      el.classList.toggle('hidden', !lv[need] || sameCovers(need));
    });
    // The rest of the listing (business name, website, socials) is last
    // year's too, so it folds away; the listing shows only what's still asked.
    var set = $('listingSet');
    Array.prototype.forEach.call(set.querySelectorAll('label:not([data-need])'), function (el) { el.classList.toggle('hidden', same); });
    set.classList.toggle('hidden', !Array.prototype.some.call(set.querySelectorAll('label'), function (el) { return !el.classList.contains('hidden'); }));
    if (P && P.lastYear) {
      var keep = [lv.logo && P.lastYear.logo ? 'logo' : '', lv.jersey && P.lastYear.jersey ? 'jersey name' : '',
        lv.banner && P.lastYear.banner ? 'banner' : '', lv.writeup && P.lastYear.writeup ? 'write-up' : '', 'listing'].filter(Boolean);
      var list = keep.length > 1 ? keep.slice(0, -1).join(', ') + ' and ' + keep[keep.length - 1] : keep[0];
      $('sameWhat').textContent = 'We\'ll reuse your ' + list + ' from last season. Just check your contact info and tap Send.';
      $('keepWhat').textContent = 'Nothing changed since last year? We\'ll reuse your ' + list + ' from last season' +
        (oneTap() ? ', and you\'re done.' : '. We\'ll only ask what\'s new.');
    }
    syncKeep();
  }

  // "Keep last year's info": shown to a returning sponsor until they choose
  // to make changes or pick an upgrade. The form waits behind it.
  var editing = false;
  function oneTap() {
    var lv = level(), y = P && P.lastYear;
    return !!(y && y.contact && ['jersey', 'logo', 'writeup', 'banner'].every(function (n) { return !lv[n] || y[n]; }));
  }
  function syncKeep() {
    var on = !!(P && P.lastYear && !P.sent && !editing && !pick);
    $('keepBox').classList.toggle('hidden', !on);
    $('pageForm').classList.toggle('hidden', on || !P);
    $('lvNext').classList.toggle('hidden', on);
  }
  function openForm(same) {
    editing = true; $('sameLast').checked = !!same; showFields();
    var f = $('pageForm'); if (f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function keep() {
    // Something new on their level, or no email on file: the short form,
    // with only what's still needed.
    if (!oneTap()) { openForm(true); return; }
    var msg = $('keepMsg');
    $('keepBtn').disabled = true; $('editBtn').disabled = true;
    msg.textContent = 'Sending…';
    call({ action: 'sponsorPageSubmit', upgradeTo: pick,
      fields: { same: true, contactName: $('contactName').value, contactEmail: '', more: '' }, files: [] })
      .then(function (res) {
        if (!res.ok) throw Object.assign(new Error(res.error), { fromBackend: true });
        finish(res, true);
      }).catch(function (err) {
        msg.textContent = err && err.fromBackend ? err.message : "That didn't go through. Check your connection and tap the button again.";
      }).finally(function () { $('keepBtn').disabled = false; $('editBtn').disabled = false; });
  }
  function finish(res, kept) {
    ['pageForm', 'levels', 'greet', 'keepBox'].forEach(function (id) { $(id).classList.add('hidden'); });
    $('doneText').textContent = res.upgrade
      ? 'We have your info. Your upgrade to ' + res.upgrade.to + ' counts once we get the ' + money(res.upgrade.owed) + ' difference.'
      : kept ? "We'll use what we have from last season. If anything's missing, we'll reach out by email."
      : "We have your info. If we need anything else, we'll reach out by email.";
    if (!res.upgrade) renderPay($('payBox'), null);
    $('done').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function showChoice() {
    var v = $('bannerChoice').value;
    $('designWrap').classList.toggle('hidden', v.indexOf('attaching') < 0);
    $('bannerTextWrap').classList.toggle('hidden', !v || v.indexOf('Reuse') === 0);
  }

  // This sponsor's page as last loaded on this device, so a second visit
  // shows at once while a fresh copy loads. Only their own business name,
  // contact name, levels and how to pay; kept a week.
  var SAVE_KEY = 'lybsSponsorPage_' + token.slice(0, 12), SAVE_DAYS = 7;
  function saved() {
    try {
      var o = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      return o && o.t === token && o.at > Date.now() - SAVE_DAYS * 864e5 && o.res && o.res.ok ? o.res : null;
    } catch (e) { return null; }
  }
  function save(res) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ t: token, at: Date.now(), res: res })); } catch (e) { }
  }

  // Fills the page from what the backend sent. The form's own boxes are only
  // filled while empty, so a fresh copy never writes over what they typed.
  function show(res) {
    P = res;
    // Their business name a touch bigger and bold, the ask on its own line.
    $('greet').innerHTML = 'Thank you, <b class="greet-co">' + esc(res.company) + '</b>!<br>Please send us your info by ' + esc(res.deadline) + '.' +
      (res.sent ? ' We already have your info; sending again adds an update.' : '');
    if (res.contactName && !$('contactName').value) $('contactName').value = res.contactName.replace(/^(manager|owner)\s*:\s*/i, '');
    if (!$('business').value) $('business').value = res.company;
    $('sameBox').classList.toggle('hidden', !res.lastYear);
    $('jerseyName').placeholder = res.company;
    if (res.upgrade) {
      $('pending').textContent = 'You asked to upgrade to ' + res.upgrade.to + '. It counts once we get the ' + money(res.upgrade.owed) + ' difference.';
      $('pending').classList.remove('hidden');
    } else $('pending').classList.add('hidden');
    $('levels').classList.remove('hidden');
    renderLevels();
    syncKeep();
  }

  function load() {
    if (!token) {
      $('greet').textContent = 'This page needs the personal link from your LYBS receipt email. Please open it from there, or just reply to that email.';
      return;
    }
    var early = saved(), fresh = false;
    if (early) show(early);
    // If the backend never answers, say so rather than sit on "Loading".
    var slow = setTimeout(function () {
      if (!fresh && !early) $('greet').textContent = "This is taking longer than it should. Refresh the page, or just reply to the email and we'll sort it out.";
    }, 20000);
    call({ action: 'sponsorPageGet' }).then(function (res) {
      clearTimeout(slow); fresh = true;
      if (!res || !res.ok) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
        $('levels').classList.add('hidden'); $('pageForm').classList.add('hidden');
        $('greet').textContent = (res && res.error) || "We couldn't load your page. Refresh, or just reply to the email.";
        return;
      }
      save(res);
      show(res);
    }).catch(function () {
      clearTimeout(slow);
      if (!early) $('greet').textContent = "We couldn't load your page. Check your connection and refresh, or just reply to the email.";
    });
  }

  function submit(e) {
    e.preventDefault();
    var msg = $('formMsg'), lv = level();
    var need = [['contactName', 'your name'], ['contactEmail', 'your email']];
    if (lv.jersey && !sameCovers('jersey')) need.push(['jerseyName', 'the name for the jersey']);
    if (lv.banner && !sameCovers('banner')) need.push(['bannerChoice', 'a banner choice']);
    for (var i = 0; i < need.length; i++) {
      if (!$(need[i][0]).value.trim()) { msg.textContent = 'Please add ' + need[i][1] + '.'; $(need[i][0]).focus(); return; }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('contactEmail').value.trim())) {
      msg.textContent = 'Please check your email address.'; $('contactEmail').focus(); return;
    }
    if (lv.logo && !P.sent && !sameCovers('logo') && !$('logoFile').files.length && !$('fileLink').value.trim()) {
      msg.textContent = 'Please attach your logo, or paste a link to it.'; return;
    }
    $('sendBtn').disabled = true;
    msg.textContent = 'Sending… big files can take a minute.';
    var same = sameOn();
    var files = [lv.logo && !sameCovers('logo') ? readFile($('logoFile'), 'logo') : null,
      lv.banner && !sameCovers('banner') ? readFile($('designFile'), 'design') : null];
    Promise.all(files).then(function (got) {
      return call({
        action: 'sponsorPageSubmit',
        upgradeTo: pick,
        fields: {
          contactName: $('contactName').value, contactEmail: $('contactEmail').value, contactPhone: $('contactPhone').value,
          // With "Same as last year" on, a part it covers goes blank and the
          // league reuses last season's.
          business: same ? '' : $('business').value, jerseyName: lv.jersey && !sameCovers('jersey') ? $('jerseyName').value : '',
          website: same ? '' : $('website').value, facebook: same ? '' : $('facebook').value,
          instagram: same ? '' : $('instagram').value, otherSocial: same ? '' : $('otherSocial').value,
          writeup: lv.writeup && !sameCovers('writeup') ? $('writeup').value : '', sponsoring: same ? '' : $('sponsoring').value,
          bannerChoice: lv.banner && !sameCovers('banner') ? $('bannerChoice').value : '',
          bannerText: lv.banner && !sameCovers('banner') ? $('bannerText').value : '',
          same: same,
          fileLink: $('fileLink').value, more: $('more').value
        },
        files: got.filter(Boolean)
      });
    }).then(function (res) {
      if (!res.ok) throw Object.assign(new Error(res.error), { fromBackend: true });
      finish(res, false);
    }).catch(function (err) {
      msg.textContent = err && (err.fromBackend || /15 MB|read /.test(err.message))
        ? err.message
        : "That didn't go through. Check your connection and tap Send again.";
    }).finally(function () { $('sendBtn').disabled = false; });
  }

  $('levelList').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    pick = b.getAttribute('data-up') || '';
    renderLevels();
  });
  $('bannerChoice').addEventListener('change', showChoice);
  $('sameLast').addEventListener('change', showFields);
  $('keepBtn').addEventListener('click', keep);
  $('editBtn').addEventListener('click', function () { openForm(false); });
  $('writeup').addEventListener('input', function () { $('writeupCount').textContent = $('writeup').value.length; });
  $('pageForm').addEventListener('submit', submit);
  // Lets a tap show the Upgrade button's pressed glow on iPhones too.
  document.addEventListener('touchstart', function () { }, { passive: true });
  load();
})();

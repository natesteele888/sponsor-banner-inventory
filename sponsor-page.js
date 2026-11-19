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
    return P.levels.filter(function (l) { return l.name === want; })[0] || P.levels[0];
  }

  // What each level gets, in plain words, from what it asks for.
  function gets(l) {
    return [l.jersey ? 'Name on the jersey' : 'Business name only', l.logo ? 'your logo' : '',
      l.writeup ? 'a ' + l.writeup + '-character write-up' : '', l.banner ? '3x5 banner at the field' : '']
      .filter(Boolean).join(', ');
  }

  function renderLevels() {
    var html = P.levels.map(function (l) {
      if (l.state === 'paid') {
        return '<li class="lv lv-paid' + (pick ? '' : ' lv-on') + '"><div class="lv-top"><b>' + esc(l.name) + '</b><span class="lv-badge">Paid</span></div>' +
          '<div class="lv-price">' + money(P.paid.amount) + '</div><div class="lv-gets">' + esc(gets(l)) + '</div>' +
          (pick ? '<button type="button" class="btn small" data-keep="1">Keep ' + esc(l.name) + '</button>'
                : '<div class="lv-lock">This is the level you picked and paid for. Your info goes below.</div>') + '</li>';
      }
      var on = pick === l.name;
      return '<li class="lv lv-up' + (on ? ' lv-on' : '') + '"><div class="lv-top"><b>' + esc(l.name) + '</b>' +
        (on ? '<span class="lv-badge lv-badge-up">Upgrade picked</span>' : '<span class="lv-opt">Optional upgrade</span>') + '</div>' +
        '<div class="lv-price">' + money(l.price) + ' <span>(' + money(l.owed) + ' more)</span></div><div class="lv-gets">' + esc(gets(l)) + '</div>' +
        (on ? '' : '<button type="button" class="btn small" data-up="' + esc(l.name) + '">Upgrade for ' + money(l.owed) + ' more</button>') + '</li>';
    }).join('');
    $('levelList').innerHTML = html;
    var lv = level();
    $('formFor').textContent = pick
      ? 'Your info for ' + lv.name + '. It counts once the ' + money(lv.owed) + ' difference is paid; until then you stay at ' + P.paid.level + '.'
      : 'Your info for ' + lv.name + '.';
    // Only the fields this level uses.
    Array.prototype.forEach.call(document.querySelectorAll('[data-need]'), function (el) {
      el.classList.toggle('hidden', !lv[el.getAttribute('data-need')]);
    });
    $('writeup').maxLength = lv.writeup || 0;
    $('writeupMax').textContent = lv.writeup || 0;
    if ($('writeup').value.length > lv.writeup) $('writeup').value = $('writeup').value.slice(0, lv.writeup);
    $('writeupCount').textContent = $('writeup').value.length;
    renderPay($('payBox'), pick ? lv : null);
  }

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

  function showChoice() {
    var v = $('bannerChoice').value;
    $('designWrap').classList.toggle('hidden', v.indexOf('attaching') < 0);
    $('bannerTextWrap').classList.toggle('hidden', !v || v.indexOf('Reuse') === 0);
  }

  function load() {
    if (!token) {
      $('greet').textContent = 'This page needs the personal link from your LYBS receipt email. Please open it from there, or just reply to that email.';
      return;
    }
    // If the backend never answers, say so rather than sit on "Loading".
    var slow = setTimeout(function () {
      if (!P) $('greet').textContent = "This is taking longer than it should. Refresh the page, or just reply to the email and we'll sort it out.";
    }, 20000);
    call({ action: 'sponsorPageGet' }).then(function (res) {
      clearTimeout(slow);
      if (!res || !res.ok) { $('greet').textContent = (res && res.error) || "We couldn't load your page. Refresh, or just reply to the email."; return; }
      P = res;
      $('greet').textContent = 'Thank you, ' + res.company + '! Please send us your info by ' + res.deadline + '.' +
        (res.sent ? ' We already have your info; sending again adds an update.' : '');
      if (res.contactName) $('contactName').value = res.contactName.replace(/^(manager|owner)\s*:\s*/i, '');
      $('business').value = res.company;
      $('jerseyName').placeholder = res.company;
      if (res.upgrade) {
        $('pending').textContent = 'You asked to upgrade to ' + res.upgrade.to + '. It counts once we get the ' + money(res.upgrade.owed) + ' difference.';
        $('pending').classList.remove('hidden');
      }
      $('levels').classList.remove('hidden');
      $('pageForm').classList.remove('hidden');
      renderLevels();
    }).catch(function () {
      clearTimeout(slow);
      $('greet').textContent = "We couldn't load your page. Check your connection and refresh, or just reply to the email.";
    });
  }

  function submit(e) {
    e.preventDefault();
    var msg = $('formMsg'), lv = level();
    var need = [['contactName', 'your name'], ['contactEmail', 'your email']];
    if (lv.jersey) need.push(['jerseyName', 'the name for the jersey']);
    if (lv.banner) need.push(['bannerChoice', 'a banner choice']);
    for (var i = 0; i < need.length; i++) {
      if (!$(need[i][0]).value.trim()) { msg.textContent = 'Please add ' + need[i][1] + '.'; $(need[i][0]).focus(); return; }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('contactEmail').value.trim())) {
      msg.textContent = 'Please check your email address.'; $('contactEmail').focus(); return;
    }
    if (lv.logo && !P.sent && !$('logoFile').files.length && !$('fileLink').value.trim()) {
      msg.textContent = 'Please attach your logo, or paste a link to it.'; return;
    }
    $('sendBtn').disabled = true;
    msg.textContent = 'Sending… big files can take a minute.';
    var files = [lv.logo ? readFile($('logoFile'), 'logo') : null, lv.banner ? readFile($('designFile'), 'design') : null];
    Promise.all(files).then(function (got) {
      return call({
        action: 'sponsorPageSubmit',
        upgradeTo: pick,
        fields: {
          contactName: $('contactName').value, contactEmail: $('contactEmail').value, contactPhone: $('contactPhone').value,
          business: $('business').value, jerseyName: lv.jersey ? $('jerseyName').value : '', website: $('website').value,
          facebook: $('facebook').value, instagram: $('instagram').value, otherSocial: $('otherSocial').value,
          writeup: lv.writeup ? $('writeup').value : '', sponsoring: $('sponsoring').value,
          bannerChoice: lv.banner ? $('bannerChoice').value : '', bannerText: lv.banner ? $('bannerText').value : '',
          fileLink: $('fileLink').value, more: $('more').value
        },
        files: got.filter(Boolean)
      });
    }).then(function (res) {
      if (!res.ok) throw Object.assign(new Error(res.error), { fromBackend: true });
      ['pageForm', 'levels', 'greet'].forEach(function (id) { $(id).classList.add('hidden'); });
      $('doneText').textContent = res.upgrade
        ? 'We have your info. Your upgrade to ' + res.upgrade.to + ' counts once we get the ' + money(res.upgrade.owed) + ' difference.'
        : "We have your info. If we need anything else, we'll reach out by email.";
      if (!res.upgrade) renderPay($('payBox'), null);
      $('done').classList.remove('hidden');
      window.scrollTo(0, 0);
    }).catch(function (err) {
      msg.textContent = err && (err.fromBackend || /15 MB|read /.test(err.message))
        ? err.message
        : "That didn't go through. Check your connection and tap Send again.";
    }).finally(function () { $('sendBtn').disabled = false; });
  }

  $('levelList').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    pick = b.getAttribute('data-up') || '';
    renderLevels();
  });
  $('bannerChoice').addEventListener('change', showChoice);
  $('writeup').addEventListener('input', function () { $('writeupCount').textContent = $('writeup').value.length; });
  $('pageForm').addEventListener('submit', submit);
  load();
})();

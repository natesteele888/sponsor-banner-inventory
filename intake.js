/**
 * The sponsor reply form. Public: no sign-in, only the personal token from
 * the sponsor's email (?t=...). The backend shows this page that one
 * sponsor's company, level and contact name, and nothing else.
 */
(function () {
  'use strict';

  var URL_ = (window.APP_CONFIG || {}).APPS_SCRIPT_URL;
  var MAX_FILE = 15 * 1024 * 1024;
  var token = new URLSearchParams(location.search).get('t') || '';
  var $ = function (id) { return document.getElementById(id); };

  function call(body) {
    return fetch(URL_, {
      method: 'POST',
      // text/plain skips a CORS preflight, which Apps Script /exec can't answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ t: token }, body))
    }).then(function (r) { return r.json(); });
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

  function showChoice() {
    var v = $('bannerChoice').value;
    $('designWrap').classList.toggle('hidden', v.indexOf('attaching') < 0);
    $('bannerTextWrap').classList.toggle('hidden', !v || v.indexOf('Reuse') === 0);
  }

  function load() {
    if (!token) {
      $('greet').textContent = 'This page needs the personal link from your LYBS email. Please open it from there, or just reply to that email.';
      return;
    }
    // If the backend never answers (one weak bar), say so rather than sit on "Loading".
    var slow = setTimeout(function () {
      $('greet').textContent = "This is taking longer than it should. Refresh the page, or just reply to the email and we'll sort it out.";
    }, 20000);
    call({ action: 'intakeGet' }).then(function (res) {
      clearTimeout(slow);
      if (!res.ok) { $('greet').textContent = res.error; return; }
      $('greet').textContent = 'Thank you, ' + res.company + '! ' +
        (res.tier ? 'For your ' + res.tier + ' sponsorship, p' : 'P') +
        'lease send us these by ' + res.deadline + '.' +
        (res.alreadySent ? ' We already have your info; sending again updates it.' : '');
      if (res.contactName) $('contactName').value = res.contactName.replace(/^(manager|owner)\s*:\s*/i, '');
      $('jerseyName').placeholder = res.company;
      $('intakeForm').classList.remove('hidden');
    }).catch(function () {
      clearTimeout(slow);
      $('greet').textContent = "We couldn't load the form. Check your connection and refresh, or just reply to the email.";
    });
  }

  function submit(e) {
    e.preventDefault();
    var msg = $('formMsg');
    var need = [['contactName', 'your name'], ['contactEmail', 'your email'], ['jerseyName', 'the jersey name'], ['bannerChoice', 'a banner choice']];
    for (var i = 0; i < need.length; i++) {
      if (!$(need[i][0]).value.trim()) { msg.textContent = 'Please add ' + need[i][1] + '.'; $(need[i][0]).focus(); return; }
    }
    // novalidate skips the browser's own check, so a typo like "bob.gmail" would be saved.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('contactEmail').value.trim())) {
      msg.textContent = 'Please check your email address.'; $('contactEmail').focus(); return;
    }
    if (!$('logoFile').files.length && !$('fileLink').value.trim()) {
      msg.textContent = 'Please attach your logo, or paste a link to it.'; return;
    }
    $('sendBtn').disabled = true;
    msg.textContent = 'Sending… big files can take a minute.';
    Promise.all([readFile($('logoFile'), 'logo'), readFile($('designFile'), 'design')]).then(function (files) {
      return call({
        action: 'intakeSubmit',
        fields: {
          contactName: $('contactName').value, contactEmail: $('contactEmail').value,
          contactPhone: $('contactPhone').value, website: $('website').value,
          jerseyName: $('jerseyName').value, writeup: $('writeup').value,
          bannerChoice: $('bannerChoice').value, bannerText: $('bannerText').value,
          fileLink: $('fileLink').value
        },
        files: files.filter(Boolean)
      });
    }).then(function (res) {
      if (!res.ok) throw Object.assign(new Error(res.error), { fromBackend: true });
      $('intakeForm').classList.add('hidden');
      $('greet').classList.add('hidden');
      $('done').classList.remove('hidden');
      window.scrollTo(0, 0);
    }).catch(function (err) {
      msg.textContent = err && (err.fromBackend || /15 MB|read /.test(err.message))
        ? err.message
        : "That didn't go through. Check your connection and tap Send again.";
    }).finally(function () { $('sendBtn').disabled = false; });
  }

  $('bannerChoice').addEventListener('change', showChoice);
  $('writeup').addEventListener('input', function () { $('writeupCount').textContent = $('writeup').value.length; });
  $('intakeForm').addEventListener('submit', submit);
  load();
})();

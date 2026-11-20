/**
 * A sponsor's donation receipt on its own page, from the Print / Save link in
 * their receipt email. Public: no sign-in, only that sponsor's long random
 * token in the link (?t=...). The backend sends back that one receipt, built
 * the same way as the email's, and nothing else.
 */
(function () {
  'use strict';

  var URL_ = (window.APP_CONFIG || {}).APPS_SCRIPT_URL;
  var token = new URLSearchParams(location.search).get('t') || '';
  var $ = function (id) { return document.getElementById(id); };
  var FALLBACK = "We couldn't load your receipt. Use the PDF attached to your receipt email, or just reply to that email.";

  function say(text) { $('msg').textContent = text; $('msg').classList.remove('hidden'); }

  function load() {
    if (!token) { say('This page needs the Print / Save link from your LYBS receipt email. Please open it from there.'); return; }
    var slow = setTimeout(function () { say("This is taking longer than it should. Refresh the page, or use the PDF attached to your receipt email."); }, 20000);
    fetch(URL_, {
      method: 'POST',
      // text/plain skips a CORS preflight, which Apps Script /exec can't answer.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'sponsorReceiptGet', t: token })
    }).then(function (r) { return r.json(); }).then(function (res) {
      clearTimeout(slow);
      if (!res || !res.ok || !res.html) { say((res && res.error) || FALLBACK); return; }
      // The receipt's HTML is built by the league's backend, with every value escaped there.
      $('receipt').innerHTML = res.html;
      // The saved PDF takes its name from the page title.
      if (res.file) document.title = res.file;
      $('msg').classList.add('hidden');
      $('bar').classList.remove('hidden');
    }).catch(function () { clearTimeout(slow); say(FALLBACK); });
  }

  $('printBtn').addEventListener('click', function () { window.print(); });
  load();
})();

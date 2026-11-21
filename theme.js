/*
 * Light or dark, one switch for every LYBS app.
 *
 * Load it in <head> BEFORE the stylesheets, as a plain blocking <script>, so a
 * saved choice is on the page before the first paint (no dark-then-light
 * flash). It sets <html data-theme="light|dark">; each app's CSS keys off that.
 *
 * The choice: localStorage 'lybsTheme' = 'light' or 'dark'. Nothing saved
 * means follow the phone or computer. LYBS Ballclub uses the same key, so on
 * natesteele888.github.io one tap changes Ballclub, the Sponsors app and
 * Meeting Secretary together.
 *
 * The button: any element with data-lybs-theme-toggle becomes a sun/moon
 * button (moon while dark, sun while light, the same as Ballclub). Pages fire
 * nothing else; a page that draws charts can listen for the 'lybs-theme' event
 * on window to redraw.
 *
 * Keeper: natesteele888/apps theme.js. Copies: lybs-reporting shared/theme.js,
 * sponsor-banner-inventory theme.js. Change all three together
 * (nate-brain parts.md `theme`).
 */
(function () {
  var KEY = 'lybsTheme';
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : ''; } catch (e) { return ''; }
  }
  function device() { return mq && mq.matches ? 'dark' : 'light'; }
  function current() { return saved() || device(); }

  function paintButtons(theme) {
    var btns = document.querySelectorAll('[data-lybs-theme-toggle]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var label = theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
      b.textContent = theme === 'light' ? '☀️' : '🌙';
      b.setAttribute('aria-label', label);
      b.title = label;
    }
  }
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"][data-lybs-theme]');
    if (meta) meta.setAttribute('content', theme === 'light' ? (meta.getAttribute('data-light') || '#F4F6FA') : (meta.getAttribute('data-dark') || '#0a1628'));
    paintButtons(theme);
  }
  function set(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    apply(theme);
    try { window.dispatchEvent(new CustomEvent('lybs-theme', { detail: { theme: theme } })); } catch (e) {}
  }
  function toggle() { set(current() === 'light' ? 'dark' : 'light'); }

  apply(current());

  // Following the device: change along with it until a choice is saved.
  if (mq) {
    var onDevice = function () {
      if (saved()) return;
      apply(device());
      try { window.dispatchEvent(new CustomEvent('lybs-theme', { detail: { theme: device() } })); } catch (e) {}
    };
    if (mq.addEventListener) mq.addEventListener('change', onDevice); else if (mq.addListener) mq.addListener(onDevice);
  }
  // Another tab switched: follow it.
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(current()); });

  // Buttons: one delegated click handler, so buttons drawn later work too.
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-lybs-theme-toggle]') : null;
    if (t) { e.preventDefault(); toggle(); }
  });
  function paintNow() { paintButtons(current()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintNow); else paintNow();

  window.lybsTheme = { current: current, set: set, toggle: toggle, paint: paintNow };
})();

// Network first: updates show right away; the saved copy is for opening with no signal or one weak bar.
const CACHE = "banners-v49";
// Save the page at install, or the first visit caches nothing and an offline open fails.
// This site's own files only: sponsor data comes from the Apps Script backend and is never saved here.
const SHELL = ["./", "index.html", "app.js", "season.js", "sponsors.js", "fields.js", "config.js", "style.css", "logo.svg", "manifest.json", "icons/sponsor-banners-192.png", "icons/sponsor-banners-512.png", "intake.html", "intake.js", "sponsor.html", "sponsor-page.js"];
self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {})))));
});
// All the apps on this site share one Cache Storage, so only ever delete our own caches.
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("banners-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  // Same-origin GETs inside this app's folder only: no sign-in traffic, no backend answers.
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(new URL("./", location).pathname)) return;
  const r = e.request;
  const saved = () => caches.match(r, { ignoreSearch: true });
  // no-cache: ask the site every time (a quick "not changed" when nothing is new), so the
  // browser's own 10-minute copy never hides a new version after a deploy.
  const net = fetch(r, { cache: "no-cache" });
  // Refresh the saved copy from the network's answer. waitUntil is called now, while the event runs: a call made
  // later, after the saved copy has already gone out, can be refused and the copy would never refresh.
  e.waitUntil(net.then(res => {
    if (res.ok) { const copy = res.clone(); return caches.open(CACHE).then(c => c.put(r, copy)); }
  }, () => {}));
  // One weak bar of signal: a fetch can hang a long time without failing. After 3 seconds the saved copy shows
  // instead (if there is one); with nothing saved, keep waiting for the network.
  e.respondWith(new Promise(resolve => {
    let done = false;
    const give = res => { if (!done && res) { done = true; resolve(res); } };
    const t = setTimeout(() => saved().then(give), 3000);
    net.then(res => { clearTimeout(t); give(res); },
      () => { clearTimeout(t); saved().then(m => { give(m); if (!done) { done = true; resolve(Response.error()); } }); });
  }));
});

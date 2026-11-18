/*
 * Fields tab: one drawing per LYBS field, with a dot wherever a banner hangs.
 * Tap a dot to see that banner; from a banner's own page, pick a field and
 * tap the drawing to say where it hangs.
 *
 * Where a banner hangs is kept in the banner row's existing `locationLabel`
 * column as "spot:<field id>@<x>,<y>" (x and y run 0 to 100 across the
 * drawing). No new column, so the Apps Script backend is unchanged.
 * The old lat/lng columns are left alone.
 *
 * The drawings are a plain diamond per field, not a survey: tell this file a
 * field's quirks (a snack shack, a short porch) under `extras` and it draws them.
 * Field names only here; never a sponsor's name or any sheet data.
 */
(function () {
  'use strict';

  var A = function () { return window.BannerApp; };
  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  // kind: 'baseball' (bigger diamond and fence) or 'softball'.
  var FIELDS = [
    { id: 'marshall-baseball', name: 'Marshall Park', sub: 'Baseball field', kind: 'baseball',
      extras: [{ type: 'pressbox' }, { type: 'snack', side: 'right' }] },
    { id: 'marshall-softball', name: 'Marshall Park', sub: 'Upper softball field', kind: 'softball',
      extras: [{ type: 'pressbox', big: true }] },
    { id: 'powell', name: 'Powell Field', sub: '', kind: 'baseball', extras: [] },
    { id: 'mcnally', name: 'McNally Park', sub: '', kind: 'baseball', extras: [] },
    { id: 'fitzgerald', name: 'Fitzgerald Field', sub: '', kind: 'baseball', extras: [] }
  ];

  var SPOT_RE = /^spot:([a-z0-9-]{1,40})@(\d{1,3}(?:\.\d+)?),(\d{1,3}(?:\.\d+)?)$/;

  function byId(id) { return FIELDS.find(function (f) { return f.id === id; }) || null; }
  function label(f) { return f ? f.name + (f.sub ? ' · ' + f.sub : '') : ''; }
  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n * 10) / 10)); }

  // locationLabel -> {field, x, y}, or null if it isn't a spot on a known field.
  function parse(text) {
    var m = SPOT_RE.exec(String(text || '').trim());
    if (!m || !byId(m[1])) return null;
    var x = Number(m[2]), y = Number(m[3]);
    if (x > 100 || y > 100) return null;
    return { field: m[1], x: x, y: y };
  }
  function format(spot) {
    return spot && byId(spot.field) ? 'spot:' + spot.field + '@' + clamp(spot.x) + ',' + clamp(spot.y) : '';
  }

  // ---------- the drawing ----------

  var HOME = { x: 50, y: 86 };
  function pt(r, deg) { // deg 90 = straight out to center field
    var a = deg * Math.PI / 180;
    return { x: HOME.x + r * Math.cos(a), y: HOME.y - r * Math.sin(a) };
  }
  function p(o) { return o.x.toFixed(2) + ' ' + o.y.toFixed(2); }
  function arc(r, from, to) { // counter-clockwise on screen from `from` to `to` degrees
    return 'M' + p(pt(r, from)) + ' A' + r + ' ' + r + ' 0 0 0 ' + p(pt(r, to));
  }
  function txt(x, y, s, cls) {
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" class="fd-label' + (cls ? ' ' + cls : '') + '" text-anchor="middle">' + s + '</text>';
  }

  function fieldSvg(f) {
    var soft = f.kind === 'softball';
    var fence = soft ? 56 : 66, dirt = soft ? 24 : 27, base = soft ? 14 : 18;
    var b1 = pt(base, 45), b2 = pt(base * Math.SQRT2, 90), b3 = pt(base, 135);
    var lf = pt(fence, 135), rf = pt(fence, 45);
    var out = [];
    // grass inside the fence
    out.push('<path class="fd-grass" d="M' + p(HOME) + ' L' + p(rf) + ' A' + fence + ' ' + fence + ' 0 0 0 ' + p(lf) + ' Z"/>');
    // infield dirt and the grass inside the bases
    out.push('<path class="fd-dirt" d="M' + p(HOME) + ' L' + p(pt(dirt, 45)) + ' A' + dirt + ' ' + dirt + ' 0 0 0 ' + p(pt(dirt, 135)) + ' Z"/>');
    if (!soft) {
      var g = 0.78;
      out.push('<path class="fd-grass" d="M' + p(pt(base * g, 45)) + ' L' + p(pt(base * g * Math.SQRT2, 90)) + ' L' + p(pt(base * g, 135)) + ' L' + p({ x: HOME.x, y: HOME.y - 3 }) + ' Z"/>');
    }
    // foul lines, bases, mound, plate
    out.push('<path class="fd-line" d="M' + p(HOME) + ' L' + p(rf) + ' M' + p(HOME) + ' L' + p(lf) + '"/>');
    [b1, b2, b3].forEach(function (b) {
      out.push('<rect class="fd-base" x="' + (b.x - 1.1).toFixed(2) + '" y="' + (b.y - 1.1).toFixed(2) + '" width="2.2" height="2.2" transform="rotate(45 ' + p(b).replace(' ', ' ') + ')"/>');
    });
    var mound = pt(base * 0.72, 90);
    out.push('<circle class="fd-dirt-dark" cx="' + mound.x.toFixed(2) + '" cy="' + mound.y.toFixed(2) + '" r="' + (soft ? 1.6 : 2.2) + '"/>');
    out.push('<path class="fd-base" d="M48.8 85.4 L51.2 85.4 L51.2 86.6 L50 87.6 L48.8 86.6 Z"/>');
    // the fences banners hang on: outfield, the two lines, the backstop
    out.push('<path class="fd-fence" d="' + arc(fence, 45, 135) + '"/>');
    var off = 7, side1 = pt(fence, 45), side3 = pt(fence, 135);
    var n1 = { x: 0.7071, y: 0.7071 }, n3 = { x: -0.7071, y: 0.7071 }; // outward from each foul line
    var r0 = 10;
    var s1a = { x: pt(r0, 45).x + n1.x * off, y: pt(r0, 45).y + n1.y * off }, s1b = { x: side1.x + n1.x * 1.5, y: side1.y + n1.y * 1.5 };
    var s3a = { x: pt(r0, 135).x + n3.x * off, y: pt(r0, 135).y + n3.y * off }, s3b = { x: side3.x + n3.x * 1.5, y: side3.y + n3.y * 1.5 };
    out.push('<path class="fd-fence" d="M' + p(s1a) + ' L' + p(s1b) + ' M' + p(s3a) + ' L' + p(s3b) + '"/>');
    out.push('<path class="fd-fence" d="M' + p(s3a) + ' Q50 ' + (HOME.y + 13).toFixed(1) + ' ' + p(s1a) + '"/>');
    // foul poles
    out.push('<circle class="fd-pole" cx="' + rf.x.toFixed(2) + '" cy="' + rf.y.toFixed(2) + '" r="0.9"/><circle class="fd-pole" cx="' + lf.x.toFixed(2) + '" cy="' + lf.y.toFixed(2) + '" r="0.9"/>');
    // dugouts, just outside each line near the infield
    var d1 = { x: pt(9, 45).x + n1.x * 4.2, y: pt(9, 45).y + n1.y * 4.2 }, d3 = { x: pt(9, 135).x + n3.x * 4.2, y: pt(9, 135).y + n3.y * 4.2 };
    out.push('<rect class="fd-build" x="-5" y="-1.4" width="10" height="2.8" rx="0.6" transform="translate(' + p(d1) + ') rotate(-45)"/>');
    out.push('<rect class="fd-build" x="-5" y="-1.4" width="10" height="2.8" rx="0.6" transform="translate(' + p(d3) + ') rotate(45)"/>');
    out.push(txt(d3.x - 3, d3.y + 6, '3B dugout'));
    out.push(txt(d1.x + 3, d1.y + 6, '1B dugout'));
    (f.extras || []).forEach(function (e) {
      if (e.type === 'pressbox') {
        var w = e.big ? 14 : 10;
        out.push('<rect class="fd-build" x="' + (50 - w / 2) + '" y="' + (HOME.y + 8.5) + '" width="' + w + '" height="3.6" rx="0.6"/>');
        out.push(txt(50, HOME.y + 11.3, 'Press box', 'fd-in'));
      }
      if (e.type === 'snack') {
        var sx = e.side === 'left' ? 9 : 91, sy = 64;
        out.push('<rect class="fd-build" x="' + (sx - 5) + '" y="' + sy + '" width="10" height="5" rx="0.6"/>');
        out.push(txt(sx, sy + 8.2, 'Snack shack'));
      }
    });
    out.push(txt(50, HOME.y - fence - 2.2, 'Outfield fence'));
    return out.join('');
  }

  // spots: [{n, x, y, cls, id}] drawn on top. cls adds 'hung', 'mine', 'dim' or 'on'.
  function diagram(f, spots, ariaLabel) {
    var dots = (spots || []).map(function (s) {
      return '<g class="fd-spot ' + (s.cls || '') + '"' + (s.id != null ? ' data-spot="' + A().esc(s.id) + '" role="button" tabindex="0" aria-label="' + A().esc(s.name || 'Banner') + '"' : '') + '>' +
        '<circle cx="' + s.x + '" cy="' + s.y + '" r="2.8"/>' +
        (s.n != null ? '<text x="' + s.x + '" y="' + (s.y + 1.05) + '" text-anchor="middle">' + s.n + '</text>' : '') +
      '</g>';
    }).join('');
    return '<svg class="fd" viewBox="0 0 100 100" role="img" aria-label="' + A().esc(ariaLabel || label(f)) + '">' +
      fieldSvg(f) + dots + '</svg>';
  }

  // Where on the drawing a tap landed, 0 to 100 (the drawing is kept square).
  function tapPoint(svg, ev) {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: clamp((ev.clientX - r.left) / r.width * 100), y: clamp((ev.clientY - r.top) / r.height * 100) };
  }

  // ---------- Fields tab ----------

  var S = { field: FIELDS[0].id, selected: null };

  function placed() {
    return A().banners().map(function (b) { return { b: b, spot: parse(b.locationLabel) }; })
      .filter(function (o) { return o.spot; });
  }

  // Numbered left field to right field, so the list reads the way you walk the fence.
  function onField(id) {
    return placed().filter(function (o) { return o.spot.field === id; })
      .sort(function (a, b) { return (a.spot.x - b.spot.x) || (a.spot.y - b.spot.y); });
  }

  function render() {
    var esc = A().esc;
    var all = placed();
    $('#fieldPick').innerHTML = FIELDS.map(function (f) {
      var n = all.filter(function (o) { return o.spot.field === f.id; }).length;
      return '<button type="button" class="seg' + (f.id === S.field ? ' on' : '') + '" data-field="' + f.id + '" aria-pressed="' + (f.id === S.field) + '">' +
        '<b>' + esc(f.name) + '</b>' + (f.sub ? '<span>' + esc(f.sub) + '</span>' : '') +
        '<i>' + (n ? n + ' banner' + (n === 1 ? '' : 's') : 'none yet') + '</i></button>';
    }).join('');

    var f = byId(S.field), list = onField(S.field);
    if (S.selected && !list.some(function (o) { return String(o.b.id) === String(S.selected); })) S.selected = null;
    $('#fieldDiagram').innerHTML = diagram(f, list.map(function (o, i) {
      return { n: i + 1, x: o.spot.x, y: o.spot.y, id: o.b.id, name: o.b.sponsorName,
        cls: (o.b.hung ? 'hung' : '') + (String(o.b.id) === String(S.selected) ? ' on' : '') };
    }), label(f) + ', ' + list.length + ' banners placed');

    $('#fieldList').innerHTML = list.length ? list.map(function (o, i) {
      return '<li><button type="button" class="frow' + (String(o.b.id) === String(S.selected) ? ' on' : '') + '" data-pick="' + esc(o.b.id) + '">' +
        '<span class="fnum' + (o.b.hung ? ' hung' : '') + '">' + (i + 1) + '</span>' +
        '<span class="fname">' + esc(o.b.sponsorName || '(unnamed)') + '</span>' +
        '<span class="fstate">' + (o.b.hung ? 'Hung' : 'Not hung yet') + '</span></button></li>';
    }).join('') : '';

    var loose = A().banners().filter(function (b) { return !parse(b.locationLabel); }).length;
    $('#fieldEmpty').textContent = list.length ? '' :
      'No banners placed on this field yet. Open a banner in Banner stock and pick "Where it hangs".';
    $('#fieldLoose').textContent = loose ? loose + ' banner' + (loose === 1 ? ' has' : 's have') + ' no spot yet. Set one from the banner\'s page in Banner stock.' : '';
    renderCard();
  }

  function renderCard() {
    var esc = A().esc, box = $('#fieldCard');
    var b = S.selected != null && A().banners().find(function (x) { return String(x.id) === String(S.selected); });
    if (!b) { box.innerHTML = '<p class="hint">Tap a dot to see the banner hung there.</p>'; return; }
    box.innerHTML = '<div class="fcard">' +
      '<div class="thumb-placeholder" data-thumb="' + esc(b.driveFileId) + '"></div>' +
      '<div class="info"><div class="name">' + esc(b.sponsorName || '(unnamed)') + '</div>' +
      '<div class="facts">' + esc([b.tier, b.onSponsorList ? '2026 sponsor' : 'Past sponsor'].filter(Boolean).join(' · ')) + '</div></div>' +
      A().badge(b.hung ? 'Hung' : 'Not hung', b.hung ? 'ok' : 'muted') +
      '</div><button type="button" class="btn small" id="fieldOpen">Open banner</button>';
    A().loadThumbs();
    $('#fieldOpen').addEventListener('click', function () { A().openDetail(b.id); });
  }

  function select(id) {
    S.selected = String(S.selected) === String(id) ? null : id;
    render();
  }

  function show() {
    A().whenBannersLoaded().then(render, function () {
      $('#fieldEmpty').textContent = "Can't reach the banner list. Check your signal, then open this tab again.";
    });
  }

  function wire() {
    $('#fieldPick').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-field]');
      if (!btn) return;
      S.field = btn.dataset.field; S.selected = null; render();
    });
    $('#fieldDiagram').addEventListener('click', function (e) {
      var g = e.target.closest('[data-spot]');
      if (g) select(g.getAttribute('data-spot'));
    });
    $('#fieldDiagram').addEventListener('keydown', function (e) {
      var g = e.target.closest('[data-spot]');
      if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); select(g.getAttribute('data-spot')); }
    });
    $('#fieldList').addEventListener('click', function (e) {
      var r = e.target.closest('[data-pick]');
      if (r) select(r.dataset.pick);
    });
  }

  // ---------- "Where it hangs" on a banner's page ----------

  // P.spot: undefined = unchanged, null = cleared, {field,x,y} = new spot.
  var P = { banner: null, field: '', spot: undefined };

  function pickerOpen(b) {
    P.banner = b; P.spot = undefined;
    var cur = parse(b.locationLabel);
    P.field = cur ? cur.field : '';
    $('#spotField').innerHTML = '<option value="">Not placed</option>' + FIELDS.map(function (f) {
      return '<option value="' + f.id + '">' + A().esc(label(f)) + '</option>';
    }).join('');
    $('#spotField').value = P.field;
    pickerDraw();
  }

  function pickerSpot() {
    if (P.spot !== undefined) return P.spot;
    return parse(P.banner && P.banner.locationLabel);
  }

  function pickerDraw() {
    var f = byId(P.field), mine = pickerSpot(), box = $('#spotPicker');
    if (!f) {
      box.innerHTML = '';
      $('#spotStatus').textContent = mine ? '' : 'Pick the field this banner hangs at, then tap where on the fence.';
      if (P.spot === null) $('#spotStatus').textContent = 'No spot. Tap Save to keep it that way.';
      $('#spotClear').classList.add('hidden');
      return;
    }
    var others = placed().filter(function (o) { return o.spot.field === f.id && String(o.b.id) !== String(P.banner.id); })
      .map(function (o) { return { x: o.spot.x, y: o.spot.y, cls: 'dim' }; });
    var here = mine && mine.field === f.id ? [{ x: mine.x, y: mine.y, cls: 'mine' }] : [];
    box.innerHTML = diagram(f, others.concat(here), 'Tap where this banner hangs at ' + label(f));
    $('#spotStatus').textContent = here.length
      ? (P.spot !== undefined ? 'Spot set at ' + label(f) + '. Tap Save to keep it.' : 'Hangs here at ' + label(f) + '. Tap the drawing to move it.')
      : 'Tap the drawing where this banner hangs.' + (others.length ? ' Faded dots are other banners.' : '');
    $('#spotClear').classList.toggle('hidden', !here.length);
  }

  // What Save should send: the new locationLabel, or undefined if unchanged.
  function pickerValue() {
    return P.spot === undefined ? undefined : format(P.spot);
  }

  function wirePicker() {
    $('#spotField').addEventListener('change', function () {
      P.field = $('#spotField').value;
      var cur = pickerSpot();
      if (!P.field) P.spot = null;
      else if (cur && cur.field !== P.field) P.spot = null;
      pickerDraw();
    });
    $('#spotPicker').addEventListener('click', function (e) {
      var svg = e.target.closest('svg');
      if (!svg || !P.field) return;
      var at = tapPoint(svg, e);
      if (!at) return;
      P.spot = { field: P.field, x: at.x, y: at.y };
      pickerDraw();
    });
    $('#spotClear').addEventListener('click', function () {
      P.spot = null; P.field = ''; $('#spotField').value = ''; pickerDraw();
    });
  }

  document.addEventListener('DOMContentLoaded', function () { wire(); wirePicker(); });

  window.Fields = {
    list: FIELDS, byId: byId, label: label, parse: parse, format: format, diagram: diagram,
    show: show, render: render,
    pickerOpen: pickerOpen, pickerValue: pickerValue
  };
})();

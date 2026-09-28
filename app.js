/* Kept: coverflow archive
 * Reads data/index.json (written by the Kept browser extension) and shows every
 * saved listing in an iTunes-style Cover Flow. The centred piece drops its photo
 * set down underneath it and fills the details panel.
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const track = $('#track');
  const stage = $('#stage');
  const drop = $('#drop');
  const info = $('#info');
  const scrub = $('#scrub');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const RANGE = 8; // covers drawn on each side of centre

  const S = {
    all: [], items: [],
    pos: 0, target: 0,
    covers: [], visible: new Set(),
    shown: -1, activeImg: 0,
    dims: {}, dirty: true,
    drag: null, wheelTimer: 0, lastStep: 0, scrubbing: false,
    platform: 'all', query: '',
    lb: null, demo: false,
    colours: new Map(),
  };

  const PLATFORMS = {
    depop: 'Depop', ebay: 'eBay', vinted: 'Vinted', grailed: 'Grailed',
    vestiaire: 'Vestiaire Collective', poshmark: 'Poshmark', mercari: 'Mercari',
    etsy: 'Etsy', carousell: 'Carousell', therealreal: 'The RealReal',
  };

  // ---------------------------------------------------------------- helpers

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lastIndex = () => Math.max(0, S.items.length - 1);
  const clampI = (v) => clamp(v, 0, lastIndex());
  const clampSoft = (v) => clamp(v, -0.35, lastIndex() + 0.35);

  const platformName = (it) => PLATFORMS[it.platform] || it.site || 'Elsewhere';

  function priceOf(it) {
    if (it.priceText) return it.priceText;
    const p = it.price;
    if (p && p.amount != null && p.amount !== '') {
      try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'USD' }).format(+p.amount);
      } catch { return `${p.amount} ${p.currency || ''}`.trim(); }
    }
    return '';
  }

  function dateOf(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  }

  const waybackFallback = (url) => `https://web.archive.org/web/${url}`;

  const photos = (it) => (it.images && it.images.length ? it.images : it.screenshot ? [it.screenshot] : []);

  // ---------------------------------------------------------------- data

  async function load() {
    let items = [];
    const params = new URLSearchParams(location.search);
    if (!params.has('demo')) {
      try {
        const r = await fetch('data/index.json', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          items = Array.isArray(j) ? j : j.items || [];
        }
      } catch { /* fall through to the samples */ }
    }
    if (!items.length) {
      items = demoItems();
      S.demo = true;
      $('#demo-note').hidden = false;
    }
    items.sort((a, b) => String(b.likedAt || '').localeCompare(String(a.likedAt || '')));
    S.all = items;
  }

  // ---------------------------------------------------------------- layout

  function measure() {
    const w = stage.clientWidth || window.innerWidth;
    const h = window.innerHeight;
    const cw = Math.round(clamp(Math.min(w * (w < 700 ? 0.5 : 0.27), h * 0.36), 150, 330));
    const ch = Math.round(cw * 1.25);
    const root = document.documentElement.style;
    root.setProperty('--cw', cw + 'px');
    root.setProperty('--ch', ch + 'px');
    S.dims = { cw, ch, centre: cw * 0.8, side: cw * 0.33, depth: cw * 0.9, angle: 64 };
    S.dirty = true;
  }

  function makeCover(i) {
    const it = S.items[i];
    const el = document.createElement('div');
    el.className = 'cover';
    el.dataset.i = i;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', it.title || 'Saved piece');
    el.innerHTML = '<div class="face"><img alt="" decoding="async" draggable="false"><div class="shade"></div></div><div class="reflect"><img alt="" decoding="async" draggable="false"></div>';
    const imgs = el.querySelectorAll('img');
    return { el, face: imgs[0], refl: imgs[1], shade: el.querySelector('.shade'), loaded: false };
  }

  function ensureCover(i) {
    let c = S.covers[i];
    if (!c) {
      c = S.covers[i] = makeCover(i);
      track.appendChild(c.el);
    }
    if (!c.loaded) {
      const src = photos(S.items[i])[0] || '';
      c.face.src = src;
      c.refl.src = src;
      c.loaded = true;
    }
    c.el.style.display = '';
    return c;
  }

  function place(i) {
    const c = S.covers[i];
    const d = S.dims;
    const o = i - S.pos;
    const a = Math.abs(o);
    const s = Math.sign(o);
    const t = Math.min(a, 1);
    const ease = t * t * (3 - 2 * t); // smoothstep: covers turn slowly as they leave centre, then settle
    const x = s * (ease * d.centre + Math.max(a - 1, 0) * d.side);
    const z = -ease * d.depth;
    const ry = s * ease * d.angle;
    c.el.style.transform = `translate3d(${x.toFixed(2)}px,0,${z.toFixed(2)}px) rotateY(${ry.toFixed(2)}deg)`;
    c.el.style.zIndex = String(10000 - Math.round(a * 100));
    c.el.style.opacity = String(clamp((RANGE + 0.5 - a) / 1.5, 0, 1));
    c.shade.style.opacity = String(Math.min(0.6, ease * 0.32 + Math.max(a - 1, 0) * 0.045));
  }

  function updateCovers() {
    if (!S.items.length) return;
    const lo = Math.max(0, Math.floor(S.pos) - RANGE);
    const hi = Math.min(lastIndex(), Math.ceil(S.pos) + RANGE);
    const now = new Set();
    for (let i = lo; i <= hi; i++) {
      now.add(i);
      ensureCover(i);
      place(i);
    }
    for (const i of S.visible) if (!now.has(i) && S.covers[i]) S.covers[i].el.style.display = 'none';
    S.visible = now;
  }

  function syncScrubber() {
    if (S.scrubbing) return;
    scrub.value = String(clamp(S.pos, 0, lastIndex()));
  }

  // ---------------------------------------------------------------- motion

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const moving = S.drag && S.drag.moved;
    const k = reduced ? 40 : moving ? 24 : 8.5; // iTunes glide: exponential ease toward the target
    const diff = S.target - S.pos;
    if (Math.abs(diff) > 0.0005) {
      S.pos += diff * (1 - Math.exp(-dt * k));
      S.dirty = true;
    } else if (diff !== 0) {
      S.pos = S.target;
      S.dirty = true;
    }
    if (S.dirty) {
      updateCovers();
      syncScrubber();
      S.dirty = false;
    }
    checkCentre();
    requestAnimationFrame(tick);
  }

  function checkCentre() {
    if (!S.items.length) return;
    const ci = clampI(Math.round(S.pos));
    const dragging = S.drag && S.drag.moved;
    const arrived = !dragging && Math.abs(S.pos - ci) < 0.14 && clampI(Math.round(S.target)) === ci;
    if (arrived && ci !== S.shown) openItem(ci);
    else if (S.shown !== -1 && Math.abs(S.pos - S.shown) > 0.42) closeItem();
  }

  function goTo(i) { S.target = clampI(i); }
  function step(n) { goTo(Math.round(S.target) + n); }

  // ---------------------------------------------------------------- the drop + details

  function closeItem() {
    const c = S.covers[S.shown];
    if (c) c.el.classList.remove('open');
    drop.classList.remove('open');
    S.shown = -1;
  }

  function openItem(i) {
    if (S.shown !== -1) closeItem();
    S.shown = i;
    S.activeImg = 0;
    const it = S.items[i];
    const c = S.covers[i];
    if (c) {
      c.el.classList.add('open');
      const first = photos(it)[0];
      if (first && c.face.getAttribute('src') !== first) swapCoverImage(c, first);
    }
    buildDrop(it);
    requestAnimationFrame(() => requestAnimationFrame(() => drop.classList.add('open')));
    renderInfo(it);
    if (it.id) history.replaceState(null, '', '#' + encodeURIComponent(it.id));
  }

  function buildDrop(it) {
    drop.textContent = '';
    const list = photos(it);
    list.forEach((src, n) => {
      const b = document.createElement('button');
      b.className = 'thumb' + (n === 0 ? ' active' : '');
      b.style.setProperty('--i', n);
      b.setAttribute('aria-label', `Photo ${n + 1} of ${list.length}`);
      b.innerHTML = `<img alt="" loading="lazy" src="${esc(src)}">`;
      b.addEventListener('click', () => pickImage(n));
      b.addEventListener('dblclick', () => openLightbox(it, n));
      drop.appendChild(b);
    });
    if (it.screenshot && it.images && it.images.length) {
      const b = document.createElement('button');
      b.className = 'thumb page';
      b.style.setProperty('--i', list.length);
      b.setAttribute('aria-label', 'Open the full-page capture of the listing');
      b.innerHTML = `<img alt="" loading="lazy" src="${esc(it.screenshot)}"><span>Full page</span>`;
      b.addEventListener('click', () => openLightbox(it, list.length));
      drop.appendChild(b);
    }
  }

  function swapCoverImage(c, src) {
    c.face.style.opacity = '0';
    c.refl.style.opacity = '0';
    const img = new Image();
    img.onload = img.onerror = () => {
      c.face.src = src;
      c.refl.src = src;
      c.face.style.opacity = '';
      c.refl.style.opacity = '';
    };
    img.src = src;
  }

  function pickImage(n) {
    const it = S.items[S.shown];
    if (!it) return;
    const src = photos(it)[n];
    const c = S.covers[S.shown];
    if (n === S.activeImg) { openLightbox(it, n); return; }
    S.activeImg = n;
    drop.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('active', k === n));
    if (c && src) swapCoverImage(c, src);
  }

  function renderInfo(it) {
    info.classList.add('swapping');
    clearTimeout(renderInfo.t);
    renderInfo.t = setTimeout(() => {
      info.innerHTML = infoHTML(it);
      const more = info.querySelector('.more');
      if (more) {
        const box = info.querySelector('.desc');
        const text = info.querySelector('.desc-text');
        if (text.scrollHeight <= text.clientHeight + 4) { box.classList.remove('clamped'); more.remove(); }
        else more.addEventListener('click', () => {
          const open = box.classList.toggle('clamped');
          more.textContent = open ? 'Read the full description' : 'Show less';
        });
      }
      const cap = info.querySelector('[data-capture]');
      if (cap) cap.addEventListener('click', () => openLightbox(it, photos(it).length));
      info.classList.remove('swapping');
    }, reduced ? 0 : 170);
  }

  function infoHTML(it) {
    const price = priceOf(it);
    const archive = it.archive || {};
    const archivedHref = archive.url || waybackFallback(it.url || '');
    let status = '';
    if (archive.status === 'archived') status = `Saved to the Wayback Machine${archive.archivedAt ? ' on ' + esc(dateOf(archive.archivedAt)) : ''}.`;
    else if (archive.status === 'failed') status = "The Wayback Machine couldn't save this page, so the button opens its most recent snapshot, if one exists. The full-page capture keeps a copy either way.";
    else if (it.url) status = 'The Wayback Machine is still saving this page. Until it finishes, the button opens the most recent snapshot.';

    const specs = [
      ['Brand', it.brand], ['Size', it.size], ['Condition', it.condition], ['Colour', it.color],
      ['Seller', it.seller], ['Location', it.location], ['Found on', platformName(it)], ['Liked', dateOf(it.likedAt)],
    ];
    const seen = new Set(specs.map(([k]) => k.toLowerCase()).concat(['color', 'item location', 'seller', 'brand', 'size', 'condition', 'colour']));
    if (it.details) {
      let extra = 0;
      for (const [k, v] of Object.entries(it.details)) {
        if (extra >= 8) break;
        if (!v || seen.has(k.toLowerCase())) continue;
        specs.push([k, v]);
        seen.add(k.toLowerCase());
        extra++;
      }
    }
    const dl = specs.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const desc = (it.description || '').trim();

    return `
      <div class="info-head">
        <h2 class="title">${esc(it.title || 'Untitled piece')}</h2>
        <p class="sub">${price ? `<span class="price">${esc(price)}</span>` : ''}${esc(platformName(it))}${it.seller ? ', from ' + esc(it.seller) : ''}</p>
        <div class="actions">
          ${it.url ? `<a class="btn btn-primary" href="${esc(archivedHref)}" target="_blank" rel="noopener">Open archived listing</a>` : ''}
          ${it.screenshot ? '<button class="btn btn-quiet" type="button" data-capture>See full-page capture</button>' : ''}
          ${it.url ? `<a class="link" href="${esc(it.url)}" target="_blank" rel="noopener" title="The seller may have removed this">Original listing</a>` : ''}
        </div>
        ${status ? `<p class="status">${status}</p>` : ''}
      </div>
      <div class="info-body">
        <dl class="specs">${dl}</dl>
        <div class="desc clamped">
          <div class="desc-text">${desc ? desc.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('') : '<p>No description was listed.</p>'}</div>
          ${desc ? '<button class="more" type="button">Read the full description</button>' : ''}
        </div>
      </div>`;
  }

  // The stage glows in the most vivid colour of the centred photo.
  function ambient(it, c) {
    const key = it.id || it.url;
    const apply = (col) => document.documentElement.style.setProperty('--amb', col);
    if (S.colours.has(key)) return apply(S.colours.get(key));
    const src = photos(it)[0];
    if (!src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = cv.height = 28;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, 28, 28);
        const px = cx.getImageData(0, 0, 28, 28).data;
        let r = 0, g = 0, b = 0, wsum = 0, ar = 0, ag = 0, ab = 0;
        for (let p = 0; p < px.length; p += 4) {
          const R = px[p] / 255, G = px[p + 1] / 255, B = px[p + 2] / 255;
          const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          const l = (mx + mn) / 2;
          const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
          const w = Math.pow(sat, 2.2) * (1 - Math.abs(l - 0.5) * 1.6);
          r += R * w; g += G * w; b += B * w; wsum += w;
          ar += R; ag += G; ab += B;
        }
        const n = px.length / 4;
        const [R, G, B] = wsum > 0.8 ? [r / wsum, g / wsum, b / wsum] : [ar / n, ag / n, ab / n];
        const col = toGlow(R, G, B);
        S.colours.set(key, col);
        if (S.items[S.shown] === it) apply(col);
      } catch { /* cross-origin image: keep the current glow */ }
    };
    img.src = src;
  }

  function toGlow(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0;
    const l = (mx + mn) / 2;
    const d = mx - mn;
    let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    s = s < 0.08 ? s : Math.max(s, 0.55);
    return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(clamp(l, 0.3, 0.46) * 100).toFixed(0)}%)`;
  }

  // ---------------------------------------------------------------- input

  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.drop, .scrubber')) return;
    S.drag = { x: e.clientX, y: e.clientY, start: S.target, moved: false, id: e.pointerId, lx: e.clientX, lt: performance.now(), v: 0, target: e.target };
  });

  window.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;
      if (Math.abs(e.clientY - d.y) > Math.abs(dx)) { S.drag = null; return; }
      d.moved = true;
      try { stage.setPointerCapture(e.pointerId); } catch {}
      stage.classList.add('dragging');
    }
    const per = S.dims.side * 1.6;
    S.target = clampSoft(d.start - dx / per);
    const t = performance.now();
    const dt = t - d.lt;
    if (dt > 0) d.v = d.v * 0.75 + ((e.clientX - d.lx) / dt) * 0.25;
    d.lx = e.clientX;
    d.lt = t;
  });

  const endDrag = (e) => {
    const d = S.drag;
    if (!d || (e && e.pointerId !== d.id)) return;
    S.drag = null;
    stage.classList.remove('dragging');
    if (d.moved) {
      const per = S.dims.side * 1.6;
      const fling = (-d.v * 240) / per; // velocity carries it a few covers, like flicking in iTunes
      goTo(Math.round(S.target + fling));
      return;
    }
    const cov = d.target && d.target.closest && d.target.closest('.cover');
    if (!cov) return;
    const i = +cov.dataset.i;
    if (i === S.shown) openLightbox(S.items[i], S.activeImg);
    else goTo(i);
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', () => { S.drag = null; stage.classList.remove('dragging'); goTo(Math.round(S.target)); });

  stage.addEventListener('wheel', (e) => {
    if (e.target.closest('.drop')) return;
    const dx = e.deltaX, dy = e.deltaY;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (!delta) return;
    e.preventDefault();
    const notched = e.deltaMode === 1 || (Math.abs(dx) < 1 && Math.abs(delta) >= 60 && Number.isInteger(delta));
    if (notched) {
      const now = performance.now();
      if (now - S.lastStep < 60) return;
      S.lastStep = now;
      step(Math.sign(delta));
      return;
    }
    S.target = clampSoft(S.target + delta / 105);
    clearTimeout(S.wheelTimer);
    S.wheelTimer = setTimeout(() => goTo(Math.round(S.target)), 120);
  }, { passive: false });

  scrub.addEventListener('input', () => { S.scrubbing = true; S.target = +scrub.value; });
  scrub.addEventListener('change', () => { S.scrubbing = false; goTo(Math.round(+scrub.value)); });

  document.addEventListener('keydown', (e) => {
    if (!$('#lb').hidden) {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') lbStep(-1);
      else if (e.key === 'ArrowRight') lbStep(1);
      return;
    }
    if (e.target.matches('input, textarea') && e.target !== scrub) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); }
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(lastIndex());
    else if (e.key === 'ArrowDown' && S.shown !== -1) { pickImage((S.activeImg + 1) % photos(S.items[S.shown]).length); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && S.shown !== -1) { const n = photos(S.items[S.shown]).length; pickImage((S.activeImg - 1 + n) % n); e.preventDefault(); }
    else if (e.key === 'Enter' && S.shown !== -1 && e.target === stage) openLightbox(S.items[S.shown], S.activeImg);
  });

  window.addEventListener('resize', () => { measure(); });

  // ---------------------------------------------------------------- filters

  function buildChips() {
    const counts = {};
    S.all.forEach((it) => { counts[it.platform || 'other'] = (counts[it.platform || 'other'] || 0) + 1; });
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    const chips = $('#chips');
    chips.textContent = '';
    if (keys.length < 2) return;
    [['all', 'Everything', S.all.length], ...keys.map((k) => [k, PLATFORMS[k] || 'Other', counts[k]])].forEach(([k, label, n]) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.type = 'button';
      b.setAttribute('aria-pressed', String(S.platform === k));
      b.innerHTML = `${esc(label)}<small>${n}</small>`;
      b.addEventListener('click', () => {
        S.platform = k;
        chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
        applyFilter();
      });
      chips.appendChild(b);
    });
  }

  function applyFilter(keepId) {
    const q = S.query.trim().toLowerCase();
    const current = keepId || (S.items[Math.round(S.target)] || {}).id;
    S.items = S.all.filter((it) => {
      if (S.platform !== 'all' && (it.platform || 'other') !== S.platform) return false;
      if (!q) return true;
      const hay = [it.title, it.brand, it.size, it.seller, it.color, it.condition, it.description, platformName(it), ...(it.details ? Object.values(it.details) : [])].join(' ').toLowerCase();
      return q.split(/\s+/).every((w) => hay.includes(w));
    });
    track.textContent = '';
    S.covers = [];
    S.visible = new Set();
    closeItem();
    const idx = Math.max(0, S.items.findIndex((it) => it.id === current));
    S.pos = S.target = idx;
    scrub.max = String(lastIndex());
    scrub.style.setProperty('--thumbw', Math.max(28, Math.min(120, 460 / Math.max(1, S.items.length) * 4)) + 'px');
    $('#count').textContent = `${S.items.length} ${S.items.length === 1 ? 'piece' : 'pieces'}`;
    const empty = $('#empty');
    if (!S.items.length) {
      empty.hidden = false;
      empty.innerHTML = `<p>Nothing matches ${q ? '\u201c' + esc(S.query.trim()) + '\u201d' : 'that filter'}.</p><button class="btn btn-quiet" type="button">Show everything</button>`;
      empty.querySelector('button').addEventListener('click', () => {
        S.query = ''; $('#q').value = ''; S.platform = 'all'; buildChips(); applyFilter();
      });
      info.innerHTML = '';
    } else {
      empty.hidden = true;
    }
    S.dirty = true;
  }

  let qTimer;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { S.query = e.target.value; applyFilter(); }, 160);
  });

  // ---------------------------------------------------------------- lightbox

  function openLightbox(it, idx) {
    if (!it) return;
    const list = photos(it).map((src) => ({ src }));
    if (it.screenshot && it.images && it.images.length) list.push({ src: it.screenshot, page: true });
    if (!list.length) return;
    S.lb = { it, list, idx: clamp(idx, 0, list.length - 1), opener: document.activeElement };
    renderLightbox();
    $('#lb').hidden = false;
    document.body.classList.add('lb-open');
    $('#lb-close').focus();
  }

  function renderLightbox() {
    const { it, list, idx } = S.lb;
    const cur = list[idx];
    const body = $('#lb-body');
    body.innerHTML = cur.page
      ? `<div class="lb-page" tabindex="0"><img alt="Full-page capture of the listing" src="${esc(cur.src)}"></div>`
      : `<img alt="${esc(it.title || '')}, photo ${idx + 1}" src="${esc(cur.src)}">`;
    $('#lb-cap').textContent = cur.page
      ? `Full-page capture, taken ${dateOf(it.likedAt) || 'when you liked it'}`
      : `${it.title || ''}, photo ${idx + 1} of ${list.filter((x) => !x.page).length}`;
    const many = list.length > 1;
    $('#lb-prev').hidden = !many;
    $('#lb-next').hidden = !many;
  }

  function lbStep(n) {
    if (!S.lb) return;
    S.lb.idx = (S.lb.idx + n + S.lb.list.length) % S.lb.list.length;
    renderLightbox();
  }

  function closeLightbox() {
    $('#lb').hidden = true;
    document.body.classList.remove('lb-open');
    if (S.lb && S.lb.opener && S.lb.opener.focus) S.lb.opener.focus();
    S.lb = null;
  }

  $('#lb-close').addEventListener('click', closeLightbox);
  $('#lb-prev').addEventListener('click', () => lbStep(-1));
  $('#lb-next').addEventListener('click', () => lbStep(1));
  $('#lb').addEventListener('click', (e) => { if (e.target.id === 'lb' || e.target.id === 'lb-body') closeLightbox(); });

  // ---------------------------------------------------------------- samples (shown until your first like arrives)

  function demoItems() {
    const shapes = {
      tee: "M300 230 L360 205 Q400 248 440 205 L500 230 L612 300 L570 392 L515 362 L515 800 L285 800 L285 362 L230 392 L188 300 Z",
      jacket: "M288 220 L360 192 L400 250 L440 192 L512 220 L600 300 L640 760 L566 772 L532 420 L532 822 L268 822 L268 420 L234 772 L160 760 L200 300 Z",
      dress: "M348 180 L370 180 L386 238 L414 238 L430 180 L452 180 L470 330 L592 832 L208 832 L330 330 Z",
      trousers: "M288 180 L512 180 L538 842 L426 842 L400 382 L374 842 L262 842 Z",
      skirt: "M322 290 L478 290 L596 770 L204 770 Z",
      bag: "M232 420 Q232 382 272 382 L528 382 Q568 382 568 420 L590 760 Q590 800 550 800 L250 800 Q210 800 210 760 Z",
    };
    const extras = {
      tee: (fg) => `<circle cx='360' cy='420' r='14' fill='#fff' opacity='.85'/><circle cx='392' cy='436' r='14' fill='#fff' opacity='.85'/><path d='M362 406 Q380 360 410 352' stroke='#2d5a27' stroke-width='5' fill='none'/>`,
      jacket: () => `<path d='M400 252 L400 820' stroke='rgba(0,0,0,.35)' stroke-width='5'/><rect x='300' y='560' width='70' height='80' fill='rgba(0,0,0,.14)'/><rect x='430' y='560' width='70' height='80' fill='rgba(0,0,0,.14)'/>`,
      dress: () => `<path d='M330 330 Q400 350 470 330' stroke='rgba(255,255,255,.35)' stroke-width='4' fill='none'/>`,
      trousers: () => `<path d='M288 230 L512 230' stroke='rgba(0,0,0,.3)' stroke-width='5'/><path d='M330 240 L318 830 M470 240 L482 830' stroke='rgba(255,255,255,.25)' stroke-width='3'/>`,
      skirt: () => [0, 1, 2, 3, 4, 5, 6].map((k) => `<path d='M${336 + k * 22} 292 L${230 + k * 57} 768' stroke='rgba(0,0,0,.18)' stroke-width='3'/>`).join(''),
      bag: (fg) => `<path d='M300 392 Q400 170 500 392' fill='none' stroke='${fg}' stroke-width='24' stroke-linecap='round'/><rect x='370' y='470' width='60' height='36' rx='4' fill='rgba(255,255,255,.55)'/>`,
    };
    const views = [
      '',
      'translate(800 0) scale(-1 1)',
      'translate(-420 -380) scale(2.05)',
      'translate(-190 -60) scale(1.45) rotate(-8 400 500)',
      'translate(40 30) scale(0.9) rotate(6 400 500)',
    ];
    const grounds = ['#e9e4dc', '#dcd6cc', '#efe9e1', '#d3cbbf', '#e4ddd2'];
    const svg = (kind, fg, v, label) => {
      const bg = grounds[v % grounds.length];
      const body = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 1000'><defs><radialGradient id='g' cx='50%' cy='38%' r='78%'><stop offset='0' stop-color='#faf7f2'/><stop offset='1' stop-color='${bg}'/></radialGradient></defs><rect width='800' height='1000' fill='url(#g)'/><ellipse cx='400' cy='880' rx='260' ry='26' fill='rgba(0,0,0,.14)'/><g transform='${views[v]}'><path d='${shapes[kind]}' fill='${fg}' stroke='rgba(0,0,0,.22)' stroke-width='4' stroke-linejoin='round'/>${extras[kind](fg)}</g>${v === 3 ? `<rect x='300' y='80' width='200' height='70' fill='#fff' stroke='#111' stroke-width='3'/><text x='400' y='126' font-family='Georgia' font-size='30' text-anchor='middle' fill='#111'>${label}</text>` : ''}</svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body);
    };
    const page = (title, fg) => {
      const body = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 2600'><rect width='1000' height='2600' fill='#fff'/><rect width='1000' height='70' fill='#f2f2f2'/><rect x='40' y='22' width='120' height='26' fill='#111'/><rect x='60' y='120' width='480' height='600' fill='${fg}' opacity='.85'/><rect x='580' y='120' width='360' height='40' fill='#222'/><rect x='580' y='180' width='200' height='30' fill='#555'/><rect x='580' y='250' width='360' height='52' rx='26' fill='#111'/><rect x='580' y='320' width='360' height='52' rx='26' fill='none' stroke='#111' stroke-width='3'/>${Array.from({ length: 12 }, (_, k) => `<rect x='580' y='${420 + k * 34}' width='${200 + ((k * 53) % 160)}' height='14' fill='#ddd'/>`).join('')}<text x='60' y='780' font-family='Arial' font-size='26' fill='#111'>${title.replace(/[&<>']/g, '')}</text>${Array.from({ length: 8 }, (_, k) => `<rect x='${60 + (k % 4) * 225}' y='${1500 + Math.floor(k / 4) * 330}' width='200' height='250' fill='#eee'/>`).join('')}</svg>`;
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body);
    };
    const rows = [
      ['Y2K baby tee, cherry print', 'Unbranded', 'depop', 'tee', '#e0344c', 'XS', 'Good', 'Red', 28, 'AUD', 'honeyarchive', 4, 'Tiny fitted tee with a cherry print on the front. Stretchy, no holes or stains. Pit to pit 40cm.'],
      ['Cobalt bias-cut silk slip dress', 'Vintage', 'ebay', 'dress', '#2449c9', 'UK 8', 'Pre-owned: excellent', 'Blue', 64, 'GBP', 'mirrorwardrobe', 5, 'Proper 90s bias cut in a deep cobalt. Adjustable straps, hits mid-calf on 5\'6".\n\nSmall pull near the hem, shown in photo 4.'],
      ['Faded Detroit jacket, blanket lined', 'Carhartt', 'depop', 'jacket', '#9a6a3a', 'M', 'Used, well loved', 'Brown', 145, 'AUD', 'workwearbin', 4, 'Beautiful sun-fade across the shoulders. Blanket lining intact, zip works. Cuff fraying adds character.'],
      ['Pleated trousers in marigold', 'Pleats Please Issey Miyake', 'grailed', 'trousers', '#f0a21a', '3', 'Gently used', 'Yellow', 310, 'USD', 'kyotoresale', 3, 'Classic pleated straight leg in a saturated marigold. Elastic waist.'],
      ['Nylon shoulder bag, emerald', 'Prada', 'vinted', 'bag', '#138a5a', 'One size', 'Very good', 'Green', 420, 'EUR', 'elodie.v', 5, 'Authentic, with dust bag. Light scuffing to the base corners. Serial tag visible in photo 4.'],
      ['Chartreuse mohair knit', 'Acne Studios', 'depop', 'jacket', '#b7d334', 'S', 'Like new', 'Green', 180, 'AUD', 'softgoods.mel', 3, 'Oversized fuzzy knit, worn twice. Dropped shoulders.'],
      ['Lilac pleated midi skirt', 'COS', 'ebay', 'skirt', '#a98bd6', 'EU 36', 'Pre-owned: good', 'Purple', 35, 'SGD', 'sg_closetclear', 4, 'Knife pleats hold their shape. Side zip. Lining included.'],
      ['Tangerine ringer tee', 'Stüssy', 'depop', 'tee', '#ff6a2b', 'L', 'Good', 'Orange', 55, 'AUD', 'stussyarchive', 3, 'Old stock from around 2004. Cracked print on the back, soft cotton.'],
    ];
    const day = 86400000;
    return rows.map((r, k) => {
      const [title, brand, platform, kind, fg, size, condition, color, amount, currency, seller, nImg, description] = r;
      const images = Array.from({ length: nImg }, (_, v) => svg(kind, fg, v, brand.split(' ')[0].slice(0, 10)));
      return {
        id: `sample-${k}`,
        platform, title, brand, size, condition, color, seller, description,
        price: { amount, currency },
        url: `https://www.${platform === 'ebay' ? 'ebay.com' : platform + '.com'}/`,
        likedAt: new Date(Date.now() - k * 4 * day).toISOString(),
        archive: k === 1 ? { status: 'pending' } : { status: 'archived', url: 'https://web.archive.org/', archivedAt: new Date(Date.now() - k * 4 * day).toISOString() },
        images,
        screenshot: page(title, fg),
        details: k === 1 ? { Material: 'Silk', 'Dress length': 'Midi', Era: '1990s' } : k === 4 ? { Material: 'Nylon', Closure: 'Zip' } : {},
      };
    });
  }

  // ---------------------------------------------------------------- start

  (async function start() {
    measure();
    await load();
    buildChips();
    const hashId = decodeURIComponent(location.hash.slice(1));
    applyFilter(hashId || undefined);
    requestAnimationFrame(tick);
  })();
})();

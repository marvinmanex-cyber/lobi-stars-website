// MatchDay Kitchen "food table": the dishes ride round a turning table (a conveyor belt like a sushi
// restaurant's), right on the /kitchen/ page. Based on the owner's design document "Turning Sushi belt
// for restaurant.docx" (a React component), rebuilt in plain TypeScript for this site (no React, no
// libraries, no cost), in the kitchen's navy and gold (Nov 2026).
//
// What it does: the plates turn slowly; hovering a plate (or tapping it on a phone) stops the table and
// lifts the plate with its name and price; a flick spins the table; ← ⏸ → buttons and the arrow keys move
// plate by plate; tapping a lifted plate (or Enter) opens it: the plate flies into a card with the
// description, price and "Add to order" (the same cart as the menu below). Plate rings are colour-coded by
// price, with a legend. It stops when off screen, and stays still for visitors who prefer less motion.

export type BeltDish = {
  id: string;
  name: string;
  /** Price text, e.g. "₦2,500". */
  price: string;
  /** Price band 1–5 (plate ring colour). */
  tier: number;
  description?: string;
  details?: string[];
  photo?: string | null;
  emoji?: string;
  /** Photo credit (free-licence photos need the photographer's name and the licence). */
  credit?: { text: string; href?: string } | null;
};
export type BeltOptions = {
  items: BeltDish[];
  eyebrow: string;
  heading: string;
  caption: string;
  legend: { tier: number; label: string }[];
  /** False while the kitchen is closed: the card says why instead of "Add to order". */
  canAdd: boolean;
  closedText: string;
  /** Adds one to the cart; returns false when it could not (e.g. the most allowed is already in the cart). */
  onAdd: (id: string) => boolean;
  /** Link under the caption, e.g. to the full menu. */
  action?: { href: string; text: string };
};

const SPACING = 1.35, CURVE = 0.95, BAND = 1.22, TILT = 0.8, SLAT = 0.34, LIFT_Y = -6, LIFT_SCALE = 0.08, BACK_SHADE = 0.15, CHIP_ROOM = 34;
const WIDE = 1024, HOLD = 1400, RUN = 0, SEEK = 1, DRAG = 2;
type Geo = { width: number; height: number; d: number; r: number; s: number; l: number; pitch: number; n: number; kb: number; cx: number; ym: number; a: number; b: number; band: number; slats: number; side: number; edgeTop: number };
type Point = { x: number; z: number; nx: number; nz: number; tx: number; tz: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pad = (n: number) => String(n).padStart(2, '0');
const tierOf = (t: number) => clamp(Math.round(t || 1), 1, 5);

/** Position on the stadium-shaped loop: u is the distance along the belt; the front lane runs right to left. */
function along(g: Geo, u: number): Point {
  const { s, r } = g;
  let t = ((u % g.l) + g.l) % g.l;
  if (t < s) return { x: s / 2 - t, z: r, nx: 0, nz: 1, tx: -1, tz: 0 };
  t -= s;
  const arc = Math.PI * r;
  if (t < arc) { const f = t / r, sin = Math.sin(f), cos = Math.cos(f); return { x: -s / 2 - r * sin, z: r * cos, nx: -sin, nz: cos, tx: -cos, tz: -sin }; }
  t -= arc;
  if (t < s) return { x: -s / 2 + t, z: -r, nx: 0, nz: -1, tx: 1, tz: 0 };
  t -= s;
  const f = Math.min(Math.PI, t / r), sin = Math.sin(f), cos = Math.cos(f);
  return { x: s / 2 + r * sin, z: -r * cos, nx: sin, nz: -cos, tx: cos, tz: sin };
}
/** A simple perspective: the back lane shrinks and the depth is foreshortened. */
function project(g: Geo, x: number, z: number) {
  const k = g.a + g.b * z;
  return { x: g.cx + x * k, y: g.ym + TILT * (g.a * z + (g.b * z * z) / 2), k };
}
function makeGeo(width: number, n: number, d: number, kb: number): Geo {
  const l = Math.max(1, n) * SPACING * d;
  const r = Math.min(CURVE * d, l / (2 * Math.PI));
  const s = Math.max(0, (l - 2 * Math.PI * r) / 2);
  const g: Geo = { width, height: 0, d, r, s, l, pitch: l / Math.max(1, n), n: Math.max(1, n), kb, cx: width / 2, ym: 0, a: (1 + kb) / 2, b: (1 - kb) / (2 * r), band: BAND * d, slats: Math.max(10, Math.round(l / (SLAT * d))), side: Math.max(3, d * 0.07), edgeTop: 0 };
  let top = Infinity, bottom = -Infinity, edge = Infinity;
  for (let j = 0; j < 120; j++) {
    const p = along(g, (j / 120) * l);
    const rim = project(g, p.x + (p.nx * g.band) / 2, p.z + (p.nz * g.band) / 2);
    const plate = project(g, p.x, p.z);
    const half = (plate.k * d * TILT) / 2;
    edge = Math.min(edge, rim.y);
    top = Math.min(top, rim.y, plate.y + (LIFT_Y / 100) * half * 2 - half * (1 + LIFT_SCALE) - CHIP_ROOM);
    bottom = Math.max(bottom, rim.y + g.side + d * 0.06, plate.y + half + d * 0.08);
  }
  g.ym = Math.ceil(-top) + 2;
  g.height = Math.ceil(bottom - top) + 4;
  g.edgeTop = edge + g.ym;
  return g;
}
function halfSpan(g: Geo) {
  let span = 0;
  for (let j = 0; j < 120; j++) {
    const p = along(g, (j / 120) * g.l);
    const rim = project(g, p.x + (p.nx * g.band) / 2, p.z + (p.nz * g.band) / 2);
    const plate = project(g, p.x, p.z);
    span = Math.max(span, Math.abs(rim.x - g.cx) + 3, Math.abs(plate.x - g.cx) + (plate.k * g.d * (1 + LIFT_SCALE)) / 2);
  }
  return span;
}
function edgePath(g: Geo, offset: number) {
  let d = '';
  for (let j = 0; j < 168; j++) {
    const p = along(g, (j / 168) * g.l);
    const q = project(g, p.x + p.nx * offset, p.z + p.nz * offset);
    d += `${j ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
  }
  return `${d}Z`;
}
/** The belt's slat seams, redrawn every frame so they travel with the plates. */
function slatPath(g: Geo, offset: number, shift: number) {
  const half = g.band * 0.46, pitch = g.l / g.slats, bulge = pitch * 0.2;
  let d = '';
  for (let j = 0; j < g.slats; j++) {
    const p = along(g, offset + shift + j * pitch);
    const inner = project(g, p.x - p.nx * half, p.z - p.nz * half);
    const outer = project(g, p.x + p.nx * half, p.z + p.nz * half);
    const mid = project(g, p.x + p.tx * bulge, p.z + p.tz * bulge);
    d += `M${inner.x.toFixed(1)} ${inner.y.toFixed(1)}Q${(2 * mid.x - (inner.x + outer.x) / 2).toFixed(1)} ${(2 * mid.y - (inner.y + outer.y) / 2).toFixed(1)} ${outer.x.toFixed(1)} ${outer.y.toFixed(1)}`;
  }
  return d;
}
function pose(g: Geo, offset: number, i: number) {
  const p = along(g, offset - i * g.pitch);
  const q = project(g, p.x, p.z);
  return { x: q.x, y: q.y, k: q.k, depth: (p.z + g.r) / (2 * g.r) };
}
const centerOf = (g: Geo, offset: number) => ((Math.round((offset - g.s / 2) / g.pitch) % g.n) + g.n) % g.n;

const ICON = {
  prev: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.5 5.5 8l4.5 4.5"/></svg>',
  next: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5 10.5 8 6 12.5"/></svg>',
  pause: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="3" width="2.6" height="10" rx=".8"/><rect x="9.4" y="3" width="2.6" height="10" rx=".8"/></svg>',
  play: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.4v9.2a.6.6 0 0 0 .9.5l7.4-4.6a.6.6 0 0 0 0-1L5.9 2.9a.6.6 0 0 0-.9.5Z"/></svg>',
  plus: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  tick: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  close: '<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
};
/** What sits on the plate: the dish photo, or its emoji, or its initials. */
function food(item: BeltDish, big = false) {
  if (item.photo) return `<img class="kb-food" src="${esc(item.photo)}" alt="${big ? esc(item.name) : ''}" draggable="false" decoding="async">`;
  const mark = item.emoji || item.name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  return `<span class="kb-emoji${item.emoji ? '' : ' kb-initials'}" aria-hidden="true">${esc(mark)}</span>`;
}

let uidCount = 0;

/** Builds the food table inside `root`. Returns destroy(). */
export function mountBelt(root: HTMLElement, o: BeltOptions): { destroy(): void } {
  const uid = `kb${++uidCount}`;
  const items = o.items, count = items.length;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = media.matches;
  // State (what React kept in useState / useRef in the original).
  const sim = { offset: 0, v: 0, mode: RUN, target: 0, lift: [] as number[], vlift: [] as number[], z: [] as number[], lane: [] as string[], raf: 0, last: 0, visible: true, init: false, touched: false, l: 0, center: -1, published: '', px: 0, py: 0, inside: false, lock: false, lockX: 0, lockY: 0 };
  let pointer = { id: -1, index: -1, x: 0, y: 0, moved: false, start: 0, lane: 1, lastX: 0, lastT: 0, v: 0 };
  let geo: Geo | null = null, active: number | null = null, paused = false, openIndex: number | null = null, playing = !reduced;
  let pendingOpen = -1, autoActive: number | null = null, autoLast: number | null = null, autoTimer = 0;
  let wide = false, narrow = false;

  root.classList.add('kb');
  root.innerHTML = `<div class="kb-glow" aria-hidden="true"></div>
<div class="kb-inner">
  <div class="kb-side">
    <p class="kb-eyebrow">${esc(o.eyebrow)}</p>
    <h2 class="kb-h" id="${uid}-h">${esc(o.heading)}</h2>
    ${o.legend.length ? `<ul class="kb-legend" aria-label="Plate colours by price">${o.legend.map(e => `<li><span class="kb-dot kb-t${tierOf(e.tier)}"></span>${esc(e.label)}</li>`).join('')}</ul>` : ''}
    <div class="kb-caption" id="${uid}-cap" aria-live="polite"><p class="kb-cap-main"></p><p class="kb-cap-desc"></p></div>
    ${o.action ? `<a class="kb-action" href="${esc(o.action.href)}">${esc(o.action.text)}</a>` : ''}
  </div>
  <div class="kb-main">
    <div class="kb-stage" role="group" aria-labelledby="${uid}-h" aria-roledescription="turning food table">
      <div class="kb-counter" aria-hidden="true"></div>
      <div class="kb-belt" aria-hidden="true"></div>
      ${items.map((it, i) => `<button type="button" class="kb-plate" data-dish="${i}" tabindex="-1" aria-label="${esc(it.name)}, ${esc(it.price)}" aria-describedby="${uid}-cap" aria-haspopup="dialog">
<span class="kb-shadowbox" aria-hidden="true"><span class="kb-shadow"></span></span>
<span class="kb-lift"><span class="kb-dish" aria-hidden="true">${food(it)}</span><span class="kb-shade" aria-hidden="true"></span><span class="kb-ring kb-t${tierOf(it.tier)}" aria-hidden="true"></span>
<span class="kb-anchor" aria-hidden="true"><span class="kb-chip"><span class="kb-dot kb-t${tierOf(it.tier)}"></span>${esc(it.name)}<span class="kb-chip-p">${esc(it.price)}</span></span></span></span></button>`).join('')}
    </div>
    ${count > 1 ? `<div class="kb-controls"><button type="button" class="kb-ctl" data-ctl="prev" aria-label="Previous plate">${ICON.prev}</button><button type="button" class="kb-ctl" data-ctl="pause" aria-label="Pause the table" aria-pressed="false">${ICON.pause}</button><button type="button" class="kb-ctl" data-ctl="next" aria-label="Next plate">${ICON.next}</button></div>` : ''}
  </div>
</div>`;
  const stage = root.querySelector<HTMLElement>('.kb-stage')!;
  const beltBox = root.querySelector<HTMLElement>('.kb-belt')!;
  const counter = root.querySelector<HTMLElement>('.kb-counter')!;
  const plates = [...root.querySelectorAll<HTMLButtonElement>('.kb-plate')];
  const lifts = plates.map(p => p.querySelector<HTMLElement>('.kb-lift')!);
  const shades = plates.map(p => p.querySelector<HTMLElement>('.kb-shade')!);
  const shadows = plates.map(p => p.querySelector<HTMLElement>('.kb-shadow')!);
  const anchors = plates.map(p => p.querySelector<HTMLElement>('.kb-anchor')!);
  const capMain = root.querySelector<HTMLElement>('.kb-cap-main')!, capDesc = root.querySelector<HTMLElement>('.kb-cap-desc')!;
  const pauseBtn = root.querySelector<HTMLButtonElement>('[data-ctl="pause"]');
  let seam: SVGPathElement | null = null, glint: SVGPathElement | null = null;

  // ── Drawing ──
  function drawBelt() {
    const g = geo;
    if (!g) { beltBox.innerHTML = ''; return; }
    stage.style.height = `${g.height}px`;
    stage.style.setProperty('--d', `${g.d}px`);
    const outer = edgePath(g, g.band / 2), inner = edgePath(g, -g.band / 2), island = edgePath(g, -g.band / 2 - g.d * 0.035);
    const top = Math.max(0, g.edgeTop - g.d * 0.34);
    counter.style.top = `${top}px`; counter.style.height = `${Math.max(0, g.ym - top)}px`;
    // "MatchDay Kitchen" on the counter in the middle (when there is room).
    const label = g.s > g.d * 2 ? `<text x="${g.cx}" y="${(g.ym - g.side * 0.6 + g.d * 0.07).toFixed(1)}" text-anchor="middle" class="kb-island-t" style="font-size:${(g.d * 0.2).toFixed(1)}px">MATCHDAY KITCHEN</text>` : '';
    beltBox.innerHTML = `<svg width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" focusable="false">
<defs><filter id="${uid}-soft" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="${(g.d * 0.06).toFixed(1)}"/></filter>
<linearGradient id="${uid}-isl" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="kb-isl-hi"/><stop offset="1" class="kb-isl-lo"/></linearGradient></defs>
<path d="${outer}" transform="translate(0 ${(g.side + g.d * 0.07).toFixed(1)})" fill="black" opacity=".55" filter="url(#${uid}-soft)"/>
<path d="${outer}${inner}" fill-rule="evenodd" transform="translate(0 ${g.side.toFixed(1)})" class="kb-belt-side"/>
<path d="${outer}${inner}" fill-rule="evenodd" class="kb-belt-top"/>
<path class="kb-seam" fill="none" stroke="black" stroke-opacity=".42" stroke-width="${Math.max(1, g.d * 0.013).toFixed(2)}" stroke-linecap="round"/>
<path class="kb-glint" fill="none" stroke="white" stroke-opacity=".12" stroke-width="${Math.max(0.8, g.d * 0.009).toFixed(2)}" stroke-linecap="round"/>
<path d="${outer}" fill="none" class="kb-rail" stroke-width="${Math.max(2, g.d * 0.026).toFixed(2)}"/>
<path d="${outer}" fill="none" stroke="white" stroke-opacity=".45" stroke-width="${Math.max(0.8, g.d * 0.008).toFixed(2)}" transform="translate(0 -0.8)"/>
<path d="${inner}" fill="none" class="kb-rail" stroke-width="${Math.max(1.6, g.d * 0.02).toFixed(2)}"/>
<path d="${island}" class="kb-isl-wall"/>
<path d="${island}" transform="translate(0 ${(-g.side * 0.6).toFixed(1)})" fill="url(#${uid}-isl)"/>
<path d="${island}" transform="translate(0 ${(-g.side * 0.6 - 0.6).toFixed(1)})" fill="none" class="kb-isl-edge" stroke-width="${Math.max(0.8, g.d * 0.008).toFixed(2)}"/>
${label}</svg>`;
    seam = beltBox.querySelector('.kb-seam'); glint = beltBox.querySelector('.kb-glint');
    for (const p of plates) { p.style.width = `${g.d}px`; p.style.height = `${g.d * TILT}px`; }
    for (const s of shadows) s.style.filter = `blur(${Math.max(2, g.d * 0.045).toFixed(1)}px)`;
  }
  function paintPlate(i: number) {
    const g = geo, button = plates[i];
    if (!g || !button) return;
    const q = pose(g, sim.offset, i), e = sim.lift[i] ?? 0;
    button.style.transform = `translate3d(${(q.x - g.d / 2).toFixed(2)}px,${(q.y - (g.d * TILT) / 2).toFixed(2)}px,0) scale(${q.k.toFixed(4)})`;
    const z = i === active ? 2000 : 100 + Math.round(q.y);
    if (sim.z[i] !== z) { sim.z[i] = z; button.style.zIndex = String(z); }
    const lane = q.depth >= 0.5 ? 'front' : 'back';
    if (sim.lane[i] !== lane) { sim.lane[i] = lane; button.dataset.lane = lane; }
    lifts[i].style.transform = `translateY(${(LIFT_Y * e).toFixed(3)}%) scale(${(1 + LIFT_SCALE * e).toFixed(4)})`;
    shades[i].style.opacity = (BACK_SHADE * 2.4 * clamp(1 - q.depth, 0, 1) * (1 - 0.7 * clamp(e, 0, 1))).toFixed(3);
    shadows[i].style.transform = `translate3d(0,${(g.d * TILT * 0.05 * e).toFixed(2)}px,0) scale(${(1 + 0.14 * e).toFixed(3)})`;
    shadows[i].style.opacity = (1 - 0.5 * clamp(e, 0, 1)).toFixed(3);
    anchors[i].style.transform = `scale(${(1 / (q.k * (1 + LIFT_SCALE * e))).toFixed(4)})`;
  }
  function paintBelt() {
    const g = geo;
    if (!g) return;
    seam?.setAttribute('d', slatPath(g, sim.offset, 0));
    glint?.setAttribute('d', slatPath(g, sim.offset, -Math.max(1.4, g.d * 0.024)));
    const c = centerOf(g, sim.offset);
    if (c !== sim.center) { sim.center = c; roving(); }
  }
  function paintAll() { for (let i = 0; i < count; i++) paintPlate(i); paintBelt(); }
  /** Only one plate can be reached with Tab (the lifted one, else the one in front); arrow keys move along. */
  function roving() {
    const r = active ?? sim.center;
    plates.forEach((p, i) => { p.tabIndex = i === r ? 0 : -1; });
  }
  function caption() {
    const cur = active === null ? null : items[active];
    capMain.classList.toggle('on', !!cur);
    capMain.innerHTML = cur ? `${esc(cur.name)} <span>· ${esc(cur.price)}</span>` : esc(o.caption);
    capDesc.textContent = cur?.description || '';
    capDesc.hidden = !cur?.description;
  }
  function hitTest(px: number, py: number) {
    const g = geo;
    if (!g) return null;
    let best: number | null = null, bestY = -Infinity;
    for (let i = 0; i < count; i++) {
      const q = pose(g, sim.offset, i), e = clamp(sim.lift[i] ?? 0, 0, 1.2);
      const grow = (1 + LIFT_SCALE * e) * (i === active ? 1.1 : 1);
      const rx = (g.d * q.k * grow) / 2, ry = (g.d * TILT * q.k * grow) / 2;
      const dx = (px - q.x) / rx, dy = (py - (q.y + (LIFT_Y / 100) * g.d * TILT * q.k * e)) / ry;
      if (dx * dx + dy * dy > 1) continue;
      if (i === active) return i;
      if (q.y > bestY) { best = i; bestY = q.y; }
    }
    return best;
  }

  // ── Motion: springs for the lifted plate, a cruise speed for the table ──
  function tick(now: number) {
    sim.raf = 0;
    const g = geo;
    if (!g || !sim.visible) { sim.last = 0; return; }
    const dt = sim.last ? clamp((now - sim.last) / 1000, 0, 0.25) : 1 / 60;
    sim.last = now;
    const steps = Math.max(1, Math.ceil(dt / 0.017)), h = dt / steps;
    const stopped = paused || active !== null || openIndex !== null;
    const cruise = reduced ? 0 : 26;
    for (let step = 0; step < steps; step++) {
      if (sim.mode === SEEK) {
        const w = 5.6;
        sim.v += (w * w * (sim.target - sim.offset) - 2 * w * sim.v) * h;
        sim.offset += sim.v * h;
        if (Math.abs(sim.target - sim.offset) < 0.3 && Math.abs(sim.v) < 4) { sim.offset = sim.target; sim.v = 0; sim.mode = RUN; }
      } else if (sim.mode === RUN) {
        if (stopped) { sim.v *= Math.exp(-7.2 * h); if (Math.abs(sim.v) < 0.02) sim.v = 0; }
        else {
          let e = sim.v - cruise;
          if (Math.abs(e) > Math.max(6, cruise * 0.5)) e = Math.sign(e) * Math.max(0, Math.abs(e) * Math.exp(-2.4 * h) - 90 * h);
          else e *= Math.exp(-3.4 * h);
          sim.v = cruise + (Math.abs(e) < 0.01 ? 0 : e);
        }
        sim.offset += sim.v * h;
      }
      for (let i = 0; i < count; i++) {
        const goal = i === active ? 1 : 0;
        if (reduced) { sim.lift[i] = goal; sim.vlift[i] = 0; continue; }
        const x = sim.lift[i] ?? 0, v = (sim.vlift[i] ?? 0) + (330 * (goal - x) - 23 * (sim.vlift[i] ?? 0)) * h;
        sim.lift[i] = x + v * h; sim.vlift[i] = v;
      }
    }
    let busy = sim.mode !== RUN || sim.v !== 0 || (!stopped && cruise > 0);
    for (let i = 0; i < count; i++) {
      const goal = i === active ? 1 : 0;
      if (Math.abs(goal - (sim.lift[i] ?? 0)) < 0.002 && Math.abs(sim.vlift[i] ?? 0) < 0.02) { sim.lift[i] = goal; sim.vlift[i] = 0; } else busy = true;
    }
    if (sim.inside && !sim.lock && sim.mode === RUN && openIndex === null && pointer.id < 0 && Math.abs(sim.v) > 0.3) {
      const hit = hitTest(sim.px, sim.py);
      if (hit !== null && hit !== active) hover(hit);
    }
    paintAll();
    if (busy) sim.raf = requestAnimationFrame(tick); else sim.last = 0;
  }
  function kick() { if (sim.raf || !sim.visible) return; sim.last = 0; sim.raf = requestAnimationFrame(tick); }
  function setActive(next: number | null) {
    if (active === next) return;
    active = next;
    plates.forEach((p, i) => { p.toggleAttribute('data-active', i === next); if (i === next) p.setAttribute('aria-current', 'true'); else p.removeAttribute('aria-current'); });
    root.dataset.active = next === null ? '' : String(next);
    caption(); roving(); kick();
  }
  function stop() {
    playing = false;
    sim.touched = true;
    if (sim.mode === SEEK) sim.mode = RUN;
    window.clearTimeout(autoTimer);
    if (autoActive !== null) { const a = autoActive; autoActive = null; if (active === a) setActive(null); }
  }
  function seekTo(index: number) {
    const g = geo;
    if (!g) return;
    const base = g.s / 2 + index * g.pitch;
    sim.target = base + Math.round((sim.offset - base) / g.l) * g.l;
    if (reduced) { sim.offset = sim.target; sim.v = 0; sim.mode = RUN; paintAll(); return; }
    sim.mode = SEEK; kick();
  }
  const focusVisible = () => !!stage.querySelector('.kb-plate:focus-visible');
  function hover(hit: number | null) {
    if (hit === active) { if (hit !== null && autoActive === hit) { autoActive = null; playing = false; window.clearTimeout(autoTimer); } return; }
    if (hit !== null) { stop(); setActive(hit); return; }
    if (active !== null && active !== autoActive && !focusVisible()) setActive(null);
  }
  function go(index: number, focus: boolean) {
    if (!count) return;
    const next = ((index % count) + count) % count;
    stop();
    if (focus) plates[next]?.focus({ preventScroll: true });
    setActive(next); seekTo(next);
  }
  function togglePause() {
    stop();
    paused = !paused;
    if (pauseBtn) { pauseBtn.setAttribute('aria-pressed', String(paused)); pauseBtn.setAttribute('aria-label', paused ? 'Start the table' : 'Pause the table'); pauseBtn.innerHTML = paused ? ICON.play : ICON.pause; }
    if (!paused && active !== null && !focusVisible() && !sim.inside) setActive(null);
    kick();
  }
  // Autoplay: brings one plate after another to the front and lifts it, until the visitor touches the table.
  function autoplay() {
    window.clearTimeout(autoTimer);
    if (!playing || reduced || paused || openIndex !== null || !count || !geo) return;
    const show = () => {
      const g = geo;
      if (!g || !playing || paused || openIndex !== null) return;
      const index = autoLast === null ? centerOf(g, sim.offset + 26 * 0.25) : (autoLast + 1) % count;
      autoLast = index; autoActive = index;
      setActive(index); seekTo(index);
      autoTimer = window.setTimeout(() => {
        if (autoActive === index) { autoActive = null; if (active === index) setActive(null); }
        autoTimer = window.setTimeout(show, 3000 - HOLD);
      }, HOLD);
    };
    autoTimer = window.setTimeout(show, autoLast === null ? 1600 : 3000 - HOLD);
  }

  // ── Size ──
  function measure() {
    const sw = Math.round(root.clientWidth);
    const nowWide = sw >= WIDE, nowNarrow = sw > 0 && sw < 480;
    if (nowWide !== wide || nowNarrow !== narrow || !geo) { wide = nowWide; narrow = nowNarrow; root.dataset.layout = wide ? 'wide' : 'stack'; }
    const width = Math.round(stage.clientWidth);
    if (!width || !count) return;
    const kb = narrow ? 0.6 : 0.68;
    const span = halfSpan(makeGeo(1000, count, 100, kb)) / 100;
    const cap = wide ? 150 : clamp(sw * 0.143, 96, 150);
    const fit = (width - 8) / (2 * span);
    const next = makeGeo(width, count, Math.round(clamp(fit, Math.min(96, cap), cap)), kb);
    if (geo && geo.width === next.width && geo.d === next.d && geo.kb === next.kb) return;
    const old = geo;
    geo = next;
    if (!sim.init) {
      sim.init = true;
      sim.offset = next.s / 2 - Math.min(26 * 1.62, next.pitch * 0.45);
      sim.v = reduced ? 0 : 26;
      if (reduced) sim.offset = next.s / 2;
    } else if (old && old.l !== next.l) { const f = next.l / old.l; sim.offset *= f; sim.target *= f; }
    sim.z = []; sim.lane = [];
    drawBelt(); paintAll(); kick(); autoplay();
  }
  const ro = new ResizeObserver(() => measure());
  ro.observe(root); ro.observe(stage);

  // ── Pointer, keyboard and buttons ──
  const local = (e: PointerEvent) => { const b = stage.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !geo) return;
    const at = local(e), hit = hitTest(at.x, at.y);
    pendingOpen = -1;
    pointer = { id: e.pointerId, index: hit ?? -1, x: e.clientX, y: e.clientY, moved: false, start: sim.offset, lane: at.y >= geo.ym ? 1 : -1, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
  });
  stage.addEventListener('pointermove', e => {
    const g = geo;
    if (!g) return;
    const at = local(e);
    if (e.pointerType === 'mouse') { sim.px = at.x; sim.py = at.y; sim.inside = true; }
    const p = pointer;
    if (p.id === e.pointerId) {
      const dx = e.clientX - p.x;
      if (!p.moved && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - p.y)) {
        p.moved = true; stop(); setActive(null); sim.mode = DRAG;
        if (stage.isConnected) stage.setPointerCapture(e.pointerId);
      }
      if (p.moved) {
        const v = (e.clientX - p.lastX) / Math.max(1, e.timeStamp - p.lastT);
        p.v = p.v * 0.6 + v * 0.4; p.lastX = e.clientX; p.lastT = e.timeStamp;
        const scale = p.lane > 0 ? 1 : 1 / g.kb;
        sim.offset = p.start - p.lane * dx * scale;
        sim.v = reduced ? 0 : -p.lane * p.v * 1000 * scale;
        kick();
      }
      return;
    }
    if (e.pointerType !== 'mouse' || openIndex !== null) return;
    if (sim.lock) { if (Math.hypot(at.x - sim.lockX, at.y - sim.lockY) < 4) return; sim.lock = false; }
    hover(hitTest(at.x, at.y));
  });
  const finish = (e: PointerEvent, cancelled: boolean) => {
    const p = pointer;
    if (p.id !== e.pointerId) return;
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    pointer = { ...p, id: -1 };
    if (sim.mode === DRAG) {
      sim.mode = RUN;
      const carry = Math.exp(-Math.max(0, e.timeStamp - p.lastT) / 70);
      sim.v = reduced ? 0 : clamp(sim.v * carry, -1400, 1400);
      if (e.pointerType === 'mouse') { const at = local(e); sim.lock = true; sim.lockX = at.x; sim.lockY = at.y; }
      kick();
      return;
    }
    if (cancelled || p.moved) return;
    const touch = e.pointerType !== 'mouse';
    if (p.index < 0) { if (touch && active !== null) { stop(); setActive(null); } return; }
    stop();
    // On a phone the first tap lifts the plate, the second opens it; with a mouse one click opens it.
    if (touch && active !== p.index) setActive(p.index); else pendingOpen = p.index;
  };
  stage.addEventListener('pointerup', e => finish(e, false));
  stage.addEventListener('pointercancel', e => finish(e, true));
  stage.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    sim.inside = false; sim.lock = false;
    if (pointer.id < 0 && openIndex === null && active !== null && active !== autoActive && !focusVisible()) setActive(null);
  });
  stage.addEventListener('focusout', e => {
    const next = e.relatedTarget as Node | null;
    if ((next && stage.contains(next)) || openIndex !== null || sim.inside) return;
    if (active !== null && active !== autoActive) setActive(null);
  });
  stage.addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key) || !count) return;
    e.preventDefault();
    const own = (e.target as HTMLElement).closest('[data-dish]')?.getAttribute('data-dish');
    const from = own != null ? Number(own) : (active ?? sim.center);
    go(e.key === 'Home' ? 0 : e.key === 'End' ? count - 1 : from + (e.key === 'ArrowRight' ? 1 : -1), true);
  });
  plates.forEach((p, i) => {
    p.addEventListener('focus', () => { if (pointer.id < 0) { stop(); setActive(i); } });
    p.addEventListener('click', e => { const pend = pendingOpen; pendingOpen = -1; if (e.detail === 0 || pend === i) open(i); });
  });
  root.querySelector('[data-ctl="prev"]')?.addEventListener('click', () => go((active ?? sim.center) - 1, false));
  root.querySelector('[data-ctl="next"]')?.addEventListener('click', () => go((active ?? sim.center) + 1, false));
  pauseBtn?.addEventListener('click', togglePause);

  // ── The dish card (the plate flies up into it) ──
  function open(index: number) {
    stop(); setActive(index);
    sim.v = 0; sim.mode = RUN;
    openIndex = index; root.dataset.open = String(index);
    paintBelt();
    const item = items[index], tier = tierOf(item.tier);
    const back = document.body.style.overflow;
    const box = document.createElement('div');
    box.className = 'kb-dialog';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', `${uid}-dt`);
    box.innerHTML = `<div class="kb-dlg-bg" aria-hidden="true"></div>
<div class="kb-dlg-card">
  <div class="kb-dlg-panel" aria-hidden="true"></div>
  <button type="button" class="kb-dlg-x">Close ${ICON.close}</button>
  <div class="kb-dlg-fig"><span class="kb-dlg-shadow" aria-hidden="true"></span><span class="kb-dlg-plate">${food(item, true)}</span><span class="kb-dlg-ring kb-t${tier}" aria-hidden="true"></span></div>
  <div class="kb-dlg-text">
    <p class="kb-dlg-n"><span class="kb-dot kb-t${tier}" aria-hidden="true"></span>${pad(index + 1)} / ${pad(count)}</p>
    <h3 id="${uid}-dt">${esc(item.name)}</h3>
    ${item.description ? `<p class="kb-dlg-desc">${esc(item.description)}</p>` : ''}
    ${item.details?.length ? `<ul class="kb-dlg-tags">${item.details.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    <div class="kb-dlg-buy"><p class="kb-dlg-price">${esc(item.price)}</p>${o.canAdd ? `<button type="button" class="kb-dlg-add">${ICON.plus}<span>Add to order</span></button>` : `<p class="kb-dlg-closed">${esc(o.closedText)}</p>`}</div>
    <p class="kb-dlg-msg" role="status"></p>
    ${item.credit ? `<p class="kb-dlg-credit">${item.credit.href ? `<a href="${esc(item.credit.href)}" target="_blank" rel="noopener">${esc(item.credit.text)}</a>` : esc(item.credit.text)}</p>` : ''}
  </div>
</div>`;
    document.body.appendChild(box);
    document.body.style.overflow = 'hidden';
    const figure = box.querySelector<HTMLElement>('.kb-dlg-fig')!, closeBtn = box.querySelector<HTMLButtonElement>('.kb-dlg-x')!;
    const source = () => lifts[index]?.getBoundingClientRect() ?? null;
    closeBtn.focus({ preventScroll: true });
    plates[index].style.visibility = 'hidden';
    const from = source();
    if (from && !reduced && from.width > 0) {
      const to = figure.getBoundingClientRect();
      const sx = from.width / to.width, sy = from.height / to.height;
      const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
      const rise = Math.min(120, Math.abs(dy) * 0.3 + 40);
      figure.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transform: `translate(${dx * 0.42}px, ${dy * 0.42 - rise}px) scale(${((sx + 1) / 2) * 1.05}, ${((sy + 1) / 2) * 1.05}) rotate(${dx > 0 ? -6 : 6}deg)`, offset: 0.5 },
        { transform: 'none' },
      ], { duration: 680, easing: 'cubic-bezier(.22,.85,.3,1)' });
    }
    requestAnimationFrame(() => box.classList.add('shown'));
    let closing = false, added = false, timer = 0;
    const done = () => {
      document.removeEventListener('keydown', onDocKey);
      box.remove();
      document.body.style.overflow = back;
      plates[index].style.visibility = '';
      openIndex = null; root.dataset.open = '';
      plates[index]?.focus({ preventScroll: true });
      kick();
    };
    const dismiss = () => {
      if (closing) return;
      closing = true; window.clearTimeout(timer);
      box.classList.remove('shown');
      const to = source();
      if (!to || reduced || to.width === 0) { done(); return; }
      const f = figure.getBoundingClientRect();
      const sx = to.width / f.width, sy = to.height / f.height;
      const dx = to.left + to.width / 2 - (f.left + f.width / 2), dy = to.top + to.height / 2 - (f.top + f.height / 2);
      const anim = figure.animate([
        { transform: 'none' },
        { transform: `translate(${dx * 0.58}px, ${dy * 0.58 - 36}px) scale(${(sx + 1) / 2}, ${(sy + 1) / 2})`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      ], { duration: 540, easing: 'cubic-bezier(.45,0,.55,1)', fill: 'forwards' });
      anim.onfinish = done;
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); dismiss(); return; }
      if (e.key !== 'Tab') return;
      const ctl = [...box.querySelectorAll<HTMLButtonElement>('button')].filter(b => !b.disabled);
      if (!ctl.length) return;
      const first = ctl[0], last = ctl[ctl.length - 1];
      if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onDocKey);
    box.querySelector('.kb-dlg-bg')!.addEventListener('click', dismiss);
    closeBtn.addEventListener('click', dismiss);
    const add = box.querySelector<HTMLButtonElement>('.kb-dlg-add');
    add?.addEventListener('click', () => {
      if (added || closing) return;
      const ok = o.onAdd(item.id);
      const msg = box.querySelector<HTMLElement>('.kb-dlg-msg')!;
      if (!ok) { msg.textContent = 'You already have the most allowed of this in your cart.'; return; }
      added = true;
      add.innerHTML = `${ICON.tick}<span>Added to your order</span>`;
      add.classList.add('is-added');
      msg.textContent = `${item.name} is in your cart.`;
      timer = window.setTimeout(dismiss, reduced ? 600 : 750);
    });
  }

  // ── Visibility: no animation while the table is off screen or the tab is hidden ──
  let inView = true;
  const vis = () => {
    const visible = inView && !document.hidden;
    if (visible === sim.visible) return;
    sim.visible = visible;
    if (visible) kick(); else if (sim.raf) { cancelAnimationFrame(sim.raf); sim.raf = 0; sim.last = 0; }
  };
  const io = new IntersectionObserver(es => { inView = es.some(x => x.isIntersecting); vis(); });
  io.observe(root);
  document.addEventListener('visibilitychange', vis);
  const onMotion = () => { reduced = media.matches; if (reduced) { playing = false; window.clearTimeout(autoTimer); sim.v = 0; } kick(); };
  media.addEventListener('change', onMotion);

  caption(); measure();
  return {
    destroy() {
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', vis);
      media.removeEventListener('change', onMotion);
      window.clearTimeout(autoTimer);
      if (sim.raf) cancelAnimationFrame(sim.raf);
      document.querySelectorAll('.kb-dialog').forEach(d => d.remove());
      root.innerHTML = ''; root.classList.remove('kb');
    },
  };
}

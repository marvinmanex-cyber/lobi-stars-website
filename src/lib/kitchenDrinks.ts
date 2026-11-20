// MatchDay Kitchen "Drinks" showcase (owner's design document "Rotating 3D Drinks section", Nov 2026, modelled on
// the drinks section of restaurant-ruddy-ten-39.vercel.app): the drinks list on one side, a stage on the other where
// one drink after another makes its entrance, in turn:
//   1. it drops from above, lands on the counter and its cap pops off (with a fizz),
//   2. the next one just appears,
//   3. the next one is revealed (rises into view),
//   4. the next one has its cap popped open,
// and the moment each is fully revealed it turns, showing its other sides (bottles and cans turn their label round;
// the juice carton turns in 3D). It moves on by itself (paused while pointed at, or with the pause button); tapping a
// drink in the list shows it at once. Drawn in SVG/CSS (no images, no libraries, no cost); still for visitors who
// prefer less motion.

export type DrinkRow = { id: string; name: string; description: string; price: string; adult: boolean };
type Kind = 'glass' | 'pet' | 'can' | 'carton';
type Look = { photo?: { src: string; ratio: number; mode: 'lathe' | 'card'; metal: boolean }; kind: Kind; liquid: string; glass: string; label: string; ink: string; cap: string; brand: string; sub: string; serif?: boolean; accent?: string };

const DWELL = 5200;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** How each drink is drawn (by its name). Brand colours and names only: no logos are copied. */
// The club's own drink pictures (cut out of their backgrounds): public/images/kitchen/drinks/.
// [name test, file, width/height, 3D: 'lathe' = round body turned in 3D, 'card' = a group or a glass that sways, metal]
const PHOTOS: [RegExp, string, number, 'lathe' | 'card', boolean][] = [[/coca|coke/, 'coca-cola', 150 / 538, 'lathe', false], [/fanta/, 'fanta', 198 / 640, 'lathe', false], [/sprite/, 'sprite', 190 / 640, 'lathe', false], [/malt/, 'malt', 378 / 633, 'card', false], [/energy/, 'energy', 265 / 640, 'lathe', true], [/juice/, 'juice', 470 / 640, 'card', false], [/water/, 'water', 267 / 640, 'lathe', false]];
function lookOf(d: DrinkRow): Look {
  const n = `${d.id} ${d.name}`.toLowerCase();
  const ph = PHOTOS.find(([re]) => re.test(n));
  if (ph) return { photo: { src: `/images/kitchen/drinks/${ph[1]}.webp`, ratio: ph[2], mode: ph[3], metal: ph[4] }, kind: 'glass', liquid: '', glass: '', label: '', ink: '', cap: '', brand: d.name, sub: '' };
  const size = d.name.match(/\(([^)]*\d[^)]*)\)/)?.[1] || '';
  if (/coca|coke/.test(n)) return { kind: 'glass', liquid: '#2B120A', glass: 'rgba(225,235,240,.32)', label: '#E41E2B', ink: '#FFFFFF', cap: '#D81E2A', brand: 'Coca-Cola', sub: size || 'Ice-cold', serif: true };
  if (/fanta/.test(n)) return { kind: 'pet', liquid: '#FF7A00', glass: 'rgba(255,190,120,.25)', label: '#1D3FA8', ink: '#FF8A1C', cap: '#FF7A00', brand: 'Fanta', sub: size || 'Orange', accent: '#7ED957' };
  if (/sprite/.test(n)) return { kind: 'glass', liquid: '#CFF5C8', glass: 'rgba(40,150,80,.55)', label: '#FFFFFF', ink: '#13883B', cap: '#13883B', brand: 'Sprite', sub: size || 'Lemon-lime', accent: '#FFD400' };
  if (/water/.test(n)) return { kind: 'pet', liquid: 'rgba(175,220,255,.35)', glass: 'rgba(200,230,255,.25)', label: '#FFFFFF', ink: '#1E6FD9', cap: '#1E6FD9', brand: 'Water', sub: size || 'Still · chilled' };
  if (/malt/.test(n)) return { kind: 'can', liquid: '#3A1A08', glass: '', label: '#FF7F1A', ink: '#3A1A08', cap: '#C9CED6', brand: 'Malt', sub: 'Non-alcoholic', accent: '#FFFFFF' };
  if (/juice/.test(n)) return { kind: 'carton', liquid: '#FFA41B', glass: '', label: '#FF9F1C', ink: '#FFFFFF', cap: '#2E9E44', brand: 'Fruit Juice', sub: '100% fruit', accent: '#2E9E44' };
  if (/energy/.test(n)) return { kind: 'can', liquid: '#111', glass: '', label: '#16205A', ink: '#B7F34A', cap: '#C9CED6', brand: 'Energy', sub: 'Chilled', accent: '#C9CED6' };
  return { kind: 'glass', liquid: '#7A2E12', glass: 'rgba(225,235,240,.3)', label: '#FFC21A', ink: '#10224A', cap: '#FFC21A', brand: d.name.replace(/\s*\(.*\)\s*/, '').slice(0, 14), sub: size || 'Chilled' };
}

// The label strip: front (brand) then back (small print and barcode), 272 wide (two faces of 136), repeated twice
// so it can scroll round endlessly; the bottle's own shading stays still on top, so it looks like it is turning.
function strip(l: Look, h: number) {
  const face = (x: number) => `<text x="${x + 68}" y="${h * 0.56}" text-anchor="middle" class="kd-brand${l.serif ? ' kd-serif' : ''}" fill="${l.ink}" style="font-size:${Math.min(34, 260 / Math.max(5, l.brand.length))}px">${esc(l.brand)}</text>
<text x="${x + 68}" y="${h * 0.82}" text-anchor="middle" class="kd-sub" fill="${l.ink}">${esc(l.sub)}</text>`;
  const back = (x: number) => `${[0.22, 0.34, 0.46, 0.58].map((f, i) => `<rect x="${x + 16}" y="${h * f}" width="${i % 2 ? 70 : 96}" height="3" rx="1.5" fill="${l.ink}" opacity=".55"/>`).join('')}
${Array.from({ length: 14 }, (_, i) => `<rect x="${x + 70 + i * 4}" y="${h * 0.66}" width="${i % 3 ? 2 : 3}" height="${h * 0.22}" fill="${l.ink}" opacity=".8"/>`).join('')}`;
  const accent = (x: number) => (l.accent ? `<circle cx="${x + 120}" cy="${h * 0.24}" r="${h * 0.12}" fill="${l.accent}" opacity=".9"/>` : '');
  let out = '';
  for (const base of [0, 272]) out += `<rect x="${base}" y="0" width="272" height="${h}" fill="${l.label}"/>${accent(base)}${face(base)}${back(base + 136)}`;
  return out;
}

/** The drink drawing (SVG), or the 3D carton (CSS). */
function drawing(l: Look, id: string) {
  if (l.photo) return `<img class="kd-photo" src="${esc(l.photo.src)}" alt="" draggable="false" decoding="async">`;
  if (l.kind === 'carton') {
    const side = (cls: string, inner: string) => `<div class="kd-face ${cls}" style="background:${l.label}">${inner}</div>`;
    const front = `<b style="color:${l.ink}">${esc(l.brand)}</b><span style="color:${l.ink}">${esc(l.sub)}</span><i class="kd-fruit" style="background:${l.accent}"></i><i class="kd-fruit kd-fruit2"></i>`;
    const back = `<span class="kd-lines"><i></i><i></i><i></i><i></i></span><span class="kd-bars"></span>`;
    return `<div class="kd-carton" aria-hidden="true"><div class="kd-box">${side('kd-front', front)}${side('kd-back', back)}${side('kd-left', `<span class="kd-vert" style="color:${l.ink}">${esc(l.brand)}</span>`)}${side('kd-right', `<span class="kd-vert" style="color:${l.ink}">${esc(l.sub)}</span>`)}<div class="kd-face kd-top" style="background:${l.label}"></div><div class="kd-face kd-bottom" style="background:${l.label}"></div></div><span class="kd-straw" style="background:${l.cap}"></span></div>`;
  }
  const uid = `kd-${id.replace(/[^a-z0-9]/gi, '')}`;
  if (l.kind === 'can') {
    return `<svg class="kd-svg" viewBox="0 0 200 460" aria-hidden="true">
<defs><clipPath id="${uid}-c"><rect x="44" y="150" width="112" height="282" rx="10"/></clipPath>
<linearGradient id="${uid}-s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".22" stop-color="#fff" stop-opacity=".28"/><stop offset=".32" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient></defs>
<g clip-path="url(#${uid}-c)"><g class="kd-roll" style="--w:272px" transform="translate(44 150)"><g class="kd-rollin">${strip(l, 282)}</g></g></g>
<rect x="44" y="150" width="112" height="282" rx="10" fill="url(#${uid}-s)"/>
<path d="M50 150 Q100 130 150 150 L156 162 H44 Z" fill="${l.cap}"/><ellipse cx="100" cy="150" rx="50" ry="10" fill="#E4E8EE"/><ellipse cx="100" cy="150" rx="40" ry="7" fill="#B9C0CA"/>
<g class="kd-cap kd-tab"><rect x="92" y="143" width="22" height="9" rx="4.5" fill="#8E96A3"/></g>
<rect x="46" y="426" width="108" height="10" rx="5" fill="#9AA2AE"/></svg>`;
  }
  // Bottles: glass (contour) or plastic (PET).
  const body = l.kind === 'glass'
    ? 'M86 42 h28 q2 6 3 12 l6 62 q4 30 24 52 q16 20 16 54 v196 q0 22 -14 26 h-98 q-14 -4 -14 -26 v-196 q0 -34 16 -54 q20 -22 24 -52 l6 -62 q1 -6 3 -12 z'
    : 'M84 46 h32 v18 q34 22 40 64 v290 q0 26 -22 34 h-68 q-22 -8 -22 -34 v-290 q6 -42 40 -64 z';
  const liquidTop = l.kind === 'glass' ? 132 : 112;
  const labelY = l.kind === 'glass' ? 262 : 226, labelH = l.kind === 'glass' ? 96 : 120;
  return `<svg class="kd-svg" viewBox="0 0 200 460" aria-hidden="true">
<defs><clipPath id="${uid}-b"><path d="${body}"/></clipPath>
<linearGradient id="${uid}-s" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".18" stop-color="#fff" stop-opacity=".34"/><stop offset=".27" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".46"/></linearGradient></defs>
<path d="${body}" fill="${l.glass}"/>
<g clip-path="url(#${uid}-b)">
  <rect x="20" y="${liquidTop}" width="160" height="330" fill="${l.liquid}"/>
  <g class="kd-bubbles">${Array.from({ length: 9 }, (_, i) => `<circle cx="${62 + (i * 37) % 80}" cy="${430 - (i * 29) % 160}" r="${1.6 + (i % 3)}" fill="#fff" opacity=".55" style="--i:${i}"/>`).join('')}</g>
  <g class="kd-roll" style="--w:272px" transform="translate(32 ${labelY})"><g class="kd-rollin">${strip(l, labelH)}</g></g>
  <rect x="0" y="0" width="200" height="460" fill="url(#${uid}-s)"/>
</g>
<path d="${body}" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="2"/>
<g class="kd-cap"><rect x="${l.kind === 'glass' ? 82 : 80}" y="${l.kind === 'glass' ? 24 : 22}" width="${l.kind === 'glass' ? 36 : 40}" height="${l.kind === 'glass' ? 20 : 26}" rx="${l.kind === 'glass' ? 4 : 5}" fill="${l.cap}"/>${l.kind === 'glass' ? Array.from({ length: 8 }, (_, i) => `<rect x="${83 + i * 4.4}" y="40" width="2.4" height="6" fill="${l.cap}"/>`).join('') : `<rect x="80" y="40" width="40" height="5" fill="rgba(0,0,0,.25)"/>`}</g>
</svg>`;
}

export function mountDrinks(host: HTMLElement, o: { items: DrinkRow[]; ctrlHtml: (id: string) => string }): { update(): void; destroy(): void } {
  const items = o.items;
  // Always moving, whatever the computer's "less motion" setting (owner's request); the pause button stops it.
  const reduced = false;
  const ENTRANCES = ['drop', 'appear', 'reveal', 'pop'] as const;
  // The real 3D drink on the stage (src/lib/drink3d.ts, loaded only when needed).
  let solid: { destroy(): void } | null = null, showId = 0;
  const running = () => !paused && !hover && inView && !document.hidden && !stopped;
  let index = 0, step = 0, elapsed = 0, last = 0, raf = 0, paused = false, hover = false, stopped = false, inView = true;
  const timers: number[] = [];
  host.className = 'kd';
  host.innerHTML = `<div class="kd-list" role="list">${items.map((d, i) => `<div class="kd-row" role="listitem" data-i="${i}">
<button type="button" class="kd-pick" data-pick="${i}" aria-controls="kdStage"><span class="kd-name">${esc(d.name)}</span><span class="kd-desc">${esc(d.description)}${d.adult ? ' · 18+' : ''}</span></button>
<span class="kd-price">${esc(d.price)}</span><span class="kd-ctrl" data-ctrl="${esc(d.id)}">${o.ctrlHtml(d.id)}</span><span class="kd-bar" aria-hidden="true"><i></i></span></div>`).join('')}</div>
<div class="kd-stage" id="kdStage" role="region" aria-roledescription="drinks showcase" aria-label="Drinks">
  <div class="kd-glow" aria-hidden="true"></div><div class="kd-counter" aria-hidden="true"></div>
  <figure class="kd-fig" aria-live="polite"></figure>
  <button type="button" class="kd-pause" aria-pressed="false" aria-label="Pause the drinks">❚❚</button>
</div>`;
  const stage = host.querySelector<HTMLElement>('.kd-stage')!, fig = host.querySelector<HTMLElement>('.kd-fig')!, pauseBtn = host.querySelector<HTMLButtonElement>('.kd-pause')!;
  const rows = [...host.querySelectorAll<HTMLElement>('.kd-row')];
  const clear = () => { while (timers.length) window.clearTimeout(timers.pop()); };

  function show(i: number, entrance: typeof ENTRANCES[number]) {
    clear();
    index = i; elapsed = 0;
    const d = items[i], l = lookOf(d);
    rows.forEach((r, k) => { r.classList.toggle('on', k === i); r.querySelector('.kd-pick')!.setAttribute('aria-current', k === i ? 'true' : 'false'); });
    fig.className = `kd-fig ${l.photo ? 'kd-photofig' : `kd-${l.kind}`}`;
    const turner = l.kind === 'carton' && !l.photo ? drawing(l, d.id) : `<div class="kd-side kd-side-f">${drawing(l, `${d.id}-f`)}</div><div class="kd-side kd-side-b">${drawing(l, `${d.id}-b`)}</div>`;
    fig.innerHTML = `<div class="kd-drink"${l.photo ? ` style="aspect-ratio:${l.photo.ratio.toFixed(4)}"` : ''}><div class="kd-turner">${turner}</div><span class="kd-fizz" aria-hidden="true">${'<i></i>'.repeat(7)}</span></div><span class="kd-shadow" aria-hidden="true"></span><figcaption>${esc(d.name)}</figcaption>`;
    fig.setAttribute('aria-label', `${d.name}, ${d.price}`);
    solid?.destroy(); solid = null;
    if (l.photo) {
      const id = ++showId, ph = l.photo, side = fig.querySelector<HTMLElement>('.kd-side-f');
      import('./drink3d').then(m => side ? m.mount3D(side, ph.src, ph.mode, running, ph.metal) : null).then(h => { if (id === showId) solid = h; else h?.destroy(); }).catch(() => {});
    }
    if (reduced) { fig.classList.add('kd-in', 'kd-still'); return; }
    void fig.offsetWidth;
    fig.classList.add(`kd-enter-${entrance}`);
    // When it is fully in view: the cap pops (drop and pop entrances) and it starts turning.
    const inAt = { drop: 900, appear: 450, reveal: 1000, pop: 350 }[entrance];
    timers.push(window.setTimeout(() => fig.classList.add('kd-in', 'kd-spin'), inAt));
    // Once the entrance is over, settle into the finished look (so redrawing the menu never replays it).
    timers.push(window.setTimeout(() => fig.classList.remove(`kd-enter-${entrance}`), inAt + 400));
    if (entrance === 'drop' || entrance === 'pop') {
      const openAt = inAt + (entrance === 'pop' ? 250 : 80);
      timers.push(window.setTimeout(() => fig.classList.add('kd-open'), openAt));
      timers.push(window.setTimeout(() => { fig.classList.remove('kd-open'); fig.classList.add('kd-capgone'); }, openAt + 1500));
    }
  }
  function next() { step += 1; show((index + 1) % items.length, ENTRANCES[step % ENTRANCES.length]); }
  function frame(t: number) {
    raf = 0;
    const running = !paused && !hover && inView && !document.hidden && !stopped;
    const dt = last ? Math.min(250, t - last) : 0;
    last = t;
    if (running && !reduced) {
      elapsed += dt;
      const bar = rows[index]?.querySelector<HTMLElement>('.kd-bar i');
      if (bar) bar.style.transform = `scaleX(${Math.min(1, elapsed / DWELL).toFixed(3)})`;
      if (elapsed >= DWELL && items.length > 1) { rows[index]?.querySelector<HTMLElement>('.kd-bar i')?.style.removeProperty('transform'); next(); }
    }
    raf = requestAnimationFrame(frame);
  }
  host.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (!b) return;
    started = true;
    rows[index]?.querySelector<HTMLElement>('.kd-bar i')?.style.removeProperty('transform');
    step += 1;
    show(Number(b.dataset.pick), ENTRANCES[step % ENTRANCES.length]);
  });
  stage.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { hover = true; stage.classList.add('kd-hold'); } });
  stage.addEventListener('pointerleave', () => { hover = false; stage.classList.remove('kd-hold'); });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.setAttribute('aria-pressed', String(paused));
    pauseBtn.setAttribute('aria-label', paused ? 'Play the drinks' : 'Pause the drinks');
    pauseBtn.textContent = paused ? '▶' : '❚❚';
    stage.classList.toggle('kd-paused', paused);
  });
  // The show starts the first time the stage comes into view (so the first drop is seen, not played off screen).
  let started = false;
  const io = new IntersectionObserver(es => { inView = es.some(x => x.isIntersecting); if (inView && !started) { started = true; show(0, 'drop'); } });
  io.observe(stage);
  if (reduced) { pauseBtn.hidden = true; host.classList.add('kd-reduced'); }
  raf = requestAnimationFrame(frame);
  return {
    /** Redraws the Add / quantity controls (after a cart change) without restarting the show. */
    update() { for (const d of items) { const c = host.querySelector<HTMLElement>(`[data-ctrl="${CSS.escape(d.id)}"]`); if (c) c.innerHTML = o.ctrlHtml(d.id); } },
    destroy() { stopped = true; solid?.destroy(); clear(); if (raf) cancelAnimationFrame(raf); io.disconnect(); host.innerHTML = ''; },
  };
}

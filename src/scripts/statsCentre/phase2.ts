// Statistics Center › Phase 2 screens (staff only): the pitch picker, maps, set pieces, ratings, player pages and
// comparison, season analytics, scouting, training themes, monthly reports and the xG model settings.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ctx } from './bst';
import { fx, club } from './fx';

const W = 105, H = 68; // the pitch in metres; positions are stored 0–100 on each axis
const pct = (v: number, max: number) => (v * max) / 100;
const PERIOD_NAME: Record<string, string> = { '1H': '1st half', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2' };

/** The pitch drawing (markings only), as SVG content in a 105 × 68 view box. */
export function pitchSvg(inner = '', { flip = false, label = '' } = {}) {
  const line = 'fill="none" stroke="rgba(255,255,255,.85)" stroke-width=".4"';
  return `<svg class="p2-pitch" viewBox="-2 -2 ${W + 4} ${H + 4}" role="img" aria-label="${label || 'Football pitch'}" preserveAspectRatio="xMidYMid meet">
    <rect x="-2" y="-2" width="${W + 4}" height="${H + 4}" fill="#2E7D32"/>${Array.from({ length: 7 }, (_, i) => `<rect x="${i * 15}" y="0" width="7.5" height="${H}" fill="rgba(255,255,255,.04)"/>`).join('')}
    <rect x="0" y="0" width="${W}" height="${H}" ${line}/><line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" ${line}/><circle cx="${W / 2}" cy="${H / 2}" r="9.15" ${line}/>
    <rect x="0" y="${H / 2 - 20.16}" width="16.5" height="40.32" ${line}/><rect x="${W - 16.5}" y="${H / 2 - 20.16}" width="16.5" height="40.32" ${line}/>
    <rect x="0" y="${H / 2 - 9.16}" width="5.5" height="18.32" ${line}/><rect x="${W - 5.5}" y="${H / 2 - 9.16}" width="5.5" height="18.32" ${line}/>
    <rect x="-1.5" y="${H / 2 - 3.66}" width="1.5" height="7.32" fill="rgba(255,255,255,.9)"/><rect x="${W}" y="${H / 2 - 3.66}" width="1.5" height="7.32" fill="rgba(255,255,255,.9)"/>
    <circle cx="11" cy="${H / 2}" r=".5" fill="#fff"/><circle cx="${W - 11}" cy="${H / 2}" r=".5" fill="#fff"/>
    ${flip ? '' : `<text x="${W / 2}" y="${H - 1.5}" text-anchor="middle" font-size="2.6" fill="rgba(255,255,255,.75)">attacking →</text>`}
    ${inner}</svg>`;
}

/**
 * One extra tap after the player: where did it happen? Draws the pitch as the statistician sees it (this half's
 * attacking direction for the acting team) and returns x, y (0–100) in the acting team's attacking direction, or null
 * for Skip.
 */
export function pickOnPitch(box: HTMLElement, { teamAttacksRight = true, teamName = '' } = {}): Promise<{ x: number; y: number } | null> {
  return new Promise(resolve => {
    box.innerHTML = `<p class="sx-small" style="margin:0 0 6px">Tap where it happened (${teamAttacksRight ? `${teamName} attack to the right →` : `← ${teamName} attack to the left`}).</p>
      <div class="p2-pick">${pitchSvg(`<text x="${teamAttacksRight ? W - 3 : 3}" y="4" text-anchor="${teamAttacksRight ? 'end' : 'start'}" font-size="3" fill="#FFC72C">${teamAttacksRight ? 'goal they attack →' : '← goal they attack'}</text>`, { flip: true, label: 'Tap the pitch where it happened' })}</div>
      <div class="sx-row" style="margin-top:8px"><button type="button" class="sx-btn" data-skip>Skip (no position)</button></div>`;
    const svg = box.querySelector('svg') as SVGSVGElement;
    svg.style.cursor = 'crosshair';
    svg.addEventListener('click', (e: MouseEvent) => {
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
      let x = Math.max(0, Math.min(100, (p.x / W) * 100)), y = Math.max(0, Math.min(100, (p.y / H) * 100));
      if (!teamAttacksRight) { x = 100 - x; y = 100 - y; }
      resolve({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }, { once: true });
    box.querySelector('[data-skip]')!.addEventListener('click', () => resolve(null), { once: true });
  });
}
/** Does the acting team attack to the right on the statistician's screen in this period? */
export function attacksRight(match: any, side: string, period: string) {
  const lobiSide = match.lobiHome ? 'home' : 'away';
  const lobiRight1 = (match.attack1h || 'ltr') === 'ltr';
  const lobiRight = period === '2H' || period === 'ET2' ? !lobiRight1 : lobiRight1;
  return side === lobiSide ? lobiRight : !lobiRight;
}

// ── The views ──
const COLOURS: Record<string, string> = { goal: '#FFC72C', on_target: '#4FC3F7', off_target: '#EF9A9A', blocked: '#B0BEC5', woodwork: '#CE93D8' };
function filters(c: Ctx, f: any, extra = '') {
  const { esc, S } = c;
  return `<form class="sx-card sx-row" data-f>${`<label>Season<select name="season">${S.seasons.map((s: string) => `<option ${s === f.season ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`}${extra}<button class="sx-btn sx-btn--p" type="submit">Show</button></form>`;
}
const readForm = (el: HTMLElement) => Object.fromEntries(new FormData(el.querySelector('[data-f]') as HTMLFormElement) as any);

export async function analysisHub(c: Ctx) {
  const items = [['analytics', 'Season analytics', 'Trends, goals by 15 minutes, home and away, formations, match state, top performers, discipline'],
    ['maps', 'Shot, heat and event maps', 'Where shots, fouls, tackles and other actions happened'], ['set-pieces', 'Set pieces', 'Corners and free kicks by routine, taker and side; set-piece goals'],
    ['compare', 'Compare players', 'Per-90 figures and ratings, 2–4 players side by side'], ['scouting', 'Opposition scouting', 'A one-page report on a club from our matches against them, with notes'],
    ['training', 'Training themes', 'Tag matches and events to training themes and see how they went'], ['reports', 'Monthly reports', 'The season summary, made each month (and on demand)'],
    ['xg', 'xG model', 'How xG is worked out, the settings and recalculation'],
    ['season-advanced', 'Advanced season numbers', 'Expected points, game state, field tilt, pressing (PPDA), goalkeepers'], ['opposition', 'Opposition pack (PDF)', 'A branded, printable report on a club before we play them'],
    ['availability', 'Injuries & availability', 'Who cannot play, with automatic suspensions from cards'], ['wellness', 'Training load & wellness', 'Players\' check-ins from their phones, load jumps and alerts'],
    ['development', 'Player development', 'Targets with progress, and a radar against the squad'], ['milestones', 'Milestones & records', 'Appearance and goal milestones, club records, ready to post'],
    ['definitions', 'Stat definitions', 'What every number means, with versions']];
  c.view().innerHTML = `<h2>Analysis</h2><div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">${items.map(([k, t, d]) => `<a class="sx-card p2-tile" href="#/${k}"><h3>${t}</h3><p class="sx-small">${d}</p></a>`).join('')}</div>
    <p class="sx-small">Staff only: nothing on these pages is shown on the public website. Player pages: Players › a player's name.</p>`;
}

export async function mapsView(c: Ctx) {
  const { esc, api, S } = c;
  const f = c.store.get('p2_maps', { season: S.season, kind: 'shots', team: 'lobi', period: '', player: '', type: 'foul_committed', from: 0, to: 130 });
  const draw = async () => {
    const types = f.kind === 'shots' ? 'shot,goal' : f.kind === 'heat' ? (f.type === 'all' ? '' : f.type) : f.type;
    const d = await api(`maps?${new URLSearchParams({ season: f.season, team: f.team, period: f.period, player: f.player, types, from: String(f.from), to: String(f.to) })}`);
    const ev = d.events;
    let inner = '';
    if (f.kind === 'heat') {
      const cols = 12, rows = 8, grid = Array.from({ length: cols * rows }, () => 0);
      for (const e of ev) grid[Math.min(rows - 1, Math.floor(e.y / (100 / rows))) * cols + Math.min(cols - 1, Math.floor(e.x / (100 / cols)))]++;
      const max = Math.max(1, ...grid);
      inner = grid.map((v, i) => v ? `<rect x="${(i % cols) * W / cols}" y="${Math.floor(i / cols) * H / rows}" width="${W / cols}" height="${H / rows}" fill="#C8102E" fill-opacity="${(0.15 + 0.75 * v / max).toFixed(2)}"><title>${v}</title></rect>` : '').join('');
    } else {
      inner = ev.map((e: any) => {
        const col = f.kind === 'shots' ? (e.goal ? COLOURS.goal : COLOURS[e.outcome] || '#fff') : '#FFC72C';
        const r = f.kind === 'shots' ? 0.9 + Math.sqrt(e.xg || 0.02) * 3.2 : 1;
        return `<circle cx="${pct(e.x, W).toFixed(1)}" cy="${pct(e.y, H).toFixed(1)}" r="${r.toFixed(2)}" fill="${col}" fill-opacity=".85" stroke="#111" stroke-width=".2"><title>${esc(`${e.minute}' ${e.label}${e.player ? ` · ${e.player}` : ''}${e.xg ? ` · xG ${e.xg}` : ''} · v ${e.opponent}`)}</title></circle>`;
      }).join('');
    }
    const shots = ev.filter((e: any) => e.type === 'shot' || e.type === 'goal');
    const xg = shots.reduce((a: number, e: any) => a + (e.xg || 0), 0);
    (c.view().querySelector('#mapOut') as HTMLElement).innerHTML = `${pitchSvg(inner, { label: f.kind === 'shots' ? 'Shot map' : f.kind === 'heat' ? 'Heat map' : 'Event map' })}
      <p class="sx-small">${ev.length} event${ev.length === 1 ? '' : 's'} with a position${f.kind === 'shots' ? ` · ${shots.filter((e: any) => e.goal).length} goals · xG ${xg.toFixed(2)}` : ''}. Drawn left to right for ${f.team === 'lobi' ? 'Lobi Stars' : 'the opponents'}. Events recorded without a position are not shown.</p>
      ${f.kind === 'shots' ? `<p class="sx-small">${Object.entries({ Goal: COLOURS.goal, 'On target': COLOURS.on_target, 'Off target': COLOURS.off_target, Blocked: COLOURS.blocked, Woodwork: COLOURS.woodwork }).map(([k, v]) => `<span style="color:${v};font-size:18px">●</span> ${k}`).join(' &nbsp; ')} · bigger dot = higher xG</p>` : ''}`;
  };
  const players = S.roster.map((p: any) => `<option value="${esc(p.slug)}" ${p.slug === f.player ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const typeOpts = ['all', 'foul_committed', 'tackle', 'interception', 'clearance', 'block', 'corner', 'free_kick', 'offside', 'gk_save', 'shot', 'goal', 'pass_key'].map(t => `<option value="${t}" ${t === f.type ? 'selected' : ''}>${t === 'all' ? 'All actions' : esc(S.eventTypes[t] || t)}</option>`).join('');
  c.view().innerHTML = `<h2>Maps</h2>${filters(c, f, `<label>Map<select name="kind"><option value="shots" ${f.kind === 'shots' ? 'selected' : ''}>Shot map</option><option value="heat" ${f.kind === 'heat' ? 'selected' : ''}>Heat map</option><option value="events" ${f.kind === 'events' ? 'selected' : ''}>Event map</option></select></label>
    <label>Team<select name="team"><option value="lobi" ${f.team === 'lobi' ? 'selected' : ''}>Lobi Stars</option><option value="opponent" ${f.team === 'opponent' ? 'selected' : ''}>Opponents</option></select></label>
    <label>Event (heat and event maps)<select name="type">${typeOpts}</select></label><label>Player<select name="player"><option value="">All</option>${players}</select></label>
    <label>Half<select name="period"><option value="">Both</option>${Object.entries(PERIOD_NAME).map(([k, v]) => `<option value="${k}" ${k === f.period ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>From minute<input name="from" type="number" min="0" max="130" value="${f.from}" style="width:90px"></label><label>To<input name="to" type="number" min="0" max="130" value="${f.to}" style="width:90px"></label>`)}
    <section class="sx-card" id="mapOut"><p class="sx-small">Loading…</p></section>`;
  c.view().querySelector('[data-f]')!.addEventListener('submit', (e: Event) => { e.preventDefault(); Object.assign(f, readForm(c.view())); c.store.set('p2_maps', f); draw(); });
  draw();
}

export async function setPiecesView(c: Ctx) {
  const { esc, api, S } = c;
  const f = c.store.get('p2_sp', { season: S.season });
  const d = await api(`analytics?season=${encodeURIComponent(f.season)}`);
  const sp = d.setPieces;
  const table = (title: string, rows: any[]) => `<section class="sx-card sx-scroll"><h3>${title}</h3><table class="sx-t"><thead><tr><th></th><th class="n">Taken</th><th class="n">Led to a shot or goal</th><th class="n">Success</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(String(r.key).replace(/_/g, ' '))}</td><td class="n">${r.n}</td><td class="n">${r.success}</td><td class="n">${r.rate}%</td></tr>`).join('') || '<tr><td colspan="4" class="sx-small">None recorded yet.</td></tr>'}</tbody></table></section>`;
  c.view().innerHTML = `<h2>Set pieces</h2>${filters(c, f)}
    <div class="sx-kpis"><div class="sx-kpi"><b>${sp.total}</b><span>Corners and free kicks taken</span></div><div class="sx-kpi"><b>${sp.goalsFor}</b><span>Set-piece goals for</span></div><div class="sx-kpi"><b>${sp.goalsAgainst}</b><span>Set-piece goals against</span></div></div>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr));margin-top:16px">${table('By routine', sp.routine)}${table('By taker', sp.taker)}${table('By side of the pitch', sp.side)}${table('By opponent', sp.opponent)}${table('Defending: routines we faced', sp.faced)}</div>
    <p class="sx-small">Record the routine and outcome when entering a corner or free kick (one tap each, optional), or on the Review page.</p>`;
  c.view().querySelector('[data-f]')!.addEventListener('submit', (e: Event) => { e.preventDefault(); Object.assign(f, readForm(c.view())); c.store.set('p2_sp', f); setPiecesView(c); });
}

export async function ratingsView(c: Ctx, matchId: string) {
  const { esc, api } = c;
  const d = await api(`match?id=${encodeURIComponent(matchId)}`);
  const m = d.match, lobi = m.lobiHome ? 'home' : 'away';
  const rows = d.lineups.filter((l: any) => l.side === lobi);
  c.view().innerHTML = `<h2><span class="sx-h2pre">Coach ratings</span>${fx(m.home, m.away, `${m.homeScore}–${m.awayScore}`)}</h2>
    <p class="sx-small">Tap a rating (1–10) for each player and add a short note if needed. Staff only: ratings are never shown on the website.</p>
    <form id="rt">${rows.map((l: any) => `<section class="sx-card p2-rate" data-id="${esc(l.id)}"><div class="sx-row" style="justify-content:space-between"><b>${esc(l.number ?? '')} ${esc(l.name)}</b><span class="sx-small">${l.starter ? 'Started' : 'Substitute'}</span></div>
      <div class="p2-stars" role="radiogroup" aria-label="Rating for ${esc(l.name)}">${Array.from({ length: 10 }, (_, i) => `<button type="button" role="radio" aria-checked="${l.rating === i + 1}" data-r="${i + 1}" class="${l.rating === i + 1 ? 'on' : ''}">${i + 1}</button>`).join('')}<button type="button" data-r="" class="clear" aria-label="No rating">—</button></div>
      <input data-note maxlength="300" placeholder="Note (optional)" value="${esc(l.ratingNote || '')}" aria-label="Note for ${esc(l.name)}"></section>`).join('') || '<p class="sx-err">No Lobi Stars line-up yet (Match Setup).</p>'}
      ${rows.length ? '<p><button class="sx-btn sx-btn--p" type="submit">Save ratings</button></p>' : ''}</form>`;
  const form = c.view().querySelector('#rt') as HTMLFormElement;
  form.addEventListener('click', (e: any) => { const b = e.target.closest('[data-r]'); if (!b) return; const card = b.closest('.p2-rate'); card.querySelectorAll('[data-r]').forEach((x: any) => { x.classList.toggle('on', x === b && b.dataset.r !== ''); x.setAttribute('aria-checked', String(x === b)); }); card.dataset.rating = b.dataset.r; });
  form.addEventListener('submit', async (e: Event) => {
    e.preventDefault();
    const out = [...form.querySelectorAll('.p2-rate')].map((card: any) => { const on = card.querySelector('[data-r].on'); return { id: card.dataset.id, rating: card.dataset.rating !== undefined ? card.dataset.rating : on ? on.dataset.r : '', note: card.querySelector('[data-note]').value }; });
    try { await api('ratings', { id: matchId, rows: out }); c.toast('Ratings saved.'); } catch (x: any) { c.toast(x.message, false); }
  });
}

const lineChart = (series: { name: string; colour: string; values: (number | null)[] }[], labels: string[], h = 160) => {
  const vals = series.flatMap(s => s.values.filter((v): v is number => v !== null));
  const max = Math.max(1, ...vals), n = Math.max(1, labels.length - 1), Wc = 600;
  const pts = (v: (number | null)[]) => v.map((x, i) => (x === null ? null : `${((i / n) * Wc).toFixed(1)},${(h - (x / max) * (h - 14) - 6).toFixed(1)}`)).filter(Boolean).join(' ');
  return `<svg viewBox="0 0 ${Wc} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="${series.map(s => s.name).join(', ')} by match">${series.map(s => `<polyline points="${pts(s.values)}" fill="none" stroke="${s.colour}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
    <p class="sx-small">${series.map(s => `<span style="color:${s.colour}">━</span> ${s.name}`).join(' &nbsp; ')} · max ${max}</p>`;
};

export async function playerView(c: Ctx, slug: string) {
  const { esc, api, S } = c;
  const season = c.store.get('p2_ps', S.season);
  const p = await api(`player?slug=${encodeURIComponent(slug)}&season=${encodeURIComponent(season)}`);
  const k = (v: any, l: string) => `<div class="sx-kpi"><b>${v ?? '—'}</b><span>${l}</span></div>`;
  const gk = /^G/i.test(p.position || '');
  c.view().innerHTML = `<div class="sx-row" style="justify-content:space-between"><h2 style="margin:0">${esc(p.name)} <small class="sx-small">${esc(p.position || '')}</small></h2><div class="sx-row"><a class="sx-btn" href="/squad/${esc(slug)}/" target="_blank" rel="noopener">Public profile</a><a class="sx-btn" href="#/compare">Compare</a></div></div>
    <p class="sx-small">${esc(season)} · recorded matches (review or published) · staff only</p>
    <div class="sx-kpis">${k(p.apps, 'Appearances')}${k(p.starts, 'Starts')}${k(p.minutes, 'Minutes')}${k(p.totals.goals, 'Goals')}${k(p.totals.assists, 'Assists')}${k(p.totals.xg.toFixed ? p.totals.xg.toFixed(2) : p.totals.xg, 'xG')}${k(p.totals.xa.toFixed ? p.totals.xa.toFixed(2) : p.totals.xa, 'xA')}${k(p.rating, 'Average rating')}${gk ? k(p.totals.saves, 'Saves') : k(p.totals.tackles, 'Tackles')}${k(`${p.totals.yellow}/${p.totals.red}`, 'Yellow / red')}</div>
    <section class="sx-card" style="margin-top:16px"><h3>Per 90 minutes</h3>${p.minutes < 90 ? '<p class="sx-small">Fewer than 90 minutes: per-90 figures are not meaningful yet.</p>' : `<div class="sx-kpis">${Object.entries({ goals: 'Goals', assists: 'Assists', shots: 'Shots', shotsOnTarget: 'On target', xg: 'xG', xa: 'xA', tackles: 'Tackles', interceptions: 'Interceptions', keyPasses: 'Key passes', ...(gk ? { saves: 'Saves' } : {}) }).map(([key, l]) => k(p.per90[key], l)).join('')}</div>`}</section>
    <section class="sx-card"><h3>Ratings</h3>${p.rows.some((r: any) => r.rating !== null) ? lineChart([{ name: 'Rating', colour: '#C8102E', values: p.rows.map((r: any) => r.rating) }, { name: 'Rolling 5-match average', colour: '#1C3F7A', values: p.rows.map((r: any) => r.rolling5) }], p.rows.map((r: any) => r.date)) : '<p class="sx-small">No ratings yet (Review › Rate players).</p>'}</section>
    <section class="sx-card sx-scroll"><h3>Match by match</h3><table class="sx-t"><thead><tr><th>Date</th><th>Opponent</th><th>Score</th><th class="n">Min</th><th class="n">G</th><th class="n">A</th><th class="n">Sh</th><th class="n">xG</th><th class="n">xA</th><th class="n">${gk ? 'Saves' : 'Tackles'}</th><th class="n">Rating</th><th>Note</th></tr></thead><tbody>
      ${p.rows.map((r: any) => `<tr><td>${esc(c.day(r.date))}</td><td><a href="#/review/${esc(r.matchId)}">${club(r.opponent)}</a></td><td>${esc(r.score)}</td><td class="n">${r.minutes}</td><td class="n">${r.goals}</td><td class="n">${r.assists}</td><td class="n">${r.shots}</td><td class="n">${Number(r.xg).toFixed(2)}</td><td class="n">${Number(r.xa).toFixed(2)}</td><td class="n">${gk ? r.saves : r.tackles}</td><td class="n">${r.rating ?? ''}</td><td><small>${esc(r.ratingNote)}</small></td></tr>`).join('') || '<tr><td colspan="12" class="sx-small">No recorded matches this season.</td></tr>'}</tbody></table></section>`;
}

export async function compareView(c: Ctx) {
  const { esc, api, S } = c;
  const f = c.store.get('p2_cmp', { season: S.season, slugs: [], min: 90, pos: '' });
  const opts = (sel: string) => S.roster.filter((p: any) => !f.pos || String(p.position || '').toUpperCase().startsWith(f.pos)).map((p: any) => `<option value="${esc(p.slug)}" ${p.slug === sel ? 'selected' : ''}>${esc(p.name)} (${esc(p.position || '')})</option>`).join('');
  let out = '<p class="sx-small">Choose 2 to 4 players.</p>';
  if (f.slugs.filter(Boolean).length >= 2) {
    const d = await api(`compare?season=${encodeURIComponent(f.season)}&slugs=${encodeURIComponent(f.slugs.filter(Boolean).join(','))}&min=${f.min}`);
    const keys = [['goals', 'Goals'], ['assists', 'Assists'], ['shots', 'Shots'], ['xg', 'xG'], ['xa', 'xA'], ['tackles', 'Tackles'], ['keyPasses', 'Key passes']];
    const colours = ['#C8102E', '#1C3F7A', '#0F8A4B', '#B26A00'];
    const max = Object.fromEntries(keys.map(([k]) => [k, Math.max(0.01, ...d.players.map((p: any) => p.per90[k] || 0))]));
    const R = 42, cx = 50, cy = 50, n = keys.length;
    const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return `${(cx + Math.cos(a) * R * v).toFixed(1)},${(cy + Math.sin(a) * R * v).toFixed(1)}`; };
    const radar = `<svg viewBox="0 0 100 100" width="100%" style="max-width:420px" role="img" aria-label="Radar chart of per-90 figures">${[0.25, 0.5, 0.75, 1].map(r => `<polygon points="${keys.map((_, i) => pt(i, r)).join(' ')}" fill="none" stroke="#C9CDD4" stroke-width=".3"/>`).join('')}
      ${keys.map(([, l], i) => { const [x, y] = pt(i, 1.17).split(','); return `<text x="${x}" y="${y}" font-size="3.4" text-anchor="middle" fill="currentColor">${l}</text>`; }).join('')}
      ${d.players.map((p: any, j: number) => `<polygon points="${keys.map(([k], i) => pt(i, (p.per90[k] || 0) / max[k])).join(' ')}" fill="${colours[j]}" fill-opacity=".18" stroke="${colours[j]}" stroke-width=".8"/>`).join('')}</svg>`;
    out = `<div class="sx-grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))"><section class="sx-card">${radar}<p class="sx-small">${d.players.map((p: any, j: number) => `<span style="color:${colours[j]}">■</span> ${esc(p.name)}`).join(' &nbsp; ')} · each axis scaled to the best of the group</p></section>
      <section class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Per 90</th>${d.players.map((p: any) => `<th class="n">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
        <tr><td>Minutes</td>${d.players.map((p: any) => `<td class="n">${p.minutes}${p.enough ? '' : ' ⚠'}</td>`).join('')}</tr><tr><td>Average rating</td>${d.players.map((p: any) => `<td class="n">${p.rating ?? '—'}</td>`).join('')}</tr>
        ${keys.map(([k, l]) => `<tr><td>${l}</td>${d.players.map((p: any) => `<td class="n">${p.per90[k]}</td>`).join('')}</tr>`).join('')}</tbody></table>
        <p class="sx-small">⚠ fewer than ${d.minMinutes} minutes: per-90 figures can mislead.</p></section></div>`;
  }
  c.view().innerHTML = `<h2>Compare players</h2><form class="sx-card sx-row" id="cmp"><label>Season<select name="season">${S.seasons.map((s: string) => `<option ${s === f.season ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <label>Position<select name="pos"><option value="">All</option>${['G', 'D', 'M', 'F'].map(p => `<option value="${p}" ${p === f.pos ? 'selected' : ''}>${{ G: 'Goalkeepers', D: 'Defenders', M: 'Midfielders', F: 'Forwards' }[p]}</option>`).join('')}</select></label>
    ${[0, 1, 2, 3].map(i => `<label>Player ${i + 1}<select name="p${i}"><option value="">—</option>${opts(f.slugs[i] || '')}</select></label>`).join('')}
    <label>Minimum minutes<input name="min" type="number" min="0" max="900" value="${f.min}" style="width:100px"></label><button class="sx-btn sx-btn--p" type="submit">Compare</button></form>${out}`;
  c.view().querySelector('#cmp')!.addEventListener('submit', (e: any) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target) as any); Object.assign(f, { season: v.season, pos: v.pos, min: Number(v.min) || 0, slugs: [v.p0, v.p1, v.p2, v.p3].filter(Boolean) }); c.store.set('p2_cmp', f); compareView(c); });
}

export async function analyticsView(c: Ctx) {
  const { esc, api, S } = c;
  const f = c.store.get('p2_an', { season: S.season, competition: '', venue: '', opponent: '' });
  const [d, o] = await Promise.all([api(`analytics?${new URLSearchParams(f)}`), api('opponents')]);
  const t = d.trend, rec = (r: any) => `${r.p} played · ${r.w}W ${r.d}D ${r.l}L · ${r.gf}–${r.ga}`;
  const bars = d.periods.map((p: any) => { const max = Math.max(1, ...d.periods.map((x: any) => Math.max(x.for, x.against))); return `<div class="p2-pbar"><span>${p.label}</span><i style="width:${(p.for / max) * 100}%" class="f">${p.for || ''}</i><i style="width:${(p.against / max) * 100}%" class="a">${p.against || ''}</i></div>`; }).join('');
  c.view().innerHTML = `<h2>Season analytics</h2>
    <form class="sx-card sx-row" data-f><label>Season<select name="season">${S.seasons.map((s: string) => `<option ${s === f.season ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label>Competition<select name="competition"><option value="">All</option>${S.settings.competitions.map((x: string) => `<option ${x === f.competition ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label>Home or away<select name="venue"><option value="">Both</option><option value="home" ${f.venue === 'home' ? 'selected' : ''}>Home</option><option value="away" ${f.venue === 'away' ? 'selected' : ''}>Away</option></select></label>
      <label>Opponent<select name="opponent"><option value="">All</option>${o.opponents.map((x: any) => `<option ${x.name === f.opponent ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><button class="sx-btn sx-btn--p" type="submit">Show</button></form>
    <section class="sx-card"><h3>In short</h3><ul>${d.notes.map((n: string) => `<li>${esc(n)}</li>`).join('')}</ul><p class="sx-small">${d.matches} recorded match${d.matches === 1 ? '' : 'es'}.</p></section>
    ${t.length ? `<div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">
      <section class="sx-card"><h3>Goals</h3>${lineChart([{ name: 'Scored', colour: '#0F8A4B', values: t.map((r: any) => r.goalsFor) }, { name: 'Conceded', colour: '#C8102E', values: t.map((r: any) => r.goalsAgainst) }], t.map((r: any) => r.date))}</section>
      <section class="sx-card"><h3>xG</h3>${lineChart([{ name: 'xG for', colour: '#0F8A4B', values: t.map((r: any) => r.xgFor) }, { name: 'xG against', colour: '#C8102E', values: t.map((r: any) => r.xgAgainst) }], t.map((r: any) => r.date))}</section>
      <section class="sx-card"><h3>Shots</h3>${lineChart([{ name: 'Shots', colour: '#1C3F7A', values: t.map((r: any) => r.shotsFor) }, { name: 'On target', colour: '#0F8A4B', values: t.map((r: any) => r.sotFor) }, { name: 'Conceded', colour: '#C8102E', values: t.map((r: any) => r.shotsAgainst) }], t.map((r: any) => r.date))}</section>
      <section class="sx-card"><h3>Corners, fouls, cards</h3>${lineChart([{ name: 'Corners', colour: '#1C3F7A', values: t.map((r: any) => r.corners) }, { name: 'Fouls', colour: '#B26A00', values: t.map((r: any) => r.fouls) }, { name: 'Cards', colour: '#C8102E', values: t.map((r: any) => r.cards) }], t.map((r: any) => r.date))}</section>
      ${d.attacksKnown ? `<section class="sx-card"><h3>Attacks (Analysis Form)</h3>${lineChart([{ name: 'Offence/Attack', colour: '#C8102E', values: t.map((r: any) => r.attacks) }], t.map((r: any) => r.date))}</section>` : ''}
      <section class="sx-card"><h3>Goals by 15 minutes</h3><div class="p2-pbars">${bars}</div><p class="sx-small"><span style="color:#0F8A4B">■</span> scored <span style="color:#C8102E">■</span> conceded</p></section>
      <section class="sx-card"><h3>Home and away</h3><p><b>Home:</b> ${rec(d.split.home)}</p><p><b>Away:</b> ${rec(d.split.away)}</p>
        <h3>Match state</h3><p>Goals scored when leading ${d.state.leading.for}, level ${d.state.level.for}, trailing ${d.state.trailing.for}.<br>Conceded when leading ${d.state.leading.against}, level ${d.state.level.against}, trailing ${d.state.trailing.against}.</p></section>
      <section class="sx-card sx-scroll"><h3>Results by formation</h3><table class="sx-t"><thead><tr><th>Formation</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GF</th><th class="n">GA</th></tr></thead><tbody>${d.formations.map((x: any) => `<tr><td>${esc(x.formation)}</td><td class="n">${x.p}</td><td class="n">${x.w}</td><td class="n">${x.d}</td><td class="n">${x.l}</td><td class="n">${x.gf}</td><td class="n">${x.ga}</td></tr>`).join('')}</tbody></table></section>
      <section class="sx-card"><h3>Top performers</h3>${[['goals', 'Goals'], ['assists', 'Assists'], ['xg', 'xG'], ['ratings', 'Average rating']].map(([k, l]) => `<p><b>${l}:</b> ${d.top[k].slice(0, 5).map((p: any) => `${esc(p.name)} ${k === 'ratings' ? p.rating : p[k]}`).join(', ') || '—'}</p>`).join('')}</section>
      <section class="sx-card sx-scroll"><h3>Discipline</h3><table class="sx-t"><thead><tr><th>Player</th><th class="n">Yellow</th><th class="n">Red</th></tr></thead><tbody>${d.discipline.map((x: any) => `<tr><td>${esc(x.name)}</td><td class="n">${x.yellow}</td><td class="n">${x.red}</td></tr>`).join('') || '<tr><td colspan="3" class="sx-small">No cards.</td></tr>'}</tbody></table></section>
    </div>` : '<p class="sx-small">No recorded matches for these filters.</p>'}`;
  c.view().querySelector('[data-f]')!.addEventListener('submit', (e: Event) => { e.preventDefault(); Object.assign(f, readForm(c.view())); c.store.set('p2_an', f); analyticsView(c); });
}

export async function scoutingView(c: Ctx) {
  const { esc, api, S } = c;
  const { opponents } = await api('opponents');
  const team = c.store.get('p2_sc', opponents[0]?.name || '');
  let body = '<p class="sx-small">No opponents recorded yet.</p>';
  if (team) {
    const r = await api(`scouting?team=${encodeURIComponent(team)}`);
    body = `<section class="sx-card bstp-page" style="min-height:0"><header class="bstp-head"><img src="/images/lobi-stars-badge.webp" alt="" width="48" height="48"><div><p>Lobi Stars FC · Opposition scouting</p><h1>${esc(r.opponent)}</h1></div></header>
      <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        <div><h3>Our results against them (${r.played})</h3><ul class="sx-feed">${r.results.map((x: any) => `<li><span class="m ${x.result}">${x.result}</span><span class="d">${esc(c.day(x.date))} · ${x.home ? 'home' : 'away'} · ${esc(x.competition)}<small>${esc(x.score)}</small></span></li>`).join('') || '<li class="sx-small">None yet.</li>'}</ul></div>
        <div><h3>Their goals by 15 minutes</h3><table class="sx-t"><thead><tr><th>Period</th><th class="n">They scored</th><th class="n">They conceded</th></tr></thead><tbody>${r.periods.map((p: any) => `<tr><td>${p.label}</td><td class="n">${p.scored}</td><td class="n">${p.conceded}</td></tr>`).join('')}</tbody></table></div>
        <div><h3>Their formations</h3><p>${r.formations.map((x: any) => `${esc(x.formation)} (${x.matches})`).join(', ') || 'Not recorded'}</p>
          <h3>Key players</h3><ul>${r.keyPlayers.map((p: any) => `<li>${esc(p.name)}: ${p.goals} goals, ${p.shots} shots, ${p.cards} cards</li>`).join('') || '<li class="sx-small">Add their line-ups and players to events to see this.</li>'}</ul></div>
        <div><h3>Set pieces we faced</h3><p>${r.routinesFaced.map((x: any) => `${esc(String(x.routine).replace(/_/g, ' '))} ${x.n}`).join(', ') || 'None recorded'}</p>
          <h3>Our best against them</h3><p>${r.ourFormations.map((x: any) => `${esc(x.formation)}: ${x.ppg} points a match (${x.gf}–${x.ga} in ${x.p})`).join('<br>') || '—'}</p>${r.bestXi ? `<p class="sx-small"><b>Starting XI in ${r.bestXi.wins} win${r.bestXi.wins > 1 ? 's' : ''}:</b> ${esc(r.bestXi.players)}</p>` : ''}</div>
      </div>
      <h3>Staff notes</h3><ul>${r.notes.map((n: any) => `<li>${esc(n.note)} <small class="sx-small">(${esc(n.season || '')} · ${esc(n.created_by || '')})</small> <button class="sx-btn sx-noprint" data-del="${esc(n.id)}" style="min-height:30px;padding:2px 8px">Remove</button></li>`).join('') || '<li class="sx-small">No notes yet.</li>'}</ul>
      <form class="sx-noprint" id="scNote"><label>Add a note<textarea name="note" maxlength="5000" style="min-height:80px"></textarea></label><button class="sx-btn sx-btn--p" type="submit">Save note</button></form>
      <footer class="bstp-foot"><span>Lobi Stars Statistics Center · staff only</span><span>Generated ${esc(new Date().toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos' }))}</span></footer></section>`;
    void r;
  }
  c.view().innerHTML = `<h2>Opposition scouting</h2><form class="sx-card sx-row sx-noprint" id="scPick"><label>Opponent<select name="team">${opponents.map((x: any) => `<option ${x.name === team ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label><button class="sx-btn sx-btn--p" type="submit">Show report</button><button class="sx-btn" type="button" onclick="window.print()">Print / Save as PDF</button></form>${body}`;
  c.view().querySelector('#scPick')?.addEventListener('submit', (e: any) => { e.preventDefault(); c.store.set('p2_sc', e.target.team.value); scoutingView(c); });
  c.view().querySelector('#scNote')?.addEventListener('submit', async (e: any) => { e.preventDefault(); try { const o = opponents.find((x: any) => x.name === team); await api('scouting/note', { teamKey: o?.key, teamName: team, season: S.season, note: e.target.note.value }); scoutingView(c); } catch (x: any) { c.toast(x.message, false); } });
  c.view().querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Remove this note?')) return; try { await api('scouting/note-remove', { id: (b as HTMLElement).dataset.del }); scoutingView(c); } catch (x: any) { c.toast(x.message, false); } }));
}

export async function trainingView(c: Ctx) {
  const { esc, api } = c;
  const { themes } = await api('themes');
  const sel = c.store.get('p2_th', themes[0]?.id || '');
  const rep = sel ? await api(`theme-report?id=${encodeURIComponent(sel)}`) : null;
  c.view().innerHTML = `<h2>Training themes</h2>
    <section class="sx-card"><h3>Themes</h3><ul class="sx-feed">${themes.map((t: any) => `<li><span class="d"><b>${esc(t.name)}</b>${t.active ? '' : ' <span class="sx-pill">off</span>'}<small>${esc(t.description)} · ${t.tags} tag${t.tags === 1 ? '' : 's'}</small></span><button class="sx-btn" data-show="${esc(t.id)}">Report</button><button class="sx-btn" data-toggle="${esc(t.id)}" data-active="${t.active}">${t.active ? 'Switch off' : 'Switch on'}</button></li>`).join('') || '<li class="sx-small">No themes yet.</li>'}</ul>
      <form id="thNew" class="sx-row" style="margin-top:10px"><label>New theme<input name="name" maxlength="60" placeholder="e.g. Pressing triggers"></label><label style="flex:1 1 260px">What it means<input name="description" maxlength="300" placeholder="e.g. win the ball back within 6 seconds"></label><button class="sx-btn sx-btn--p" type="submit">Add</button></form>
      <p class="sx-small">Tag a whole match or a single event to a theme on the match's Review page.</p></section>
    ${rep ? `<section class="sx-card sx-scroll"><h3>Report: ${esc(themes.find((t: any) => t.id === sel)?.name || '')}</h3><table class="sx-t"><thead><tr><th>Month</th><th class="n">Tags</th><th class="n">Events</th><th class="n">Goals for</th><th class="n">Goals against</th><th class="n">Shots</th><th class="n">Set pieces leading to a shot</th></tr></thead><tbody>
      ${rep.months.map((r: any) => `<tr><td>${esc(r.month)}</td><td class="n">${r.tags}</td><td class="n">${r.events}</td><td class="n">${r.goalsFor}</td><td class="n">${r.goalsAgainst}</td><td class="n">${r.shots}</td><td class="n">${r.setPieceSuccess}</td></tr>`).join('') || '<tr><td colspan="7" class="sx-small">Nothing tagged yet.</td></tr>'}</tbody></table>
      <ul class="sx-feed" style="margin-top:10px">${rep.items.map((i: any) => `<li><span class="d"><a href="#/review/${esc(i.matchId)}">${esc(i.match)}</a> · ${esc(i.event)}<small>${esc(c.day(i.date))}${i.note ? ` · ${esc(i.note)}` : ''}</small></span><button class="sx-btn" data-untag="${esc(i.id)}">Remove</button></li>`).join('')}</ul></section>` : ''}`;
  c.view().querySelector('#thNew')!.addEventListener('submit', async (e: any) => { e.preventDefault(); try { await api('themes', { name: e.target.name.value, description: e.target.description.value }); trainingView(c); } catch (x: any) { c.toast(x.message, false); } });
  c.view().addEventListener('click', async (e: any) => {
    const b = e.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.show) { c.store.set('p2_th', b.dataset.show); trainingView(c); }
      else if (b.dataset.toggle) { await api('themes', { id: b.dataset.toggle, active: b.dataset.active !== 'true' }); trainingView(c); }
      else if (b.dataset.untag) { await api('tags/remove', { id: b.dataset.untag }); trainingView(c); }
    } catch (x: any) { c.toast(x.message, false); }
  }, c.resetView());
}

export async function reportsView(c: Ctx) {
  const { esc, api, S } = c;
  const { reports } = await api('reports');
  c.view().innerHTML = `<h2>Monthly reports</h2>
    <section class="sx-card"><p class="sx-small">The season summary (results, top performers, trends, xG, discipline, set pieces) is made automatically on the 1st of each month for the month before${S.settings.reportEmail ? ' and emailed to the Super Admins' : ''}. Settings › Monthly report email switches the email on or off.</p>
      ${S.user.canPublish ? `<form id="repNow" class="sx-row"><label>Month<input name="period" type="month" value="${new Date().toISOString().slice(0, 7)}"></label><button class="sx-btn sx-btn--p" type="submit">Make the report now</button></form>` : ''}</section>
    <div class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Month</th><th>Report</th><th>Made</th><th>Emailed</th><th></th></tr></thead><tbody>${reports.map((r: any) => `<tr><td>${esc(r.period)}</td><td>${esc(r.title || '')}</td><td>${esc(c.when(r.generated_at))} · ${esc(r.generated_by || '')}</td><td>${r.emailed_at ? esc(c.when(r.emailed_at)) : '—'}</td><td><button class="sx-btn" data-open="${esc(r.id)}">Open</button></td></tr>`).join('') || '<tr><td colspan="5" class="sx-small">No reports yet.</td></tr>'}</tbody></table></div>
    <section class="sx-card" id="repOut" hidden></section>`;
  c.view().querySelector('#repNow')?.addEventListener('submit', async (e: any) => { e.preventDefault(); try { await api('reports/generate', { period: e.target.period.value }); c.toast('Report made.'); reportsView(c); } catch (x: any) { c.toast(x.message, false); } });
  c.view().querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
    const r = await api(`report?id=${encodeURIComponent((b as HTMLElement).dataset.open!)}`);
    const out = c.view().querySelector('#repOut') as HTMLElement; out.hidden = false;
    out.innerHTML = `<p class="sx-noprint"><button class="sx-btn" onclick="window.print()">Print / Save as PDF</button></p>${r.html}`; out.scrollIntoView({ behavior: 'smooth' });
  }));
}

export async function xgView(c: Ctx) {
  const { esc, api, S } = c;
  const d = await api('xg');
  const P = d.params, can = S.user.canPublish;
  const labels: Record<string, string> = { intercept: 'Starting value (intercept)', angle: 'Angle of the goal mouth (per radian)', distance: 'Distance to goal (per metre)', head: 'Header adjustment', other: 'Other body part adjustment', freeKick: 'Direct free kick adjustment', counter: 'Counter-attack adjustment', penalty: 'Penalty (fixed xG)' };
  c.view().innerHTML = `<h2>xG model</h2>
    <section class="sx-card"><h3>How xG is worked out</h3>
      <p>xG (expected goals) is the chance that a shot becomes a goal, from 0 to 1. Each shot with a position on the pitch gets one automatically; you never type it (you can still type a value by hand on a shot, which then wins).</p>
      <p>The model is a simple formula, not a black box: <code>xG = 1 / (1 + e<sup>−z</sup>)</code> with <code>z = starting value + angle × (angle of the goal mouth seen from the shot) + distance × (metres to the goal centre) + adjustments</code> for a header, another body part, a direct free kick or a counter-attack. A penalty always gets the fixed value.</p>
      <p class="sx-small">With the standard values: a shot from 5.5 m in front of goal ≈ 0.60, from the penalty spot in open play ≈ 0.33 (a header ≈ 0.18), from 25 m ≈ 0.05. xA: the player who gave the pass for a shot is credited with that shot's xG.</p></section>
    <form class="sx-card" id="xgF"><h3>Settings</h3><div class="sx-form">${Object.keys(labels).map(k => `<label>${labels[k]}<input name="${k}" type="number" step="0.001" value="${esc(P[k])}" ${can ? '' : 'disabled'}><small class="sx-small">standard: ${d.defaults[k]}</small></label>`).join('')}</div>
      ${can ? '<p class="sx-row"><button class="sx-btn sx-btn--p" type="submit">Save</button><button class="sx-btn" type="button" id="xgStd">Back to the standard values</button></p>' : '<p class="sx-small">A senior statistician or a Super Admin can change these.</p>'}</form>
    ${can ? `<section class="sx-card"><h3>Recalculate</h3><p class="sx-small">Works out xG again for every shot with a position (values typed by hand are kept). Safe to run more than once; recorded in the activity log.</p><p class="sx-row"><button class="sx-btn" id="xgSeason">Recalculate the ${esc(S.season)} season</button></p></section>` : ''}`;
  c.view().querySelector('#xgF')?.addEventListener('submit', async (e: any) => { e.preventDefault(); try { await api('xg', Object.fromEntries(new FormData(e.target) as any)); c.toast('Saved. Press Recalculate to apply it to past shots.'); } catch (x: any) { c.toast(x.message, false); } });
  c.view().querySelector('#xgStd')?.addEventListener('click', async () => { try { await api('xg', d.defaults); c.toast('Standard values restored.'); xgView(c); } catch (x: any) { c.toast(x.message, false); } });
  c.view().querySelector('#xgSeason')?.addEventListener('click', async () => { try { const r = await api('xg/recalc', { season: S.season }); c.toast(`${r.changed} of ${r.shots} shots updated.`); } catch (x: any) { c.toast(x.message, false); } });
}

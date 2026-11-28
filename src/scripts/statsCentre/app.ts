// The Lobi Stars Statistics Center app (/staff/statistics-center/). Talks only to /api/stats-centre/*.
// Live entry keeps working without a connection: every tap is saved on this device first (localStorage queue)
// and sent when the connection returns; the top bar shows how many are still "unsynced". Events are sent with an
// id made here, so sending the same event twice never records it twice.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { bstRoute, applyUi, type Ctx } from './bst';
import { retentionView, inventoryView } from './retention';
import { setupInstall, showInstall } from './install';
import { fx, club } from './fx';
import { setupFit } from './responsive';
import { matchLinks, passesView, advancedView, seasonAdvancedView, availabilityView, markAvailability, wellnessView, developmentView, milestonesView, definitionsProView, oppositionPackView, startPractice } from './pro';
import { analysisHub, mapsView, setPiecesView, ratingsView, playerView, compareView, analyticsView, scoutingView, trainingView, reportsView, xgView, pickOnPitch, attacksRight } from './phase2';
const $ = (id: string) => document.getElementById(id) as any;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) : '');
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) : '');
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''));
const store = { get(k: string, d: any) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k: string, v: any) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } } };

let S: any = null; // the session: user, csrf, roster, eventTypes, periods, outcomes...
const view = () => $('view') as HTMLElement;
let viewAbort = new AbortController();
/** Call at the start of drawing a page: drops the listeners of the page drawn before. */
const resetView = () => { viewAbort.abort(); viewAbort = new AbortController(); return { signal: viewAbort.signal }; };
let toastT = 0;
function toast(t: string, ok = true) { const m = $('toast'); m.textContent = t; m.className = `sx-toast${ok ? '' : ' err'}`; m.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => { m.hidden = true; }, 5000); }

class ApiError extends Error { data: any; status: number; constructor(m: string, status: number, data: any) { super(m); this.status = status; this.data = data; } }
async function api(path: string, body?: unknown) {
  const opts: RequestInit = body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': S?.csrf || '' }, body: JSON.stringify(body) };
  const r = await fetch(`/api/stats-centre/${path}`, opts);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.signedOut) { showLogin(); throw new ApiError(d.error || 'Please sign in again.', 401, d); }
  if (r.status === 403 && d.mustChange) { show('vPassword'); throw new ApiError(d.error, 403, d); }
  if (!r.ok) throw new ApiError(d.error || 'Something went wrong.', r.status, d);
  return d;
}

function show(id: string) { for (const v of ['vLogin', 'vPassword', 'vApp']) $(v).hidden = v !== id; }
function showLogin() { S = null; show('vLogin'); }

// ── Sign in ──
$('loginForm').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const f = e.target as any, err = $('loginErr'); err.hidden = true;
  try {
    const r = await fetch('/api/stats-centre/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginId: f.loginId.value, password: f.password.value, code: f.code.value }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { if (d.needCode) $('codeRow').hidden = false; err.textContent = d.error || 'Could not sign in.'; err.hidden = false; return; }
    f.reset(); $('codeRow').hidden = true; await boot();
  } catch { err.textContent = 'No connection. Check the internet and try again.'; err.hidden = false; }
});
$('pwForm').addEventListener('submit', async (e: Event) => {
  e.preventDefault();
  const f = e.target as any, err = $('pwErr'); err.hidden = true;
  if (f.password.value !== f.again.value) { err.textContent = 'The two new passwords are not the same.'; err.hidden = false; return; }
  try { await api('password', { current: f.current.value, password: f.password.value }); f.reset(); toast('Password saved.'); await boot(); }
  catch (x: any) { err.textContent = x.message; err.hidden = false; }
});
$('logout').addEventListener('click', async () => { try { await api('logout', {}); } catch { /* signed out anyway */ } showLogin(); });

async function boot() {
  applyUi(); // dark mode / big buttons, if chosen on this device
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/staff/statistics-center/sw.js', { scope: '/staff/statistics-center/' }).catch(() => {}); } catch { /* not supported */ }
  try { S = await api('session'); }
  catch (x: any) { if (x.status !== 401 && x.status !== 403) { show('vLogin'); $('loginErr').textContent = x.message; $('loginErr').hidden = false; } return; }
  if (S.user.mustChange) { show('vPassword'); return; }
  $('who').textContent = `${S.user.fullName}${S.user.admin ? ' · Super Admin' : S.user.readOnly ? ' · coach (view only)' : S.user.canPublish ? ' · may publish' : ''}`;
  document.body.classList.toggle('sx-ro', !!S.user.readOnly);
  show('vApp');
  updateSync(); flushAll();
  route();
}

// ── Router ──
window.addEventListener('hashchange', () => route());
// The Back button (every page except the dashboard): back to the page you came from inside the Statistics Center,
// or, if this page was opened straight from a link, to its parent page.
let pagesSeen = 0;
function parentPage() {
  const path = location.pathname;
  if (path.startsWith('/staff/statistics-center/bst-analysis')) {
    const rest = path.replace('/staff/statistics-center/bst-analysis/', '').split('/').filter(Boolean);
    if (rest[1] === 'print') return `/staff/statistics-center/bst-analysis/${rest[0]}/`;
    return rest.length ? '/staff/statistics-center/bst-analysis/' : '/staff/statistics-center/#/';
  }
  const page = (location.hash || '#/').split('/')[1] || '';
  if (!page) return null;
  if (page === 'tag') return `/staff/statistics-center/#/review/${(location.hash.split('/')[2] || '')}`;
  if (page === 'recycle') return '/staff/statistics-center/#/settings';
  if (page === 'ratings') return `/staff/statistics-center/#/review/${(location.hash.split('/')[2] || '')}`;
  if (page === 'player') return '/staff/statistics-center/#/players';
  if (['analytics', 'maps', 'set-pieces', 'compare', 'scouting', 'training', 'reports', 'xg'].includes(page)) return '/staff/statistics-center/#/analysis';
  return ['match', 'live', 'review', 'new'].includes(page) ? '/staff/statistics-center/#/matches' : '/staff/statistics-center/#/';
}
function updateBack() {
  const parent = parentPage();
  $('backBar').hidden = !parent;
}
$('backBtn').addEventListener('click', () => {
  if (pagesSeen > 1 && history.length > 1) history.back();
  else location.href = parentPage() || '/staff/statistics-center/#/';
});
function route() {
  if (!S) return;
  pagesSeen++;
  updateBack();
  // BST Analysis Form pages have their own addresses (/staff/statistics-center/bst-analysis/...).
  if (location.pathname.startsWith('/staff/statistics-center/bst-analysis')) {
    for (const a of document.querySelectorAll('[data-nav]')) (a as HTMLElement).toggleAttribute('aria-current', false);
    document.querySelector('[data-nav="bst"]')?.setAttribute('aria-current', 'page');
    stopTick(); resetView();
    view().innerHTML = '<p class="sx-small">Loading…</p>';
    Promise.resolve(bstRoute(ctx)).catch((x: any) => { view().innerHTML = `<div class="sx-card"><p class="sx-err">${esc(x.message)}</p></div>`; });
    return;
  }
  const [, page = '', id = ''] = (location.hash || '#/').split('/');
  for (const a of document.querySelectorAll('[data-nav]')) (a as HTMLElement).toggleAttribute('aria-current', false);
  const nav = { '': 'home', matches: 'matches', match: 'matches', live: 'matches', review: 'matches', new: 'matches', tag: 'matches', passes: 'matches', advanced: 'matches', 'season-advanced': 'analysis', availability: 'players', wellness: 'players', development: 'players', milestones: 'players', opposition: 'analysis', recycle: 'settings', retention: 'settings', inventory: 'settings', ratings: 'matches', analysis: 'analysis', analytics: 'analysis', maps: 'analysis', 'set-pieces': 'analysis', player: 'players', compare: 'analysis', scouting: 'analysis', training: 'analysis', reports: 'analysis', xg: 'analysis', players: 'players', team: 'team', exports: 'exports', settings: 'settings', definitions: 'definitions' }[page] || 'home';
  document.querySelector(`[data-nav="${nav}"]`)?.setAttribute('aria-current', 'page');
  const run: Record<string, () => Promise<void> | void> = { '': dashboardView, matches: matchesView, new: newMatchView, match: () => setupView(id).then(() => markAvailability(ctx, view())), live: () => liveView(id), review: () => reviewView(id),
    players: playersView, team: teamView, exports: exportsView, settings: settingsView, definitions: () => definitionsProView(ctx),
    passes: () => passesView(ctx, id), advanced: () => advancedView(ctx, id), 'season-advanced': () => seasonAdvancedView(ctx), availability: () => availabilityView(ctx), wellness: () => wellnessView(ctx),
    development: () => developmentView(ctx, id), milestones: () => milestonesView(ctx), opposition: () => oppositionPackView(ctx), tag: () => tagView(id), recycle: recycleView, retention: () => retentionView(ctx), inventory: () => inventoryView(ctx), ratings: () => ratingsView(ctx, id), analysis: () => analysisHub(ctx), analytics: () => analyticsView(ctx), maps: () => mapsView(ctx), 'set-pieces': () => setPiecesView(ctx),
    player: () => playerView(ctx, id), compare: () => compareView(ctx), scouting: () => scoutingView(ctx), training: () => trainingView(ctx), reports: () => reportsView(ctx), xg: () => xgView(ctx) };
  stopTick(); resetView();
  view().innerHTML = '<p class="sx-small">Loading…</p>';
  Promise.resolve((run[page] || dashboardView)()).catch((x: any) => { view().innerHTML = `<div class="sx-card"><p class="sx-err">${esc(x.message)}</p></div>`; });
  window.scrollTo(0, 0);
}
const seasonSelect = (cur: string, extra = '') => `<label>Season<select data-season>${extra}${S.seasons.map((s: string) => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`;
const pill = (st: string) => `<span class="sx-pill ${esc(st)}">${esc(st)}</span>`;
const label = (t: string) => S.settings?.labels?.[t] || S.eventTypes[t] || t;
const words = (s: string) => { const t = String(s || '').replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };
let season = '';

// ── Dashboard ──
async function dashboardView() {
  season = season || S.season;
  const d = await api(`dashboard?season=${encodeURIComponent(season)}`);
  const a = d.team.all;
  view().innerHTML = `
    <div class="sx-row sx-noprint" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Season ${esc(season)}</h2><div class="sx-row">${seasonSelect(season)}<a class="sx-btn" href="/staff/statistics-center/bst-analysis/">Analysis Form</a><span class="sx-row"><button class="sx-btn" type="button" data-practice>Practice match</button><a class="sx-btn sx-btn--r" href="#/new">+ New match</a></span></div></div>
    <div class="sx-kpis">
      ${[['Played', a.p], ['Won', a.w], ['Drawn', a.d], ['Lost', a.l], ['Goals for', a.gf], ['Goals against', a.ga], ['Clean sheets', a.cleanSheets], ['Yellow cards', d.team.discipline.yellow], ['Red cards', d.team.discipline.red]]
        .map(([l, v]) => `<div class="sx-kpi"><b>${v}</b><span>${l}</span></div>`).join('')}
      <div class="sx-kpi"><b style="font-size:20px">${d.topScorer ? esc(d.topScorer.name) : '—'}</b><span>Top scorer${d.topScorer ? ` · ${d.topScorer.goals}` : ''}</span></div>
      <div class="sx-kpi"><b style="font-size:20px">${d.topAssister ? esc(d.topAssister.name) : '—'}</b><span>Top assists${d.topAssister ? ` · ${d.topAssister.assists}` : ''}</span></div>
    </div>
    <div class="sx-grid" style="margin-top:16px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <section class="sx-card"><h3>Recent published matches</h3>${d.recent.length ? `<ul class="sx-feed">${d.recent.map((r: any) => `<li><span class="m ${r.r}">${r.r}</span><span class="d"><a href="#/review/${esc(r.id)}">${esc(r.opponent)}</a><small>${esc(r.score)} · ${esc(day(r.date))}</small></span></li>`).join('')}</ul>` : '<p class="sx-small">No published matches this season yet.</p>'}</section>
      <section class="sx-card"><h3>Awaiting review or publishing</h3>${d.open.length ? `<ul class="sx-feed">${d.open.map((m: any) => `<li><span class="d"><a href="#/${m.status === 'live' ? 'live' : m.status === 'draft' ? 'match' : 'review'}/${esc(m.id)}">${fx(m.home, m.away)}</a><small>${esc(day(m.date))} · ${shownScore(m)}${m.official && (m.official.home !== m.homeScore || m.official.away !== m.awayScore) ? ` (goals recorded ${m.homeScore}–${m.awayScore})` : ''}</small></span>${pill(m.status)}</li>`).join('')}</ul>` : '<p class="sx-small">Nothing waiting.</p>'}</section>
    </div>`;
  view().querySelector('[data-season]')?.addEventListener('change', (e: any) => { season = e.target.value; dashboardView(); });
}

// ── Matches ──
async function matchesView() {
  const L1 = resetView();
  const f = store.get('sx_filters', { season: S.season, status: '', competition: '' });
  const q = new URLSearchParams(f).toString();
  const d = await api(`matches?${q}`);
  view().innerHTML = `
    <div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Matches</h2><span class="sx-row"><button class="sx-btn" type="button" data-practice>Practice match</button><a class="sx-btn sx-btn--r" href="#/new">+ New match</a></span></div>
    <form class="sx-card sx-row" id="mf">
      <label>Season<select name="season"><option value="">All</option>${S.seasons.map((s: string) => `<option ${s === f.season ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <label>Status<select name="status"><option value="">All</option>${S.statuses.map((s: string) => `<option ${s === f.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Competition<select name="competition"><option value="">All</option>${S.settings.competitions.map((c: string) => `<option ${c === f.competition ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    </form>
    <div class="sx-card sx-scroll"><table class="sx-t sx-t--cards"><thead><tr><th>Date</th><th>Match</th><th class="n">Score</th><th>Competition</th><th>Status</th><th>Open</th></tr></thead><tbody>
    ${d.matches.map((m: any) => `<tr><td class="c-date">${esc(day(m.date))}</td><td class="c-match">${fx(m.home, m.away)}</td><td class="n c-score" data-label="Score">${shownScore(m)}${scoreNote(m)}</td><td class="c-comp">${esc(m.competition)}${m.practice ? ' · practice' : ''}</td><td class="c-status">${pill(m.status)}</td>
      <td class="c-acts"><div class="sx-form-r"><a class="sx-btn" href="#/match/${esc(m.id)}">Setup</a>${m.status !== 'published' ? `<a class="sx-btn" href="#/live/${esc(m.id)}">Live</a>` : ''}<a class="sx-btn" href="#/review/${esc(m.id)}">Review</a>${m.status !== 'published' ? `<button class="sx-btn" data-remove="${esc(m.id)}">Remove</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="6" class="sx-small">No matches yet.</td></tr>'}
    </tbody></table></div>`;
  $('mf').addEventListener('change', (e: any) => { store.set('sx_filters', Object.fromEntries(new FormData(e.currentTarget) as any)); matchesView(); });
  view().addEventListener('click', async (e: any) => {
    const b = e.target.closest('[data-remove]'); if (!b) return;
    if (!confirm('Remove this match from the lists? It is kept in the database and can be restored by a Super Admin.')) return;
    try { await api('match/remove', { id: b.dataset.remove }); toast('Removed.'); matchesView(); } catch (x: any) { toast(x.message, false); }
  }, L1);
}

async function newMatchView() {
  const d = await api('fixtures');
  const open = d.fixtures.filter((f: any) => !f.recorded);
  view().innerHTML = `
    <h2>New match</h2>
    <section class="sx-card"><h3>From the fixture list</h3><p class="sx-small">Choose the fixture: teams, date, venue and competition are filled in for you, and publishing updates its match page.</p>
      <div class="sx-scroll"><table class="sx-t"><tbody>${open.map((f: any) => `<tr><td>${esc(day(f.date))}</td><td>${fx(f.home, f.away)}<br><small class="sx-small">${esc(f.competition)} · ${esc(f.venue || '')}</small></td><td><button class="sx-btn sx-btn--p" data-fx="${esc(f.id)}">Record this match</button></td></tr>`).join('') || '<tr><td class="sx-small">Every fixture is already being recorded.</td></tr>'}</tbody></table></div>
    </section>
    <form class="sx-card" id="fr"><h3>A match not in the fixtures (e.g. a friendly)</h3>
      <div class="sx-form">
        <label>Home team<input name="home" required maxlength="80" value="Lobi Stars FC"></label><label>Away team<input name="away" required maxlength="80"></label>
        <label>Date<input name="date" type="date" required></label><label>Kick-off<input name="kickoff" type="time"></label>
        <label>Competition<select name="competition">${S.settings.competitions.map((c: string) => `<option ${c === 'Friendly' ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label>Venue<input name="venue" maxlength="120"></label>
      </div><p><button class="sx-btn sx-btn--p" type="submit">Create match</button></p></form>`;
  const go = (id: string) => { location.hash = `#/match/${id}`; };
  view().querySelectorAll('[data-fx]').forEach(b => b.addEventListener('click', async () => {
    try { go((await api('matches', { eventId: (b as HTMLElement).dataset.fx })).id); } catch (x: any) { if (x.data?.id) go(x.data.id); else toast(x.message, false); }
  }));
  $('fr').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    try { go((await api('matches', Object.fromEntries(new FormData(e.target) as any))).id); } catch (x: any) { toast(x.message, false); }
  });
}

// ── Match setup: details and line-ups ──
const lobiSide = (m: any) => (m.lobiHome ? 'home' : 'away');
const teamName = (m: any, side: string) => (side === 'home' ? m.home : m.away);
async function loadMatch(id: string) {
  try { const d = await api(`match?id=${encodeURIComponent(id)}`); store.set(`sx_m_${id}`, d); return d; }
  catch (x: any) { const c = store.get(`sx_m_${id}`, null); if (c && !(x instanceof ApiError)) { toast('No connection: showing the copy saved on this device.', false); return c; } throw x; }
}
/** The result to show: the official one (as on /results) when there is one, else the recorded goals. */
const shownScore = (m: any) => (m.official ? `${m.official.home}–${m.official.away}` : `${m.homeScore}–${m.awayScore}`);
const scoreNote = (m: any) => (m.official && (m.official.home !== m.homeScore || m.official.away !== m.awayScore) ? `<small class="sx-offnote">Official result · goals recorded ${m.homeScore}–${m.awayScore}</small>` : m.official ? '<small class="sx-offnote ok">Official result</small>' : '');
const matchHead = (m: any, here: string) => `
  <div class="sx-row sx-noprint" style="justify-content:space-between;margin-bottom:12px">
    <div><h2 style="margin:0">${fx(m.home, m.away, shownScore(m))}</h2>${scoreNote(m)}<p class="sx-small" style="margin:0">${esc(m.competition)} · ${esc(day(m.date))} · ${pill(m.status)}</p></div>
    <div class="sx-row">${[['match', 'Setup'], ['live', 'Live entry'], ['review', 'Review & publish']].filter(([k]) => !(k === 'live' && m.status === 'published')).map(([k, t]) => `<a class="sx-btn ${k === here ? 'sx-btn--p' : ''}" href="#/${k}/${esc(m.id)}">${t}</a>`).join('')}${matchLinks(ctx, m)}</div>
  </div>${m.practice ? '<p class="sx-note">Practice match: for training only. It is never published or counted, and is deleted after 30 days.</p>' : ''}`;

async function setupView(id: string) {
  const d = await loadMatch(id);
  const m = d.match, ls = lobiSide(m), os = ls === 'home' ? 'away' : 'home', locked = m.status === 'published';
  const inLu = new Map(d.lineups.filter((l: any) => l.side === ls).map((l: any) => [l.slug, l]));
  const opp = d.lineups.filter((l: any) => l.side === os);
  const roster = [...S.roster].sort((a: any, b: any) => (a.number ?? 99) - (b.number ?? 99));
  const f = (k: string, t: string, input: string) => `<label>${t}${input.replace('NAME', k)}</label>`;
  const v = (x: any) => esc(x ?? '');
  view().innerHTML = matchHead(m, 'match') + `
    ${locked ? '<p class="sx-err">This match is published. Reopen it on the Review page to make corrections.</p>' : ''}
    <form class="sx-card" id="setup"><h3>Match details</h3><fieldset ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0"><div class="sx-form">
      ${f('competition', 'Competition', `<select name="NAME">${[...new Set([m.competition, ...S.settings.competitions])].map((c: string) => `<option ${c === m.competition ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>`)}
      ${f('matchday', 'Matchday / round', `<input name="NAME" maxlength="20" value="${v(m.matchday)}">`)}
      ${f('date', 'Date', `<input name="NAME" type="date" value="${v(String(m.date).slice(0, 10))}">`)}
      ${f('kickoff', 'Kick-off (Lagos time)', `<input name="NAME" type="time" value="${v(m.kickoff)}">`)}
      ${f('venue', 'Venue', `<input name="NAME" maxlength="120" value="${v(m.venue)}">`)}
      ${f('home', 'Home team', `<input name="NAME" maxlength="80" value="${v(m.home)}" ${m.eventId ? 'readonly' : ''}>`)}
      ${f('away', 'Away team', `<input name="NAME" maxlength="80" value="${v(m.away)}" ${m.eventId ? 'readonly' : ''}>`)}
      ${f('referee', 'Referee', `<input name="NAME" maxlength="80" value="${v(m.referee)}">`)}
      ${f('assistants', 'Assistant referees / 4th official', `<input name="NAME" maxlength="160" value="${v(m.assistants)}">`)}
      ${f('weather', 'Weather', `<span class="sx-row" style="flex-wrap:nowrap"><input name="NAME" maxlength="60" value="${v(m.weather)}" placeholder="Sunny, 31°C"><button type="button" class="sx-btn" id="wxFill" title="Weather at kick-off from Open-Meteo (free)">Fill in</button></span>`)}
      ${f('pitch', 'Pitch condition', `<input name="NAME" maxlength="60" value="${v(m.pitch)}" placeholder="Good, dry">`)}
      ${f('attendance', 'Attendance', `<input name="NAME" type="number" min="0" max="100000" value="${v(m.attendance)}">`)}
      ${f('attack1h', 'Lobi Stars attack in the 1st half (as you watch)', `<select name="NAME"><option value="ltr" ${m.attack1h !== 'rtl' ? 'selected' : ''}>Left to right →</option><option value="rtl" ${m.attack1h === 'rtl' ? 'selected' : ''}>← Right to left</option></select>`)}
      ${f('videoUrl', 'Match video link (YouTube, Vimeo or a file)', `<input name="NAME" type="url" maxlength="400" value="${v(m.videoUrl)}" placeholder="https://">`)}
      ${f('videoOffset', 'Kick-off time in the video (seconds)', `<input name="NAME" type="number" min="0" max="86400" value="${v(m.videoOffset)}" placeholder="e.g. 95">`)}
      ${f('videoOffset2', '2nd-half kick-off in the video (seconds, optional)', `<input name="NAME" type="number" min="0" max="86400" value="${v(m.videoOffset2)}" placeholder="e.g. 3720">`)}
      ${f('length', 'Match length', `<select name="NAME"><option value="90" ${m.length !== 120 ? 'selected' : ''}>90 minutes</option><option value="120" ${m.length === 120 ? 'selected' : ''}>120 minutes (extra time)</option></select>`)}
    </div><p><button class="sx-btn sx-btn--p" type="submit">Save details</button></p></fieldset></form>

    <form class="sx-card" id="lu"><h3>Line-ups</h3><fieldset ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <div id="mcNote"></div>
      <div class="sx-row" style="justify-content:space-between"><h3 style="margin:0">${esc(teamName(m, ls))}</h3>
        <p class="sx-count" aria-live="polite">Starting XI: <b id="nStart">0</b> of 11 · Substitutes: <b id="nBench">0</b></p></div>
      <p class="sx-err" id="luWarn" hidden></p>
      <div class="sx-form" style="margin:10px 0">${formationPick(ls === 'home' ? 'formationHome' : 'formationAway', 'Starting formation', ls === 'home' ? m.formationHome : m.formationAway)}${formationPick(ls === 'home' ? 'formationHomeFinish' : 'formationAwayFinish', 'Finishing formation', ls === 'home' ? m.formationHomeFinish : m.formationAwayFinish)}</div>
      <div class="sx-row" role="group" aria-label="Show positions" style="margin-bottom:10px">${['All', 'GK', 'DF', 'MF', 'FW'].map((p, i) => `<button type="button" class="sx-btn ${i ? '' : 'sx-btn--p'}" data-posf="${p}">${p === 'All' ? 'All players' : p}</button>`).join('')}</div>
      <p class="sx-small">The whole squad from the Squad page. Choose <b>Starting</b> (11) or <b>Substitute</b> for each player in the matchday squad; leave the rest on "—". Shirt numbers can be changed for this match.</p>
      <div class="sx-pcards">${roster.map((p: any) => { const l: any = inLu.get(p.slug); const role = l ? (l.starter ? 's' : 'b') : ''; return `<div class="sx-pcard${role ? ` r-${role}` : ''}" data-slug="${esc(p.slug)}" data-pos="${posGroup(p.position)}" data-ini="${esc(initials(p.name))}">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy" width="48" height="48">` : `<span class="sx-pini" aria-hidden="true">${esc(initials(p.name))}</span>`}
        <span class="sx-pinfo"><b>#<input data-num type="number" min="0" max="99" value="${esc(l?.number ?? p.number ?? '')}" aria-label="Shirt number for ${esc(p.name)}"> ${esc(p.name)}</b><small>${esc(l?.position || p.position || '')}</small></span>
        <select data-role aria-label="${esc(p.name)}: starting, substitute or not in the squad"><option value="">—</option><option value="s" ${role === 's' ? 'selected' : ''}>Starting</option><option value="b" ${role === 'b' ? 'selected' : ''}>Substitute</option></select>
        <input type="hidden" data-ppos value="${esc(l?.position || p.position || '')}"></div>`; }).join('') || '<p class="sx-err">The squad list is empty: players come from the IT Center (Squad page).</p>'}</div>

      <h3 style="margin-top:22px">${esc(teamName(m, os))}</h3>
      <div class="sx-form" style="margin:10px 0">${formationPick(os === 'home' ? 'formationHome' : 'formationAway', 'Starting formation', os === 'home' ? m.formationHome : m.formationAway)}${formationPick(os === 'home' ? 'formationHomeFinish' : 'formationAwayFinish', 'Finishing formation', os === 'home' ? m.formationHomeFinish : m.formationAwayFinish)}</div>
      <p class="sx-small">Type the opponents' players (name and number), or copy them. Optional, but needed to record who did what for them. Players are saved for next time we play ${esc(teamName(m, os))}.</p>
      <p class="sx-row" id="oppTools"></p><datalist id="oppSaved"></datalist>
      <div class="sx-scroll"><table class="sx-t"><thead><tr><th>Name</th><th class="n">No.</th><th>Position</th><th>Starter</th><th></th></tr></thead><tbody id="oppRows">
      ${(opp.length ? opp : Array.from({ length: 11 }, () => ({ starter: true }))).map(oppRow).join('')}
      </tbody></table></div>
      <p class="sx-row"><button class="sx-btn" type="button" id="addOpp">+ Add a player</button><button class="sx-btn sx-btn--p" type="submit">Save line-ups and formations</button></p>
    </fieldset></form>`;
  const count = () => {
    let st = 0, bn = 0; const nums = new Map<string, number>();
    view().querySelectorAll('.sx-pcard').forEach((c: any) => {
      const r = c.querySelector('[data-role]').value; c.classList.toggle('r-s', r === 's'); c.classList.toggle('r-b', r === 'b');
      if (r === 's') st++; if (r === 'b') bn++;
      const n = c.querySelector('[data-num]').value; if (r && n !== '') nums.set(n, (nums.get(n) || 0) + 1);
    });
    $('nStart').textContent = st; $('nBench').textContent = bn; $('nStart').style.color = st === 11 ? 'var(--ok)' : 'var(--red)';
    const dup = [...nums].filter(([, k]) => k > 1).map(([n]) => n);
    const warn = [st > 11 ? `${st} starters: only 11 can start.` : '', bn > 14 ? `${bn} substitutes: the league allows at most 14 on the bench.` : '', dup.length ? `Shirt number${dup.length > 1 ? 's' : ''} ${dup.join(', ')} used twice.` : ''].filter(Boolean);
    $('luWarn').hidden = !warn.length; $('luWarn').textContent = warn.join(' ');
  };
  // A photo that cannot load shows the player's initials instead of a broken image.
  const noPhoto = (img: any) => { const sp = document.createElement('span'); sp.className = 'sx-pini'; sp.setAttribute('aria-hidden', 'true'); sp.textContent = img.closest('.sx-pcard').dataset.ini || ''; img.replaceWith(sp); };
  view().querySelectorAll('.sx-pcard img').forEach((img: any) => { if (img.complete && !img.naturalWidth) noPhoto(img); else img.addEventListener('error', () => noPhoto(img), { once: true }); });
  count(); $('lu').addEventListener('change', count); $('lu').addEventListener('input', (e: any) => { if (e.target.matches('[data-num]')) count(); });
  $('lu').addEventListener('click', (e: any) => {
    const b = e.target.closest('[data-posf]'); if (!b) return;
    view().querySelectorAll('[data-posf]').forEach((x: any) => x.classList.toggle('sx-btn--p', x === b));
    view().querySelectorAll('.sx-pcard').forEach((c: any) => { c.hidden = b.dataset.posf !== 'All' && c.dataset.pos !== b.dataset.posf; });
  });
  $('lu').addEventListener('change', (e: any) => { const t = e.target; if (t.matches('[data-fsel]')) { const i = view().querySelector(`[data-fcus="${t.dataset.fsel}"]`) as HTMLInputElement; i.hidden = t.value !== 'custom'; if (!i.hidden) i.focus(); } });
  // Filled in from the Media Centre's line-up for this fixture (or the one on the match page), when nothing is saved here yet.
  if (m.eventId && !locked) api(`match/media-lineup?id=${encodeURIComponent(id)}`).then((r: any) => {
    const L = r.lineup; if (!L) return;
    const apply = () => {
      const bySlug = new Map(roster.map((p: any) => [p.slug, p])), byName = new Map(roster.map((p: any) => [String(p.name).toLowerCase(), p]));
      view().querySelectorAll('.sx-pcard [data-role]').forEach((x: any) => { x.value = ''; });
      for (const [list, role] of [[L.starting, 's'], [L.subs, 'b']] as [any[], string][]) for (const p of list) {
        const sq: any = (p.slug && bySlug.get(p.slug)) || byName.get(String(p.name).toLowerCase()); if (!sq) continue;
        const card = view().querySelector(`.sx-pcard[data-slug="${CSS.escape(sq.slug)}"]`); if (!card) continue;
        (card.querySelector('[data-role]') as HTMLSelectElement).value = role;
        if (p.number !== null && p.number !== undefined) (card.querySelector('[data-num]') as HTMLInputElement).value = String(p.number);
      }
      if (L.formation && /^[1-5](-[1-5]){1,4}$/.test(L.formation)) { const k = ls === 'home' ? 'formationHome' : 'formationAway'; const sel = view().querySelector(`[data-fsel="${k}"]`) as HTMLSelectElement; if (sel && !sel.value) { if ([...sel.options].some(o => o.value === L.formation)) sel.value = L.formation; else { sel.value = 'custom'; const i = view().querySelector(`[data-fcus="${k}"]`) as HTMLInputElement; i.hidden = false; i.value = L.formation; } } }
      count();
    };
    const from = L.source === 'media' ? `the Media Centre line-up (${L.status === 'published' ? 'published' : 'draft'}${L.by ? `, ${L.by}` : ''})` : 'the line-up on the match page';
    const saved = d.lineups.some((l: any) => l.side === ls);
    $('mcNote').innerHTML = saved ? `<p class="sx-note">A line-up is also set in ${esc(from)}. <button type="button" class="sx-btn" id="mcCopy">Use that line-up</button></p>`
      : `<p class="sx-note">Filled in from ${esc(from)}. Check it, then press <b>Save line-ups and formations</b>.</p>`;
    if (saved) $('mcCopy').addEventListener('click', () => { apply(); $('mcNote').innerHTML = '<p class="sx-note">Copied. Check it, then save.</p>'; });
    else apply();
  }).catch(() => { /* no Media Centre line-up */ });
  $('addOpp').addEventListener('click', () => $('oppRows').insertAdjacentHTML('beforeend', oppRow({ starter: false })));
  // The opponent's saved players (from earlier matches) and their last line-up against us.
  const saved = new Map<string, any>();
  api(`opponent/players?team=${encodeURIComponent(teamName(m, os))}`).then((r: any) => {
    for (const p of r.players) saved.set(String(p.name).toLowerCase(), p);
    $('oppSaved').innerHTML = r.players.map((p: any) => `<option value="${esc(p.name)}">${p.number ?? ''} ${esc(p.position || '')}</option>`).join('');
    if (r.players.length) $('oppTools').insertAdjacentHTML('beforeend', `<span class="sx-small">${r.players.length} saved ${esc(teamName(m, os))} players are offered as you type.</span>`);
  }).catch(() => {});
  api(`opponent/last-lineup?id=${encodeURIComponent(id)}`).then((r: any) => {
    if (!r.lineup || locked) return;
    $('oppTools').insertAdjacentHTML('afterbegin', `<button type="button" class="sx-btn" id="oppCopy">Copy line-up from our last match against them (${esc(day(r.lineup.from.date))})</button>`);
    $('oppCopy').addEventListener('click', () => {
      const has = [...$('oppRows').querySelectorAll('[data-oname]')].some((x: any) => x.value.trim());
      if (has && !confirm('Replace the opponent players typed here?')) return;
      $('oppRows').innerHTML = r.lineup.players.map(oppRow).join(''); toast('Copied. Check the players and substitutes, then save.');
    });
  }).catch(() => {});
  $('oppRows').addEventListener('change', (e: any) => {
    const t = e.target; if (!t.matches('[data-oname]')) return;
    const p = saved.get(t.value.trim().toLowerCase()); if (!p) return;
    const tr = t.closest('tr'); if (!tr.querySelector('[data-onum]').value && p.number !== null) tr.querySelector('[data-onum]').value = p.number; if (!tr.querySelector('[data-opos]').value) tr.querySelector('[data-opos]').value = p.position || '';
  });
  $('oppRows').addEventListener('click', (e: any) => { if (e.target.closest('[data-del]')) e.target.closest('tr').remove(); });
  $('wxFill')?.addEventListener('click', async () => {
    try { const r = await api(`match/weather?id=${encodeURIComponent(id)}`); ($('setup') as any).weather.value = r.text.slice(0, 60); toast(`${r.text} (${r.place}, ${r.source}). Press Save details to keep it.`); } catch (x: any) { toast(x.message, false); }
  });
  $('setup').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    const body: any = { id, ...Object.fromEntries(new FormData(e.target) as any) };
    if (body.date === String(m.date).slice(0, 10)) delete body.date; // same day: keep the full date and time
    try { await api('match/setup', body); toast('Details saved.'); setupView(id); } catch (x: any) { toast(x.message, false); }
  });
  // The shared line-up (lineupService.js): the same line-up as the Media Centre's Matchday Desk. Saving sends only the
  // changes, with the version this page loaded: other people's changes to other players merge; a clash asks.
  const sheets: any = {};
  let luDirty = false;
  $('lu').addEventListener('input', () => { luDirty = true; }); $('lu').addEventListener('change', () => { luDirty = true; });
  const chip = (sh: any) => `<span class="sx-pill ${sh.status === 'locked' ? '' : sh.status === 'confirmed' ? 'published' : 'review'}">${sh.status === 'locked' ? 'Locked (kick-off)' : sh.status === 'confirmed' ? 'Confirmed' : 'Draft'}</span>`;
  const drawStatus = () => {
    const sh = sheets[ls]; if (!sh) return;
    $('luStatus').innerHTML = `${chip(sh)} <span class="sx-small">version ${sh.version}${sh.lastEditedBy ? ` · last change by ${esc(sh.lastEditedBy)}` : ''}${sh.confirmedBy && sh.status !== 'draft' ? ` · confirmed by ${esc(sh.confirmedBy)}` : ''}</span>
      ${sh.status === 'draft' && !locked ? '<button type="button" class="sx-btn" id="luConfirm">Confirm line-up</button>' : ''}${sh.status === 'confirmed' && !locked ? '<button type="button" class="sx-btn" id="luReopen">Reopen</button>' : ''}<button type="button" class="sx-btn" id="luHist">History</button>
      ${sh.others?.length ? `<p class="sx-err" style="margin:8px 0 0">${esc(sh.others.map((o: any) => o.name).join(', '))} ${sh.others.length > 1 ? 'are' : 'is'} editing this line-up too. Changes are merged safely.</p>` : ''}
      ${sh.changedSincePublished ? '<p class="sx-err" style="margin:8px 0 0">The line-up changed since the Media Centre last published it: ask the media team to send it for approval again.</p>' : ''}
      ${sh.status === 'locked' ? '<p class="sx-small">The match has kicked off: record changes as substitutions. A correction (e.g. a wrong shirt number) asks for a reason.</p>' : sh.status === 'confirmed' ? '<p class="sx-small">Confirmed: reopen it to change anything.</p>' : ''}<div id="luHistBox"></div>`;
    $('luConfirm')?.addEventListener('click', async () => { try { sheets[ls] = (await api('lineup/confirm', { id, side: ls })).sheet; toast('Line-up confirmed (the official line-up for both pages).'); drawStatus(); } catch (x: any) { toast(x.message, false); } });
    $('luReopen')?.addEventListener('click', async () => { try { const r = await api('lineup/reopen', { id, side: ls }); sheets[ls] = r.sheet; if (r.warning) toast(r.warning, false); drawStatus(); } catch (x: any) { toast(x.message, false); } });
    $('luHist')?.addEventListener('click', async () => {
      const box = $('luHistBox'); if (box.innerHTML) { box.innerHTML = ''; return; }
      const { revisions } = await api(`lineup/revisions?id=${encodeURIComponent(id)}&side=${ls}`);
      box.innerHTML = `<ul class="sx-feed" style="margin-top:8px">${revisions.map((r: any) => `<li><span class="d"><b>Version ${r.version}</b><small>${esc(when(r.at))} · ${esc(r.by || '')} · ${esc(r.what || '')}</small></span>${sheets[ls].status === 'draft' ? `<button type="button" class="sx-btn" data-restore="${esc(r.id)}">Put back</button>` : ''}</li>`).join('') || '<li class="sx-small">No changes yet.</li>'}</ul>`;
      box.querySelectorAll('[data-restore]').forEach((x: any) => x.addEventListener('click', async () => { if (!confirm('Put this version back? It is saved as a new version.')) return; try { await api('lineup/restore', { id, side: ls, revisionId: x.dataset.restore }); toast('Version put back.'); setupView(id); } catch (y: any) { toast(y.message, false); } }));
    });
  };
  $('lu').insertAdjacentHTML('afterbegin', '<div id="luStatus" class="sx-row" style="margin-bottom:10px"></div><div id="luConflict"></div>');
  Promise.all([api(`lineup?id=${encodeURIComponent(id)}&side=${ls}`), api(`lineup?id=${encodeURIComponent(id)}&side=${os}`)]).then(([x, y]: any) => { sheets[ls] = x; sheets[os] = y; drawStatus(); }).catch(() => {});
  const timers = [
    window.setInterval(async () => {
      if (!location.hash.startsWith(`#/match/${id}`)) { timers.forEach(t => clearInterval(t)); return; }
      try {
        const v = await api(`lineup/version?id=${encodeURIComponent(id)}&side=${ls}`);
        if (sheets[ls] && v.version !== sheets[ls].version) {
          if (!luDirty) { toast(`Line-up updated by ${v.by || 'someone else'}`); setupView(id); }
          else $('luConflict').innerHTML = `<p class="sx-err">Line-up changed by ${esc(v.by || 'someone else')}. Your changes are still here: save to merge them, or <a href="#/match/${esc(id)}" id="luReload">see their changes</a>.</p>`;
        }
      } catch { /* offline */ }
    }, 5000),
    window.setInterval(async () => { try { const r = await api('lineup/heartbeat', { id, side: ls, page: 'match-setup' }); if (sheets[ls]) { sheets[ls].others = r.others; drawStatus(); } } catch { /* offline */ } }, 15000),
  ];
  api('lineup/heartbeat', { id, side: ls, page: 'match-setup' }).catch(() => {});
  $('lu').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    let badF = '';
    const formVal = (k: string) => { const x = view().querySelector(`[data-fsel="${k}"]`) as HTMLSelectElement; if (!x) return null; const v = x.value === 'custom' ? (view().querySelector(`[data-fcus="${k}"]`) as HTMLInputElement).value.trim() : x.value; if (v && !/^[1-5](-[1-5]){1,4}$/.test(v)) badF = v; return v; };
    const fk = (side: string, finish: boolean) => (side === 'home' ? (finish ? 'formationHomeFinish' : 'formationHome') : (finish ? 'formationAwayFinish' : 'formationAway'));
    const changesFor = (side: string) => {
      const orig = new Map(d.lineups.filter((l: any) => l.side === side).map((l: any) => [l.slug ? `s:${l.slug}` : `o:${String(l.name).toLowerCase()}#${l.number ?? ''}`, l]));
      const out: any[] = [], seen = new Set();
      if (side === ls) {
        view().querySelectorAll('.sx-pcard').forEach((c: any) => {
          const role = c.querySelector('[data-role]').value, key = `s:${c.dataset.slug}`, o: any = orig.get(key);
          const num = c.querySelector('[data-num]').value, want = role === 's' ? 'starter' : role === 'b' ? 'sub' : 'none';
          if (want !== 'none') seen.add(key);
          const had = o ? (o.starter ? 'starter' : 'sub') : 'none';
          if (want !== had || (want !== 'none' && String(o?.number ?? '') !== String(num))) out.push({ op: 'set', slug: c.dataset.slug, role: want, number: num, position: c.querySelector('[data-ppos]').value });
        });
      } else {
        $('oppRows').querySelectorAll('tr').forEach((tr: any) => {
          const name = tr.querySelector('[data-oname]').value.trim(); if (!name) return;
          const num = tr.querySelector('[data-onum]').value, key = `o:${name.toLowerCase()}#${num}`, o: any = orig.get(key);
          const want = tr.querySelector('[data-ostart]').checked ? 'starter' : 'sub'; seen.add(key);
          if (!o || (o.starter ? 'starter' : 'sub') !== want || (o.position || '') !== tr.querySelector('[data-opos]').value) out.push({ op: 'set', key, name, number: num, position: tr.querySelector('[data-opos]').value, role: want });
        });
      }
      for (const [key, o] of orig) if (!seen.has(key)) out.push({ op: 'set', key, slug: (o as any).slug, name: (o as any).name, number: (o as any).number, role: 'none' });
      const f1 = formVal(fk(side, false)), f2 = formVal(fk(side, true));
      if (f1 !== null && f1 !== (m[fk(side, false)] || '')) out.push({ op: 'formation', value: f1 });
      if (f2 !== null && f2 !== (m[fk(side, true)] || '')) out.push({ op: 'formation_finish', value: f2 });
      return out;
    };
    const todo = [[ls, changesFor(ls)], [os, changesFor(os)]].filter(([, c]: any) => c.length) as [string, any[]][];
    if (badF) { toast(`Write the formation like 4-4-2 (not "${badF}").`, false); return; }
    if (!todo.length) { toast('Nothing changed.'); return; }
    let reason = '';
    if ((sheets[ls]?.status === 'locked' || sheets[os]?.status === 'locked')) { reason = prompt('The match has kicked off. What are you correcting, and why? (e.g. wrong shirt number on the team sheet)') || ''; if (!reason.trim()) return; }
    for (const [side, changes] of todo) {
      try {
        const r = await api('lineup/changes', { id, side, baseVersion: sheets[side]?.version ?? 0, changes, reason });
        sheets[side] = r.sheet;
        if (r.merged) toast('Saved and merged with changes made by someone else.');
      } catch (x: any) {
        if (x.status === 409 && x.data?.conflict) {
          $('luConflict').innerHTML = `<div class="sx-card" style="border-color:var(--warn)"><p><b>${esc(x.data.message || 'Someone else changed this while you were editing.')}</b></p>${(x.data.conflicts || []).map((c: any) => `<p>${esc(c.label)}: now <b>${esc(c.theirs)}</b>, you chose <b>${esc(c.mine)}</b>.</p>`).join('')}${(x.data.problems || []).map((p: string) => `<p>${esc(p)}</p>`).join('')}
            <p class="sx-row"><button type="button" class="sx-btn" id="cfTheirs">Keep theirs (reload)</button><button type="button" class="sx-btn sx-btn--p" id="cfMine">Use mine</button></p></div>`;
          $('cfTheirs').addEventListener('click', () => setupView(id));
          $('cfMine').addEventListener('click', async () => { try { await api('lineup/changes', { id, side, baseVersion: x.data.sheet.version, changes, reason }); toast('Your changes are saved.'); setupView(id); } catch (y: any) { toast(y.message, false); } });
          return;
        }
        toast(x.message, false); if (x.data?.sheet) { sheets[side] = x.data.sheet; drawStatus(); }
        return;
      }
    }
    luDirty = false;
    toast('Line-ups and formations saved (the same line-up the Media Centre sees).');
    setupView(id);
  });
}
/** GK, DF, MF or FW, whichever way the squad list writes the position (DEF, MID, FWD, ST…). */
const posGroup = (p: string) => { const x = String(p || '').toUpperCase(); return /^G/.test(x) ? 'GK' : /^(D|CB|LB|RB|WB)/.test(x) ? 'DF' : /^(M|CM|DM|AM|LM|RM)/.test(x) ? 'MF' : /^(F|ST|CF|W|LW|RW)/.test(x) ? 'FW' : ''; };
const initials = (n: string) => String(n || '').trim().split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join('').slice(0, 2);
const FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-5-1'];
function formationPick(key: string, label: string, cur: string) {
  const custom = !!cur && !FORMATIONS.includes(cur);
  return `<label>${label}<select data-fsel="${key}"><option value="">—</option>${FORMATIONS.map(f => `<option ${f === cur ? 'selected' : ''}>${f}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>Custom…</option></select>
    <input data-fcus="${key}" placeholder="e.g. 4-1-3-2" value="${esc(custom ? cur : '')}" ${custom ? '' : 'hidden'} aria-label="${label}: custom"></label>`;
}
function oppRow(l: any) {
  return `<tr><td><input data-oname maxlength="80" list="oppSaved" value="${esc(l.name || '')}" aria-label="Player name"></td><td class="n"><input data-onum type="number" min="0" max="99" style="width:80px" value="${esc(l.number ?? '')}" aria-label="Shirt number"></td>
    <td><input data-opos maxlength="8" style="width:90px" value="${esc(l.position || '')}" aria-label="Position"></td><td><input data-ostart type="checkbox" ${l.starter ? 'checked' : ''} aria-label="Starter"></td><td><button class="sx-btn" type="button" data-del aria-label="Remove this row">×</button></td></tr>`;
}

// ── Offline queue (per match) ──
const qKey = (id: string) => `sx_q_${id}`;
const queue = (id: string) => store.get(qKey(id), []) as any[];
function enqueue(id: string, op: any) { const q = queue(id); q.push(op); store.set(qKey(id), q); updateSync(); }
function allQueued() { let n = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('sx_q_')) n += (store.get(k, []) as any[]).length; } } catch { /* blocked */ } return n; }
function updateSync() { const n = allQueued(), el = $('sync'); el.hidden = !n && navigator.onLine; el.className = `sx-sync${navigator.onLine ? '' : ' off'}`; el.textContent = navigator.onLine ? `${n} unsynced` : `Offline · ${n} unsynced`; }
let flushing = false;
async function flush(id: string) {
  if (flushing || !navigator.onLine) return null;
  const q = queue(id); if (!q.length) return null;
  flushing = true;
  let last: any = null;
  try {
    // In order: clock taps one by one, events in batches.
    while (queue(id).length) {
      const cur = queue(id), first = cur[0];
      if (first.op === 'clock') { await api('match/clock', { id, action: first.action, at: first.at }); store.set(qKey(id), cur.slice(1)); continue; }
      let n = 0; while (n < cur.length && n < 50 && cur[n].op !== 'clock') n++;
      last = await api('match/events', { id, ops: cur.slice(0, n) });
      const bad = (last.results || []).filter((r: any) => !r.ok);
      if (bad.length) toast(`${bad.length} event(s) were not accepted: ${bad[0].error}`, false);
      else if ((last.results || []).some((r: any) => r.duplicateOf) && cur.slice(0, n).length === 1) toast('Saved. Note: the same event for the same player and minute was already recorded. If it was entered twice, remove one.', false);
      store.set(qKey(id), queue(id).slice(n));
    }
  } catch (x: any) { if (x instanceof ApiError && x.status < 500 && x.status !== 401) { toast(`Not saved: ${x.message}`, false); store.set(qKey(id), queue(id).slice(1)); } }
  finally { flushing = false; updateSync(); }
  return last;
}
function flushAll() { try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; if (k.startsWith('sx_q_')) flush(k.slice(5)); } } catch { /* blocked */ } }
window.addEventListener('online', () => { updateSync(); flushAll(); });
window.addEventListener('offline', updateSync);
setInterval(() => { if (S) flushAll(); }, 15000);

// ── Live entry ──
let tick = 0; const stopTick = () => { clearInterval(tick); tick = 0; };
let L: any = null; // the live match: server copy + this device's unsynced changes
const PERIOD_NAMES: Record<string, string> = { '1H': '1st half', HT: 'Half-time', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2', PEN: 'Penalties', FT: 'Full time' };
function liveEvents() {
  const evs = new Map(L.server.events.map((e: any) => [e.id, e]));
  for (const o of queue(L.id)) {
    if (o.op === 'save') evs.set(o.event.id, { ...o.event, unsynced: true });
    if (o.op === 'delete') evs.delete(o.id);
  }
  const order: any = { '1H': 1, '2H': 2, ET1: 3, ET2: 4, PEN: 5 };
  return [...evs.values()].sort((a: any, b: any) => (order[a.period] - order[b.period]) || (a.minute - b.minute) || ((a.stoppage || 0) - (b.stoppage || 0)) || String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
}
function liveClock() {
  let c = L.server.match.clock || { period: null };
  for (const o of queue(L.id)) if (o.op === 'clock') c = applyClock(c, o.action, o.at);
  return c;
}
function applyClock(c: any, action: string, t: number) {
  const start = (period: string) => ({ period, startedAt: t, pausedAt: null, pausedMs: 0 });
  switch (action) {
    case 'start_1h': return start('1H'); case 'start_2h': return start('2H'); case 'start_et1': return start('ET1'); case 'start_et2': return start('ET2');
    case 'half_time': return { period: 'HT' }; case 'penalties': return { period: 'PEN' }; case 'full_time': return { period: 'FT' };
    case 'pause': return c.startedAt && !c.pausedAt ? { ...c, pausedAt: t } : c;
    case 'resume': return c.pausedAt ? { ...c, pausedAt: null, pausedMs: (c.pausedMs || 0) + (t - c.pausedAt) } : c;
    default: return c;
  }
}
/** The minute now from the clock: { period, minute, stoppage }. */
function clockMinute() {
  const c = liveClock(), P = S.periods;
  const period = ['1H', '2H', 'ET1', 'ET2'].includes(c.period) ? c.period : c.period === 'HT' ? '1H' : c.period === 'PEN' ? 'PEN' : c.period === 'FT' ? (L.server.match.length === 120 ? 'ET2' : '2H') : '1H';
  const [lo, hi] = P[period];
  if (!c.startedAt) return { period, minute: c.period === 'HT' || c.period === 'FT' ? hi : lo + 1, stoppage: null, running: false, label: PERIOD_NAMES[c.period] || 'Not started' };
  const ms = (c.pausedAt || Date.now()) - c.startedAt - (c.pausedMs || 0);
  const m = lo + Math.floor(ms / 60000) + 1;
  const secs = Math.floor((ms % 60000) / 1000);
  return m > hi ? { period, minute: hi, stoppage: m - hi, running: !c.pausedAt, label: `${hi}+${m - hi}'`, secs } : { period, minute: m, stoppage: null, running: !c.pausedAt, label: `${m}'`, secs };
}
function onPitch(side: string, evs: any[]) {
  const lu = L.server.lineups.filter((l: any) => l.side === side);
  const key = (slug: any, name: any) => slug || `n:${String(name || '').toLowerCase()}`;
  const on = new Map(lu.filter((l: any) => l.starter).map((l: any) => [key(l.slug, l.name), l]));
  const bench = new Map(lu.filter((l: any) => !l.starter).map((l: any) => [key(l.slug, l.name), l]));
  for (const e of evs) {
    if (e.side !== side) continue;
    if (e.type === 'substitution') { const off = key(e.slug, e.name), inn = key(e.relatedSlug, e.relatedName); const p = bench.get(inn); on.delete(off); bench.delete(inn); if (p) on.set(inn, p); }
    if (e.type === 'red_card') on.delete(key(e.slug, e.name));
  }
  return { on: [...on.values()], bench: [...bench.values()] };
}

async function liveView(id: string) {
  const server = await loadMatch(id);
  L = { id, server };
  if (server.match.status === 'published') { location.hash = `#/review/${id}`; return; }
  drawLive();
  tick = window.setInterval(() => { const c = $('clockLabel'); if (c) { const m = clockMinute(); c.textContent = m.label; } }, 1000);
  keepAwake();
  const KEYS: Record<string, string> = { g: 'goal', s: 'shot', c: 'corner', f: 'foul_committed', y: 'yellow_card', r: 'red_card', o: 'offside', u: 'substitution', i: 'injury', v: 'gk_save' };
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!location.hash.startsWith('#/live/') || ($('sheet') as HTMLDialogElement).open || e.ctrlKey || e.metaKey || e.altKey || /input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
    const t = KEYS[e.key.toLowerCase()];
    if (t && S.liveButtons.includes(t)) { e.preventDefault(); startFlow(t); }
    else if (e.key.toLowerCase() === 'z') { e.preventDefault(); $('undo')?.click(); }
  }, { signal: viewAbort.signal });
}
function drawLive() {
  const m = L.server.match, evs = liveEvents(), c = liveClock(), cm = clockMinute();
  const h = evs.filter((e: any) => e.type === 'goal' && e.side === 'home').length, a = evs.filter((e: any) => e.type === 'goal' && e.side === 'away').length;
  const btn = (action: string, t: string) => `<button class="sx-btn" data-clock="${action}">${t}</button>`;
  const clockBtns = !c.period ? btn('start_1h', 'Kick-off')
    : c.period === '1H' ? (c.pausedAt ? btn('resume', 'Resume') : btn('pause', 'Pause')) + btn('half_time', 'Half-time')
    : c.period === 'HT' ? btn('start_2h', 'Start 2nd half')
    : c.period === '2H' ? (c.pausedAt ? btn('resume', 'Resume') : btn('pause', 'Pause')) + btn('full_time', 'Full time') + btn('start_et1', 'Extra time')
    : c.period === 'ET1' ? (c.pausedAt ? btn('resume', 'Resume') : btn('pause', 'Pause')) + btn('start_et2', 'Start ET 2nd half')
    : c.period === 'ET2' ? (c.pausedAt ? btn('resume', 'Resume') : btn('pause', 'Pause')) + btn('full_time', 'Full time') + btn('penalties', 'Penalties')
    : c.period === 'PEN' ? btn('full_time', 'Finish') : '';
  view().innerHTML = `
    <div class="sx-live-head">
      <div class="sx-score"><span class="t">${esc(m.home)}</span><span class="s">${h}–${a}</span><span class="t">${esc(m.away)}</span></div>
      <div class="sx-clock"><span id="clockLabel">${esc(cm.label)}</span><span class="p">${esc(PERIOD_NAMES[c.period] || 'Not started')}${c.pausedAt ? ' · paused' : ''}</span></div>
      <div class="sx-clock-btns">${clockBtns}</div>
    </div>
    <div class="sx-taps">${S.liveButtons.map((t: string) => `<button class="sx-tap" data-t="${t}">${esc(label(t))}${LIVE_KEY[t] ? `<small class="sx-key">${LIVE_KEY[t]}</small>` : ''}</button>`).join('')}</div>
    <div class="sx-row" style="justify-content:space-between;margin:16px 0 8px"><h3 style="margin:0">Events</h3><div class="sx-row">
      <button class="sx-btn" id="undo" ${evs.length ? '' : 'disabled'}>Undo last</button><a class="sx-btn" href="#/review/${esc(L.id)}">Review</a><a class="sx-btn" href="#/match/${esc(L.id)}">Setup</a></div></div>
    <ul class="sx-feed">${evs.slice().reverse().slice(0, 40).map(feedItem).join('') || '<li class="sx-small">No events yet. Press Kick-off, then tap what happens.</li>'}</ul>`;
  view().querySelectorAll('[data-clock]').forEach(b => b.addEventListener('click', () => clockTap((b as HTMLElement).dataset.clock!)));
  view().querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => startFlow((b as HTMLElement).dataset.t!)));
  $('undo').addEventListener('click', () => { const last = evs[evs.length - 1]; if (last && confirm(`Undo: ${label(last.type)} ${last.minute}'${last.name ? ` (${last.name})` : ''}?`)) liveChange({ op: 'delete', id: last.id }); });
  view().querySelector('.sx-feed')?.addEventListener('click', (e: any) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
    if (ed) { const ev = evs.find((x: any) => x.id === ed.dataset.edit); if (ev) editDialog(ev, L.server, (op: any) => liveChange(op)); }
    if (del && confirm('Remove this event? (It can be restored on the Review page.)')) liveChange({ op: 'delete', id: del.dataset.del });
  });
}
function feedItem(e: any) {
  const who = e.type === 'substitution' ? `${e.relatedName || '?'} on for ${e.name || '?'}` : e.name || '';
  const extra = [e.type === 'goal' && e.relatedName && e.detail !== 'own_goal' ? `assist ${e.relatedName}` : '', e.outcome, e.detail && e.detail !== 'open_play' ? e.detail : '', e.bodyPart].filter(Boolean).map(words).join(' · ');
  return `<li><span class="m">${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'</span><span class="d"><b>${esc(label(e.type))}</b> · ${esc(teamName(L.server.match, e.side))}<small>${esc(who)}${extra ? ` · ${esc(extra)}` : ''}</small></span>
    ${e.unsynced ? '<span class="u">unsynced</span>' : ''}<button class="sx-btn" data-edit="${esc(e.id)}">Edit</button><button class="sx-btn" data-del="${esc(e.id)}" aria-label="Remove">×</button></li>`;
}
async function clockTap(action: string) {
  if (action === 'full_time' && !confirm('Full time? The match moves to Review.')) return;
  enqueue(L.id, { op: 'clock', action, at: Date.now() });
  drawLive();
  await flush(L.id);
  if (navigator.onLine) { try { L.server = await loadMatch(L.id); } catch { /* keep local */ } drawLive(); }
  if (action === 'full_time') toast('Full time. Check everything on the Review page, then publish.');
}
async function liveChange(op: any) {
  enqueue(L.id, op);
  drawLive();
  const r = await flush(L.id);
  if (r && r.events) { L.server = { ...L.server, match: r.match, events: r.events, derived: r.derived }; store.set(`sx_m_${L.id}`, L.server); drawLive(); }
}

// The step-by-step sheet: team → player → details → minute → save.
function startFlow(type: string) {
  const m = L.server.match, cm = clockMinute();
  const ev: any = { id: uid(), type, period: cm.period, minute: cm.minute, stoppage: cm.stoppage, side: null, createdAt: new Date().toISOString() };
  const evs = liveEvents();
  const steps: string[] = ['side'];
  if (type === 'substitution') steps.push('off', 'on', 'reason');
  else if (type === 'goal') steps.push('gtype', 'player', 'assist', 'body');
  else if (type === 'corner' || type === 'offside') steps.push('player?');
  else steps.push('player');
  if (type === 'shot') steps.push('outcome');
  if (['shot', 'goal', 'foul_committed', 'free_kick', 'offside'].includes(type)) steps.push('where');
  if (type === 'corner' || type === 'free_kick') steps.push('routine', 'spout');
  if (type === 'injury') steps.push('injury');
  steps.push('minute');
  let i = 0;
  const sheet = $('sheet'), body = $('sheetBody');
  const title = () => { $('sheetTitle').textContent = `${label(type)}${ev.side ? ` · ${teamName(m, ev.side)}` : ''}`; };
  const pickBtn = (val: string, main: string, sub = '', wide = false, pressed = false) => `<button type="button" class="sx-pick${wide ? ' wide' : ''}" data-v="${esc(val)}" aria-pressed="${pressed}">${main}${sub ? `<span>${sub}</span>` : ''}</button>`;
  const playersFor = (side: string, which: 'all' | 'on' | 'bench') => {
    const lu = L.server.lineups.filter((l: any) => l.side === side);
    if (lu.length && which === 'on') return onPitch(side, evs).on;
    if (lu.length && which === 'bench') return onPitch(side, evs).bench;
    if (lu.length) return lu;
    return side === lobiSide(m) ? S.roster.map((p: any) => ({ slug: p.slug, name: p.name, number: p.number })) : [];
  };
  const playerGrid = (side: string, which: 'all' | 'on' | 'bench', allowNone: string) => {
    const list = playersFor(side, which);
    const isLobi = side === lobiSide(m);
    return `<div class="sx-picks">${list.map((p: any) => pickBtn(JSON.stringify([p.slug || null, p.name]), `<b>${esc(p.number ?? '–')}</b>`, esc(p.name))).join('')}
      ${allowNone ? pickBtn('null', '<b>—</b>', esc(allowNone), true) : ''}</div>
      ${!isLobi ? `<label style="margin-top:8px">Or type the player's name<span class="sx-form-r"><input data-typed maxlength="80" placeholder="e.g. No. 9 Musa"><button type="button" class="sx-btn" data-typedok>Use this name</button></span></label>` : ''}`;
  };
  const next = () => { i++; render(); };
  const draw = (stepTitle: string, html: string) => {
    title();
    body.innerHTML = `<p class="sx-step">Step ${i + 1} of ${steps.length} · ${esc(stepTitle)}</p>${html}<div class="sx-row" style="justify-content:space-between">${i ? '<button type="button" class="sx-btn" data-back>← Back</button>' : '<span></span>'}</div>`;
    body.querySelector('[data-back]')?.addEventListener('click', () => { i--; render(); });
  };
  const onPick = (fn: (v: any) => void) => {
    body.querySelectorAll('[data-v]').forEach((b: any) => b.addEventListener('click', () => { fn(JSON.parse(b.dataset.v)); next(); }));
    body.querySelector('[data-typedok]')?.addEventListener('click', () => { const t = body.querySelector('[data-typed]').value.trim(); if (t) { fn([null, t]); next(); } });
  };
  function render() {
    const step = steps[i];
    if (!step) return;
    const other = ev.side === 'home' ? 'away' : 'home';
    switch (step) {
      case 'side': draw('Which team?', `<div class="sx-picks">${pickBtn('"home"', `<b style="font-size:18px">${esc(m.home)}</b>`, 'Home', true)}${pickBtn('"away"', `<b style="font-size:18px">${esc(m.away)}</b>`, 'Away', true)}</div>`);
        onPick(v => { ev.side = v; }); break;
      case 'gtype': draw('What kind of goal?', `<div class="sx-picks">${['open_play', 'penalty', 'free_kick', 'corner', 'counter', 'own_goal'].map(t => pickBtn(`"${t}"`, `<b style="font-size:16px">${esc(words(t))}</b>`, t === 'own_goal' ? `by a ${esc(teamName(m, other))} player` : '', false, ev.detail === t)).join('')}</div>`);
        onPick(v => { ev.detail = v; }); break;
      case 'player': case 'player?': {
        const og = type === 'goal' && ev.detail === 'own_goal';
        const side = og ? other : ev.side;
        draw(og ? `Who put it in (${teamName(m, side)})?` : type === 'gk_save' ? 'Which goalkeeper?' : 'Which player?', playerGrid(side, type === 'gk_save' || type === 'goal' || type === 'shot' || type === 'foul_committed' || type === 'yellow_card' || type === 'red_card' || type === 'offside' ? 'on' : 'all', step === 'player?' || side !== lobiSide(m) ? 'Not known' : ''));
        if (!body.querySelector('[data-v]') && side === lobiSide(m)) body.insertAdjacentHTML('afterbegin', '<p class="sx-err">No line-up yet: add it on the Setup page.</p>');
        onPick(([slug, name]: any) => { ev.slug = slug; ev.name = name; }); break;
      }
      case 'assist': draw('Assist?', playerGrid(ev.side, 'on', 'No assist').replace(`data-v="${esc(JSON.stringify([ev.slug, ev.name]))}"`, 'data-v="null" hidden'));
        onPick((v: any) => { ev.relatedSlug = v ? v[0] : null; ev.relatedName = v ? v[1] : null; }); break;
      case 'body': draw('Body part', `<div class="sx-picks">${S.bodyParts.map((b: string) => pickBtn(`"${b}"`, `<b style="font-size:16px">${esc(words(b))}</b>`)).join('')}${pickBtn('null', '<b>—</b>', 'Not known')}</div>`);
        onPick(v => { ev.bodyPart = v; }); break;
      case 'outcome': draw('Outcome', `<div class="sx-picks">${S.outcomes.shot.map((o: string) => pickBtn(`"${o}"`, `<b style="font-size:16px">${esc(words(o))}</b>`)).join('')}</div>`);
        onPick(v => { ev.outcome = v; }); break;
      case 'off': draw('Player going off', playerGrid(ev.side, 'on', ev.side !== lobiSide(m) ? 'Not known' : ''));
        onPick(([slug, name]: any) => { ev.slug = slug; ev.name = name; }); break;
      case 'on': draw('Player coming on', playerGrid(ev.side, 'bench', ev.side !== lobiSide(m) ? 'Not known' : ''));
        onPick(([slug, name]: any) => { ev.relatedSlug = slug; ev.relatedName = name; }); break;
      case 'reason': draw('Reason', `<div class="sx-picks">${pickBtn('"tactical"', '<b style="font-size:16px">Tactical</b>', '', true)}${pickBtn('"injury"', '<b style="font-size:16px">Injury</b>', '', true)}</div>`);
        onPick(v => { ev.outcome = v; ev.detail = v; }); break;
      case 'where': {
        draw('Where on the pitch? (optional)', '<div id="pickBox"></div>');
        pickOnPitch(body.querySelector('#pickBox'), { teamAttacksRight: attacksRight(m, ev.side, ev.period), teamName: teamName(m, ev.side) }).then(p => { if (p) { ev.x = p.x; ev.y = p.y; } next(); });
        break;
      }
      case 'routine': draw('Routine (optional)', `<div class="sx-picks">${S.routines.map((r: string) => pickBtn(`"${r}"`, `<b style="font-size:15px">${esc(words(r))}</b>`)).join('')}${pickBtn('null', '<b>—</b>', 'Skip')}</div>`);
        onPick(v => { ev.routine = v; }); break;
      case 'spout': draw('What came of it? (optional)', `<div class="sx-picks">${S.spOutcomes.map((r: string) => pickBtn(`"${r}"`, `<b style="font-size:15px">${esc(words(r))}</b>`)).join('')}${pickBtn('null', '<b>—</b>', 'Skip')}</div>`);
        onPick(v => { ev.setPieceOutcome = v; }); break;
      case 'injury': draw('Did the player carry on?', `<div class="sx-picks">${pickBtn('"continued"', '<b style="font-size:16px">Carried on</b>', '', true)}${pickBtn('"off"', '<b style="font-size:16px">Went off</b>', '', true)}</div>`);
        onPick(v => { ev.outcome = v; }); break;
      case 'minute':
        draw('Minute (from the clock; change it if needed)', `<div class="sx-form">
          <label>Half<select data-f="period">${Object.keys(S.periods).map(p => `<option value="${p}" ${p === ev.period ? 'selected' : ''}>${PERIOD_NAMES[p]}</option>`).join('')}</select></label>
          <label>Minute<input data-f="minute" type="number" min="0" max="130" value="${ev.minute}" inputmode="numeric"></label>
          <label>Added time (+)<input data-f="stoppage" type="number" min="0" max="30" value="${ev.stoppage ?? ''}" inputmode="numeric"></label>
          <label>Note (optional)<input data-f="notes" maxlength="300"></label></div>
          <button type="button" class="sx-btn sx-btn--ok" data-save style="width:100%;min-height:56px;font-size:20px">Save ${esc(label(type))}</button>`);
        body.querySelector('[data-save]').addEventListener('click', () => {
          for (const k of ['period', 'minute', 'stoppage', 'notes']) { const v = body.querySelector(`[data-f="${k}"]`).value; ev[k] = k === 'minute' ? Number(v) : k === 'stoppage' ? (v === '' ? null : Number(v)) : v; }
          sheet.close();
          liveChange({ op: 'save', event: ev });
          toast(`${label(type)} saved${navigator.onLine ? '' : ' on this device (will send when online)'}.`);
        });
        break;
      default: break;
    }
  }
  render();
  sheet.showModal();
}

// A full form for one event (review, and Edit on the live screen).
function editDialog(ev: any, data: any, done: (op: any) => void) {
  const m = data.match, e = { ...ev };
  const opts = (side: string) => {
    const lu = data.lineups.filter((l: any) => l.side === side);
    const list = lu.length ? lu : side === lobiSide(m) ? S.roster : [];
    return list.map((p: any) => `<option value="${esc(JSON.stringify([p.slug || null, p.name]))}">${esc(p.number ?? '')} ${esc(p.name)}</option>`).join('');
  };
  const sel = (k: string, list: string[], cur: any, none = '—') => `<select data-f="${k}"><option value="">${none}</option>${list.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(words(v))}</option>`).join('')}</select>`;
  $('sheetTitle').textContent = ev.id ? 'Edit event' : 'Add event';
  const body = $('sheetBody');
  body.innerHTML = `<div class="sx-form">
    <label>Event${sel('type', Object.keys(S.eventTypes), e.type, 'Choose').replace(/>([a-z_ ]+)<\/option>/g, (x: string, t: string) => `>${esc(label(t.replace(/ /g, '_')))}</option>`)}</label>
    <label>Team<select data-f="side"><option value="home" ${e.side === 'home' ? 'selected' : ''}>${esc(m.home)}</option><option value="away" ${e.side === 'away' ? 'selected' : ''}>${esc(m.away)}</option></select></label>
    <label>Half<select data-f="period">${Object.keys(S.periods).map(p => `<option value="${p}" ${p === e.period ? 'selected' : ''}>${PERIOD_NAMES[p]}</option>`).join('')}</select></label>
    <label>Minute<input data-f="minute" type="number" min="0" max="130" value="${esc(e.minute ?? '')}"></label>
    <label>Added time (+)<input data-f="stoppage" type="number" min="0" max="30" value="${esc(e.stoppage ?? '')}"></label>
    <label>Player<select data-f="player"><option value="">—</option><optgroup label="${esc(m.home)}">${opts('home')}</optgroup><optgroup label="${esc(m.away)}">${opts('away')}</optgroup></select><input data-f="playerTyped" placeholder="or type a name (opponents)" maxlength="80" value="${esc(!e.slug ? e.name || '' : '')}"></label>
    <label>Assist / player coming on<select data-f="related"><option value="">—</option><optgroup label="${esc(m.home)}">${opts('home')}</optgroup><optgroup label="${esc(m.away)}">${opts('away')}</optgroup></select><input data-f="relatedTyped" placeholder="or type a name" maxlength="80" value="${esc(!e.relatedSlug ? e.relatedName || '' : '')}"></label>
    <label>Outcome${sel('outcome', [...new Set(Object.values(S.outcomes).flat() as string[])], e.outcome)}</label>
    <label>Type${sel('detail', S.detailTypes, e.detail)}</label>
    <label>Body part${sel('bodyPart', S.bodyParts, e.bodyPart)}</label>
    <label>Note<input data-f="notes" maxlength="300" value="${esc(e.notes || '')}"></label>
    <label>Position on the pitch (0–100, the team attacking →)<span class="sx-row" style="flex-wrap:nowrap"><input data-f="x" type="number" min="0" max="100" step="0.1" placeholder="x" value="${esc(e.x ?? '')}" aria-label="x"><input data-f="y" type="number" min="0" max="100" step="0.1" placeholder="y" value="${esc(e.y ?? '')}" aria-label="y"><button type="button" class="sx-btn" data-pickpos>Pick</button></span></label>
    <label>xG typed by hand (else worked out)<input data-f="xgManual" type="number" min="0" max="1" step="0.01" value="${esc(e.xgSource === 'manual' ? e.xg : '')}" placeholder="${e.xg !== null && e.xg !== undefined ? `auto: ${e.xg}` : 'auto'}"></label>
    <label>Set-piece routine${sel('routine', S.routines, e.routine)}</label><label>Set-piece outcome${sel('setPieceOutcome', S.spOutcomes, e.setPieceOutcome)}</label></div>
    <div id="editPick"></div>
    <button type="button" class="sx-btn sx-btn--ok" data-save style="width:100%">Save</button>`;
  const setSel = (k: string, slug: any, name: any) => { const s = body.querySelector(`[data-f="${k}"]`); const v = JSON.stringify([slug || null, name]); for (const o of s.options) if (o.value === v) o.selected = true; };
  if (e.name) setSel('player', e.slug, e.name);
  if (e.relatedName) setSel('related', e.relatedSlug, e.relatedName);
  body.querySelector('[data-pickpos]')?.addEventListener('click', () => {
    const side = body.querySelector('[data-f="side"]').value, period = body.querySelector('[data-f="period"]').value;
    pickOnPitch(body.querySelector('#editPick'), { teamAttacksRight: attacksRight(m, side, period), teamName: side === 'home' ? m.home : m.away }).then(pos => { body.querySelector('#editPick').innerHTML = ''; if (pos) { body.querySelector('[data-f="x"]').value = pos.x; body.querySelector('[data-f="y"]').value = pos.y; } });
  });
  body.querySelector('[data-save]').addEventListener('click', () => {
    const g = (k: string) => body.querySelector(`[data-f="${k}"]`).value;
    const p = g('player') ? JSON.parse(g('player')) : [null, g('playerTyped').trim() || null];
    const r = g('related') ? JSON.parse(g('related')) : [null, g('relatedTyped').trim() || null];
    const out = { ...e, id: e.id || uid(), type: g('type'), side: g('side'), period: g('period'), minute: Number(g('minute')), stoppage: g('stoppage') === '' ? null : Number(g('stoppage')),
      slug: p[0], name: p[1], relatedSlug: r[0], relatedName: r[1], outcome: g('outcome') || null, detail: g('detail') || null, bodyPart: g('bodyPart') || null, notes: g('notes'),
      x: g('x') === '' ? null : Number(g('x')), y: g('y') === '' ? null : Number(g('y')), xgManual: g('xgManual'), routine: g('routine') || null, setPieceOutcome: g('setPieceOutcome') || null };
    if (!out.type) { toast('Choose the event.', false); return; }
    $('sheet').close();
    done({ op: 'save', event: out });
  });
  $('sheet').showModal();
}

// ── Review and publish ──
async function reviewView(id: string) {
  const L2 = resetView();
  await flush(id);
  const d = await loadMatch(id);
  const m = d.match, locked = m.status === 'published', T = d.derived.team;
  const typeFilter = store.get('sx_rf', { type: '', side: '' });
  const evs = d.events.filter((e: any) => (!typeFilter.type || e.type === typeFilter.type) && (!typeFilter.side || e.side === typeFilter.side));
  const statRow = (k: string, t: string) => `<tr><td class="n">${T.home[k]}</td><th style="text-align:center">${t}</th><td>${T.away[k]}</td></tr>`;
  const players = d.derived.players;
  view().innerHTML = matchHead(m, 'review') + `
    <section class="sx-card"><h3>Checklist</h3>
      <ul class="sx-check">${d.check.errors.map((x: string) => `<li class="e">✖ ${esc(x)}</li>`).join('')}${d.check.warnings.map((x: string) => `<li class="w">⚠ ${esc(x)}</li>`).join('')}${d.check.ok ? '<li class="ok">✔ Score matches the goal events, line-ups and substitutions are valid, nothing after full time.</li>' : ''}</ul>
      <div class="sx-row sx-noprint" style="margin-top:12px">
        ${locked ? `<p class="sx-small" style="margin:0">Published ${esc(when(m.publishedAt))} · verified by ${esc(m.verifiedBy || '')}.</p>${S.user.canPublish ? '<button class="sx-btn" id="reopen">Reopen for corrections</button>' : ''}`
          : S.user.canPublish ? `<button class="sx-btn sx-btn--ok" id="publish" ${d.check.ok ? '' : 'disabled'}>Verify and Publish</button>` : '<p class="sx-small" style="margin:0">A senior statistician or a Super Admin publishes this match.</p>'}
        ${!locked && m.status !== 'review' ? '<button class="sx-btn" id="toReview">Mark ready for review</button>' : ''}
        ${S.settings.secondCheck && !locked ? `<button class="sx-btn" id="secondCheck">I have checked this match</button>` : ''}${m.secondCheckBy ? `<span class="sx-small">Checked by ${esc(m.secondCheckBy)}</span>` : ''}
        <a class="sx-btn" href="#/tag/${esc(id)}">Tag players</a>
        <a class="sx-btn" href="#/ratings/${esc(id)}">Rate players</a>
        <button class="sx-btn" id="statPng">Stat graphic (PNG)</button>
        ${locked ? `<a class="sx-btn" href="https://wa.me/?text=${encodeURIComponent(shareText(d))}" target="_blank" rel="noopener">Share on WhatsApp</a>` : ''}
        <button class="sx-btn" id="print">Print match report</button>
        <a class="sx-btn" href="/api/stats-centre/export/events.csv?matchId=${esc(id)}">Events CSV</a>
      </div>
    </section>

    <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <section class="sx-card"><h3>Team stats</h3><table class="sx-t"><thead><tr><th class="n">${esc(m.home)}</th><th></th><th>${esc(m.away)}</th></tr></thead><tbody>
        ${statRow('goals', 'Goals')}${statRow('shots', 'Shots')}${statRow('shotsOnTarget', 'On target')}${statRow('corners', 'Corners')}${statRow('fouls', 'Fouls')}${statRow('offsides', 'Offsides')}${statRow('saves', 'Saves')}${statRow('yellow', 'Yellow cards')}${statRow('red', 'Red cards')}
        ${m.possessionHome !== null && m.possessionHome !== undefined ? `<tr><td class="n">${m.possessionHome}%</td><th style="text-align:center">Possession</th><td>${100 - m.possessionHome}%</td></tr>` : ''}
        <tr><td class="n">${m.htHome ?? '–'}</td><th style="text-align:center">Half-time</th><td>${m.htAway ?? '–'}</td></tr></tbody></table></section>
      <form class="sx-card" id="post"><h3>After the match</h3><fieldset ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0;display:grid;gap:10px">
        <label>Possession: ${esc(m.home)} % <input name="possessionHome" type="number" min="0" max="100" value="${esc(m.possessionHome ?? '')}"></label>
        <label>Attendance<input name="attendance" type="number" min="0" max="100000" value="${esc(m.attendance ?? '')}"></label>
        <label>Highlights link (YouTube, Facebook…)<input name="highlights" type="url" maxlength="400" value="${esc(m.highlights)}" placeholder="https://"></label>
        <label>Match report<textarea name="report" maxlength="40000">${esc(m.report)}</textarea></label>
        <button class="sx-btn" type="button" id="draftReport">Write a draft from the events</button>
        <button class="sx-btn sx-btn--p" type="submit">Save</button></fieldset></form>
    </div>

    <section class="sx-card" id="keyMoments"><h3>Key moments</h3><p class="sx-small">Loading…</p></section>
    <section class="sx-card" id="trainTags"><h3>Training themes</h3><p class="sx-small">Loading…</p></section>
    <form class="sx-card" id="pl"><h3>Players: minutes, ratings, Man of the Match</h3><fieldset ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <p class="sx-small">Minutes are worked out from the substitutions and red cards. Type a number only to correct one. Ratings are the coach's (1–10).</p>
      <div class="sx-scroll"><table class="sx-t"><thead><tr><th>Player</th><th>Team</th><th class="n">Min</th><th>Correct minutes</th><th class="n">G</th><th class="n">A</th><th class="n">Sh</th><th class="n">YC</th><th class="n">RC</th><th>Rating</th><th>MOTM</th></tr></thead><tbody>
      ${players.filter((p: any) => p.inLineup).map((p: any) => `<tr data-key="${esc(p.slug || `${p.side}:${p.name}`)}"><td>${esc(p.number ?? '')} ${p.slug ? `<a href="/squad/${esc(p.slug)}/" target="_blank" rel="noopener">${esc(p.name)}</a>` : esc(p.name)}${p.starter ? '' : ' <small class="sx-small">(sub)</small>'}</td><td>${esc(teamName(m, p.side))}</td>
        <td class="n">${p.minutes}</td><td><input data-min type="number" min="0" max="130" style="width:84px" value="${esc(p.minutesOverride ?? '')}" aria-label="Correct minutes for ${esc(p.name)}"></td>
        <td class="n">${p.goals}</td><td class="n">${p.assists}</td><td class="n">${p.shots}</td><td class="n">${p.yellow}</td><td class="n">${p.red}</td>
        <td><input data-rate type="number" min="1" max="10" step="0.5" style="width:76px" value="${esc(p.rating ?? '')}" aria-label="Rating for ${esc(p.name)}"></td><td><input data-motm type="radio" name="motm" ${p.motm ? 'checked' : ''} aria-label="Man of the Match: ${esc(p.name)}"></td></tr>`).join('') || '<tr><td colspan="11" class="sx-small">Add the line-ups on the Setup page first.</td></tr>'}
      </tbody></table></div><p><button class="sx-btn sx-btn--p" type="submit">Save players</button></p></fieldset></form>

    <section class="sx-card"><div class="sx-row" style="justify-content:space-between"><h3 style="margin:0">All events (${d.events.length})</h3>
      <div class="sx-row sx-noprint"><label>Event<select id="rfType"><option value="">All</option>${Object.keys(S.eventTypes).map(t => `<option value="${t}" ${t === typeFilter.type ? 'selected' : ''}>${esc(label(t))}</option>`).join('')}</select></label>
      <label>Team<select id="rfSide"><option value="">Both</option><option value="home" ${typeFilter.side === 'home' ? 'selected' : ''}>${esc(m.home)}</option><option value="away" ${typeFilter.side === 'away' ? 'selected' : ''}>${esc(m.away)}</option></select></label>
      ${locked ? '' : '<button class="sx-btn sx-btn--r" id="addEv">+ Add an event</button>'}</div></div>
      <div class="sx-scroll"><table class="sx-t"><thead><tr><th>Min</th><th>Event</th><th>Team</th><th>Player</th><th>Assist / on</th><th>Details</th><th>Score</th><th>Entered</th><th class="sx-noprint"></th></tr></thead><tbody>
      ${evs.map((e: any) => `<tr><td>${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'</td><td><b>${esc(label(e.type))}</b></td><td>${esc(teamName(m, e.side))}</td><td>${esc(e.name)}</td><td>${esc(e.relatedName)}</td>
        <td>${esc([e.outcome, e.detail, e.bodyPart].filter(Boolean).map(words).join(' · '))}${e.notes ? `<br><small class="sx-small">${esc(e.notes)}</small>` : ''}</td><td>${e.scoreHome ?? ''}–${e.scoreAway ?? ''}</td>
        <td><small class="sx-small">${esc(e.updatedBy || e.createdBy || '')}</small></td><td class="sx-noprint">${locked ? '' : `<div class="sx-form-r"><button class="sx-btn" data-edit="${esc(e.id)}">Edit</button><button class="sx-btn" data-del="${esc(e.id)}">Remove</button></div>`}</td></tr>`).join('') || '<tr><td colspan="9" class="sx-small">No events.</td></tr>'}
      </tbody></table></div>
      ${d.deleted.length && !locked ? `<details class="sx-noprint"><summary>Removed events (${d.deleted.length})</summary><ul class="sx-feed">${d.deleted.map((e: any) => `<li><span class="m">${e.minute}'</span><span class="d">${esc(label(e.type))} · ${esc(e.name)}</span><button class="sx-btn" data-restore="${esc(e.id)}">Restore</button></li>`).join('')}</ul></details>` : ''}
    </section>`;
  const reload = () => reviewView(id);
  const send = async (op: any) => { try { await api('match/events', { id, ops: [op] }); toast('Saved.'); reload(); } catch (x: any) { toast(x.message, false); } };
  $('print').addEventListener('click', () => window.print());
  // Key moments with video clips (staff only), and training-theme tags for the match or an event.
  api(`match/key-moments?id=${encodeURIComponent(id)}`).then((r: any) => {
    $('keyMoments').innerHTML = `<h3>Key moments</h3>${r.video ? '' : '<p class="sx-small">Add the match video link and the kick-off time in the video on the Setup page to get "Watch clip" links.</p>'}<ul class="sx-feed">${r.moments.map((k: any) => `<li><span class="m">${k.minute}${k.stoppage ? `+${k.stoppage}` : ''}'</span><span class="d"><b>${esc(label(k.type))}</b> · ${esc(teamName(m, k.side))}<small>${esc(k.name || '')}${k.xg ? ` · xG ${k.xg}` : ''}</small></span>${k.clip ? `<a class="sx-btn" href="${esc(k.clip)}" target="_blank" rel="noopener">Watch clip</a>` : ''}</li>`).join('') || '<li class="sx-small">No goals, shots on target or cards yet.</li>'}</ul>`;
  }).catch(() => {});
  Promise.all([api('themes'), api(`match/tags?id=${encodeURIComponent(id)}`)]).then(([t, g]: any) => {
    const active = t.themes.filter((x: any) => x.active);
    const evName = (eid: string) => { const e = d.events.find((x: any) => x.id === eid); return e ? `${label(e.type)} ${e.minute}'${e.name ? ` · ${e.name}` : ''}` : 'an event'; };
    $('trainTags').innerHTML = `<h3>Training themes</h3><ul class="sx-feed">${g.tags.map((x: any) => `<li><span class="d"><b>${esc(x.name)}</b><small>${x.event_id ? esc(evName(x.event_id)) : 'Whole match'}${x.note ? ` · ${esc(x.note)}` : ''}</small></span><button class="sx-btn" data-untag="${esc(x.id)}">Remove</button></li>`).join('') || '<li class="sx-small">Not tagged yet.</li>'}</ul>
      ${active.length ? `<form class="sx-row" id="tagF" style="margin-top:8px"><label>Theme<select name="theme">${active.map((x: any) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label><label>What<select name="event"><option value="">The whole match</option>${d.events.map((e: any) => `<option value="${esc(e.id)}">${esc(evName(e.id))}</option>`).join('')}</select></label><label>Note<input name="note" maxlength="300"></label><button class="sx-btn sx-btn--p" type="submit">Tag</button></form>` : '<p class="sx-small">Create themes in Analysis › Training themes.</p>'}`;
    $('tagF')?.addEventListener('submit', async (e: any) => { e.preventDefault(); try { await api('tags', { themeId: e.target.theme.value, matchId: e.target.event.value ? '' : id, eventId: e.target.event.value || '', note: e.target.note.value }); toast('Tagged.'); reload(); } catch (x: any) { toast(x.message, false); } });
    $('trainTags').querySelectorAll('[data-untag]').forEach((b: any) => b.addEventListener('click', async () => { try { await api('tags/remove', { id: b.dataset.untag }); reload(); } catch (x: any) { toast(x.message, false); } }));
  }).catch(() => {});
  $('secondCheck')?.addEventListener('click', async () => { if (!confirm('Confirm that you have checked every event, the line-ups and the score?')) return; try { await api('match/second-check', { id }); toast('Recorded. Someone else can now publish.'); reload(); } catch (x: any) { toast(x.message, false); } });
  $('draftReport')?.addEventListener('click', () => { const t = ($('post') as any).report; if (t.value.trim() && !confirm('Replace the report text with a draft from the events?')) return; t.value = draftReport(d); toast('Draft written: read it, edit it, then Save.'); });
  $('statPng').addEventListener('click', () => statGraphic(d));
  $('publish')?.addEventListener('click', async () => {
    if (!confirm('Verify and publish? The stats go on the website (Stats page, player pages, match page).')) return;
    try { await api('match/publish', { id }); toast('Published. The website is updated.'); reload(); } catch (x: any) { toast(x.message, false); if (x.data?.check) reload(); }
  });
  $('reopen')?.addEventListener('click', async () => { if (!confirm('Reopen for corrections? The website keeps showing the published version until you publish again.')) return; try { await api('match/reopen', { id }); reload(); } catch (x: any) { toast(x.message, false); } });
  $('toReview')?.addEventListener('click', async () => { try { await api('match/status', { id, status: 'review' }); reload(); } catch (x: any) { toast(x.message, false); } });
  $('rfType').addEventListener('change', (e: any) => { store.set('sx_rf', { ...typeFilter, type: e.target.value }); reload(); });
  $('rfSide').addEventListener('change', (e: any) => { store.set('sx_rf', { ...typeFilter, side: e.target.value }); reload(); });
  $('addEv')?.addEventListener('click', () => editDialog({ type: '', side: lobiSide(m), period: '1H', minute: 1 }, d, send));
  view().addEventListener('click', (e: any) => {
    const ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]'), res = e.target.closest('[data-restore]');
    if (ed) editDialog(d.events.find((x: any) => x.id === ed.dataset.edit), d, send);
    if (del && confirm('Remove this event? It can be restored below.')) send({ op: 'delete', id: del.dataset.del });
    if (res) send({ op: 'restore', id: res.dataset.restore });
  }, L2);
  $('post').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    try { await api('match/setup', { id, ...Object.fromEntries(new FormData(e.target) as any) }); toast('Saved.'); reload(); } catch (x: any) { toast(x.message, false); }
  });
  $('pl').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    const rows = new Map<string, any>();
    view().querySelectorAll('tr[data-key]').forEach((tr: any) => rows.set(tr.dataset.key, { min: tr.querySelector('[data-min]').value, rate: tr.querySelector('[data-rate]').value, motm: tr.querySelector('[data-motm]').checked }));
    const out: any = { id, home: [], away: [] };
    let motmSlug = '';
    for (const l of d.lineups) {
      const r = rows.get(l.slug || `${l.side}:${l.name}`) || {};
      if (r.motm && l.slug) motmSlug = l.slug;
      out[l.side].push({ slug: l.slug, name: l.name, number: l.number, position: l.position, starter: l.starter, minutesOverride: r.min ?? l.minutesOverride, rating: r.rate ?? l.rating, motm: !!r.motm });
    }
    try { await api('match/lineups', out); if (motmSlug) await api('match/setup', { id, motm: motmSlug }); toast('Players saved.'); reload(); } catch (x: any) { toast(x.message, false); }
  });
}

// ── Players ──
async function playersView() {
  const L3 = resetView();
  const sel = store.get('sx_ps', S.season);
  const d = await api(`players?season=${encodeURIComponent(sel)}`);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Players · ${sel === 'career' ? 'all seasons' : esc(sel)}</h2>${seasonSelect(sel, `<option value="career" ${sel === 'career' ? 'selected' : ''}>All seasons (career)</option>`)}</div>
    <div class="sx-card sx-scroll"><p class="sx-small">From published matches only. Tap a name for the match-by-match log; "Profile" opens the player's public page.</p><table class="sx-t"><thead><tr><th>Player</th><th class="n">Apps</th><th class="n">Starts</th><th class="n">Min</th><th class="n">Goals</th><th class="n">Assists</th><th class="n">Shots</th><th class="n">On target</th><th class="n">YC</th><th class="n">RC</th><th class="n">Clean sheets</th><th class="n">MOTM</th><th></th></tr></thead><tbody>
    ${d.players.map((p: any) => `<tr><td><button class="sx-btn" data-log="${esc(p.slug)}" style="min-height:36px">${esc(p.name)}</button> <a href="#/player/${esc(p.slug)}" class="sx-small">Player page</a> <a href="#/development/${esc(p.slug)}" class="sx-small">Development</a></td><td class="n">${p.apps}</td><td class="n">${p.starts}</td><td class="n">${p.minutes}</td><td class="n">${p.goals}</td><td class="n">${p.assists}</td><td class="n">${p.shots}</td><td class="n">${p.shotsOnTarget}</td><td class="n">${p.yellow}</td><td class="n">${p.red}</td><td class="n">${p.cleanSheets}</td><td class="n">${p.motm}</td><td><a href="/squad/${esc(p.slug)}/" target="_blank" rel="noopener">Profile</a></td></tr>
      <tr data-logrow="${esc(p.slug)}" hidden><td colspan="13"><table class="sx-t"><tbody>${p.matches.map((x: any) => `<tr><td>${esc(day(x.date))}</td><td>${x.home ? 'v' : '@'} ${esc(x.opponent)}</td><td>${esc(x.score)}</td><td>${x.started ? 'Started' : 'Sub'}</td><td class="n">${x.minutes}'</td><td class="n">${x.goals ? `${x.goals} goal${x.goals > 1 ? 's' : ''}` : ''}</td><td class="n">${x.assists ? `${x.assists} assist${x.assists > 1 ? 's' : ''}` : ''}</td><td><a href="#/review/${esc(x.id)}">Match</a></td></tr>`).join('')}</tbody></table></td></tr>`).join('') || '<tr><td colspan="13" class="sx-small">No published matches yet.</td></tr>'}
    </tbody></table></div>`;
  view().querySelector('[data-season]')?.addEventListener('change', (e: any) => { store.set('sx_ps', e.target.value); playersView(); });
  view().addEventListener('click', (e: any) => { const b = e.target.closest('[data-log]'); if (b) { const r = view().querySelector(`[data-logrow="${b.dataset.log}"]`) as HTMLElement; r.hidden = !r.hidden; } }, L3);
}

// ── Team ──
async function teamView() {
  const sel = store.get('sx_ts', S.season);
  const { team: t } = await api(`team?season=${encodeURIComponent(sel)}`);
  const rec = (r: any) => `${r.p} played · ${r.w}W ${r.d}D ${r.l}L · ${r.gf}–${r.ga} · ${r.cleanSheets} clean sheets`;
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Team · ${esc(sel)}</h2>${seasonSelect(sel)}</div>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">
      <section class="sx-card"><h3>Record</h3><p><b>All:</b> ${rec(t.all)}</p><p><b>Home:</b> ${rec(t.home)}</p><p><b>Away:</b> ${rec(t.away)}</p>
        <p><b>Form (last 5):</b></p><div class="sx-form-guide">${t.form.map((f: any) => `<i class="${f.r}" title="${esc(f.opponent)} ${esc(f.score)}">${f.r}</i>`).join('') || '—'}</div>
        <p class="sx-small">The league table (all clubs) is on the <a href="/table/" target="_blank" rel="noopener">Table page</a>.</p></section>
      <section class="sx-card"><h3>Attack and discipline</h3><p>${t.attack.shots} shots, ${t.attack.shotsOnTarget} on target, ${t.attack.corners} corners</p><p>${t.discipline.yellow} yellow cards, ${t.discipline.red} red cards</p></section>
    </div>
    <section class="sx-card sx-scroll"><h3>Head-to-head</h3><table class="sx-t"><thead><tr><th>Opponent</th><th class="n">P</th><th class="n">W</th><th class="n">D</th><th class="n">L</th><th class="n">GF</th><th class="n">GA</th></tr></thead><tbody>
      ${t.h2h.map((h: any) => `<tr><td>${club(h.opponent)}</td><td class="n">${h.p}</td><td class="n">${h.w}</td><td class="n">${h.d}</td><td class="n">${h.l}</td><td class="n">${h.gf}</td><td class="n">${h.ga}</td></tr>`).join('') || '<tr><td colspan="7" class="sx-small">No published matches yet.</td></tr>'}</tbody></table></section>
    <section class="sx-card"><h3>Results</h3><ul class="sx-feed">${t.recent.map((r: any) => `<li><span class="m ${r.r}">${r.r}</span><span class="d"><a href="#/review/${esc(r.id)}">${esc(r.opponent)}</a><small>${esc(r.score)} · ${esc(day(r.date))}</small></span></li>`).join('') || '<li class="sx-small">None yet.</li>'}</ul></section>`;
  view().querySelector('[data-season]')?.addEventListener('change', (e: any) => { store.set('sx_ts', e.target.value); teamView(); });
}

// ── Free-tool helpers ──
const LIVE_KEY: Record<string, string> = { goal: 'G', shot: 'S', corner: 'C', foul_committed: 'F', yellow_card: 'Y', red_card: 'R', offside: 'O', substitution: 'U', injury: 'I', gk_save: 'V' };
let wake: any = null;
/** Keeps the phone screen on during live entry (Screen Wake Lock, built into the browser). */
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await (navigator as any).wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { /* not allowed or not supported */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && location.hash.startsWith('#/live/')) keepAwake(); else if (wake && !location.hash.startsWith('#/live/')) { wake.release?.(); wake = null; } });
const minuteText = (e: any) => `${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'`;
function shareText(d: any) {
  const m = d.match, goals = d.events.filter((e: any) => e.type === 'goal');
  const by = (side: string) => goals.filter((e: any) => e.side === side).map((e: any) => `${e.name || 'own goal'} ${minuteText(e)}${e.detail === 'own_goal' ? ' (og)' : e.detail === 'penalty' ? ' (pen)' : ''}`).join(', ');
  const T = d.derived.team;
  return `${m.home} ${m.homeScore}–${m.awayScore} ${m.away} (${m.competition})${by('home') ? `\n${m.home}: ${by('home')}` : ''}${by('away') ? `\n${m.away}: ${by('away')}` : ''}\nShots ${T.home.shots}–${T.away.shots} · On target ${T.home.shotsOnTarget}–${T.away.shotsOnTarget} · Corners ${T.home.corners}–${T.away.corners}\nFull stats: lobistarsfc.com/stats/`;
}
/** A first draft of the match report from the events (no AI, no cost): the staff edit it before saving. */
function draftReport(d: any) {
  const m = d.match, T = d.derived.team, lobi = m.lobiHome ? 'home' : 'away', opp = lobi === 'home' ? 'away' : 'home';
  const name = (s: string) => (s === 'home' ? m.home : m.away);
  const lf = m.lobiHome ? m.homeScore : m.awayScore, la = m.lobiHome ? m.awayScore : m.homeScore;
  const res = lf > la ? `won ${lf}–${la} against` : lf < la ? `lost ${la}–${lf} to` : `drew ${lf}–${la} with`;
  const where = m.lobiHome ? `at ${m.venue || 'home'}` : `away at ${m.venue || name(opp)}`;
  const goals = d.events.filter((e: any) => e.type === 'goal');
  const line = (e: any) => `${e.detail === 'own_goal' ? `an own goal by ${e.name || 'a defender'}` : e.name || 'a goal'} (${minuteText(e)}${e.detail === 'penalty' ? ', penalty' : ''}${e.relatedName && e.detail !== 'own_goal' ? `, assisted by ${e.relatedName}` : ''})`;
  const parts = [`Lobi Stars ${res} ${name(opp)} ${where} in the ${m.competition}${m.matchday ? ` (matchday ${m.matchday})` : ''}.`];
  const ours = goals.filter((e: any) => e.side === lobi), theirs = goals.filter((e: any) => e.side === opp);
  if (ours.length) parts.push(`Lobi Stars scored through ${ours.map(line).join(', ')}.`);
  if (theirs.length) parts.push(`${name(opp)} scored through ${theirs.map(line).join(', ')}.`);
  if (m.htHome !== null && m.htHome !== undefined) parts.push(`It was ${m.htHome}–${m.htAway} at half-time.`);
  parts.push(`Lobi Stars had ${T[lobi].shots} shots (${T[lobi].shotsOnTarget} on target) and ${T[lobi].corners} corners; ${name(opp)} had ${T[opp].shots} shots (${T[opp].shotsOnTarget} on target).${m.possessionHome !== null && m.possessionHome !== undefined ? ` Possession: ${m.lobiHome ? m.possessionHome : 100 - m.possessionHome}% for Lobi Stars.` : ''}`);
  const cards = d.events.filter((e: any) => e.type === 'red_card');
  if (cards.length) parts.push(`Sent off: ${cards.map((e: any) => `${e.name || 'a player'} (${name(e.side)}, ${minuteText(e)})`).join(', ')}.`);
  const subs = d.events.filter((e: any) => e.type === 'substitution' && e.side === lobi && e.relatedName);
  if (subs.length) parts.push(`Lobi Stars substitutions: ${subs.map((e: any) => `${e.relatedName} for ${e.name} (${minuteText(e)})`).join(', ')}.`);
  if (m.attendance) parts.push(`Attendance: ${Number(m.attendance).toLocaleString('en-GB')}.`);
  return parts.join('\n\n');
}
/** A square stat graphic (PNG) for social media, drawn in the browser (no design tool needed). */
async function statGraphic(d: any) {
  const m = d.match, T = d.derived.team, W = 1080;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = W;
  const x = cv.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, W); g.addColorStop(0, '#1C3F7A'); g.addColorStop(1, '#0E2147'); x.fillStyle = g; x.fillRect(0, 0, W, W);
  x.fillStyle = '#C8102E'; x.fillRect(0, W - 24, W, 24);
  try { const img = new Image(); img.src = '/images/lobi-stars-badge.png'; await img.decode(); x.drawImage(img, W / 2 - 70, 50, 140, 140); } catch { /* no badge */ }
  const font = (w: number, s: number) => `${w} ${s}px "Barlow Condensed", "Arial Narrow", sans-serif`;
  x.textAlign = 'center'; x.fillStyle = '#F2B705'; x.font = font(700, 34); x.fillText(`${String(m.competition).toUpperCase()} · ${new Date(m.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }).toUpperCase()}`, W / 2, 240);
  x.fillStyle = '#fff'; x.font = font(700, 46); x.fillText(String(m.home).toUpperCase(), W / 4, 340); x.fillText(String(m.away).toUpperCase(), (3 * W) / 4, 340);
  x.font = font(700, 170); x.fillText(`${m.homeScore}–${m.awayScore}`, W / 2, 500);
  const goals = d.events.filter((e: any) => e.type === 'goal');
  x.font = font(600, 30); x.fillStyle = '#DDE6F5';
  for (const [side, cx] of [['home', W / 4], ['away', (3 * W) / 4]] as [string, number][]) goals.filter((e: any) => e.side === side).slice(0, 5).forEach((e: any, i: number) => x.fillText(`⚽ ${e.name || 'OG'} ${minuteText(e)}`, cx, 560 + i * 38));
  const rows: [string, number, number][] = [['SHOTS', T.home.shots, T.away.shots], ['ON TARGET', T.home.shotsOnTarget, T.away.shotsOnTarget], ['CORNERS', T.home.corners, T.away.corners], ['FOULS', T.home.fouls, T.away.fouls]];
  rows.forEach(([l, h, a], i) => { const y = 790 + i * 62; x.fillStyle = '#fff'; x.font = font(700, 40); x.textAlign = 'right'; x.fillText(String(h), W / 2 - 170, y); x.textAlign = 'left'; x.fillText(String(a), W / 2 + 170, y); x.textAlign = 'center'; x.fillStyle = '#AFC3E6'; x.font = font(700, 30); x.fillText(l, W / 2, y); });
  x.fillStyle = '#fff'; x.font = font(700, 28); x.fillText('LOBISTARSFC.COM · LOBI STARS STATISTICS CENTER', W / 2, W - 50);
  const a = document.createElement('a'); a.download = `lobi-stars-${String(m.date).slice(0, 10)}-stats.png`; a.href = cv.toDataURL('image/png'); a.click();
}

// ── Tag players: give events recorded without a player (quick live entry, BST grid taps) their player ──
async function tagView(id: string) {
  const R = resetView();
  await flush(id);
  const d = await loadMatch(id);
  const m = d.match, locked = m.status === 'published';
  const { types } = await api('taggable');
  const tag = new Set(types);
  const all = d.events.filter((e: any) => tag.has(e.type));
  const todo = all.filter((e: any) => !e.slug && !e.name);
  const done = all.length - todo.length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 100;
  const players = (side: string) => { const lu = d.lineups.filter((l: any) => l.side === side); return lu.length ? lu : side === lobiSide(m) ? S.roster : []; };
  view().innerHTML = matchHead(m, 'review') + `
    <section class="sx-card"><h3>Tag players</h3><p class="sx-small">Events recorded without a player (fast live entry, Analysis Form grid taps). One tap on a player adds them; nothing is recorded twice.</p>
      <div class="sx-prog" role="progressbar" aria-valuemin="0" aria-valuemax="${all.length}" aria-valuenow="${done}"><i style="width:${pct}%"></i></div>
      <p><b>${done} of ${all.length} events tagged</b></p>${locked ? '<p class="sx-err">This match is published: reopen it on the Review page to tag players.</p>' : ''}</section>
    ${todo.map((e: any) => `<section class="sx-card" data-ev="${esc(e.id)}"><p><b>${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}' · ${esc(label(e.type))}</b> · ${esc(teamName(m, e.type === 'goal' && e.detail === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side))}${e.outcome ? ` · ${esc(words(e.outcome))}` : ''}</p>
      <div class="sx-picks">${players(e.type === 'goal' && e.detail === 'own_goal' ? (e.side === 'home' ? 'away' : 'home') : e.side).map((p: any) => `<button type="button" class="sx-pick" data-p="${esc(JSON.stringify([p.slug || null, p.name]))}" ${locked ? 'disabled' : ''}><b>${esc(p.number ?? '–')}</b>${esc(p.name)}</button>`).join('') || '<p class="sx-small">No line-up for this team: add it on the Setup page, or leave this event without a player.</p>'}</div></section>`).join('') || '<section class="sx-card"><p class="sx-small">Every event has its player.</p></section>'}`;
  view().addEventListener('click', async (ev: any) => {
    const b = ev.target.closest('[data-p]'); if (!b) return;
    const card = b.closest('[data-ev]'), e = d.events.find((x: any) => x.id === card.dataset.ev); if (!e) return;
    const [slug, name] = JSON.parse(b.dataset.p);
    try { await api('match/events', { id, ops: [{ op: 'save', event: { ...e, slug, name } }] }); card.remove(); toast(`${name} added.`); tagView(id); } catch (x: any) { toast(x.message, false); }
  }, R);
}

async function recycleView() {
  const R = resetView();
  const { items } = await api('recycle');
  view().innerHTML = `<h2>Recycle bin</h2><div class="sx-card sx-scroll"><p class="sx-small">Removed items are kept and can be restored. Match history is never deleted from here.</p><table class="sx-t"><thead><tr><th>What</th><th>Removed by</th><th>When</th><th></th></tr></thead><tbody>
    ${items.map((x: any) => `<tr><td><span class="sx-pill">${esc(x.type)}</span> ${esc(x.name)}</td><td>${esc(x.by || '')}</td><td>${esc(when(x.at))}</td><td><button class="sx-btn" data-restore="${esc(x.type)}|${esc(x.id)}">Restore</button></td></tr>`).join('') || '<tr><td colspan="4" class="sx-small">The recycle bin is empty.</td></tr>'}</tbody></table></div>`;
  view().addEventListener('click', async (e: any) => {
    const b = e.target.closest('[data-restore]'); if (!b) return;
    const [type, id] = b.dataset.restore.split('|');
    try { await api('recycle/restore', { type, id }); toast('Restored.'); recycleView(); } catch (x: any) { toast(x.message, false); }
  }, R);
}

// ── Exports, settings, definitions ──
function exportsView() {
  const sel = store.get('sx_es', S.season);
  view().innerHTML = `<h2>Exports</h2><section class="sx-card"><div class="sx-row">${seasonSelect(sel)}</div>
    <label class="sx-small" style="flex-direction:row;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" id="exNotes"> Include staff notes (coach rating notes and event notes: keep the file inside the club)</label>
    <p class="sx-row" style="margin-top:12px"><a class="sx-btn sx-btn--p" data-ex href="/api/stats-centre/export/events.csv?season=${encodeURIComponent(sel)}">Every event (CSV)</a><a class="sx-btn sx-btn--p" href="/api/stats-centre/export/matches.csv?season=${encodeURIComponent(sel)}">Matches (CSV)</a><a class="sx-btn" data-ex href="/api/stats-centre/export/season.json?season=${encodeURIComponent(sel)}">Everything for the season (JSON, for safekeeping)</a></p>
    <p class="sx-small">CSV files open in Excel or Google Sheets. One match's events and a printable match report are on that match's Review page. Every download is recorded in the activity log.</p></section>
    <section class="sx-card"><h3>Google Sheets (updates by itself)</h3><p class="sx-small">A private link that Google Sheets can read with <code>=IMPORTDATA(…)</code>: every event of the season, refreshed by Google about once an hour. Anyone with the link can read the events, so keep it inside the club; making a new link switches the old one off.</p>
      <p class="sx-small">${S.settings.sheetsMade ? `A link is active (made ${esc(when(S.settings.sheetsMade))}).` : 'No link yet.'}</p>
      ${S.user.canPublish ? `<p class="sx-row"><button class="sx-btn sx-btn--p" id="sheetsMake">${S.settings.sheetsMade ? 'Make a new link' : 'Make the link'}</button>${S.settings.sheetsMade ? '<button class="sx-btn" id="sheetsStop">Switch it off</button>' : ''}</p><div id="sheetsOut"></div>` : '<p class="sx-small">A senior statistician or a Super Admin can make it.</p>'}</section>
    <section class="sx-card"><h3>Public stats feed (open data)</h3><p class="sx-small">Published matches and season leaders as data for media partners and apps (no ratings, notes or analysis): <a href="/api/stats/feed.json" target="_blank" rel="noopener">lobistarsfc.com/api/stats/feed.json</a></p></section>`;
  $('sheetsMake')?.addEventListener('click', async () => {
    if (S.settings.sheetsMade && !confirm('Make a new link? The old one stops working.')) return;
    try { const r = await api('settings/sheets', {}); S.settings.sheetsMade = new Date().toISOString(); $('sheetsOut').innerHTML = `<p class="sx-note"><input readonly value="${esc(r.formula)}" style="flex:1 1 320px" aria-label="Formula for Google Sheets"><button class="sx-btn" id="sheetsCopy">Copy</button></p><p class="sx-small">Paste this formula into cell A1 of a Google Sheet. It is shown only once.</p>`; $('sheetsCopy').addEventListener('click', () => navigator.clipboard?.writeText(r.formula).then(() => toast('Copied.'))); } catch (x: any) { toast(x.message, false); }
  });
  $('exNotes')?.addEventListener('change', (e: any) => { for (const a of view().querySelectorAll('a[data-ex]')) { const u = new URL((a as HTMLAnchorElement).href); if (e.target.checked) u.searchParams.set('notes', '1'); else u.searchParams.delete('notes'); (a as HTMLAnchorElement).href = u.toString(); } });
  $('sheetsStop')?.addEventListener('click', async () => { if (!confirm('Switch the Google Sheets link off?')) return; try { await api('settings/sheets', { stop: true }); S.settings.sheetsMade = null; exportsView(); toast('Switched off.'); } catch (x: any) { toast(x.message, false); } });
  view().querySelector('[data-season]')?.addEventListener('change', (e: any) => { store.set('sx_es', e.target.value); exportsView(); });
}
function settingsView() {
  const can = S.user.canPublish;
  view().innerHTML = `<h2>Settings</h2>
    <form class="sx-card" id="sf"><h3>Competitions</h3><p class="sx-small">One per line. Offered when creating and editing matches.${can ? '' : ' Only a senior statistician or a Super Admin can change them.'}</p>
      <textarea name="competitions" ${can ? '' : 'disabled'}>${esc(S.settings.competitions.join('\n'))}</textarea>${can ? '<p><button class="sx-btn sx-btn--p" type="submit">Save</button></p>' : ''}</form>
    <section class="sx-card"><h3>Seasons</h3><p class="sx-small">A match's season comes from its date and the club's season start (set in the website's site settings). Current season: <b>${esc(S.season)}</b>. Seasons with matches: ${S.seasons.map(esc).join(', ')}.</p></section>
    <section class="sx-card"><h3>Monthly report email</h3><p class="sx-small">On the 1st of each month the season summary is made automatically (Analysis › Monthly reports). Tick to also email it to the Super Admins.</p>
      <label class="sx-small" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="repEmail" ${S.settings.reportEmail ? 'checked' : ''} ${can ? '' : 'disabled'}> Email the monthly report</label></section>
    <section class="sx-card"><h3>Second check before publishing</h3><p class="sx-small">When on, a match can be published only after someone other than the publisher has pressed "I have checked this match" on its Review page (the four-eyes rule).</p>
      <label class="sx-small" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="scToggle" ${S.settings.secondCheck ? 'checked' : ''} ${can ? '' : 'disabled'}> Require a second check</label></section>
    <section class="sx-card"><h3>Recycle bin</h3><p class="sx-small">Removed matches, events and analyses are kept here and can be restored.</p><p><a class="sx-btn" href="#/recycle">Open the recycle bin</a></p></section>
    <section class="sx-card"><h3>Install the app</h3><p class="sx-small">Put the Statistics Center on your phone's home screen: it opens full screen like an app and keeps working when the signal drops. Free, no app store needed.</p><p><button class="sx-btn sx-btn--p" type="button" data-install>Install the app</button></p></section>
    <section class="sx-card"><h3>Data retention &amp; privacy</h3><p class="sx-small">How long things are kept, archiving old seasons, youth players and anonymising.</p><p><a class="sx-btn" href="#/retention">Open data retention</a> <a class="sx-btn" href="#/inventory">What we keep</a></p></section>
    <section class="sx-card"><h3>Your account</h3><p>${esc(S.user.fullName)} ${S.user.admin ? '(Super Admin: everything)' : `(${esc(S.user.loginId)})${S.user.canPublish ? ' · may publish' : ''}`}</p><p class="sx-small">Signed out after ${S.idleMinutes / 60} hours without activity. Accounts are managed by the Super Admins in the website admin (Statistics Center).</p></section>`;
  $('repEmail')?.addEventListener('change', async (e: any) => { try { const r = await api('settings', { reportEmail: e.target.checked }); S.settings = { ...S.settings, ...r }; toast('Saved.'); } catch (x: any) { e.target.checked = !e.target.checked; toast(x.message, false); } });
  $('scToggle')?.addEventListener('change', async (e: any) => { try { const r = await api('settings', { secondCheck: e.target.checked }); S.settings = { ...S.settings, ...r }; toast(e.target.checked ? 'A second check is now required before publishing.' : 'Second check switched off.'); } catch (x: any) { e.target.checked = !e.target.checked; toast(x.message, false); } });
  $('sf').addEventListener('submit', async (e: any) => {
    e.preventDefault();
    try { const r = await api('settings', { competitions: e.target.competitions.value.split('\n') }); S.settings = { ...S.settings, competitions: r.competitions }; toast('Saved.'); } catch (x: any) { toast(x.message, false); }
  });
}
const ctx: Ctx = {
  api, esc, toast, view, resetView, store, uid, day, when,
  get S() { return S; },
  enqueue: (matchId: string, op: any) => enqueue(matchId, op),
  flush: (matchId: string) => flush(matchId),
};

setupInstall();
setupFit();
document.addEventListener('click', e => {
  const t = e.target as HTMLElement;
  if (t.closest?.('[data-install]')) { e.preventDefault(); showInstall(); }
  if (t.closest?.('[data-practice]')) { e.preventDefault(); startPractice(ctx); }
});
boot();

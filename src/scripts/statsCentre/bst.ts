// Statistics Center › BST Analysis Form (/staff/statistics-center/bst-analysis/). Library, the two-section form
// (match sheet, data collection grid), autosave, and the print pages (Lobi Stars match analysis report, blank form).
// Every fact is recorded once: match details and line-ups come from Match Setup (read-only here), the event rows
// are the match's events (a + adds one, a − removes the latest in that block, shared with live entry), and only the
// analyst's own numbers (Offence/Attack, Defense, Dangerous Attack, Crossing, xG, xA) and the texts are saved here.
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Ctx {
  api: (path: string, body?: unknown) => Promise<any>; S: any; esc: (s: unknown) => string; toast: (t: string, ok?: boolean) => void;
  view: () => HTMLElement; resetView: () => { signal: AbortSignal }; store: { get(k: string, d: any): any; set(k: string, v: any): void };
  enqueue: (matchId: string, op: any) => void; flush: (matchId: string) => Promise<any>; uid: () => string; day: (iso?: string) => string; when: (iso?: string) => string;
}
const BASE = '/staff/statistics-center/bst-analysis/';
const PNAME: Record<string, string> = { '1H': '1st half', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2' };
const START: Record<string, number> = { '1H': 0, '2H': 45, ET1: 90, ET2: 105 };
const LEN: Record<string, number> = { '1H': 45, '2H': 45, ET1: 15, ET2: 15 };
const blockLabel = (b: string) => { const [x, p] = String(b).split('+'); return p ? `${x}+${p}'` : `${x}'`; };
function blockOf(e: any) {
  if (!(e.period in START)) return null;
  const s = START[e.period], len = LEN[e.period], end = s + len;
  if (e.stoppage) return `${end}+${Math.max(2, Math.ceil(e.stoppage / 2) * 2)}`;
  const rel = e.minute - s;
  return rel >= len ? String(end) : String(s + Math.max(2, Math.ceil(rel / 2) * 2));
}
const blockRange = (period: string, b: string) => {
  const [x, p] = String(b).split('+'); const n = Number(x);
  if (p) return `${x}+${Number(p) - 1}–${x}+${p}'`;
  const end = START[period] + LEN[period];
  return n === end ? `${n}'` : `${Math.max(START[period] + 1, n - 1)}–${n}'`;
};
const ROW_TEST: Record<string, (e: any) => boolean> = {
  shot_on: e => e.type === 'shot' && e.outcome === 'on_target', shot_off: e => e.type === 'shot' && (e.outcome === 'off_target' || e.outcome === 'woodwork'),
  blocked: e => e.type === 'shot' && e.outcome === 'blocked', free_kick: e => e.type === 'free_kick', corner: e => e.type === 'corner', gk_save: e => e.type === 'gk_save',
  foul: e => e.type === 'foul_committed', tackle_won: e => e.type === 'tackle' && e.outcome !== 'lost', offside: e => e.type === 'offside', cards: e => e.type === 'yellow_card' || e.type === 'red_card',
};
const ROW_CREATE: Record<string, any> = { shot_on: { type: 'shot', outcome: 'on_target' }, shot_off: { type: 'shot', outcome: 'off_target' }, blocked: { type: 'shot', outcome: 'blocked' }, free_kick: { type: 'free_kick' },
  corner: { type: 'corner' }, gk_save: { type: 'gk_save' }, foul: { type: 'foul_committed' }, tackle_won: { type: 'tackle', outcome: 'won' }, offside: { type: 'offside' } };

export function bstRoute(c: Ctx) {
  const parts = location.pathname.replace(BASE, '').split('/').filter(Boolean);
  if (!parts.length) return library(c);
  if (parts[0] === 'blank') return printView(c, null);
  applyUi();
  if (parts[1] === 'print') return printView(c, parts[0]);
  if (parts[1] === 'summary') return summaryView(c, parts[0]);
  return form(c, parts[0]);
}

// Dark mode (evening matches) and big buttons (tablets): remembered on this device.
const uiPrefs = () => { try { return JSON.parse(localStorage.getItem('sx_ui') || '{}'); } catch { return {}; } };
export function applyUi() { const p = uiPrefs(); document.documentElement.classList.toggle('sx-dark', !!p.dark); document.documentElement.classList.toggle('sx-big', !!p.big); }
function toggleUi(k: string) { const p = uiPrefs(); p[k] = !p[k]; try { localStorage.setItem('sx_ui', JSON.stringify(p)); } catch { /* blocked */ } applyUi(); }

// ── Library ──
async function library(c: Ctx) {
  const { esc } = c;
  const d = await c.api('bst');
  c.view().innerHTML = `
    <div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">BST Analysis Form</h2><a class="sx-btn" href="${BASE}blank/" target="_blank" rel="noopener">Blank form (print)</a></div>
    <section class="sx-card"><h3>New analysis</h3>
      ${d.matchesWithout.length ? `<form id="bstNew" class="sx-row"><label style="flex:1 1 280px">Match<select name="matchId">${d.matchesWithout.map((m: any) => `<option value="${esc(m.id)}">${esc(m.home)} v ${esc(m.away)} · ${esc(c.day(m.date))}</option>`).join('')}</select></label><button class="sx-btn sx-btn--r" type="submit">Start the analysis</button></form>
        <p class="sx-small">Everything known about the match (teams, date, venue, competition, line-ups, formations) is filled in from Match Setup.</p>`
        : `<p class="sx-small">Every match already has an analysis. <a href="/staff/statistics-center/#/new">Create the match first</a> (New match), then come back.</p>`}
    </section>
    <div class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Date</th><th>Match</th><th>Opponent</th><th>Status</th><th>Last saved</th><th>Prepared by</th><th></th></tr></thead><tbody>
    ${d.analyses.map((a: any) => `<tr><td>${esc(c.day(a.date))}</td><td>${esc(a.home)} v ${esc(a.away)}</td><td>${esc(a.opponent)}</td><td><span class="sx-pill ${a.status === 'final' ? 'published' : 'review'}">${a.status === 'final' ? 'Final' : 'Draft'}</span></td>
      <td>${esc(c.when(a.updatedAt))}</td><td>${esc(a.preparedBy || '')}</td><td><div class="sx-row"><a class="sx-btn sx-btn--p" href="${BASE}${esc(a.id)}/">Open</a><a class="sx-btn" href="${BASE}${esc(a.id)}/print/" target="_blank" rel="noopener">PDF</a>
      <a class="sx-btn" href="/api/stats-centre/export/bst.xlsx?id=${esc(a.id)}">Excel</a>${a.status === 'final' && c.S.user.admin ? `<button class="sx-btn" data-reopen="${esc(a.id)}">Reopen</button>` : ''}${a.status !== 'final' || c.S.user.admin ? `<button class="sx-btn" data-remove="${esc(a.id)}">Remove</button>` : ''}</div></td></tr>`).join('') || '<tr><td colspan="7" class="sx-small">No analyses yet.</td></tr>'}
    </tbody></table></div>`;
  document.getElementById('bstNew')?.addEventListener('submit', async (e: any) => {
    e.preventDefault();
    try { const r = await c.api('bst', { matchId: e.target.matchId.value }); location.href = `${BASE}${r.id}/`; } catch (x: any) { if (x.data?.id) location.href = `${BASE}${x.data.id}/`; else c.toast(x.message, false); }
  });
  c.view().querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Move this analysis to the recycle bin? It can be restored from Settings › Recycle bin.')) return;
    try { await c.api('bst/remove', { id: (b as HTMLElement).dataset.remove }); library(c); } catch (x: any) { c.toast(x.message, false); }
  }));
  c.view().querySelectorAll('[data-reopen]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Reopen this Final analysis for changes?')) return;
    try { await c.api('bst/reopen', { id: (b as HTMLElement).dataset.reopen }); library(c); } catch (x: any) { c.toast(x.message, false); }
  }));
}

// ── The form ──
let hb = 0;
async function form(c: Ctx, id: string) {
  const { esc, api } = c;
  clearInterval(hb);
  let d: any = await api(`bst/one?id=${encodeURIComponent(id)}`);
  const m = d.match, lobiSide = m.lobiHome ? 'home' : 'away';
  const st = c.store.get(`sx_bst_${id}`, { side: 'lobi', lu: 'lobi', sel: null, metric: 0 });
  const qKey = `sx_bq_${id}`;
  let saving = false, lastSaved = d.analysis.updatedAt;
  const locked = () => d.analysis.status === 'final';
  const sideOf = (s: string) => (s === 'lobi' ? lobiSide : lobiSide === 'home' ? 'away' : 'home');
  const teamName = (s: string) => (sideOf(s) === 'home' ? m.home : m.away);
  // The current block from the match clock (or the first block).
  const clockBlock = () => {
    const k = m.clock;
    if (!k || !k.period || !(k.period in START)) return null;
    if (!k.startedAt) return null;
    const ms = (k.pausedAt || Date.now()) - k.startedAt - (k.pausedMs || 0);
    const minute = START[k.period] + Math.floor(ms / 60000) + 1, end = START[k.period] + LEN[k.period];
    return { period: k.period, block: blockOf(minute > end ? { period: k.period, minute: end, stoppage: minute - end } : { period: k.period, minute }) };
  };
  if (!st.sel) st.sel = clockBlock() || { period: '1H', block: '2' };
  const save = () => c.store.set(`sx_bst_${id}`, st);
  const status = (t: string) => { const el = document.getElementById('bstSave'); if (el) el.textContent = t; };
  const pending = () => (c.store.get(qKey, []) as any[]).length;
  const showSaved = () => status(!navigator.onLine && pending() ? 'Offline — will sync' : saving ? 'Saving…' : `Saved ${lastSaved ? new Date(lastSaved).toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos' }) : ''}`);

  async function reload() { d = await api(`bst/one?id=${encodeURIComponent(id)}`); Object.assign(m, d.match); draw(); }
  async function flushCells() {
    if (saving || !navigator.onLine) { showSaved(); return; }
    let q = c.store.get(qKey, []) as any[]; if (!q.length) return;
    saving = true; showSaved();
    try {
      while ((q = c.store.get(qKey, [])).length) {
        const r = await api('bst/cell', { id, ...q[0] });
        lastSaved = r.savedAt;
        c.store.set(qKey, (c.store.get(qKey, []) as any[]).slice(1));
      }
    } catch (x: any) { if (x.status && x.status < 500) { c.toast(x.message, false); c.store.set(qKey, (c.store.get(qKey, []) as any[]).slice(1)); } }
    finally { saving = false; showSaved(); }
  }
  let reloadT = 0;
  const reloadSoon = () => { clearTimeout(reloadT); reloadT = window.setTimeout(() => { if (!pending() && !saving) reload(); }, 900); };

  // One change in the grid: a cell (analyst number) or an event (+ adds one, − removes the latest in that block).
  // Undo / redo (the last 20 changes on this page; Ctrl+Z and Ctrl+Y).
  const hist: any[] = [], redo: any[] = [];
  const label = (h: any) => `${h.delta > 0 ? '+1' : h.delta < 0 ? '−1' : `= ${h.value}`} ${d.metrics.find((x: any) => x.key === h.metric)?.label} · ${teamName(h.side)} · ${blockRange(h.period, h.block)}`;
  async function undo() {
    const h = hist.pop(); if (!h) { c.toast('Nothing to undo.', false); return; }
    redo.push(h);
    if (h.kind === 'cell') await change(h.metric, h.period, h.block, -h.delta, {}, h.side, false);
    else if (h.kind === 'decimal') await change(h.metric, h.period, h.block, 0, { value: h.prev }, h.side, false);
    else if (h.created) { c.enqueue(m.id, { op: 'delete', id: h.created.id }); d.events = d.events.filter((e: any) => e.id !== h.created.id); d.grid[h.side][h.metric][h.period][h.block] = Math.max(0, d.grid[h.side][h.metric][h.period][h.block] - 1); draw(); await c.flush(m.id); reloadSoon(); }
    else if (h.removed) { c.enqueue(m.id, { op: 'restore', id: h.removed.id }); d.events.push(h.removed); d.grid[h.side][h.metric][h.period][h.block]++; draw(); await c.flush(m.id); reloadSoon(); }
    c.toast(`Undone: ${label(h)}`);
  }
  async function redoLast() {
    const h = redo.pop(); if (!h) { c.toast('Nothing to redo.', false); return; }
    await change(h.metric, h.period, h.block, h.delta, h.kind === 'decimal' ? { value: h.value } : h.card ? { card: h.card } : {}, h.side, true, true);
  }
  async function change(metric: string, period: string, block: string, delta: number, extra: any = {}, sd: string = st.side === 'both' ? 'lobi' : st.side, record = true, keepRedo = false) {
    if (locked()) { c.toast('This analysis is Final. A Super Admin can reopen it.', false); return; }
    const kind = d.metrics.find((x: any) => x.key === metric)?.kind;
    const h: any = { metric, period, block, side: sd, kind, delta, card: extra.card, value: extra.value };
    if (record) { if (!keepRedo) redo.length = 0; hist.push(h); if (hist.length > 20) hist.shift(); }
    if (kind === 'cell') {
      const cell = d.grid[sd][metric][period];
      if (delta < 0 && !(cell[block] > 0)) { if (record) hist.pop(); c.toast('Already 0.', false); return; }
      cell[block] = Math.max(0, (cell[block] || 0) + delta);
      const q = c.store.get(qKey, []); q.push({ metric, side: sd, period, block, delta }); c.store.set(qKey, q);
      draw(); await flushCells(); reloadSoon();
      return;
    }
    if (kind === 'decimal') {
      h.prev = d.grid[sd][metric][period][block] || 0;
      const q = c.store.get(qKey, []); q.push({ metric, side: sd, period, block, value: extra.value }); c.store.set(qKey, q);
      d.grid[sd][metric][period][block] = extra.value; draw(); await flushCells(); reloadSoon();
      return;
    }
    if (kind !== 'event') return;
    const side = sideOf(sd);
    if (delta > 0) {
      const tpl = metric === 'cards' ? { type: extra.card === 'red' ? 'red_card' : 'yellow_card' } : ROW_CREATE[metric];
      const [base, plus] = block.split('+').map(Number);
      const ev = { id: c.uid(), side, ...tpl, period, minute: base, stoppage: plus || null, createdAt: new Date().toISOString() };
      c.enqueue(m.id, { op: 'save', event: ev });
      d.events.push(ev); h.created = ev;
    } else {
      const test = ROW_TEST[metric];
      const cand = d.events.filter((e: any) => !e.deleted && e.side === side && e.period === period && blockOf(e) === block && test(e) && !(e.type === 'goal'));
      const last = cand.sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
      if (!last) { if (record) hist.pop(); c.toast(metric === 'shot_on' ? 'Nothing to remove here (goals are removed on the Review page).' : 'Nothing to remove in this block.', false); return; }
      if (last.name && !confirm(`Remove the ${metric.replace('_', ' ')} by ${last.name} at ${last.minute}'?`)) return;
      c.enqueue(m.id, { op: 'delete', id: last.id });
      d.events = d.events.filter((e: any) => e.id !== last.id); h.removed = last;
    }
    d.grid[sd][metric][period][block] = Math.max(0, d.grid[sd][metric][period][block] + delta);
    draw();
    saving = true; showSaved();
    try { const r = await c.flush(m.id); if (r?.results?.some((x: any) => !x.ok)) c.toast(r.results.find((x: any) => !x.ok).error, false); } finally { saving = false; lastSaved = new Date().toISOString(); showSaved(); }
    reloadSoon();
  }

  // Texts: saved 800 ms after typing stops; refused (not overwritten) if someone else saved in between.
  const baseText: Record<string, string> = { overview: d.analysis.overview, half1Note: d.analysis.half1Note, half2Note: d.analysis.half2Note };
  const timers: Record<string, number> = {};
  async function saveText(field: string, value: string, force = false) {
    saving = true; showSaved();
    try {
      const r = await api('bst/text', { id, field, value, baseText: force ? undefined : baseText[field] });
      baseText[field] = value; lastSaved = r.savedAt;
    } catch (x: any) {
      if (x.status === 409) {
        const box = document.getElementById(`conf_${field}`)!;
        box.hidden = false;
        box.innerHTML = `<p class="sx-err">${esc(x.message)}</p><div class="sx-row"><button class="sx-btn" data-keep="mine">Keep my text</button><button class="sx-btn" data-keep="theirs">Use their text</button></div>`;
        box.querySelector('[data-keep=mine]')!.addEventListener('click', () => { box.hidden = true; saveText(field, value, true); });
        box.querySelector('[data-keep=theirs]')!.addEventListener('click', () => { box.hidden = true; baseText[field] = x.data.current; (document.querySelector(`[data-text="${field}"]`) as HTMLTextAreaElement).value = x.data.current; });
      } else c.toast(x.message, false);
    } finally { saving = false; showSaved(); }
  }

  function lineupHtml(side: string): string {
    if (side === 'both') return `<div class="sx-form"><div><b>${esc(teamName('lobi'))}</b>${lineupHtml('lobi')}</div><div><b>${esc(teamName('opponent'))}</b>${lineupHtml('opponent')}</div></div>`;
    const lu = d.lineups.filter((l: any) => l.side === sideOf(side));
    if (!lu.length) return side === 'lobi'
      ? `<p class="sx-err">Complete the line-up in Match Setup. <a href="/staff/statistics-center/#/match/${esc(m.id)}">Open Match Setup</a></p>`
      : `<p class="sx-small">No opponent line-up (optional). <a href="/staff/statistics-center/#/match/${esc(m.id)}">Add it in Match Setup</a></p>`;
    const row = (l: any, i: number) => `<tr><td class="n">${i}</td><td class="n">${esc(l.number ?? '')}</td><td>${esc(l.name)}</td><td>${esc(l.position || '')}</td></tr>`;
    const starters = lu.filter((l: any) => l.starter), res = lu.filter((l: any) => !l.starter);
    return `<table class="sx-t"><thead><tr><th class="n">#</th><th class="n">No.</th><th>Starting XI</th><th>Pos</th></tr></thead><tbody>${starters.map((l: any, i: number) => row(l, i + 1)).join('')}</tbody></table>
      ${res.length ? `<table class="sx-t" style="margin-top:8px"><thead><tr><th class="n">#</th><th class="n">No.</th><th>Reserves</th><th>Pos</th></tr></thead><tbody>${res.map((l: any, i: number) => row(l, i + 12)).join('')}</tbody></table>` : ''}`;
  }
  const fSel = (name: string, cur: string) => {
    const opts = d.formations as string[];
    const custom = cur && !opts.includes(cur);
    return `<label>${name.includes('Finish') ? 'Finishing' : 'Starting'} formation<select data-form="${name}" ${locked() ? 'disabled' : ''}><option value="">—</option>${opts.map(f => `<option ${f === cur ? 'selected' : ''}>${f}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>Custom…</option></select>
      <input data-formc="${name}" placeholder="e.g. 4-1-3-2" value="${esc(custom ? cur : '')}" ${custom ? '' : 'hidden'} pattern="[1-5](-[1-5]){1,4}"></label>`;
  };
  // Momentum: Offence/Attack vs Defense per block, as a small line chart.
  function momentum(side: string) {
    const blocks = d.cols.flatMap((col: any) => col.blocks.map((b: string) => [col.period, b]));
    const a = blocks.map(([p, b]: any) => d.grid[side].offence_attack[p][b]), f = blocks.map(([p, b]: any) => d.grid[side].defense[p][b]);
    const max = Math.max(1, ...a, ...f), W = 600, H = 90, step = W / Math.max(1, blocks.length - 1);
    const line = (v: number[]) => v.map((x, i) => `${(i * step).toFixed(1)},${(H - (x / max) * (H - 6) - 3).toFixed(1)}`).join(' ');
    return `<figure class="bst-mom" aria-label="Momentum: Offence/Attack and Defense per 2-minute block"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" width="100%" height="${H}" role="img">
      <polyline points="${line(a)}" fill="none" stroke="#C8102E" stroke-width="2.5" vector-effect="non-scaling-stroke"/><polyline points="${line(f)}" fill="none" stroke="#1C3F7A" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <figcaption class="sx-small"><span style="color:#C8102E">━</span> Offence/Attack &nbsp; <span style="color:#1C3F7A">━</span> Defense</figcaption></figure>`;
  }

  function draw() {
    const R = c.resetView();
    const side = st.side, both = side === 'both', main = both ? 'lobi' : side, g = d.grid[main], T = d.totals[main], sel = st.sel;
    const cur = clockBlock();
    const allBlocks = d.cols.flatMap((col: any) => col.blocks.map((b: string) => ({ period: col.period, block: b })));
    let si = allBlocks.findIndex((x: any) => x.period === sel.period && x.block === sel.block);
    if (si < 0) { si = 0; st.sel = allBlocks[0]; }
    const S = st.sel;
    const valueCell = (mt: any, sd: string = main) => {
      const v = d.grid[sd][mt.key][S.period][S.block];
      if (mt.kind === 'calc' || mt.kind === 'derived') return `<span class="bst-v ro">${v}</span>`;
      if (mt.kind === 'decimal') return `<input class="bst-dec" type="number" min="0" max="9.99" step="0.01" inputmode="decimal" data-dec="${mt.key}" data-s="${sd}" value="${v ? Number(v).toFixed(2) : ''}" placeholder="0.00" aria-label="${esc(mt.label)}" ${locked() ? 'disabled' : ''}>`;
      if (mt.key === 'cards') return `<button class="bst-pm" data-m="cards" data-s="${sd}" data-d="-1" aria-label="Remove a card" ${locked() ? 'disabled' : ''}>−</button><span class="bst-v">${v}</span><button class="bst-pm" data-card="yellow" data-s="${sd}" aria-label="Add a yellow card" ${locked() ? 'disabled' : ''}>🟨+</button><button class="bst-pm" data-card="red" data-s="${sd}" aria-label="Add a red card" ${locked() ? 'disabled' : ''}>🟥+</button>`;
      return `<button class="bst-pm" data-m="${mt.key}" data-s="${sd}" data-d="-1" aria-label="${esc(mt.label)} minus one (${esc(teamName(sd))})" ${locked() ? 'disabled' : ''}>−</button><span class="bst-v">${v}</span><button class="bst-pm" data-m="${mt.key}" data-s="${sd}" data-d="1" aria-label="${esc(mt.label)} plus one (${esc(teamName(sd))})" ${locked() ? 'disabled' : ''}>+</button>`;
    };
    const lobiF = lobiSide === 'home' ? ['formationHome', 'formationHomeFinish'] : ['formationAway', 'formationAwayFinish'];
    const oppF = lobiSide === 'home' ? ['formationAway', 'formationAwayFinish'] : ['formationHome', 'formationHomeFinish'];
    c.view().innerHTML = `
      <div class="sx-row" style="justify-content:space-between;margin-bottom:8px"><div><h2 style="margin:0">Match analysis: ${esc(m.home)} ${m.homeScore}–${m.awayScore} ${esc(m.away)}</h2>
        <p class="sx-small" style="margin:0">${d.analysis.status === 'final' ? `<span class="sx-pill published">Final</span> by ${esc(d.analysis.finalisedBy || '')} ${esc(c.when(d.analysis.finalisedAt))}` : '<span class="sx-pill review">Draft</span>'} · Prepared by: <b>${esc(d.analysis.preparedBy || c.S.user.fullName)}</b> · <span id="bstSave" aria-live="polite"></span></p></div>
        <div class="sx-row"><button class="sx-btn" data-ui="dark" aria-pressed="${!!uiPrefs().dark}">🌙 Dark</button><button class="sx-btn" data-ui="big" aria-pressed="${!!uiPrefs().big}">Big buttons</button><a class="sx-btn" href="${BASE}${esc(id)}/summary/">Summary</a><a class="sx-btn" href="/staff/statistics-center/#/tag/${esc(m.id)}">Tag players</a><a class="sx-btn" href="${BASE}${esc(id)}/print/${hasOpp() ? '?opponent=1' : ''}" target="_blank" rel="noopener">PDF</a><a class="sx-btn" href="/api/stats-centre/export/bst.xlsx?id=${esc(id)}&opponent=${st.opp || hasOpp() ? 1 : 0}">Excel</a><a class="sx-btn" href="/api/stats-centre/export/bst.csv?id=${esc(id)}">CSV</a></div></div>
      <p class="sx-err" id="bstOthers" ${d.others?.length ? '' : 'hidden'}>${d.others?.length ? `${esc(d.others.map((o: any) => o.name).join(', '))} also has this analysis open. Your numbers are added together safely; agree who writes the overview.` : ''}</p>

      <section class="sx-card"><h3>1 · Match sheet</h3>
        <div class="sx-form">
          <div><p class="sx-small" style="margin:0">Match</p><b>${esc(m.home)} v ${esc(m.away)}</b></div><div><p class="sx-small" style="margin:0">Date and time</p><b>${esc(c.day(m.date))}${m.kickoff ? ` · ${esc(m.kickoff)}` : ''}</b></div>
          <div><p class="sx-small" style="margin:0">Venue</p><b>${esc(m.venue || '—')}</b></div><div><p class="sx-small" style="margin:0">Tournament</p><b>${esc(m.competition)}${m.matchday ? ` · ${esc(m.matchday)}` : ''}</b></div>
        </div>
        <p class="sx-small"><a href="/staff/statistics-center/#/match/${esc(m.id)}">Edit match details</a> · <a href="/staff/statistics-center/#/match/${esc(m.id)}">Edit line-up</a> (in Match Setup, so nothing is entered twice)</p>
        <div class="sx-row" role="group" aria-label="Team list"><button class="sx-btn ${st.lu === 'lobi' ? 'sx-btn--p' : ''}" data-lu="lobi">${esc(teamName('lobi'))}</button><button class="sx-btn ${st.lu === 'opponent' ? 'sx-btn--p' : ''}" data-lu="opponent">${esc(teamName('opponent'))}</button><button class="sx-btn ${st.lu === 'both' ? 'sx-btn--p' : ''}" data-lu="both">Both side by side</button></div><p class="sx-small"><a href="/staff/statistics-center/#/match/${esc(m.id)}">Edit opponent line-up</a> (optional)</p>
        <div class="sx-scroll" style="margin-top:10px">${lineupHtml(st.lu)}</div>
        <div class="sx-form" style="margin-top:12px"><div><b>${esc(teamName('lobi'))}</b>${fSel(lobiF[0], m[lobiF[0]] || '')}${fSel(lobiF[1], m[lobiF[1]] || '')}</div><div><b>${esc(teamName('opponent'))}</b>${fSel(oppF[0], m[oppF[0]] || '')}${fSel(oppF[1], m[oppF[1]] || '')}</div></div>
      </section>

      <section class="sx-card"><div class="sx-row" style="justify-content:space-between"><h3 style="margin:0">2 · Match data collection</h3>
        <div class="sx-row" role="group" aria-label="Team"><button class="sx-btn ${side === 'lobi' ? 'sx-btn--p' : ''}" data-side="lobi">${esc(teamName('lobi'))}</button><button class="sx-btn ${side === 'opponent' ? 'sx-btn--p' : ''}" data-side="opponent">${esc(teamName('opponent'))}</button><button class="sx-btn ${both ? 'sx-btn--p' : ''}" data-side="both">Both</button></div></div>
        <div class="bst-clock" aria-label="Match clock"><span>Clock: <b>${esc(clockText())}</b></span>${locked() ? '' : clockButtons()}</div>
        <div class="bst-block"><button class="sx-btn" data-step="-1" aria-label="Previous block">◀</button><div><b>${esc(PNAME[S.period])} · ${esc(blockRange(S.period, S.block))}</b>${cur && cur.period === S.period && cur.block === S.block ? ' <span class="sx-pill live">now</span>' : ''}${cur && !(cur.period === S.period && cur.block === S.block) ? ` <button class="sx-btn" data-now style="min-height:34px;padding:2px 10px">Go to now</button>` : ''}</div><button class="sx-btn" data-step="1" aria-label="Next block">▶</button></div>
        ${both ? `<p class="bst-bothhead"><span></span><b>${esc(teamName('lobi'))}</b><b>${esc(teamName('opponent'))}</b></p>` : ''}<ul class="bst-list${both ? ' both' : ''}">${d.metrics.map((mt: any, i: number) => `<li class="${mt.kind === 'calc' || mt.kind === 'derived' ? 'ro' : ''}${st.metric === i ? ' focus' : ''}" data-mi="${i}"><span class="bst-l">${esc(mt.label)}</span><span class="bst-c">${valueCell(mt, main)}</span>${both ? `<span class="bst-c">${valueCell(mt, 'opponent')}</span>` : ''}<span class="bst-t" title="Match total">${both ? `${d.totals.lobi[mt.key].full}–${d.totals.opponent[mt.key].full}` : T[mt.key].full}</span></li>`).join('')}</ul>
        <p class="sx-small">The event rows are the match's events (shared with live entry): a + adds one at ${esc(blockRange(S.period, S.block))} with no player (add the player later on the Review page); a − removes the latest one in this block. Grey rows are worked out. Keyboard: ← → blocks, ↑ ↓ rows, + and − to change.</p>
        <div class="sx-scroll bst-gridwrap"><table class="bst-grid"><thead><tr><th class="bst-sticky">Metric</th>${d.cols.map((col: any) => col.blocks.map((b: string) => `<th class="${col.period === S.period && b === S.block ? 'sel' : ''}${cur && cur.period === col.period && cur.block === b ? ' now' : ''}"><button data-pick="${col.period}|${b}" aria-label="${esc(PNAME[col.period])} ${esc(blockLabel(b))}">${esc(blockLabel(b))}</button></th>`).join('') + `<th class="tot">${col.period}</th>`).join('')}<th class="tot">Total</th>${both ? '<th class="tot">Lobi − Opp</th>' : ''}</tr></thead>
          <tbody>${d.metrics.map((mt: any) => `<tr class="${mt.kind === 'calc' || mt.kind === 'derived' ? 'ro' : ''}"><th class="bst-sticky">${esc(mt.label)}</th>${d.cols.map((col: any) => col.blocks.map((b: string) => { const v = g[mt.key][col.period][b]; return `<td class="${col.period === S.period && b === S.block ? 'sel' : ''}">${v ? (mt.kind === 'decimal' ? Number(v).toFixed(2) : v) : ''}</td>`; }).join('') + `<td class="tot">${T[mt.key][col.period] || ''}</td>`).join('')}<td class="tot"><b>${T[mt.key].full || ''}</b></td>${both ? '<td class="tot"></td>' : ''}</tr>${both ? `<tr class="opp${mt.kind === 'calc' || mt.kind === 'derived' ? ' ro' : ''}"><th class="bst-sticky">↳ ${esc(teamName('opponent'))}</th>${d.cols.map((col: any) => col.blocks.map((b: string) => { const v = d.grid.opponent[mt.key][col.period][b]; return `<td class="${col.period === S.period && b === S.block ? 'sel' : ''}">${v ? (mt.kind === 'decimal' ? Number(v).toFixed(2) : v) : ''}</td>`; }).join('') + `<td class="tot">${d.totals.opponent[mt.key][col.period] || ''}</td>`).join('')}<td class="tot"><b>${d.totals.opponent[mt.key].full || ''}</b></td><td class="tot diff">${Math.round((d.totals.lobi[mt.key].full - d.totals.opponent[mt.key].full) * 100) / 100}</td></tr>` : ''}`).join('')}</tbody></table></div>
        <div class="sx-row" style="margin-top:8px">${d.cols.map((col: any) => `<span class="sx-small">${esc(PNAME[col.period])} added time:</span><button class="sx-btn" data-stop="${col.period}|1" ${locked() ? 'disabled' : ''}>+ Add stoppage block</button>${d.stoppage[col.period] ? `<button class="sx-btn" data-stop="${col.period}|-1" ${locked() ? 'disabled' : ''}>Remove last</button>` : ''}`).join('')}</div>
      </section>

      <section class="sx-card"><div class="sx-row" style="justify-content:space-between"><h3 style="margin:0">Recent changes</h3><div class="sx-row"><button class="sx-btn" id="bstUndo" ${hist.length && !locked() ? '' : 'disabled'}>↶ Undo</button><button class="sx-btn" id="bstRedo" ${redo.length && !locked() ? '' : 'disabled'}>↷ Redo</button></div></div>
        <ol class="bst-hist">${hist.slice().reverse().map((h: any) => `<li>${esc(label(h))}</li>`).join('') || '<li class="sx-small">Your changes on this page appear here (last 20). Ctrl+Z undoes, Ctrl+Y redoes.</li>'}</ol></section>

      <section class="sx-card"><h3>Summary</h3>
        <div class="sx-kpis">${d.cols.map((col: any) => `<div class="sx-kpi"><b>${T.goal_attempt[col.period]}</b><span>Goal attempts · ${esc(PNAME[col.period])}</span></div>`).join('')}
          <div class="sx-kpi"><b>${T.goal_attempt.full}</b><span>Goal attempts · match</span></div><div class="sx-kpi"><b>${T.shot_on.full}</b><span>On target</span></div>
          <div class="sx-kpi"><b>${d.accuracy[side] === null ? '—' : `${d.accuracy[side]}%`}</b><span>Shot accuracy</span></div><div class="sx-kpi"><b>${T.goal_for.full}–${T.goal_against.full}</b><span>Goals for – against</span></div>
          <div class="sx-kpi"><b>${T.xg.full.toFixed ? T.xg.full.toFixed(2) : T.xg.full}</b><span>xG</span></div></div>
        ${momentum(side)}
      </section>

      <section class="sx-card"><h3>Game overview</h3>
        <label class="sx-small" for="tOverview">Saved by itself as you type</label><textarea id="tOverview" data-text="overview" maxlength="20000" ${locked() ? 'disabled' : ''}>${esc(d.analysis.overview)}</textarea><div id="conf_overview" hidden></div>
        <div class="sx-form" style="margin-top:10px"><label>1st half note<textarea data-text="half1Note" maxlength="20000" ${locked() ? 'disabled' : ''}>${esc(d.analysis.half1Note)}</textarea><div id="conf_half1Note" hidden></div></label>
          <label>2nd half note<textarea data-text="half2Note" maxlength="20000" ${locked() ? 'disabled' : ''}>${esc(d.analysis.half2Note)}</textarea><div id="conf_half2Note" hidden></div></label></div>
      </section>

      <section class="sx-card"><h3>Data quality</h3>
        <ul class="sx-check">${d.quality.map((q: any, i: number) => `<li class="${q.level === 'error' ? 'e' : q.level === 'warning' ? 'w' : 'ok'}">${q.level === 'error' ? '✖' : q.level === 'warning' ? '⚠' : 'ℹ'} ${esc(q.text)} ${q.link ? `<button class="sx-btn" data-q="${i}" style="min-height:32px;padding:2px 10px">${q.link.tag ? 'Tag players' : q.link.setup ? 'Match Setup' : 'Show'}</button>` : ''}</li>`).join('') || '<li class="ok">✔ No problems found.</li>'}</ul></section>

      <section class="sx-card"><h3>Share with the coach</h3>
        <p class="sx-small">A private, read-only link to this analysis for the head coach: no sign-in, no editing, not on Google. It stops working on the date you choose, or when you switch it off.</p>
        <div class="sx-row"><label>Valid for<select id="shDays">${[1, 3, 7, 14, 21, 30].map(n => `<option value="${n}" ${n === 14 ? 'selected' : ''}>${n} day${n > 1 ? 's' : ''}</option>`).join('')}</select></label>
          <label class="sx-small" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="shNotes"> Include staff notes (half notes)</label><button class="sx-btn sx-btn--p" id="shMake">Make a link</button></div>
        <div id="shNew"></div><div id="shList" class="sx-scroll"></div></section>

      <section class="sx-card"><h3>Final</h3>
        <ul class="sx-check">${d.checks.errors.map((x: string) => `<li class="e">✖ ${esc(x)}</li>`).join('')}${d.checks.notices.map((x: string) => `<li class="w">ℹ ${esc(x)}</li>`).join('')}${d.checks.ok ? '<li class="ok">✔ Line-up, score, minutes and formations are in order.</li>' : ''}</ul>
        <div class="sx-row" style="margin-top:10px">${locked() ? (c.S.user.admin ? '<button class="sx-btn" id="bstReopen">Reopen (Super Admin)</button>' : '<p class="sx-small" style="margin:0">Final: read only. A Super Admin can reopen it.</p>')
          : `<button class="sx-btn sx-btn--ok" id="bstFinal" ${d.checks.ok ? '' : 'disabled'}>Mark as Final</button>`}
          <label class="sx-small" style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="bstOpp" ${st.opp ? 'checked' : ''}> Include the opponent in the Excel file</label></div>
      </section>`;
    showSaved();
    const v = c.view();
    v.addEventListener('click', async (e: any) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.lu) { st.lu = t.dataset.lu; save(); draw(); }
      else if (t.dataset.side) { st.side = t.dataset.side; save(); draw(); }
      else if (t.dataset.step) { const n = Math.max(0, Math.min(allBlocks.length - 1, si + Number(t.dataset.step))); st.sel = allBlocks[n]; save(); draw(); }
      else if (t.hasAttribute('data-now')) { const k = clockBlock(); if (k) { st.sel = k; save(); draw(); } }
      else if (t.dataset.pick) { const [p, b] = t.dataset.pick.split('|'); st.sel = { period: p, block: b }; save(); draw(); }
      else if (t.dataset.m) change(t.dataset.m, S.period, S.block, Number(t.dataset.d), {}, t.dataset.s || main);
      else if (t.dataset.card) change('cards', S.period, S.block, 1, { card: t.dataset.card }, t.dataset.s || main);
      else if (t.dataset.ui) { toggleUi(t.dataset.ui); draw(); }
      else if (t.dataset.clock) {
        if (t.dataset.clock === 'full_time' && !confirm('Full time?')) return;
        try { await api('match/clock', { id: m.id, action: t.dataset.clock, at: Date.now() }); await reload(); } catch (x: any) { c.toast(x.message, false); }
      }
      else if (t.dataset.q !== undefined) {
        const q = d.quality[Number(t.dataset.q)]; const L = q?.link || {};
        if (L.tag) location.href = `/staff/statistics-center/#/tag/${m.id}`;
        else if (L.setup) location.href = `/staff/statistics-center/#/match/${m.id}`;
        else if (L.event) location.href = `/staff/statistics-center/#/review/${m.id}`;
        else if (L.block) { st.sel = { period: L.period, block: L.block }; save(); draw(); document.querySelector('.bst-block')?.scrollIntoView({ behavior: 'smooth' }); }
      }
      else if (t.id === 'bstUndo') undo();
      else if (t.id === 'bstRedo') redoLast();
      else if (t.id === 'shMake') {
        try {
          const r = await api('bst/share', { id, days: Number((document.getElementById('shDays') as HTMLSelectElement).value), includeNotes: (document.getElementById('shNotes') as HTMLInputElement).checked });
          document.getElementById('shNew')!.innerHTML = `<p class="sx-note"><input readonly value="${esc(r.url)}" style="flex:1 1 300px" aria-label="Coach link"><button class="sx-btn" id="shCopy">Copy</button><a class="sx-btn" href="https://wa.me/?text=${encodeURIComponent(`Match analysis: ${m.home} v ${m.away} ${r.url}`)}" target="_blank" rel="noopener">WhatsApp</a></p><p class="sx-small">Valid until ${esc(c.when(r.expiresAt))}. Copy it now: it is shown only once.</p>`;
          document.getElementById('shCopy')!.addEventListener('click', () => { navigator.clipboard?.writeText(r.url).then(() => c.toast('Copied.')); });
          loadShares();
        } catch (x: any) { c.toast(x.message, false); }
      }
      else if (t.dataset.shoff) { if (!confirm('Switch this link off? The coach can no longer open it.')) return; try { await api('bst/share-revoke', { shareId: t.dataset.shoff }); loadShares(); } catch (x: any) { c.toast(x.message, false); } }
      else if (t.dataset.stop) {
        const [p, dl] = t.dataset.stop.split('|');
        const n = (d.stoppage[p] || 0) + Number(dl);
        if (Number(dl) < 0) { const last = `${START[p] + LEN[p]}+${(d.stoppage[p]) * 2}`; if (d.metrics.some((mt: any) => d.grid.lobi[mt.key][p][last] || d.grid.opponent[mt.key][p][last])) { c.toast('That block has data: it cannot be removed.', false); return; } }
        try { await api('bst/stoppage', { id, period: p, count: n }); reload(); } catch (x: any) { c.toast(x.message, false); }
      } else if (t.id === 'bstFinal') {
        if (!confirm('Mark as Final? The analysis becomes read only.')) return;
        try { await api('bst/final', { id }); c.toast('Marked as Final.'); reload(); } catch (x: any) { c.toast(x.message, false); }
      } else if (t.id === 'bstReopen') { try { await api('bst/reopen', { id }); reload(); } catch (x: any) { c.toast(x.message, false); } }
    }, R);
    v.addEventListener('change', async (e: any) => {
      const t = e.target;
      if (t.id === 'bstOpp') { st.opp = t.checked; save(); draw(); return; }
      if (t.dataset.dec) {
        const val = t.value === '' ? 0 : Number(t.value);
        if (!(val >= 0 && val <= 9.99)) { c.toast('xG and xA are from 0.00 to 9.99.', false); return; }
        change(t.dataset.dec, S.period, S.block, 0, { value: Math.round(val * 100) / 100 }, t.dataset.s || main);
        return;
      }
      if (t.dataset.form || t.dataset.formc) {
        const name = t.dataset.form || t.dataset.formc;
        const sel = v.querySelector(`[data-form="${name}"]`) as HTMLSelectElement, inp = v.querySelector(`[data-formc="${name}"]`) as HTMLInputElement;
        if (t.dataset.form) { inp.hidden = sel.value !== 'custom'; if (sel.value === 'custom') { inp.focus(); return; } }
        const value = sel.value === 'custom' ? inp.value.trim() : sel.value;
        if (value && !/^[1-5](-[1-5]){1,4}$/.test(value)) { c.toast('Write the formation like 4-4-2.', false); return; }
        // Formations belong to the shared line-up (the same one as Match Setup and the Media Centre).
        try { const sideF = /Home/.test(name) ? 'home' : 'away'; const ver = await api(`lineup/version?id=${encodeURIComponent(m.id)}&side=${sideF}`); await api('lineup/changes', { id: m.id, side: sideF, baseVersion: ver.version, changes: [{ op: /Finish$/.test(name) ? 'formation_finish' : 'formation', value }] }); m[name] = value; d.checks = (await api(`bst/one?id=${encodeURIComponent(id)}`)).checks; lastSaved = new Date().toISOString(); showSaved(); draw(); } catch (x: any) { c.toast(x.message, false); }
      }
    }, R);
    v.addEventListener('input', (e: any) => {
      const t = e.target; const f = t.dataset.text; if (!f) return;
      status('Saving…'); clearTimeout(timers[f]); timers[f] = window.setTimeout(() => saveText(f, t.value), 800);
    }, R);
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (/input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redoLast(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redoLast(); return; }
      const mt = d.metrics[st.metric];
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = Math.max(0, Math.min(allBlocks.length - 1, si + (e.key === 'ArrowRight' ? 1 : -1))); st.sel = allBlocks[n]; save(); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { st.metric = Math.max(0, Math.min(d.metrics.length - 1, st.metric + (e.key === 'ArrowDown' ? 1 : -1))); save(); draw(); e.preventDefault(); }
      else if ((e.key === '+' || e.key === '=' || e.key === '-') && mt && (mt.kind === 'cell' || (mt.kind === 'event' && mt.key !== 'cards'))) { change(mt.key, S.period, S.block, e.key === '-' ? -1 : 1, {}, main); e.preventDefault(); }
    }, R);
    loadShares();
  }
  function hasOpp() { return d.metrics.some((mt: any) => d.totals.opponent[mt.key].full) || d.lineups.some((l: any) => l.side !== lobiSide); }
  // The match clock (the same clock as live entry: stored on the server, so a refresh never loses it).
  function clockText() {
    const k = m.clock; if (!k || !k.period) return 'not started';
    const names: any = { '1H': '1st half', HT: 'Half-time', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2', PEN: 'Penalties', FT: 'Full time' };
    if (!k.startedAt) return names[k.period] || k.period;
    const ms = (k.pausedAt || Date.now()) - k.startedAt - (k.pausedMs || 0), end = START[k.period] + LEN[k.period], mi = START[k.period] + Math.floor(ms / 60000) + 1;
    return `${names[k.period]} · ${mi > end ? `${end}+${mi - end}` : mi}'${k.pausedAt ? ' (paused)' : ''}`;
  }
  function clockButtons() {
    const k = m.clock || {}, b = (a: string, t: string) => `<button class="sx-btn" data-clock="${a}">${t}</button>`;
    const run = k.pausedAt ? b('resume', 'Resume') : b('pause', 'Pause');
    return !k.period ? b('start_1h', 'Kick-off') : k.period === '1H' ? run + b('half_time', 'Half-time') : k.period === 'HT' ? b('start_2h', 'Start 2nd half')
      : k.period === '2H' ? run + b('full_time', 'Full time') + b('start_et1', 'Extra time') : k.period === 'ET1' ? run + b('start_et2', 'ET 2nd half') : k.period === 'ET2' ? run + b('full_time', 'Full time') : '';
  }
  async function loadShares() {
    const box = document.getElementById('shList'); if (!box) return;
    try {
      const { shares } = await api(`bst/shares?id=${encodeURIComponent(id)}`);
      box.innerHTML = shares.length ? `<table class="sx-t"><thead><tr><th>Made</th><th>Valid until</th><th>Notes</th><th>Opened</th><th></th></tr></thead><tbody>${shares.map((x: any) => `<tr><td>${esc(c.when(x.createdAt))}<br><small class="sx-small">${esc(x.createdBy || '')}</small></td><td>${esc(c.when(x.expiresAt))}</td><td>${x.includeNotes ? 'yes' : 'no'}</td><td>${x.opens}×</td><td>${x.active ? `<button class="sx-btn" data-shoff="${esc(x.id)}">Switch off</button>` : `<span class="sx-pill">${x.revokedAt ? 'switched off' : 'expired'}</span>`}</td></tr>`).join('')}</tbody></table>` : '';
    } catch { /* offline */ }
  }
  draw();
  flushCells();
  // Who else has it open, and newer changes made by someone else.
  const beat = async () => {
    try {
      const r = await api('bst/presence', { id });
      const el = document.getElementById('bstOthers');
      if (el) { el.hidden = !r.others.length; el.textContent = r.others.length ? `${r.others.join(', ')} also has this analysis open. Your numbers are added together safely; agree who writes the overview.` : ''; }
      if (r.version !== d.analysis.version && !pending() && !saving && !document.activeElement?.matches('textarea,input')) { await reload(); if (r.updatedBy && !String(r.updatedBy).startsWith(c.S.user.fullName)) c.toast(`Updated by ${r.updatedBy}`); }
    } catch { /* offline: try again later */ }
  };
  beat();
  hb = window.setInterval(() => { if (!location.pathname.startsWith(`${BASE}${id}`)) { clearInterval(hb); return; } beat(); flushCells(); }, 20000);
  window.addEventListener('online', () => flushCells(), { once: true });
}

// ── Print: the Lobi Stars match analysis report (2 pages, A4 landscape) and the blank form ──
async function printView(c: Ctx, id: string | null) {
  const { esc } = c;
  const d: any = id ? await c.api(`bst/one?id=${encodeURIComponent(id)}`) : null;
  const meta = id ? null : await c.api('bst');
  const metrics = d ? d.metrics : meta.metrics;
  const includeOpp = new URLSearchParams(location.search).get('opponent') === '1';
  const m = d?.match;
  const season = m?.season || c.S.season;
  const cols = d ? d.cols : [{ period: '1H', blocks: [...Array.from({ length: 22 }, (_, i) => String((i + 1) * 2)), '45', '45+2', '45+4'] }, { period: '2H', blocks: [...Array.from({ length: 22 }, (_, i) => String(45 + (i + 1) * 2)), '90', '90+2', '90+4'] }];
  const draft = d && d.analysis.status !== 'final';
  const lobiSide = m ? (m.lobiHome ? 'home' : 'away') : 'home';
  const sideName = (s: string) => (!m ? (s === 'lobi' ? 'Lobi Stars FC' : 'Opponent') : (s === 'lobi') === (lobiSide === 'home') ? m.home : m.away);
  const blank = (w = 160) => `<span class="bstp-line" style="min-width:${w}px"></span>`;
  const foot = `<footer class="bstp-foot"><span>Lobi Stars Statistics Center</span><span>${d ? `Prepared by ${esc(d.analysis.preparedBy || '')}` : 'Prepared by ____________________'}</span><span>Generated ${esc(new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></footer>`;
  const head = `<header class="bstp-head"><img src="/images/lobi-stars-badge.webp" alt="" width="56" height="56"><div><p>Lobi Stars FC · Pride of Benue</p><h1>Lobi Stars Match Analysis Report – ${esc(season)}</h1></div></header>`;
  const luTable = (s: string) => {
    const lu = d ? d.lineups.filter((l: any) => (l.side === lobiSide) === (s === 'lobi')) : [];
    const st = lu.filter((l: any) => l.starter), rs = lu.filter((l: any) => !l.starter);
    const rows = (list: any[], from: number, n: number) => Array.from({ length: n }, (_, i) => { const l = list[i]; return `<tr><td>${from + i}</td><td>${l ? esc(l.number ?? '') : ''}</td><td>${l ? esc(l.name) : ''}</td><td>${l ? esc(l.position || '') : ''}</td></tr>`; }).join('');
    return `<table class="bstp-t"><thead><tr><th>#</th><th>No.</th><th>${esc(sideName(s))}</th><th>Pos</th></tr></thead><tbody>${rows(st, 1, 11)}<tr class="sep"><td colspan="4">Reserves</td></tr>${rows(rs, 12, 9)}</tbody></table>`;
  };
  const f = (k: string) => (m ? esc(m[k] || '—') : blank(90));
  const grid = (s: string) => `<h3>${esc(sideName(s))}</h3>` + cols.map((col: any) => `<table class="bstp-g"><thead><tr><th class="mt">${esc(PNAME[col.period])}</th>${col.blocks.map((b: string) => `<th>${esc(blockLabel(b))}</th>`).join('')}<th class="tot">Total</th></tr></thead><tbody>
    ${metrics.map((mt: any) => `<tr class="${mt.kind === 'calc' || mt.kind === 'derived' ? 'ro' : ''}"><th class="mt">${esc(mt.label)}</th>${col.blocks.map((b: string) => { const v = d ? d.grid[s][mt.key][col.period][b] : 0; return `<td>${v ? (mt.kind === 'decimal' ? Number(v).toFixed(2) : v) : ''}</td>`; }).join('')}<td class="tot">${d ? (d.totals[s][mt.key][col.period] || '') : ''}</td></tr>`).join('')}</tbody></table>`).join('')
    + (d ? `<p class="bstp-tot">Match totals: ${metrics.map((mt: any) => `${esc(mt.label)} ${d.totals[s][mt.key].full}`).join(' · ')}</p>` : '');
  const sides = d && (includeOpp || d.lineups.some((l: any) => l.side !== lobiSide)) && includeOpp ? ['lobi', 'opponent'] : ['lobi'];
  document.body.classList.add('bstp-body');
  c.view().innerHTML = `<div class="bstp">
    <p class="sx-noprint sx-row" style="margin:0 0 12px"><button class="sx-btn sx-btn--p" onclick="window.print()">Print / Save as PDF</button>${d ? `<a class="sx-btn" href="?opponent=${includeOpp ? 0 : 1}">${includeOpp ? 'Without' : 'With'} the opponent</a><a class="sx-btn" href="${BASE}${esc(id!)}/">Back to the form</a>` : `<a class="sx-btn" href="${BASE}">Back</a>`}<span class="sx-small">Choose "Landscape" and "Save as PDF" in the print window.</span></p>
    ${draft ? '<div class="bstp-wm" aria-hidden="true">DRAFT</div>' : ''}
    <section class="bstp-page">${head}
      <table class="bstp-info"><tr><th>Match</th><td>${m ? `${esc(m.home)} ${m.homeScore}–${m.awayScore} ${esc(m.away)}` : `Lobi Stars FC vs ${blank(200)}`}</td><th>Date</th><td>${m ? esc(c.day(m.date)) : blank(110)}</td><th>Time</th><td>${m ? esc(m.kickoff || '—') : blank(70)}</td></tr>
        <tr><th>Venue</th><td>${m ? esc(m.venue || '—') : blank(200)}</td><th>Tournament</th><td colspan="3">${m ? esc(m.competition) : blank(200)}</td></tr></table>
      <div class="bstp-cols"><div>${luTable('lobi')}<p class="bstp-form">Starting formation: <b>${lobiSide === 'home' ? f('formationHome') : f('formationAway')}</b> · Finishing formation: <b>${lobiSide === 'home' ? f('formationHomeFinish') : f('formationAwayFinish')}</b></p></div>
        ${sides.includes('opponent') ? `<div>${luTable('opponent')}<p class="bstp-form">Starting formation: <b>${lobiSide === 'home' ? f('formationAway') : f('formationHome')}</b> · Finishing: <b>${lobiSide === 'home' ? f('formationAwayFinish') : f('formationHomeFinish')}</b></p></div>` : ''}
        <div class="bstp-ov"><h3>Game overview</h3><div class="bstp-box">${d ? esc(d.analysis.overview).replace(/\n/g, '<br>') : ''}</div>
          ${d && (d.analysis.half1Note || d.analysis.half2Note) ? `<h3>1st half</h3><div class="bstp-box sm">${esc(d.analysis.half1Note).replace(/\n/g, '<br>')}</div><h3>2nd half</h3><div class="bstp-box sm">${esc(d.analysis.half2Note).replace(/\n/g, '<br>')}</div>` : ''}</div></div>
      ${foot}</section>
    <section class="bstp-page">${head}<h2>Match data collection</h2>${sides.map(grid).join('')}
      ${d ? `<div class="bstp-mom">${(() => { const s = 'lobi'; const blocks = d.cols.flatMap((col: any) => col.blocks.map((b: string) => [col.period, b])); const a = blocks.map(([p, b]: any) => d.grid[s].offence_attack[p][b]), fd = blocks.map(([p, b]: any) => d.grid[s].defense[p][b]); const max = Math.max(1, ...a, ...fd), W = 900, H = 70, step = W / Math.max(1, blocks.length - 1); const line = (v: number[]) => v.map((x, i) => `${(i * step).toFixed(1)},${(H - (x / max) * (H - 6) - 3).toFixed(1)}`).join(' '); return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}"><polyline points="${line(a)}" fill="none" stroke="#C8102E" stroke-width="2"/><polyline points="${line(fd)}" fill="none" stroke="#1C3F7A" stroke-width="2"/></svg><p class="bstp-tot"><span style="color:#C8102E">━</span> Offence/Attack <span style="color:#1C3F7A">━</span> Defense (Lobi Stars, per 2-minute block)</p>`; })()}</div>` : ''}
      ${foot}</section></div>`;
}

// ── Auto-summary (staff): halves, accuracy, attack vs defence, momentum, strongest and weakest 10-minute spells,
// set pieces, and Lobi Stars vs the opponent ──
async function summaryView(c: Ctx, id: string) {
  const { esc } = c;
  const d: any = await c.api(`bst/one?id=${encodeURIComponent(id)}`);
  const m = d.match, lobiSide = m.lobiHome ? 'home' : 'away';
  const name = (s: string) => ((s === 'lobi') === (lobiSide === 'home') ? m.home : m.away);
  const T = d.totals, blocks = d.cols.flatMap((col: any) => col.blocks.map((b: string) => [col.period, b]));
  const pressure = (s: string, p: string, b: string) => d.grid[s].offence_attack[p][b] + d.grid[s].dangerous_attack[p][b] + d.grid[s].goal_attempt[p][b];
  // 10-minute spells = 5 blocks in a row (within a half): Lobi pressure minus the opponent's.
  const spells: any[] = [];
  for (const col of d.cols) for (let i = 0; i + 5 <= col.blocks.length; i++) {
    const bs = col.blocks.slice(i, i + 5); const v = bs.reduce((a: number, b: string) => a + pressure('lobi', col.period, b) - pressure('opponent', col.period, b), 0);
    spells.push({ period: col.period, from: bs[0], to: bs[4], v });
  }
  const best = spells.slice().sort((a, b) => b.v - a.v)[0], worst = spells.slice().sort((a, b) => a.v - b.v)[0];
  const share = (s: string) => { const a = T[s].offence_attack.full, f = T[s].defense.full; return a + f ? Math.round((a / (a + f)) * 100) : null; };
  const compare = ['goal_attempt', 'shot_on', 'shot_off', 'blocked', 'corner', 'free_kick', 'offence_attack', 'dangerous_attack', 'crossing', 'foul', 'cards', 'offside'];
  const lbl = (k: string) => d.metrics.find((x: any) => x.key === k)?.label || k;
  const bar = (k: string) => { const a = T.lobi[k].full, b = T.opponent[k].full, t = a + b || 1;
    return `<div class="sxm-bar2"><span>${esc(lbl(k))}</span><b>${a}</b><div class="sxm-track2" aria-hidden="true"><i style="width:${(a / t) * 100}%"></i><i style="width:${(b / t) * 100}%"></i></div><b>${b}</b></div>`; };
  const mom = (() => { const a = blocks.map(([p, b]: any) => pressure('lobi', p, b)), o = blocks.map(([p, b]: any) => pressure('opponent', p, b)); const max = Math.max(1, ...a, ...o), W = 800, H = 120, st = W / Math.max(1, blocks.length - 1);
    const line = (v: number[]) => v.map((x, i) => `${(i * st).toFixed(1)},${(H - (x / max) * (H - 8) - 4).toFixed(1)}`).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" role="img" aria-label="Momentum per 2-minute block"><polyline points="${line(a)}" fill="none" stroke="#C8102E" stroke-width="2.5" vector-effect="non-scaling-stroke"/><polyline points="${line(o)}" fill="none" stroke="#1C3F7A" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>
      <p class="sx-small"><span style="color:#C8102E">━</span> ${esc(name('lobi'))} &nbsp; <span style="color:#1C3F7A">━</span> ${esc(name('opponent'))} (attacks + dangerous attacks + goal attempts, per 2-minute block)</p>`; })();
  const rng = (x: any) => x ? `${x.period === '1H' ? '1st half' : x.period === '2H' ? '2nd half' : x.period} ${Number(String(x.from).split('+')[0]) - 1}'–${x.to}'` : '—';
  c.view().innerHTML = `<h2>Summary: ${esc(m.home)} ${m.homeScore}–${m.awayScore} ${esc(m.away)}</h2>
    <div class="sx-kpis">${d.cols.map((col: any) => `<div class="sx-kpi"><b>${T.lobi.goal_attempt[col.period]}–${T.opponent.goal_attempt[col.period]}</b><span>Goal attempts · ${col.period}</span></div>`).join('')}
      <div class="sx-kpi"><b>${d.accuracy.lobi === null ? '—' : `${d.accuracy.lobi}%`}</b><span>Lobi shot accuracy</span></div><div class="sx-kpi"><b>${share('lobi') === null ? '—' : `${share('lobi')}%`}</b><span>Attack share (attack ÷ attack + defence)</span></div>
      <div class="sx-kpi"><b>${T.lobi.corner.full + T.lobi.free_kick.full}</b><span>Lobi set pieces (corners + free kicks)</span></div><div class="sx-kpi"><b>${Number(T.lobi.xg.full).toFixed(2)}</b><span>Lobi xG</span></div></div>
    <section class="sx-card" style="margin-top:16px"><h3>Momentum</h3>${mom}
      <p><b>Strongest 10 minutes:</b> ${esc(rng(best))} · <b>Weakest 10 minutes:</b> ${esc(rng(worst))}</p></section>
    <section class="sx-card"><h3>${esc(name('lobi'))} v ${esc(name('opponent'))}</h3><div class="sxm-bars2">${compare.map(bar).join('')}</div></section>
    <section class="sx-card sx-scroll"><h3>Totals per half</h3><table class="sx-t"><thead><tr><th>Metric</th>${d.cols.map((col: any) => `<th class="n">${col.period} ${esc(name('lobi'))}</th><th class="n">${col.period} ${esc(name('opponent'))}</th>`).join('')}<th class="n">Match</th></tr></thead><tbody>
      ${d.metrics.map((mt: any) => `<tr><td>${esc(mt.label)}</td>${d.cols.map((col: any) => `<td class="n">${T.lobi[mt.key][col.period]}</td><td class="n">${T.opponent[mt.key][col.period]}</td>`).join('')}<td class="n"><b>${T.lobi[mt.key].full}–${T.opponent[mt.key].full}</b></td></tr>`).join('')}</tbody></table></section>`;
}

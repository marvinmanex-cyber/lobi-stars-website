// Statistics Center › professional add-ons (staff only): pass entry, advanced match and season numbers, goalkeepers,
// injury and availability, training load and wellness, player development, milestones, versioned definitions,
// branded reports and opposition packs, practice matches and coach (view-only) accounts.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Ctx } from './bst';
import { pitchSvg, pickOnPitch } from './phase2';
import { fx, club } from './fx';

const W = 105, H = 68;
const PN: Record<string, string> = { '1H': '1st half', '2H': '2nd half', ET1: 'Extra time 1', ET2: 'Extra time 2' };
const num = (v: any, d = '—') => (v === null || v === undefined || v === '' ? d : String(v));
const ro = (c: Ctx) => !!c.S.user.readOnly;
const lobiOf = (m: any) => (m.lobiHome ? 'home' : 'away');

/** Extra buttons for a match's header (Passes, Advanced, Report). */
export function matchLinks(c: Ctx, m: any) {
  return `<a class="sx-btn" href="#/passes/${c.esc(m.id)}">Passes</a><a class="sx-btn" href="#/advanced/${c.esc(m.id)}">Advanced</a><a class="sx-btn" href="/api/stats-centre/report/match.html?id=${encodeURIComponent(m.id)}" target="_blank" rel="noopener">Match report (PDF)</a>`;
}

// ── 1. Pass entry (after the match, from video or notes) ──
export async function passesView(c: Ctx, id: string) {
  const { api, esc, toast, view, S, uid } = c;
  const d = await api(`match?id=${encodeURIComponent(id)}`);
  const m = d.match, ls = lobiOf(m), os = ls === 'home' ? 'away' : 'home', locked = m.status === 'published' || ro(c);
  const team = c.store.get('sx_pass_side', ls);
  const people = (side: string) => { const lu = d.lineups.filter((l: any) => l.side === side); return lu.length ? lu : side === ls ? S.roster : []; };
  const opt = (side: string) => people(side).map((p: any) => `<option value="${esc(p.slug || `n:${p.name}`)}">${esc(p.number ? `${p.number}. ` : '')}${esc(p.name)}</option>`).join('');
  const passes = d.events.filter((e: any) => e.type === 'pass');
  const P = d.derived.players.filter((p: any) => p.passes);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><div><h2 style="margin:0"><span class="sx-h2pre">Passes</span>${fx(m.home, m.away, `${m.homeScore}–${m.awayScore}`)}</h2><p class="sx-small" style="margin:0">Recorded after the match (from the video or notes). ${passes.length} passes so far.</p></div>
      <div class="sx-row"><a class="sx-btn" href="#/review/${esc(m.id)}">Review</a><a class="sx-btn" href="#/advanced/${esc(m.id)}">Advanced</a></div></div>
    ${locked ? `<p class="sx-note">${ro(c) ? 'Coach accounts view only.' : 'This match is published. Reopen it on the Review page to add passes.'}</p>` : `
    <form class="sx-card" id="pf"><h3>Add a pass</h3>
      <div class="sx-row"><label>Team<select name="side"><option value="${ls}" ${team === ls ? 'selected' : ''}>${esc(ls === 'home' ? m.home : m.away)}</option><option value="${os}" ${team === os ? 'selected' : ''}>${esc(os === 'home' ? m.home : m.away)}</option></select></label>
        <label>Half<select name="period">${Object.entries(PN).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label><label>Minute<input name="minute" type="number" min="0" max="130" required style="width:6em"></label></div>
      <div class="sx-row"><label>From<select name="from" data-people></select></label><label>Result<select name="outcome"><option value="complete">Complete</option><option value="incomplete">Lost / not received</option></select></label><label>To<select name="to" data-people><option value="">—</option></select></label></div>
      <div id="pitchBox" style="margin-top:10px"></div>
      <p class="sx-small">Tap where the pass started, then where it ended (the team attacking →). "Skip" saves it without positions.</p>
      <div class="sx-row"><button class="sx-btn sx-btn--p" type="submit">Pick positions and save</button></div></form>`}
    <section class="sx-card sx-scroll"><h3>Passing by player</h3><table class="sx-t"><thead><tr><th>Player</th><th class="n">Passes</th><th class="n">Complete</th><th class="n">%</th><th class="n">Progressive</th><th class="n">Final third</th><th class="n">Into box</th></tr></thead><tbody>
      ${P.map((p: any) => `<tr><td>${esc(p.name)} <small class="sx-small">${esc(p.side === 'home' ? m.home : m.away)}</small></td><td class="n">${p.passes}</td><td class="n">${p.passesComplete}</td><td class="n">${p.passes ? Math.round((p.passesComplete / p.passes) * 100) : ''}</td><td class="n">${p.progressivePasses}</td><td class="n">${p.finalThirdPasses}</td><td class="n">${p.boxPasses}</td></tr>`).join('') || '<tr><td class="sx-small" colspan="7">No passes yet.</td></tr>'}</tbody></table></section>
    <section class="sx-card sx-scroll"><h3>Recorded passes</h3><table class="sx-t"><tbody>${passes.slice().reverse().slice(0, 80).map((e: any) => `<tr><td>${e.minute}'</td><td>${esc(e.name || '?')} → ${esc(e.relatedName || (e.outcome === 'incomplete' ? 'lost' : '?'))}</td><td>${e.outcome === 'incomplete' ? 'Lost' : 'Complete'}</td><td class="sx-small">${e.x !== null ? `${Math.round(e.x)},${Math.round(e.y)} → ${num(e.endX && Math.round(e.endX))},${num(e.endY && Math.round(e.endY))}` : 'no position'}</td><td>${locked ? '' : `<button class="sx-btn" data-del="${esc(e.id)}">Remove</button>`}</td></tr>`).join('') || '<tr><td class="sx-small">None yet.</td></tr>'}</tbody></table></section>`;
  const f = view().querySelector('#pf') as HTMLFormElement | null;
  const fill = () => { if (!f) return; const side = (f.side as any).value; for (const s of f.querySelectorAll('[data-people]')) { const first = (s as HTMLSelectElement).name === 'to' ? '<option value="">—</option>' : ''; s.innerHTML = first + opt(side); } };
  fill();
  f?.side.addEventListener('change', () => { c.store.set('sx_pass_side', (f.side as any).value); fill(); });
  f?.addEventListener('submit', async e => {
    e.preventDefault();
    const side = (f.side as any).value, from = (f.from as any).value, to = (f.to as any).value, outcome = (f.outcome as any).value;
    if (!from) return toast('Choose who passed.', false);
    const box = view().querySelector('#pitchBox') as HTMLElement;
    const a = await pickOnPitch(box, { teamAttacksRight: true, teamName: 'Start of the pass:' });
    const b = a ? await pickOnPitch(box, { teamAttacksRight: true, teamName: 'End of the pass:' }) : null;
    box.innerHTML = '';
    const who = (v: string) => (v.startsWith('n:') ? { slug: null, name: v.slice(2) } : { slug: v, name: people(side).find((p: any) => p.slug === v)?.name || '' });
    const p = who(from), r = to ? who(to) : { slug: null, name: null };
    const ev = { id: uid(), side, type: 'pass', period: (f.period as any).value, minute: Number((f.minute as any).value), outcome, slug: p.slug, name: p.name, relatedSlug: r.slug, relatedName: r.name, x: a?.x ?? null, y: a?.y ?? null, endX: b?.x ?? null, endY: b?.y ?? null };
    try { const res = await api('match/events', { id, ops: [{ op: 'save', event: ev }] }); const bad = res.results?.find((x: any) => !x.ok); if (bad) return toast(bad.error, false); toast('Pass saved.'); passesView(c, id); } catch (x: any) { toast(x.message, false); }
  });
  view().querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => { try { await api('match/events', { id, ops: [{ op: 'delete', id: (btn as HTMLElement).dataset.del }] }); passesView(c, id); } catch (x: any) { toast(x.message, false); } }));
}

// ── 2–3. Advanced numbers and goalkeepers ──
function networkSvg(c: Ctx, net: any) {
  if (!net.nodes.length) return '<p class="sx-small">Needs passes or actions with positions.</p>';
  const at = new Map(net.nodes.map((n: any) => [n.slug, n]));
  const max = Math.max(1, ...net.links.map((l: any) => l.passes));
  const lines = net.links.filter((l: any) => at.has(l.from) && at.has(l.to)).map((l: any) => { const a: any = at.get(l.from), b: any = at.get(l.to); return `<line x1="${(a.x * W) / 100}" y1="${(a.y * H) / 100}" x2="${(b.x * W) / 100}" y2="${(b.y * H) / 100}" stroke="#FFC72C" stroke-opacity="${0.35 + 0.6 * (l.passes / max)}" stroke-width="${0.3 + 1.6 * (l.passes / max)}"/>`; }).join('');
  const dots = net.nodes.map((n: any) => `<circle cx="${(n.x * W) / 100}" cy="${(n.y * H) / 100}" r="${1.6 + Math.min(2.4, n.actions / 10)}" fill="#123A7A" stroke="#fff" stroke-width=".4"><title>${c.esc(n.name)}: ${n.actions} actions</title></circle><text x="${(n.x * W) / 100}" y="${(n.y * H) / 100 - 3.2}" font-size="2.4" text-anchor="middle" fill="#fff">${c.esc(String(n.name).split(' ').slice(-1)[0])}</text>`).join('');
  return pitchSvg(lines + dots, { label: 'Pass network' }) + '<p class="sx-small">Average position of each player\'s actions; thicker lines = more passes between the two.</p>';
}
const gsTable = (c: Ctx, gs: any) => `<table class="sx-t"><thead><tr><th>When we were</th><th class="n">Minutes</th><th class="n">Scored</th><th class="n">Conceded</th><th class="n">xG for</th><th class="n">xG against</th></tr></thead><tbody>${['winning', 'drawing', 'losing'].map(k => `<tr><td>${k[0].toUpperCase() + k.slice(1)}</td><td class="n">${Math.round(gs[k].minutes)}</td><td class="n">${gs[k].gf}</td><td class="n">${gs[k].ga}</td><td class="n">${gs[k].xgf}</td><td class="n">${gs[k].xga}</td></tr>`).join('')}</tbody></table>`;
const gkTable = (c: Ctx, ks: any[]) => `<table class="sx-t"><thead><tr><th>Goalkeeper</th><th class="n">On target faced</th><th class="n">Saves</th><th class="n">Save %</th><th class="n">Goals prevented</th><th class="n">Distribution</th></tr></thead><tbody>${ks.map(k => `<tr><td>${c.esc(k.keepers?.join(', ') || k.name || k.team || '')}<br><small class="sx-small">${c.esc(k.team || '')}</small></td><td class="n">${k.shotsOnTargetFaced}</td><td class="n">${k.saves}</td><td class="n">${num(k.savePct)}</td><td class="n"><b>${k.goalsPrevented > 0 ? '+' : ''}${k.goalsPrevented}</b></td><td class="n">${k.distribution ? `${k.distribution.complete}/${k.distribution.passes}${k.distribution.long ? ` · long ${k.distribution.longComplete}/${k.distribution.long}` : ''}` : '—'}</td></tr>`).join('')}</tbody></table>`;
export async function advancedView(c: Ctx, id: string) {
  const { api, esc, view } = c;
  const d = await api(`match/advanced?id=${encodeURIComponent(id)}`);
  const m = d.match, a = d.advanced, ls = a.lobiSide, os = ls === 'home' ? 'away' : 'home', nm = (s: string) => (s === 'home' ? m.home : m.away);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><div><h2 style="margin:0"><span class="sx-h2pre">Advanced</span>${fx(m.home, m.away, `${m.homeScore}–${m.awayScore}`)}</h2><p class="sx-small" style="margin:0">Worked out from the recorded events. Definitions version ${esc(m.definitionsVersion ?? 1)}.</p></div><div class="sx-row">${matchLinks(c, m)}<a class="sx-btn" href="#/review/${esc(m.id)}">Review</a></div></div>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      <div class="sx-card"><small class="sx-small">Expected points</small><h3 style="margin:4px 0">${a.expected.xPts} <small class="sx-small">(got ${a.expected.actualPoints})</small></h3><p class="sx-small">Win ${Math.round(a.expected.win * 100)}% · draw ${Math.round(a.expected.draw * 100)}% · loss ${Math.round(a.expected.loss * 100)}%</p></div>
      <div class="sx-card"><small class="sx-small">Field tilt</small><h3 style="margin:4px 0">${a.fieldTilt ? `${a.fieldTilt.lobi}%` : '—'}</h3><p class="sx-small">${a.fieldTilt ? `From ${esc(a.fieldTilt.source)}` : 'Needs positions or passes'}</p></div>
      <div class="sx-card"><small class="sx-small">Pressing (PPDA)</small><h3 style="margin:4px 0">${a.ppda ? a.ppda.value : '—'}</h3><p class="sx-small">${a.ppda ? (a.ppda.approximate ? 'Approximate (no positions)' : 'Lower = more pressing') : 'Needs opponent passes and our tackles/interceptions'}</p></div>
      <div class="sx-card"><small class="sx-small">Shot quality (xG per shot)</small><h3 style="margin:4px 0">${num(a.quality[ls].xgPerShot)} <small class="sx-small">v ${num(a.quality[os].xgPerShot)}</small></h3><p class="sx-small">Big chances ${a.quality[ls].bigChances} v ${a.quality[os].bigChances}</p></div>
    </div>
    <section class="sx-card sx-scroll"><h3>Passing</h3><table class="sx-t"><thead><tr><th>Team</th><th class="n">Passes</th><th class="n">Complete</th><th class="n">%</th><th class="n">Progressive</th><th class="n">Final third</th><th class="n">Into box</th></tr></thead><tbody>
      ${['home', 'away'].map(s => `<tr><td>${esc(nm(s))}</td><td class="n">${a.passing[s].passes}</td><td class="n">${a.passing[s].complete}</td><td class="n">${num(a.passing[s].completion)}</td><td class="n">${a.passing[s].progressive}</td><td class="n">${a.passing[s].finalThird}</td><td class="n">${a.passing[s].box}</td></tr>`).join('')}</tbody></table>
      ${a.passPossession ? `<p class="sx-small">Possession from recorded passes: ${a.passPossession.home}% – ${a.passPossession.away}%</p>` : ''}<p><a class="sx-btn" href="#/passes/${esc(m.id)}">Add or check passes</a></p></section>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"><section class="sx-card"><h3>Pass network (Lobi Stars)</h3>${networkSvg(c, a.network)}</section><section class="sx-card sx-scroll"><h3>Game state</h3>${gsTable(c, a.gameState)}<p class="sx-small">How the match went while we were winning, drawing or losing.</p></section></div>
    <section class="sx-card sx-scroll"><h3>Goalkeepers</h3>${gkTable(c, a.keepers)}<p class="sx-small">Goals prevented = xG of the shots on target faced − goals conceded (above 0: better than an average keeper).</p></section>`;
}
export async function seasonAdvancedView(c: Ctx) {
  const { api, esc, view, S, store } = c;
  const sel = store.get('sx_sa', S.season);
  const d = await api(`season-advanced?season=${encodeURIComponent(sel)}`);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Advanced season numbers · ${esc(sel)}</h2><label>Season<select data-s>${S.seasons.map((s: string) => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label></div>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
      <div class="sx-card"><small class="sx-small">Points v expected</small><h3 style="margin:4px 0">${d.expected.points} <small class="sx-small">v ${d.expected.xPts} xPts</small></h3><p class="sx-small">${d.expected.points > d.expected.xPts ? 'Doing better than the chances suggest' : d.expected.points < d.expected.xPts ? 'Doing worse than the chances suggest' : 'In line with the chances'}</p></div>
      <div class="sx-card"><small class="sx-small">Average field tilt</small><h3 style="margin:4px 0">${num(d.fieldTilt)}${d.fieldTilt !== null ? '%' : ''}</h3></div>
      <div class="sx-card"><small class="sx-small">Average PPDA</small><h3 style="margin:4px 0">${num(d.ppda)}</h3></div>
      <div class="sx-card"><small class="sx-small">Passes completed</small><h3 style="margin:4px 0">${d.passing.complete}/${d.passing.passes}</h3><p class="sx-small">${d.passing.progressive} progressive · ${d.passing.box} into the box</p></div>
    </div>
    <section class="sx-card sx-scroll"><h3>Match by match</h3><table class="sx-t"><thead><tr><th>Date</th><th>Opponent</th><th class="n">Score</th><th class="n">xG</th><th class="n">xPts</th><th class="n">Points</th><th class="n">Tilt</th><th class="n">PPDA</th><th></th></tr></thead><tbody>
      ${d.expected.byMatch.map((x: any) => `<tr><td>${esc(c.day(x.date))}</td><td>${club(x.opponent)}</td><td class="n">${esc(x.score)}</td><td class="n">${x.xgFor}–${x.xgAgainst}</td><td class="n">${x.xPts}</td><td class="n">${x.points}</td><td class="n">${num(x.tilt)}</td><td class="n">${num(x.ppda)}</td><td><a class="sx-btn" href="#/advanced/${esc(x.id)}">Open</a></td></tr>`).join('') || '<tr><td class="sx-small" colspan="9">No published matches yet.</td></tr>'}</tbody></table></section>
    <section class="sx-card sx-scroll"><h3>Game state (season)</h3>${gsTable(c, d.gameState)}</section>
    <section class="sx-card sx-scroll"><h3>Goalkeepers (season)</h3>${d.keepers.length ? gkTable(c, d.keepers) : '<p class="sx-small">No data yet.</p>'}</section>`;
  view().querySelector('[data-s]')?.addEventListener('change', (e: any) => { store.set('sx_sa', e.target.value); seasonAdvancedView(c); });
}

// ── 4. Injury and availability ──
export async function markAvailability(c: Ctx, root: HTMLElement) {
  try {
    const d = await c.api(`availability?season=${encodeURIComponent(c.S.season)}`);
    for (const card of root.querySelectorAll('.sx-pcard[data-slug]')) {
      const a = d.players[(card as HTMLElement).dataset.slug!];
      if (!a) continue;
      card.classList.add('sx-unavail');
      const tag = document.createElement('small'); tag.className = 'sx-avtag'; tag.textContent = `${a.label || 'Suspended'}${a.reason ? `: ${a.reason}` : ''}`;
      (card.querySelector('.sx-pinfo') || card).appendChild(tag);
      (card as HTMLElement).title = `${a.label || 'Suspended'}${a.expectedReturn ? ` · back ${a.expectedReturn}` : ''}`;
    }
  } catch { /* the picker works without it */ }
}
export async function availabilityView(c: Ctx) {
  const { api, esc, toast, view, S } = c;
  const d = await api(`availability?season=${encodeURIComponent(S.season)}`);
  const L = S.pro?.avail || {};
  const roster = [...S.roster].sort((a: any, b: any) => (a.number ?? 99) - (b.number ?? 99));
  view().innerHTML = `<h2>Injuries &amp; availability</h2><p class="sx-small">Who cannot play. Suspensions from red cards and every ${d.yellowBan}th yellow card (published matches) are added automatically. Unavailable players are marked on the line-up picker.</p>
    <section class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Player</th><th>Status</th><th>Reason</th><th>Expected back</th><th class="n">Yellows</th>${ro(c) ? '' : '<th></th>'}</tr></thead><tbody>
      ${roster.map((p: any) => { const a = d.players[p.slug]; return `<tr data-slug="${esc(p.slug)}"><td>${esc(p.number ? `${p.number}. ` : '')}${esc(p.name)}</td><td>${a ? `<b class="sx-err">${esc(a.label || 'Suspended')}</b>${a.auto ? ' <small class="sx-small">(automatic)</small>' : ''}` : '<span class="sx-small">Available</span>'}</td><td class="sx-small">${esc(a?.reason || '')}</td><td class="sx-small">${esc(a?.expectedReturn || '')}</td><td class="n">${d.yellows[p.slug] || ''}</td>
        ${ro(c) ? '' : `<td><button class="sx-btn" data-set>Change</button></td>`}</tr>`; }).join('')}</tbody></table></section>
    <dialog id="avDlg" class="sx-card" style="max-width:420px"><form method="dialog" id="avF"><h3 id="avT"></h3>
      <label>Status<select name="status"><option value="available">Available</option>${Object.entries(L).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label>
      <label>Reason (e.g. hamstring)<input name="reason" maxlength="120"></label><label>From<input type="date" name="from"></label><label>Expected back<input type="date" name="expectedReturn"></label><label>Notes (staff only)<input name="notes" maxlength="300"></label>
      <div class="sx-row" style="margin-top:10px"><button class="sx-btn sx-btn--p" value="save">Save</button><button class="sx-btn" value="cancel" formnovalidate>Cancel</button></div></form></dialog>
    ${S.user.canPublish ? `<section class="sx-card"><h3>Yellow-card suspensions</h3><p class="sx-small">A player is suspended for one match after this many yellow cards (each time).</p><div class="sx-row"><input type="number" id="yb" min="2" max="15" value="${d.yellowBan}" style="width:6em"><button class="sx-btn" id="ybSave">Save</button></div></section>` : ''}
    <section class="sx-card sx-scroll"><h3>History</h3><table class="sx-t"><tbody>${d.history.slice(0, 30).map((h: any) => `<tr><td>${esc(S.roster.find((p: any) => p.slug === h.slug)?.name || h.slug)}</td><td>${esc(L[h.status] || h.status)}</td><td class="sx-small">${esc(h.reason || '')}</td><td class="sx-small">${esc(h.from || '')}${h.clearedAt ? ` → ${esc(String(h.clearedAt).slice(0, 10))}` : ' (current)'}</td></tr>`).join('') || '<tr><td class="sx-small">Nothing yet.</td></tr>'}</tbody></table></section>`;
  const dlg = view().querySelector('#avDlg') as HTMLDialogElement, f = view().querySelector('#avF') as HTMLFormElement;
  let slug = '';
  view().querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => { slug = (b.closest('tr') as HTMLElement).dataset.slug!; const a = d.players[slug]; (view().querySelector('#avT') as HTMLElement).textContent = S.roster.find((p: any) => p.slug === slug)?.name || slug; f.reset(); if (a && !a.auto) { (f.status as any).value = a.status; (f.reason as any).value = a.reason || ''; (f.expectedReturn as any).value = a.expectedReturn || ''; } dlg.showModal(); }));
  dlg.addEventListener('close', async () => { if (dlg.returnValue !== 'save') return; const fd = Object.fromEntries(new FormData(f) as any); try { await api('availability', { slug, ...fd }); toast('Saved.'); availabilityView(c); } catch (x: any) { toast(x.message, false); } });
  view().querySelector('#ybSave')?.addEventListener('click', async () => { try { await api('availability/yellow-ban', { n: (view().querySelector('#yb') as HTMLInputElement).value }); toast('Saved.'); availabilityView(c); } catch (x: any) { toast(x.message, false); } });
}

// ── 5. Training load and wellness ──
export async function wellnessView(c: Ctx) {
  const { api, esc, toast, view, S } = c;
  const d = await api('wellness');
  const by = new Map(d.players.map((p: any) => [p.slug, p]));
  const roster = [...S.roster].sort((a: any, b: any) => (a.number ?? 99) - (b.number ?? 99));
  view().innerHTML = `<h2>Training load &amp; wellness</h2><p class="sx-small">Each player gets a private link for their phone. After every session they rate how hard it was (1–10) and how they feel (sleep, soreness, energy, stress, mood). Load = effort × minutes. <b>Ratio</b> = the last 7 days ÷ the usual week (last 28 days): over 1.5 is a sudden jump and an injury risk. Health information: staff only, kept 2 years.</p>
    <section class="sx-card sx-scroll"><table class="sx-t"><thead><tr><th>Player</th><th class="n">7-day load</th><th class="n">Usual week</th><th class="n">Ratio</th><th class="n">Feeling (1–5)</th><th>Alerts</th><th>Link</th></tr></thead><tbody>
      ${roster.map((p: any) => { const w: any = by.get(p.slug) || {}; return `<tr data-slug="${esc(p.slug)}"><td>${esc(p.name)}${w.latestDate ? `<br><small class="sx-small">Last check-in ${esc(w.latestDate)}</small>` : ''}</td><td class="n">${num(w.acute, '')}</td><td class="n">${num(w.chronic, '')}</td><td class="n">${w.ratio === null || w.ratio === undefined ? '' : `<b class="${w.ratio > 1.5 ? 'sx-err' : ''}">${w.ratio}</b>`}</td><td class="n">${num(w.wellness, '')}</td>
        <td class="sx-small">${(w.flags || []).map((f: string) => `<span class="sx-err">⚠ ${esc(f)}</span>`).join('<br>')}</td>
        <td>${ro(c) ? (w.link ? 'Active' : '') : `<button class="sx-btn" data-link>${w.link ? 'New link' : 'Make link'}</button>${w.link ? ' <button class="sx-btn" data-off>Switch off</button>' : ''}`}</td></tr>`; }).join('')}</tbody></table></section><div id="wlOut"></div>`;
  view().querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', async () => {
    const slug = (b.closest('tr') as HTMLElement).dataset.slug!, name = S.roster.find((p: any) => p.slug === slug)?.name || '';
    if ((b as HTMLElement).textContent === 'New link' && !confirm('Make a new link? The old one stops working.')) return;
    try {
      const r = await api('wellness/link', { slug });
      const msg = `Hi ${name.split(' ')[0]}, this is your private Lobi Stars check-in link. Please fill it in after every session (30 seconds): ${r.url}`;
      (view().querySelector('#wlOut') as HTMLElement).innerHTML = `<section class="sx-card"><h3>Link for ${esc(name)}</h3><p class="sx-note"><input readonly value="${esc(r.url)}" style="flex:1 1 320px"><button class="sx-btn" id="wlCopy">Copy</button><a class="sx-btn sx-btn--p" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Send on WhatsApp</a></p><p class="sx-small">Shown once. Send it only to the player.</p></section>`;
      view().querySelector('#wlCopy')?.addEventListener('click', () => navigator.clipboard?.writeText(r.url).then(() => toast('Copied.')));
    } catch (x: any) { toast(x.message, false); }
  }));
  view().querySelectorAll('[data-off]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Switch this player\'s link off?')) return; try { await api('wellness/revoke', { slug: (b.closest('tr') as HTMLElement).dataset.slug }); wellnessView(c); } catch (x: any) { toast(x.message, false); } }));
}

// ── 7. Player development ──
function radarSvg(c: Ctx, items: any[]) {
  const n = items.length, cx = 60, cy = 60, R = 44;
  if (!n) return '';
  const pt = (i: number, v: number) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
  const ring = (v: number) => items.map((_, i) => pt(i, v).map(x => x.toFixed(1)).join(',')).join(' ');
  const poly = items.map((it, i) => pt(i, (it.percentile ?? 0) / 100).map(x => x.toFixed(1)).join(',')).join(' ');
  const labels = items.map((it, i) => { const [x, y] = pt(i, 1.2); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="4.6" text-anchor="middle" dominant-baseline="middle" fill="currentColor">${c.esc(it.label)}</text>`; }).join('');
  return `<svg viewBox="-12 -6 144 132" role="img" aria-label="Radar: percentile against the squad" style="max-width:420px;color:var(--ink,#16181D)">${[0.25, 0.5, 0.75, 1].map(v => `<polygon points="${ring(v)}" fill="none" stroke="#C9CED8" stroke-width=".4"/>`).join('')}${items.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#C9CED8" stroke-width=".4"/>`; }).join('')}
    <polygon points="${poly}" fill="#1C3F7A" fill-opacity=".35" stroke="#1C3F7A" stroke-width="1"/>${labels}</svg>`;
}
export async function developmentView(c: Ctx, slug: string) {
  const { api, esc, toast, view, S } = c;
  if (!slug) {
    view().innerHTML = `<h2>Player development</h2><section class="sx-card"><div class="sx-pcards">${S.roster.map((p: any) => `<a class="sx-btn" href="#/development/${esc(p.slug)}">${esc(p.name)}</a>`).join(' ')}</div></section>`;
    return;
  }
  const d = await api(`development?slug=${encodeURIComponent(slug)}&season=${encodeURIComponent(S.season)}`);
  const can = !ro(c);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">${esc(d.name)} · development</h2><div class="sx-row"><a class="sx-btn" href="#/player/${esc(slug)}">Player page</a><a class="sx-btn" href="#/development">All players</a></div></div>
    <div class="sx-grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <section class="sx-card"><h3>Compared with the squad (${esc(d.group)})</h3>${d.peers ? radarSvg(c, d.radar) : ''}<p class="sx-small">Percentile against the ${d.peers} squad ${esc(d.group)} player(s) with at least 180 minutes this season (per 90 minutes). ${d.minutes < 180 ? 'Fewer than 180 minutes so far: the picture will settle with more games.' : ''}</p>
        <table class="sx-t"><thead><tr><th>Measure</th><th class="n">Per 90</th><th class="n">Squad average</th><th class="n">Percentile</th></tr></thead><tbody>${d.radar.map((r: any) => `<tr><td>${esc(r.label)}</td><td class="n">${r.per90}</td><td class="n">${num(r.squadAverage)}</td><td class="n">${num(r.percentile)}</td></tr>`).join('')}</tbody></table></section>
      <section class="sx-card"><h3>Targets</h3>${d.targets.map((t: any) => `<div style="margin:0 0 12px"><div class="sx-row" style="justify-content:space-between"><b>${esc(t.label)}: ${t.current} / ${t.target}</b>${can ? `<button class="sx-btn" data-rm="${esc(t.id)}">Remove</button>` : ''}</div>
        <div style="height:10px;background:#E6EAF2;border-radius:5px;overflow:hidden"><div style="height:100%;width:${t.progress}%;background:${t.progress >= 100 ? '#2E7D32' : '#1C3F7A'}"></div></div><small class="sx-small">${esc(t.season)}${t.deadline ? ` · by ${esc(t.deadline)}` : ''}${t.note ? ` · ${esc(t.note)}` : ''} · set by ${esc(t.by)}</small></div>`).join('') || '<p class="sx-small">No targets yet.</p>'}
        ${can ? `<form id="tf" class="sx-row" style="margin-top:8px"><label>Measure<select name="metric">${Object.entries(d.metrics).map(([k, t]) => `<option value="${k}">${esc(t)}</option>`).join('')}</select></label><label>Target<input name="target" type="number" min="1" max="9999" required style="width:6em"></label><label>By (optional)<input name="deadline" type="date"></label><label>Note<input name="note" maxlength="200"></label><button class="sx-btn sx-btn--p" type="submit">Add target</button></form>` : ''}</section></div>`;
  view().querySelector('#tf')?.addEventListener('submit', async (e: any) => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target) as any); try { await api('targets', { ...fd, slug, season: S.season }); toast('Target added.'); developmentView(c, slug); } catch (x: any) { toast(x.message, false); } });
  view().querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', async () => { if (!confirm('Remove this target?')) return; try { await api('targets', { remove: (b as HTMLElement).dataset.rm }); developmentView(c, slug); } catch (x: any) { toast(x.message, false); } }));
}

// ── 8. Milestones and records ──
export async function milestonesView(c: Ctx) {
  const { api, esc, toast, view } = c;
  const d = await api('milestones');
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Milestones &amp; records</h2>${ro(c) ? '' : '<button class="sx-btn" id="msRefresh">Check again</button>'}</div>
    <p class="sx-small">Found automatically each time a match is published: first appearance and goal, 50/100/150… appearances, 10/25/50… goals, hat-tricks, clean-sheet milestones, and club records from the recorded matches (wins in a row, unbeaten runs, clean sheets in a row, biggest win). Copy the text for the Media Centre or social media. Youth players are not shown on the public pages unless allowed.</p>
    <section class="sx-card sx-scroll"><table class="sx-t"><tbody>${d.milestones.map((x: any, i: number) => `<tr><td>${esc(c.day(x.on))}</td><td><b>${esc(x.title)}</b><br><small class="sx-small">${esc(x.detail || '')}${x.kind === 'record' ? ' · club record' : ''}</small></td><td><button class="sx-btn" data-copy="${i}">Copy post</button></td></tr>`).join('') || '<tr><td class="sx-small">None yet: they appear when matches are published.</td></tr>'}</tbody></table></section>`;
  view().querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => { const x = d.milestones[Number((b as HTMLElement).dataset.copy)]; const t = `🌟 ${x.title} ${x.detail ? `(${x.detail})` : ''} #LobiStars #ThePrideOfBenue`; navigator.clipboard?.writeText(t).then(() => toast('Copied.')); }));
  view().querySelector('#msRefresh')?.addEventListener('click', async () => { try { const r = await api('milestones/refresh', {}); toast(r.fresh.length ? `${r.fresh.length} new.` : 'Nothing new.'); milestonesView(c); } catch (x: any) { toast(x.message, false); } });
}

// ── 12. Definitions with versions ──
export async function definitionsProView(c: Ctx) {
  const { api, esc, toast, view, S } = c;
  const d = await api('definitions');
  const can = S.user.canPublish && !ro(c);
  view().innerHTML = `<div class="sx-row" style="justify-content:space-between;margin-bottom:12px"><h2 style="margin:0">Stat definitions · version ${d.current}</h2>${can ? '<button class="sx-btn" id="defEdit">Change definitions…</button>' : ''}</div>
    <p class="sx-small">Each match keeps the version it was recorded under (shown on its Advanced page and report), so a change never silently alters how old matches were counted.</p>
    <section class="sx-card" id="defList"><dl>${d.items.map((x: any) => `<dt><b>${esc(x.label)}</b></dt><dd style="margin:0 0 12px" data-k="${esc(x.key)}">${esc(x.text)}</dd>`).join('')}</dl></section>
    <section class="sx-card"><h3>Versions</h3><table class="sx-t"><tbody>${d.history.map((v: any) => `<tr><td>Version ${v.version}</td><td>${esc(String(v.created_at).slice(0, 10))}</td><td>${esc(v.note || '')}</td><td class="sx-small">${esc(v.created_by || '')}</td></tr>`).join('')}</tbody></table></section>`;
  view().querySelector('#defEdit')?.addEventListener('click', () => {
    const list = view().querySelector('#defList') as HTMLElement;
    list.innerHTML = `<form id="defF">${d.items.map((x: any) => `<label><b>${esc(x.label)}</b><textarea name="${esc(x.key)}" rows="3">${esc(x.text)}</textarea></label>`).join('')}<label>What changed and why (kept with the version)<input name="__note" required maxlength="300"></label><div class="sx-row" style="margin-top:10px"><button class="sx-btn sx-btn--p" type="submit">Save as version ${d.current + 1}</button></div></form>`;
    list.querySelector('#defF')?.addEventListener('submit', async (e: any) => {
      e.preventDefault(); const fd: any = Object.fromEntries(new FormData(e.target) as any); const note = fd.__note; delete fd.__note;
      const changes: any = {}; for (const x of d.items) if (fd[x.key] !== x.text) changes[x.key] = fd[x.key];
      try { const r = await api('definitions', { changes, note }); toast(`Saved as version ${r.version}.`); definitionsProView(c); } catch (x: any) { toast(x.message, false); }
    });
  });
}

// ── 6. Opposition pack ──
export async function oppositionPackView(c: Ctx) {
  const { api, esc, view } = c;
  const d = await api('opponents');
  view().innerHTML = `<h2>Opposition pack (PDF)</h2><p class="sx-small">A club-branded, printable report on a club from our recorded matches against them: results, when goals come, formations, set pieces, key players, what worked for us and the scouting notes. Opens in a new tab: use "Save as PDF / print", then send it on WhatsApp or email.</p>
    <section class="sx-card"><div class="sx-row">${(d.opponents || []).map((o: any) => `<a class="sx-btn" target="_blank" rel="noopener" href="/api/stats-centre/report/opposition.html?team=${encodeURIComponent(o.name || o.opponent || o.team)}">${esc(o.name || o.opponent || o.team)}</a>`).join(' ') || '<span class="sx-small">No opponents recorded yet.</span>'}</div>
    <form class="sx-row" style="margin-top:12px" id="opF"><label>Another club<input name="team" maxlength="80" required></label><button class="sx-btn sx-btn--p" type="submit">Open pack</button></form></section>`;
  view().querySelector('#opF')?.addEventListener('submit', (e: any) => { e.preventDefault(); window.open(`/api/stats-centre/report/opposition.html?team=${encodeURIComponent(e.target.team.value)}`, '_blank', 'noopener'); });
}

// ── 11. Practice matches ──
export async function startPractice(c: Ctx) {
  try { const r = await c.api('matches', { practice: true }); c.toast('Practice match made: nothing in it is ever published or counted.'); location.hash = `#/match/${r.id}`; } catch (x: any) { c.toast(x.message, false); }
}

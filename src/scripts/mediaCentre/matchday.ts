// Media Centre › Matchday Desk: prepare the line-up and substitutes in advance
// (approved, published at the chosen time), and post quick live updates during
// the match (kick-off, goal, card, substitution, half-time, full-time) that
// update the match page and the homepage live score. Updates post instantly
// only for people a Super Admin granted "pre-approved live updates" for the
// match; otherwise they wait for approval.
import { api, esc, register, go, toast, when, itemPath, statusPill } from './core';
import { statusBanner, autosaver, workflowButtons } from './items';
import { meta } from './news';

const localInput = (iso?: string | null) => iso ? new Date(Date.parse(iso) + 3600e3).toISOString().slice(0, 16) : '';
const fromLocal = (v: string) => v ? new Date(`${v}:00+01:00`).toISOString() : null;

register({ path: 'matchday', label: 'Matchday Desk', icon: '⚽', async render(main, parts) {
  if (parts[0] === 'live' && parts[1]) return liveDesk(main, parts[1]);
  if (parts[0]) return lineupEditor(main, parts[0]);
  const [M, L] = await Promise.all([meta(), api('items?kind=lineup')]);
  const soon = M.matches.filter((m: any) => Date.parse(m.date) > Date.now() - 6 * 3600e3);
  main.innerHTML = `<div class="mc-page-head"><h1>Matchday Desk</h1></div>
    <p class="mc-muted">Prepare line-ups before the match and post live updates during it. Updates go to the match page and the homepage live score. For the full live audio, see <a href="/commentary/" target="_blank" rel="noopener">Live Commentary</a>.</p>
    <section class="mc-card"><h2 class="mc-h3">Lobi Stars matches</h2>${soon.length ? `<ul class="mc-list">${soon.map((m: any) => `<li><div class="t"><b>${esc(m.label)}</b><small>${esc(when(m.date))} · ${esc(m.venue)}</small></div>
      <button class="mc-btn mc-btn-o mc-btn-sm" type="button" data-lineup="${esc(m.id)}" data-label="${esc(m.label)}" data-date="${esc(m.date)}">Prepare line-up</button>
      <a class="mc-btn mc-btn-blue mc-btn-sm" href="/media-centre/matchday/live/${esc(m.id)}/" data-go="/matchday/live/${esc(m.id)}">Live updates</a> <a class="mc-small" href="/matches/${esc(m.slug)}/" target="_blank" rel="noopener">Match page</a></li>`).join('')}</ul>` : '<p class="mc-empty">No upcoming Lobi Stars matches in the fixtures.</p>'}</section>
    <section class="mc-card" style="margin-top:14px"><h2 class="mc-h3">Line-ups</h2>${L.items.length ? `<ul class="mc-list">${L.items.map((i: any) => `<li><div class="t"><b>${esc(i.title)}</b><small>${i.scheduledAt ? `publishes ${esc(when(i.scheduledAt))}` : `updated ${esc(when(i.updatedAt))}`}</small></div>${statusPill(i)} <a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/${esc(itemPath(i))}/" data-go="/${esc(itemPath(i))}">Open</a></li>`).join('')}</ul>` : '<p class="mc-empty">No line-ups yet.</p>'}</section>`;
  main.querySelectorAll<HTMLElement>('[data-lineup]').forEach(b => b.addEventListener('click', async () => {
    const d = await api('items', { method: 'POST', body: { kind: 'lineup', data: { eventId: b.dataset.lineup, label: b.dataset.label, starting: [], subs: [] } } });
    go(`/matchday/${d.id}`);
  }));
} });

async function lineupEditor(main: HTMLElement, id: string) {
  main.innerHTML = '<p class="mc-muted">Loading…</p>';
  const [{ item, editable }, M] = await Promise.all([api(`items/${id}`), meta()]);
  const d: any = item.data || {}, ro = editable ? '' : 'disabled';
  const m = M.matches.find((x: any) => x.id === d.eventId);
  const role = (slug: string) => d.starting?.some((p: any) => p.slug === slug) ? 'start' : d.subs?.some((p: any) => p.slug === slug) ? 'sub' : '';
  const defaultAt = item.scheduledAt || (m ? new Date(Date.parse(m.date) - 60 * 60e3).toISOString() : null);
  main.innerHTML = `<div class="mc-page-head"><h1>Line-up: ${esc(d.label || '')}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/matchday/" data-go="/matchday">← Matchday Desk</a></div>
    ${statusBanner(item, editable)}
    <form class="mc-card" id="f" onsubmit="return false">
      <p class="mc-muted">${m ? `${esc(when(m.date))} · ${esc(m.venue)}` : ''}</p>
      <p><b id="count"></b></p>
      <div class="mc-pick">${M.players.map((p: any) => `<label><span>${p.number != null ? `#${esc(p.number)} ` : ''}${esc(p.name)}</span><select data-p="${esc(p.slug)}" data-name="${esc(p.name)}" data-number="${esc(p.number ?? '')}" data-pos="${esc(p.position)}" ${ro}><option value="">—</option><option value="start" ${role(p.slug) === 'start' ? 'selected' : ''}>Starts</option><option value="sub" ${role(p.slug) === 'sub' ? 'selected' : ''}>Sub</option></select></label>`).join('') || '<p class="mc-muted">No live squad profiles yet.</p>'}</div>
      <div class="mc-grid two" style="margin-top:12px"><div class="mc-field"><label for="formation">Formation <small>(optional)</small></label><input id="formation" maxlength="12" value="${esc(d.formation || '')}" placeholder="4-3-3" ${ro} /></div>
      <div class="mc-field"><label for="at">Publish at <small>(Nigerian time; usually an hour before kick-off)</small></label><input id="at" type="datetime-local" value="${esc(localInput(defaultAt))}" ${ro} /></div></div>
      <p class="mc-hint" id="saveState"></p><div id="wf"></div>
    </form>`;
  const $ = (s: string) => main.querySelector(s) as any;
  const pick = (want: string) => [...main.querySelectorAll<HTMLSelectElement>('[data-p]')].filter(s => s.value === want).map(s => ({ slug: s.dataset.p, name: s.dataset.name, number: s.dataset.number ? Number(s.dataset.number) : null, position: s.dataset.pos }));
  const value = () => ({ eventId: d.eventId, label: d.label, starting: pick('start'), subs: pick('sub'), formation: $('#formation').value });
  const count = () => { const n = pick('start').length; $('#count').textContent = `Starting XI: ${n} of 11 · Substitutes: ${pick('sub').length}`; $('#count').style.color = n === 11 ? '' : '#A15C00'; };
  const saver = autosaver(async () => { await api(`items/${id}`, { method: 'PUT', body: { data: value() } }); }, $('#saveState'));
  $('#f').addEventListener('change', () => { count(); if (editable) saver.changed(); });
  const wf = workflowButtons(item, editable, { flush: () => saver.flush(), schedule: () => fromLocal($('#at').value), onDone: () => go('/matchday') });
  $('#wf').innerHTML = wf.html; wf.wire($('#wf'));
  count();
}

async function liveDesk(main: HTMLElement, eventId: string) {
  const M = await meta();
  let timer = 0;
  const draw = async () => {
    if (!main.isConnected || !location.pathname.includes(`/matchday/live/${eventId}`)) { clearInterval(timer); return; }
    const d = await api(`live?event=${encodeURIComponent(eventId)}`, { quiet: true });
    const m = d.match, lobiHome = /lobi stars/i.test(m.home);
    const keep = main.querySelector<HTMLFormElement>('#lf');
    const saved = keep ? Object.fromEntries(new FormData(keep).entries()) : null;
    main.innerHTML = `<div class="mc-page-head"><h1>Live: ${esc(m.home)} v ${esc(m.away)}</h1><a class="mc-btn mc-btn-o mc-btn-sm" href="/media-centre/matchday/" data-go="/matchday">← Matchday Desk</a></div>
      <p>${d.granted ? '<span class="mc-pill published">Your updates post instantly (pre-approved for this match)</span>' : '<span class="mc-pill submitted">Your updates wait for a Super Admin to approve</span>'}</p>
      <section class="mc-card"><p class="mc-score">${esc(m.homeScore)} – ${esc(m.awayScore)}</p><p style="text-align:center" class="mc-muted">${esc(m.status)} · ${esc(when(m.date))}</p></section>
      <form class="mc-card" id="lf" style="margin-top:12px" onsubmit="return false">
        <div class="mc-grid two"><div class="mc-field"><label for="minute">Minute</label><input id="minute" name="minute" inputmode="numeric" maxlength="6" placeholder="e.g. 23 or 45+2" /></div>
        <div class="mc-field"><label for="team">Team</label><select id="team" name="team"><option value="">—</option><option value="home">${esc(m.home)}</option><option value="away">${esc(m.away)}</option></select></div>
        <div class="mc-field"><label for="player">Player</label><input id="player" name="player" list="squadList" maxlength="80" placeholder="Name" /><datalist id="squadList">${M.players.map((p: any) => `<option value="${esc(p.name)}">`).join('')}</datalist></div>
        <div class="mc-field"><label for="detail">Detail <small>(optional)</small></label><input id="detail" name="detail" maxlength="160" placeholder="e.g. header from a corner; Akaa off, Musa on" /></div></div>
        <div class="mc-live-btns">${Object.entries(d.types).map(([k, l]) => `<button type="button" class="mc-btn ${k === 'goal' ? 'mc-btn-red' : 'mc-btn-o'}" data-type="${esc(k)}">${esc(l as string)}</button>`).join('')}</div>
      </form>
      ${d.waiting.length ? `<section class="mc-card" style="margin-top:12px"><h2 class="mc-h3">Waiting for approval</h2><ul class="mc-list">${d.waiting.map((w: any) => `<li><div class="t"><b>${esc(w.title)}</b><small>${esc(when(w.submitted_at))}</small></div></li>`).join('')}</ul></section>` : ''}
      <section class="mc-card" style="margin-top:12px"><h2 class="mc-h3">On the match page now</h2>${m.timeline.length ? `<ul class="mc-list">${m.timeline.map((t: any) => `<li><div class="t"><b>${esc(t.minute ? `${t.minute}'` : '')} ${esc(t.type)} ${esc(t.player || '')}</b><small>${esc(t.detail || '')}</small></div></li>`).join('')}</ul>` : '<p class="mc-empty">No updates yet.</p>'}</section>`;
    if (saved) for (const [k, v] of Object.entries(saved)) { const el = main.querySelector<HTMLInputElement>(`[name="${k}"]`); if (el) el.value = String(v); }
    if (!saved && lobiHome !== undefined) (main.querySelector('#team') as HTMLSelectElement).value = lobiHome ? 'home' : 'away';
    main.querySelectorAll<HTMLButtonElement>('[data-type]').forEach(b => b.addEventListener('click', async () => {
      const f = Object.fromEntries(new FormData(main.querySelector('#lf') as HTMLFormElement).entries()) as any;
      b.disabled = true;
      try {
        const r = await api('live', { method: 'POST', body: { eventId, update: { type: b.dataset.type, minute: f.minute, team: f.team, player: f.player, detail: f.detail } } });
        toast(r.posted ? `Posted. Score ${r.score} (${r.status}).` : 'Sent to the Super Admins for approval.');
        for (const k of ['minute', 'player', 'detail']) (main.querySelector(`[name="${k}"]`) as HTMLInputElement).value = '';
        await draw();
      } catch (err: any) { toast(err.message, 9000); b.disabled = false; }
    }));
  };
  await draw();
  timer = window.setInterval(() => draw().catch(() => {}), 20000);
}

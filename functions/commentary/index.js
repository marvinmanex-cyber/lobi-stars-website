import { publicCommentaryState } from '../api/_lib/commentary.js';
import { renderPage, fill, esc, fmtDate, fmtTime } from '../api/_lib/ssr.js';

// "/commentary" -- Lobi Stars FC Live, with the on-air status and upcoming
// commentary filled in on the server (no "Loading…").
export async function onRequestGet({ request, env }) {
  let st;
  try { st = await publicCommentaryState(env); } catch { st = null; }
  if (!st) return env.ASSETS.fetch(new URL('/commentary/', request.url));

  const now = Date.now();
  const watDay = ms => new Date(ms + 3_600_000).toISOString().slice(0, 10);
  const when = iso => (watDay(new Date(iso).getTime()) === watDay(now) ? fmtTime(iso) : `${fmtDate(iso)}, ${fmtTime(iso)}`);
  const f = st.fixture;
  const badge = st.state === 'live' ? 'Live now' : st.state === 'today' && f?.commentaryStart ? `Starts at ${fmtTime(f.commentaryStart).replace(' WAT', '')}` : 'Off air';
  const status = st.streamUrl ? 'Press play to listen live'
    : !st.enabled ? 'Off air'
    : f?.commentaryStart ? `Off air – commentary starts at ${when(f.commentaryStart)}` : 'Off air – check back on matchday';
  const upcoming = st.upcoming.length
    ? st.upcoming.map(u => `<li><div><span class="cm-teams">${esc(u.home_team)} vs ${esc(u.away_team)}</span><span class="cm-when">${esc(fmtDate(u.event_date))} · Kick-off ${esc(fmtTime(u.event_date))} · Commentary from ${esc(fmtTime(u.commentaryStart || u.event_date))}</span></div></li>`).join('')
    : '<li class="cm-empty">No live commentary scheduled yet. Check the fixtures for the next match.</li>';

  return renderPage(request, env, '/commentary/', [
    ['[data-live-player] [data-lp-status]', { element(el) { el.setInnerContent(status); } }],
    ['[data-live-player] [data-lp-badge]', { element(el) {
      el.setInnerContent(badge);
      el.setAttribute('class', `lp-badge ${st.state === 'live' ? 'live' : st.state === 'today' ? 'today' : ''}`);
    } }],
    ['#cmUpcoming', fill(upcoming)],
  ], { 'ssr-commentary': st });
}

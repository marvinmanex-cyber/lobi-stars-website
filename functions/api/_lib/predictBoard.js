// Predict & Win results for the public page: the current home game's result card (winner, the score
// they predicted and when, everyone with the exact score) and this season's winners. Names are shown
// as first name, surname initial and a masked phone number (publicName), never in full.
import { findMotmMatch } from './motmService.js';
import { ensurePredictSchema, predictState, predictionWindow, countPredictions, publicName } from './predict.js';
import { PRIZE_AMOUNT, formatNaira } from './predictSettings.js';
import { getGameSponsor, publicSponsor } from './gameSponsors.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'Africa/Lagos';
const day = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
const exact = iso => `${new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ })}.${String(new Date(iso).getUTCMilliseconds()).padStart(3, '0')}`;
const opponent = m => (/lobi stars/i.test(m.home_team || '') ? m.away_team : m.home_team);

/** The result of one match (or null if no final score yet). */
async function resultFor(db, eventId) {
  const r = await db.prepare(`SELECT * FROM prediction_results WHERE event_id = ?`).bind(eventId).first();
  if (!r) return null;
  const { results } = await db.prepare(
    `SELECT p.id, p.created_at, p.is_winner, COALESCE(m.is_staff, 0) AS is_staff, m.first_name, m.last_name, m.phone_e164
     FROM predictions p LEFT JOIN members m ON m.id = p.member_id
     WHERE p.event_id = ? AND p.disqualified = 0 AND p.home_goals = ? AND p.away_goals = ? ORDER BY p.created_at ASC, p.id ASC LIMIT 200`
  ).bind(eventId, r.home_score, r.away_score).all();
  const list = results.map(p => ({ name: p.first_name ? publicName(p) : 'Deleted account', at: p.created_at, winner: !!p.is_winner, note: p.is_winner ? '' : p.is_staff ? 'Club staff or player: cannot win' : '' }));
  return { home: r.home_score, away: r.away_score, prize: r.prize_amount ?? PRIZE_AMOUNT, total: r.total_count, correct: r.correct_count, winner: list.find(x => x.winner) || null, exact: list };
}

/** Everything the page shows. */
export async function predictBoard(env) {
  const db = env.DB;
  await ensurePredictSchema(db);
  const sponsor = publicSponsor(await getGameSponsor(db, 'predict'));
  const m = await findMotmMatch(env, '');
  let current = null;
  if (m && m.is_home) {
    const result = await resultFor(db, m.id);
    const { opensAt, closesAt } = predictionWindow(m);
    current = { matchId: m.id, slug: m.slug, home: m.home_team, away: m.away_team, opponent: opponent(m), kickoff: m.event_date, state: predictState(m, !!result),
      opensAt: new Date(opensAt).toISOString(), closesAt: Number.isFinite(closesAt) ? new Date(closesAt).toISOString() : null, count: await countPredictions(db, m.id), result };
  }
  const { results } = await db.prepare(
    `SELECT r.event_id, e.home_team, e.away_team, e.event_date FROM prediction_results r JOIN events e ON e.id = r.event_id
     WHERE e.event_date >= '2026-07-01' AND e.event_date < '2027-07-01' ORDER BY e.event_date DESC LIMIT 40`
  ).all();
  const archive = [];
  for (const e of results) archive.push({ matchId: e.event_id, match: `Lobi Stars vs ${opponent(e)}`, home: e.home_team, away: e.away_team, date: e.event_date, result: await resultFor(db, e.event_id) });
  return { current, archive, sponsor };
}

/** The result card and the season list as HTML. */
export function predictBoardHtml(b) {
  const c = b.current, out = [];
  const score = (r, x) => `${esc(x.home)} <b>${esc(r.home)} – ${esc(r.away)}</b> ${esc(x.away)}`;
  if (c && c.state === 'result') {
    const r = c.result;
    out.push(`<article class="pwb-card" data-pwb-state="result"><p class="pwb-k">Predict &amp; Win result &middot; ${esc(day(c.kickoff))}</p>`
      + `<p class="pwb-score">${score(r, c)}</p>`
      + (r.winner
        ? `<div class="pwb-win"><span class="pwb-trophy" aria-hidden="true">🏆</span><div><p class="pwb-win-k">Winner</p><p class="pwb-win-name">${esc(r.winner.name)}</p>`
          + `<p>Predicted <b>${esc(r.home)} – ${esc(r.away)}</b> on ${esc(day(r.winner.at))} at ${esc(exact(r.winner.at))} (Nigerian time)</p>`
          + `<p>Predicted first of ${esc(r.correct)} correct prediction${r.correct === 1 ? '' : 's'} &middot; wins <b>${esc(formatNaira(r.prize))}</b></p></div></div>`
        : `<p class="pwb-none">Nobody predicted the exact score this time, so the prize is not given out for this match.</p>`)
      + (b.sponsor ? `<p class="pwb-sp">${esc(b.sponsor.line)}</p>` : '')
      + (r.exact.length ? `<h3 class="pwb-h3">Everyone who predicted ${esc(r.home)} – ${esc(r.away)}</h3><p class="pwb-note">In the order they predicted. The first eligible fan wins.</p><ol class="pwb-list">${r.exact.map(x => `<li class="${x.winner ? 'win' : ''}"><span>${x.winner ? '🏆 ' : ''}${esc(x.name)}</span><span class="pwb-at">${esc(day(x.at))}, ${esc(exact(x.at))}</span>${x.note ? `<span class="pwb-tag">${esc(x.note)}</span>` : x.winner ? '<span class="pwb-tag pwb-tag--win">Predicted first: winner</span>' : ''}</li>`).join('')}</ol>` : '')
      + `<p class="pwb-total">${esc(r.total)} fan${r.total === 1 ? '' : 's'} predicted</p></article>`);
  } else if (c && c.state === 'closed') {
    out.push(`<article class="pwb-card pwb-card--wait" data-pwb-state="closed"><p class="pwb-k">Predict &amp; Win &middot; Lobi Stars vs ${esc(c.opponent)}</p><h3 class="pwb-wait">Predictions are closed</h3><p>${esc(c.count)} fan${c.count === 1 ? '' : 's'} predicted. The winner appears here as soon as the final score is entered.</p></article>`);
  } else if (c && c.state === 'open') {
    out.push(`<article class="pwb-card pwb-card--open" data-pwb-state="open"><p class="pwb-k">Predict &amp; Win &middot; Lobi Stars vs ${esc(c.opponent)}</p><h3 class="pwb-wait">Predictions are open</h3><p>Until ${esc(time(c.closesAt))} on ${esc(day(c.closesAt))}. ${esc(c.count)} fan${c.count === 1 ? ' has' : 's have'} predicted. <a href="/matches/${esc(c.slug)}/live/#predict">Make your prediction &rarr;</a></p></article>`);
  }
  const past = b.archive.filter(a => a.result && !(c && a.matchId === c.matchId && c.state === 'result'));
  if (past.length) {
    out.push(`<section class="pwb-arch"><h3 class="pwb-h3">Season 2026/27 winners</h3><ul>${past.map(a => `<li><span class="pwb-arch-w">${a.result.winner ? `🏆 ${esc(a.result.winner.name)}` : 'No winner'}</span><span class="pwb-arch-m">${esc(a.match)} &middot; ${esc(day(a.date))} &middot; ${esc(a.result.home)}-${esc(a.result.away)}${a.result.winner ? ` &middot; ${esc(formatNaira(a.result.prize))}` : ''}</span></li>`).join('')}</ul></section>`);
  }
  return out.join('');
}

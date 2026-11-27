import { renderPage, fill, esc, crestHtml, fmtDate } from '../../api/_lib/ssr.js';
import { publicMatch } from '../../api/_lib/statsCentreData.js';
import { edgeCached } from '../../api/_lib/edgeCache.js';

// /stats/matches/<match> -- the public stats page of a match published in the Statistics Center (published version
// only: drafts, live entry and corrections in progress are never shown): scoreline, team stats, event timeline,
// line-ups with links to the player pages, Lobi Stars player stats, the report and the highlights link.
// <match> is the fixture's match-page slug (the same as /matches/<match>/), or the Statistics Center id for a match
// that is not in the fixtures. The same copy for everyone for a minute at Cloudflare's edge.
export async function onRequestGet(ctx) {
  return edgeCached(ctx.request, ctx.waitUntil, 60, () => page(ctx));
}

const PERIOD = { '1H': 'First half', '2H': 'Second half', ET1: 'Extra time', ET2: 'Extra time, second half', PEN: 'Penalties' };
const LABEL = { goal: 'Goal', shot: 'Shot', corner: 'Corner', foul_committed: 'Foul', yellow_card: 'Yellow card', red_card: 'Red card', offside: 'Offside', substitution: 'Substitution', injury: 'Injury', gk_save: 'Save', penalty: 'Penalty', var_decision: 'VAR' };
const TIMELINE_TYPES = new Set(['goal', 'yellow_card', 'red_card', 'substitution', 'var_decision']);
const icon = e => (e.type === 'goal' ? '⚽' : e.type === 'yellow_card' ? '🟨' : e.type === 'red_card' ? '🟥' : e.type === 'substitution' ? '🔁' : '📺');

async function page({ request, env, params }) {
  const url = new URL(request.url);
  const key = String(params.slug || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120); // a fixture slug, or a Statistics Center id (mixed case)
  let data = null;
  try { data = key ? await publicMatch(env.DB, key) : null; } catch (err) { console.error('[stats match]', err); }
  if (!data) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=60' } });

  const { match: m, lineups, events, derived } = data;
  const lobiSide = m.lobiHome ? 'home' : 'away';
  const name = side => (side === 'home' ? m.home : m.away);
  const title = `${m.home} ${m.homeScore}–${m.awayScore} ${m.away}: match stats`;
  const desc = `${m.home} ${m.homeScore}–${m.awayScore} ${m.away} (${m.competition}, ${fmtDate(m.date)}): shots, corners, cards, line-ups and every event, recorded by the Lobi Stars Statistics Center.`;
  const canonical = `${url.origin}/stats/matches/${data.slug}/`;
  const player = (slug, nm) => (slug ? `<a href="/squad/${esc(slug)}/">${esc(nm)}</a>` : esc(nm || ''));

  // Scoreline
  let html = `<section class="sxm-score" aria-label="Final score">
    <div class="sxm-team">${crestHtml(m.home, 64)}<span>${esc(m.home)}</span></div>
    <div class="sxm-num">${m.homeScore}–${m.awayScore}</div>
    <div class="sxm-team">${crestHtml(m.away, 64)}<span>${esc(m.away)}</span></div></section>
    <p class="sxm-meta">${esc(m.competition)}${m.matchday ? ` · Matchday ${esc(m.matchday)}` : ''} · ${esc(fmtDate(m.date, true))}${m.venue ? ` · ${esc(m.venue)}` : ''}${m.htHome !== null && m.htHome !== undefined ? ` · Half-time ${m.htHome}–${m.htAway}` : ''}${m.attendance ? ` · Attendance ${Number(m.attendance).toLocaleString('en-GB')}` : ''}${m.referee ? ` · Referee ${esc(m.referee)}` : ''}</p>
    <p class="sxm-links">${data.matchUrl ? `<a class="btn-o" href="${esc(data.matchUrl)}">Match page</a>` : ''}${m.highlights ? `<a class="btn-p" href="${esc(m.highlights)}" target="_blank" rel="noopener">Watch highlights</a>` : ''}<a class="btn-o" href="/stats/">Season stats</a><a class="btn-o" href="https://wa.me/?text=${encodeURIComponent(`${m.home} ${m.homeScore}–${m.awayScore} ${m.away}: match stats ${canonical}`)}" target="_blank" rel="noopener">Share on WhatsApp</a></p>`;

  // Team stats
  const T = derived.team;
  const rows = [['Goals', 'goals'], ['Shots', 'shots'], ['Shots on target', 'shotsOnTarget'], ['Corners', 'corners'], ['Fouls', 'fouls'], ['Offsides', 'offsides'], ['Saves', 'saves'], ['Yellow cards', 'yellow'], ['Red cards', 'red']];
  const bar = (label, h, a) => { const t = h + a || 1; return `<div class="sxm-bar"><span>${esc(label)}</span><b>${h}</b><div class="sxm-track" aria-hidden="true"><i style="width:${(h / t) * 100}%"></i><i style="width:${(a / t) * 100}%"></i></div><b>${a}</b></div>`; };
  html += `<h2 class="sxm-h2">Team stats</h2><div class="sxm-bars">`
    + (m.possessionHome !== null && m.possessionHome !== undefined ? bar('Possession %', m.possessionHome, 100 - m.possessionHome) : '')
    + rows.map(([l, k]) => bar(l, T.home[k], T.away[k])).join('') + `</div><p class="sxm-meta">${esc(m.home)} (red) · ${esc(m.away)} (blue)</p>`;

  // Timeline
  const tl = events.filter(e => TIMELINE_TYPES.has(e.type));
  if (tl.length) {
    let last = '';
    html += `<h2 class="sxm-h2">Timeline</h2><ol class="sxm-tl">` + tl.map(e => {
      const head = e.period !== last ? `<li class="sxm-period" aria-hidden="true">${esc(PERIOD[e.period] || e.period)}</li>` : '';
      last = e.period;
      const what = e.type === 'substitution' ? `${player(e.relatedSlug, e.relatedName || '?')} on for ${player(e.slug, e.name || '?')}`
        : e.type === 'goal' ? `${player(e.slug, e.name || 'Goal')}${e.detail === 'own_goal' ? ' (own goal)' : e.detail === 'penalty' ? ' (penalty)' : ''}${e.relatedName && e.detail !== 'own_goal' ? `<small>Assist: ${player(e.relatedSlug, e.relatedName)}</small>` : ''}`
        : player(e.slug, e.name || '');
      return `${head}<li class="${e.side}"><span class="m">${e.minute}${e.stoppage ? `+${e.stoppage}` : ''}'</span><span><span aria-hidden="true">${icon(e)}</span> <b>${esc(LABEL[e.type] || e.type)}</b> · ${what}${e.type === 'goal' ? `<small>${e.scoreHome}–${e.scoreAway}</small>` : ''}</span></li>`;
    }).join('') + '</ol>';
  }

  // Line-ups
  if (lineups.length) {
    const list = (side, starter) => lineups.filter(l => l.side === side && l.starter === starter).map(l => `<li><span>${esc(l.number ?? '')}</span>${player(l.slug, l.name)}${l.motm ? ' ⭐' : ''}</li>`).join('');
    html += `<h2 class="sxm-h2">Line-ups</h2><div class="sxm-lu">` + ['home', 'away'].map(side => `<section><h3>${esc(name(side))}${(side === 'home' ? m.formationHome : m.formationAway) ? ` <small>(${esc(side === 'home' ? m.formationHome : m.formationAway)})</small>` : ''}</h3>
      <ol>${list(side, true) || '<li>Not recorded</li>'}</ol>${list(side, false) ? `<p class="sxm-meta" style="text-align:left">Substitutes</p><ol>${list(side, false)}</ol>` : ''}</section>`).join('') + '</div>';
  }

  // Lobi Stars players
  const ps = derived.players.filter(p => p.side === lobiSide && p.slug && p.played);
  if (ps.length) {
    html += `<h2 class="sxm-h2">Lobi Stars players</h2><div class="sxm-scroll"><table class="sxm-t"><thead><tr><th>Player</th><th class="n">Min</th><th class="n">Goals</th><th class="n">Assists</th><th class="n">Shots</th><th class="n">On target</th><th class="n">Cards</th></tr></thead><tbody>`
      + ps.map(p => `<tr><td>${player(p.slug, p.name)}${p.starter ? '' : ' <small>(sub)</small>'}</td><td class="n">${p.minutes}</td><td class="n">${p.goals}</td><td class="n">${p.assists}</td><td class="n">${p.shots}</td><td class="n">${p.shotsOnTarget}</td><td class="n">${p.red ? '🟥' : p.yellow ? '🟨' : ''}</td></tr>`).join('')
      + '</tbody></table></div>';
  }
  if (m.report) html += `<h2 class="sxm-h2">Report</h2><div class="sxm-report">${esc(m.report)}</div>`;
  html += `<p class="sxm-meta">Verified and published by the Lobi Stars Statistics Center.</p>`;

  const attr = (name, value) => ({ element(el) { el.setAttribute(name, value); } });
  return renderPage(request, env, '/stats/match/', [
    ['title', fill(esc(`${title} | Lobi Stars Football Club`))],
    ['meta[name="description"]', attr('content', desc)],
    ['meta[property="og:title"]', attr('content', title)],
    ['meta[property="og:description"]', attr('content', desc)],
    ['meta[property="og:url"]', attr('content', canonical)],
    ['link[rel="canonical"]', attr('href', canonical)],
    ['meta[name="robots"]', { element(el) { el.remove(); } }],
    ['#sxmKicker', fill(esc(`${m.competition} · ${fmtDate(m.date)}`))],
    ['#sxmTitle', fill(`${esc(m.home)} <span class="r">${m.homeScore}–${m.awayScore}</span> ${esc(m.away)}`)],
    ['#sxmBody', fill(html)],
  ]);
}

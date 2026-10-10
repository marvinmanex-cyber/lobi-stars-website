import { renderPage, fill, esc, fmtDate, fmtTime } from './api/_lib/ssr.js';
import { publicAwards } from './api/_lib/awards.js';
import { awardsAssets } from './api/_lib/awardsData.js';

// "/awards" -- fan awards (Goal of the Month, Player of the Month, Player of
// the Season) rendered on the server: open votes first, then upcoming, then
// past winners. The browser script only adds the fan's own vote and the
// vote buttons (it reads the same awards from /api/awards).
export async function onRequestGet({ request, env }) {
  let awards;
  try { awards = await publicAwards(env.DB, await awardsAssets(env, request)); }
  catch (err) { console.error('[awards] failed', err); return env.ASSETS.fetch(new URL('/awards/', request.url)); }

  const open = awards.filter(a => a.state === 'open');
  const upcoming = awards.filter(a => a.state === 'upcoming').reverse();
  const past = awards.filter(a => a.state === 'closed');

  const when = iso => `${fmtDate(iso)}, ${fmtTime(iso)}`;
  const face = n => n.player?.photo
    ? `<img class="aw-face" src="${esc(n.player.photo)}" alt="" loading="lazy" width="56" height="56">`
    : `<span class="aw-face" aria-hidden="true">${esc(n.player?.number ?? '★')}</span>`;
  const clip = (n, title) => n.youtube
    ? `<button type="button" class="aw-clip" data-yt="${esc(n.youtube)}" aria-label="Play goal: ${esc(n.label)}"><img src="https://i.ytimg.com/vi/${esc(n.youtube)}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360"><span class="aw-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span></button>`
    : '';
  const sponsor = a => a.sponsor
    ? `<p class="aw-sponsor">${a.sponsor.logo ? `<img src="${esc(a.sponsor.logo)}" alt="${esc(a.sponsor.name)}" loading="lazy" height="28">` : ''}<span>In partnership with ${esc(a.sponsor.name)}</span></p>`
    : '';
  const head = a => `<header class="aw-head"><p class="aw-k">${esc(a.typeLabel)} &middot; ${esc(a.period)}</p><h3>${esc(a.title)}</h3>${sponsor(a)}</header>`;

  const nomineeCard = (a, n) => `<li class="aw-nom${a.type === 'gotm' ? ' aw-nom--goal' : ''}" data-nominee="${n.id}">`
    + (a.type === 'gotm' ? clip(n) : face(n))
    + `<div class="aw-nom-t"><strong>${esc(n.player && a.type !== 'gotm' ? n.player.name : n.label)}</strong>`
    + (a.type === 'gotm' && n.player ? `<span>${esc(n.player.name)}</span>` : n.player?.position ? `<span>${esc(n.player.position)}</span>` : '')
    + `</div><button type="button" class="aw-vote" data-vote="${n.id}" disabled>Vote</button><span class="aw-mine" hidden>Your vote</span></li>`;

  const openCard = a => `<article class="aw-card" data-award="${esc(a.id)}" data-state="open" aria-label="${esc(a.title)} ${esc(a.period)}">${head(a)}`
    + `<p class="aw-time">Voting closes ${esc(when(a.closesAt))}. One vote per fan. The winner is revealed when voting closes.</p>`
    + `<ol class="aw-noms">${a.nominees.map(n => nomineeCard(a, n)).join('')}</ol>`
    + `<p class="aw-msg" role="status" aria-live="polite"><a href="/fans/login/?next=/awards/">Log in</a> or <a href="/fans/register/?next=/awards/">create a free fan account</a> to vote.</p></article>`;

  const upcomingCard = a => `<article class="aw-card aw-card--soon" aria-label="${esc(a.title)} ${esc(a.period)}">${head(a)}`
    + `<p class="aw-time">Voting opens ${esc(when(a.opensAt))} and closes ${esc(when(a.closesAt))}.</p></article>`;

  const pastCard = a => {
    const r = a.results || { total: 0, rows: [], winners: [] };
    const byId = new Map(a.nominees.map(n => [n.id, n]));
    const name = n => (a.type !== 'gotm' && n.player ? n.player.name : n.label);
    const winners = r.winners.map(id => byId.get(id)).filter(Boolean);
    const win = winners.length
      ? `<div class="aw-winner"><span class="aw-trophy" aria-hidden="true">🏆</span><div><p class="aw-k">${winners.length > 1 ? 'Joint winners' : 'Winner'}</p>`
        + winners.map(n => `<p class="aw-wname">${n.player ? `<a href="/squad/${esc(n.player.slug)}/">${esc(name(n))}</a>` : esc(name(n))}${a.type === 'gotm' && n.player ? ` <span>(${esc(n.player.name)})</span>` : ''}</p>`).join('')
        + `</div></div>`
      : `<p class="aw-time">No votes were cast, so there is no winner.</p>`;
    const clips = a.type === 'gotm' && winners.length ? `<div class="aw-wclip">${clip(winners[0])}</div>` : '';
    const table = r.total ? `<details class="aw-res"><summary>Full results (${r.total} vote${r.total === 1 ? '' : 's'})</summary><ol>`
      + r.rows.map(row => { const n = byId.get(row.id); return n ? `<li><span>${esc(name(n))}</span><span class="aw-bar" style="--p:${row.pct}%"></span><b>${row.pct}%</b></li>` : ''; }).join('')
      + `</ol></details>` : '';
    return `<article class="aw-card aw-card--past" aria-label="${esc(a.title)} ${esc(a.period)}">${head(a)}${win}${clips}${table}</article>`;
  };

  let html = '';
  if (open.length) html += `<h2 class="aw-h2">Vote now</h2><div class="aw-grid">${open.map(openCard).join('')}</div>`;
  if (upcoming.length) html += `<h2 class="aw-h2">Coming up</h2><div class="aw-grid">${upcoming.map(upcomingCard).join('')}</div>`;
  if (past.length) html += `<h2 class="aw-h2">Past winners</h2><div class="aw-grid">${past.map(pastCard).join('')}</div>`;
  if (!html) html = `<p class="aw-empty">No award votes yet. Goal of the Month, Player of the Month and Player of the Season votes will appear here when they open.</p>`;

  return renderPage(request, env, '/awards/', [['#awardsBody', fill(html)]]);
}

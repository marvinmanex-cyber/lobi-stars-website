// Man of the Match page: the announcement card, sponsor and season archive as HTML. Used by the
// server (functions/man-of-the-match.js fills the page before it is sent) and by the page's own
// script when it reloads the status. Plain strings, every value escaped.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const POS = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const TZ = 'Africa/Lagos';
const time = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
const date = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const BADGE = '/images/lobi-stars-badge.png';

/** "Man of the Match, sponsored by …" with the photo; empty when the sponsor is hidden. */
export function sponsorHtml(sp) {
  if (!sp) return '';
  return `<div class="motm-sp">${sp.photoUrl ? `<img data-motm-sponsor src="${esc(sp.photoUrl)}" alt="${esc(sp.name)}" width="72" height="72" loading="lazy">` : ''}`
    + `<p data-motm-sponsor-line>Man of the Match, sponsored by <strong>${esc(sp.name)}</strong></p></div>`;
}

const face = (p, cls) => (p.photoUrl
  ? `<img class="${cls}" src="${esc(p.photoUrl)}" alt="" loading="lazy" width="64" height="64">`
  : `<span class="${cls} ${cls}--n" aria-hidden="true">${esc(p.number ?? p.name?.charAt(0) ?? '?')}</span>`);

/** The winner card (an announcement as returned by the status API, plus match and venue). */
export function announcementHtml(a, { opponent, venue = 'McCarthy Stadium', sponsor = null, date: when = null } = {}) {
  if (!a) return '';
  if (!a.winner) return `<article class="motm-card motm-card--none"><p class="motm-k">Man of the Match</p><h2>No Man of the Match this game.</h2><p class="motm-match">Lobi Stars vs ${esc(opponent)} &middot; ${esc(venue)}</p></article>`;
  const w = a.winner;
  const hero = w.photoUrl
    ? `<img class="motm-photo" src="${esc(w.photoUrl)}" alt="${esc(w.name)}" width="320" height="320">`
    : `<div class="motm-nophoto"><img src="${BADGE}" alt="Lobi Stars FC" width="96" height="96"><span class="motm-bigname">${esc(w.name)}</span></div>`;
  const lines = String(a.message || '').split('\n');
  const top3 = (a.top3 || []).map(p => `<li>${face(p, 'motm-sm')}<span class="motm-sm-name">${esc(p.name)}</span>`
    + `<span class="motm-barwrap" aria-hidden="true"><span class="motm-bar" style="width:${Math.max(0, Math.min(100, Number(p.percent) || 0))}%"></span></span>`
    + `<span class="motm-sm-v">${esc(p.votes)} votes &middot; ${esc(p.percent)}%</span></li>`).join('');
  return `<article class="motm-card" data-motm-winner="${esc(w.name)}">`
    + `<p class="motm-k">Man of the Match${when ? ` &middot; ${esc(date(when))}` : ''}</p>`
    + `<div class="motm-main">${hero}<div class="motm-who"><h2>${esc(w.name)}</h2>`
    + `<p class="motm-meta">${w.number != null ? `#${esc(w.number)} &middot; ` : ''}${esc(POS[w.position] || w.position || '')}</p>`
    + `<p class="motm-match">Lobi Stars vs ${esc(opponent)} &middot; ${esc(venue)}</p></div></div>`
    + `<div class="motm-msg">${lines.map((l, i) => (i === 0 ? `<p class="motm-msg-h">${esc(l)}</p>` : `<p>${esc(l)}</p>`)).join('')}</div>`
    + (sponsor ? `<p class="motm-card-sp">${esc(sponsor.line)}</p>` : '')
    + `<h3 class="motm-h3">How the top 3 were voted</h3><ol class="motm-top3">${top3}</ol>`
    + `<p class="motm-total">${esc(a.totalVotes)} fan${a.totalVotes === 1 ? '' : 's'} voted</p></article>`;
}

/** The whole top-of-page block for a status response (with its archive). */
export function cardHtml(s) {
  if (!s) return '';
  const latest = s.status === 'closed' && s.announcement
    ? { a: s.announcement, opponent: s.opponent, venue: s.venue, date: s.kickoff }
    : (s.archive || [])[0] ? { a: s.archive[0], opponent: s.archive[0].match.replace(/^Lobi Stars vs /, ''), venue: 'McCarthy Stadium', date: s.archive[0].date } : null;
  const live = s.status === 'open'
    ? `<div class="motm-live"><strong>Voting is open now</strong> for Lobi Stars vs ${esc(s.opponent)}, until ${esc(time(s.closesAt))}. <a href="/matches/${esc(s.slug)}/live/#vote">Vote in Matchday Live &rarr;</a></div>`
    : s.status === 'upcoming'
      ? `<div class="motm-live motm-live--soon">Next vote: Lobi Stars vs ${esc(s.opponent)}, ${esc(date(s.opensAt))}. Voting opens at ${esc(time(s.opensAt))} and closes at ${esc(time(s.closesAt))}.</div>`
      : '';
  const archive = (s.archive || []).length
    ? `<section class="motm-arch" aria-labelledby="motm-arch-h"><h3 id="motm-arch-h" class="motm-h3">Season 2026/27 winners</h3><ul>${s.archive.map(r => `<li><span class="motm-arch-w">${esc(r.winner ? r.winner.name : 'No Man of the Match')}</span>`
      + `<span class="motm-arch-m">${esc(r.match)} &middot; ${esc(date(r.date))}${r.score ? ` &middot; ${esc(r.score)}` : ''}</span>`
      + `${r.winner ? `<span class="motm-arch-v">${esc(r.winner.votes)} votes &middot; ${esc(r.winner.percent)}%</span>` : ''}</li>`).join('')}</ul></section>`
    : '';
  return live + (latest ? announcementHtml(latest.a, { opponent: latest.opponent, venue: latest.venue, sponsor: s.sponsor, date: latest.date }) : '') + archive;
}

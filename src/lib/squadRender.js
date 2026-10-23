// The Squad pages' markup, in one place (23 Oct 2026). Used twice:
//  - at build time by the Astro pages (src/pages/squad/…), and
//  - on the server by functions/squad/[[path]].js, which shows a profile within
//    seconds of a Super Admin approving it (no rebuild needed).
// Same input (a "person": public details only) → same HTML, so the two never
// differ. The styles are global (src/components/squad/*.astro).
import { longDate, birthLine, heightText } from './format.js';
import { countryName, flagUrl } from './countries.js';
import { roleCategory } from './squadFields.js';
import { publicName, officialName, shortName } from './names.js';

export const GROUPS = [
  { key: 'GK', title: 'Goalkeepers', label: 'Goalkeeper' },
  { key: 'DEF', title: 'Defenders', label: 'Defender' },
  { key: 'MID', title: 'Midfielders', label: 'Midfielder' },
  { key: 'FWD', title: 'Forwards', label: 'Forward' },
];
export const ROLE_ORDER = ['Head Coach', 'Assistant Coach', 'Goalkeeper Coach', 'Fitness Coach', 'Technical Adviser', 'Performance Analyst'];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (s, n = 155) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);

/** A person (what the pages show) from one entry of /api/squad/public (squadPublish.js publicSquad). */
export function personFromFeed(x, kind) {
  const parts = { firstName: x.firstName || '', surname: x.surname || '', middleName: '', websiteName: x.websiteName || '' };
  const slug = x.slug;
  const label = GROUPS.find(g => g.key === x.group)?.label || '';
  return {
    kind, slug, href: kind === 'player' ? `/squad/${slug}/` : `/squad/staff/${slug}/`, oldSlugs: x.oldSlugs || [],
    firstName: parts.firstName, surname: parts.surname, name: x.name || publicName(parts), officialName: x.officialName || officialName(parts), shortName: x.shortName || shortName(parts) || x.name,
    number: kind === 'player' && Number.isFinite(x.number) ? x.number : null, group: kind === 'player' ? x.group || null : null, groupLabel: label,
    position: kind === 'player' ? x.position || label : '', role: kind === 'staff' ? x.role || 'Staff' : '', roleCategory: x.roleCategory || null, roleOrder: x.roleOrder ?? null,
    photo: x.photo || null, photoSmall: x.photoSmall || x.photo || null, hero: x.heroPhoto || null,
    nationality: [x.nationality, x.nationality2].filter(Boolean), nationalTeam: x.nationalTeam || null, birthTown: x.birthTown || null, birthCountry: x.birthCountry || null,
    dob: x.dob || null, age: x.age ?? null, heightCm: x.heightCm ?? null, preferredFoot: x.preferredFoot || null,
    nickname: x.nickname || null, stateOfOrigin: x.stateOfOrigin || null, hometown: x.hometown || null,
    secondaryPositions: (x.secondaryPositions || []).filter(p => p && p !== x.position), playingCareer: x.playingCareer || null,
    joined: x.joined || null, debut: x.debutDate || null, licence: x.licence || null,
    bioHeadline: x.bioHeadline || null, bioText: x.bio || null, shortBio: null, interestingFact: x.interestingFact || null, shirtUrl: x.shirtShopUrl || null,
    socials: x.socials || {}, previousClubs: x.previousClubs || [], previousRoles: x.previousRoles || [], internationalCareer: x.internationalCareer || [], honours: x.honours || [],
    isSample: false,
  };
}
/** Players by position group then number; coaches Head Coach first. */
export function sortPlayers(list) {
  const order = g => GROUPS.findIndex(x => x.key === g);
  return [...list].sort((a, b) => order(a.group) - order(b.group) || (a.number ?? 999) - (b.number ?? 999) || a.surname.localeCompare(b.surname));
}
export function sortStaff(list) {
  // The order set in Squad › Roles (roleOrder), else the starting list.
  const idx = p => { if (p.roleOrder != null) return p.roleOrder; const i = ROLE_ORDER.indexOf(p.role); return 1000 + (i < 0 ? ROLE_ORDER.length : i); };
  return [...list].sort((a, b) => idx(a) - idx(b) || a.surname.localeCompare(b.surname));
}

// ── Pieces ──
export function flagHtml(code, size = 18) {
  const name = countryName(code), src = flagUrl(code);
  if (!name) return '';
  return `<span class="flag">${src ? `<img src="${esc(src)}" alt="${esc(name)} flag" width="${Math.round(size * 4 / 3)}" height="${size}" loading="lazy" decoding="async" />` : ''}<span>${esc(name)}</span></span>`;
}
/** The bio: paragraphs separated by an empty line; a line starting "## " is a heading. */
export function bioHtml(text) {
  return String(text || '').replace(/\r/g, '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    if (/^#{2,3}\s/.test(b)) { const [h, ...rest] = b.split('\n'); return `<h3>${esc(h.replace(/^#+\s*/, ''))}</h3>${rest.length ? `<p>${esc(rest.join(' '))}</p>` : ''}`; }
    return `<p>${esc(b.replace(/\n/g, ' '))}</p>`;
  }).join('');
}
const SIL = '<circle cx="50" cy="36" r="18" /><path d="M14 100c0-22 16-36 36-36s36 14 36 36z" />';

/** A squad card (photo, big number, first name above the surname, position or role). */
export function renderCard(p) {
  const subtitle = p.kind === 'player' ? p.position || p.groupLabel : p.role;
  const plain = `${p.firstName} ${p.surname}`.trim();
  const twoLine = !!p.surname && (!p.name || p.name === plain);
  return `<a class="sc" href="${esc(p.href)}"><div class="sc-photo">${p.number != null ? `<span class="sc-num" aria-hidden="true">${esc(p.number)}</span>` : ''}${p.photoSmall
    ? `<img src="${esc(p.photoSmall)}" alt="" loading="lazy" decoding="async" width="400" height="500" />`
    : `<svg class="sc-sil" viewBox="0 0 100 100" aria-hidden="true">${SIL}</svg>`}</div><div class="sc-body">${p.number != null ? `<span class="sr-only">Number ${esc(p.number)}, </span>` : ''}${twoLine
    ? `<span class="sc-name"><span class="sc-first">${esc(p.firstName)}</span><span class="sc-last">${esc(p.surname)}</span></span>`
    : `<span class="sc-name"><span class="sc-last">${esc(p.name || plain)}</span></span>`}<span class="sc-sub">${esc(subtitle)}</span></div></a>`;
}

/** The squad list: groups by position, then coaching staff. */
export function renderList({ players, staff, season }) {
  if (!players.length && !staff.length) return `<div class="empty-state">The squad for the ${esc(season)} season will be announced soon.</div>`;
  const group = (id, title, list) => `<section class="sq-group" aria-labelledby="${id}"><h2 class="sq-title" id="${id}">${esc(title)}</h2><ul class="sq-grid">${list.map(p => `<li>${renderCard(p)}</li>`).join('')}</ul></section>`;
  return GROUPS.map(g => { const list = players.filter(p => p.group === g.key); return list.length ? group(`g-${g.key}`, g.title, list) : ''; }).join('')
    + (staff.length ? group('g-staff', 'Coaching Staff', staff) : '');
}

const handle = h => String(h || '').replace(/^@/, '');
const ICON = {
  instagram: '<path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 8.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4zM17.3 5.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4zM12 2c-2.7 0-3 0-4.1.1C4.3 2.3 2.3 4.3 2.1 7.9 2 9 2 9.3 2 12s0 3 .1 4.1c.2 3.6 2.2 5.6 5.8 5.8 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c3.6-.2 5.6-2.2 5.8-5.8.1-1.1.1-1.4.1-4.1s0-3-.1-4.1c-.2-3.6-2.2-5.6-5.8-5.8C15 2 14.7 2 12 2zm0 1.8c2.7 0 3 0 4 .1 2.6.1 3.9 1.4 4 4 .1 1 .1 1.3.1 4s0 3-.1 4c-.1 2.6-1.4 3.9-4 4-1 .1-1.3.1-4 .1s-3 0-4-.1c-2.6-.1-3.9-1.4-4-4-.1-1-.1-1.3-.1-4s0-3 .1-4c.1-2.6 1.4-3.9 4-4 1-.1 1.3-.1 4-.1z"/>',
  x: '<path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.8 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/>',
  tiktok: '<path d="M16.6 2h-3.3v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.2a6.3 6.3 0 1 0 5.3 6.2V8.7a8 8 0 0 0 4.4 1.3V6.7a4.6 4.6 0 0 1-4.4-4.7z"/>',
};

/**
 * One profile page's article (everything between the header and the news).
 * opts: { prev, next, teammates, season, share: html of the share button,
 *   personalisation: the shop's shirt printing settings (shirtOrders.js PERSONALISATION) }.
 */
export function renderProfile(p, { prev = null, next = null, teammates = [], season = '', share = '', personalisation = { enabled: false, maxLetters: 12 } } = {}) {
  const isPlayer = p.kind === 'player', isGk = p.group === 'GK';
  const socials = [
    p.socials.instagram && { key: 'instagram', label: 'Instagram', href: `https://www.instagram.com/${handle(p.socials.instagram)}/` },
    p.socials.x && { key: 'x', label: 'X', href: `https://x.com/${handle(p.socials.x)}` },
    p.socials.tiktok && { key: 'tiktok', label: 'TikTok', href: `https://www.tiktok.com/@${handle(p.socials.tiktok)}` },
  ].filter(Boolean);
  const birthPlace = [p.birthTown, countryName(p.birthCountry)].filter(Boolean).join(', ');
  const plain = `${p.firstName} ${p.surname}`.trim(), twoLine = !!p.surname && p.name === plain;
  const printName = (p.surname || p.shortName || '').toUpperCase().replace(/[^A-Z .'-]/g, '').slice(0, personalisation.maxLetters);
  const shirtHref = p.shirtUrl || (isPlayer && personalisation.enabled && printName && p.number != null ? `/shop/?print=${encodeURIComponent(printName)}&number=${p.number}#personalise` : null);
  const pos = isPlayer ? p.position || p.groupLabel : p.role;
  const bio = bioHtml(p.bioText);
  const det = [
    p.officialName && ['Name', esc(p.officialName)], p.nickname && ['Nickname', esc(p.nickname)],
    p.nationality.length && ['Nationality', p.nationality.map(c => flagHtml(c)).join(''), 'pf-flags'], isPlayer && p.nationalTeam && ['National team', flagHtml(p.nationalTeam)],
    birthPlace && ['Place of birth', esc(birthPlace)], p.stateOfOrigin && ['State of origin', esc(p.stateOfOrigin)], p.hometown && ['Hometown', esc(p.hometown)],
    [isPlayer ? 'Position' : 'Role', esc(pos)], isPlayer && p.secondaryPositions.length && ['Other positions', esc(p.secondaryPositions.join(', '))],
    p.dob ? ['Date of birth', esc(birthLine(p.dob)), '', `data-birth="${esc(p.dob)}"`] : p.age != null && ['Age', esc(p.age)],
    isPlayer && p.heightCm && ['Height', esc(heightText(p.heightCm))], isPlayer && p.preferredFoot && ['Preferred foot', esc(p.preferredFoot)],
    !isPlayer && p.licence && ['Licence', esc(p.licence)], isPlayer && ['Lobi Stars debut', p.debut ? esc(longDate(p.debut)) : 'Yet to debut'],
    p.joined && ['Joined', esc(longDate(p.joined))],
  ].filter(Boolean);
  const career = isPlayer ? p.previousClubs : p.previousRoles;
  const stats = [['apps', 'Appearances'], ['starts', 'Starts'], ['goals', 'Goals'], ['assists', 'Assists'], ...(isGk ? [['cleanSheets', 'Clean sheets']] : []), ['minutes', 'Minutes'], ['yellow', 'Yellow cards'], ['red', 'Red cards'], ['motm', 'Man of the Match']];
  const fact = !isPlayer && (p.roleCategory || roleCategory(p.role)) === 'CLUB_STAFF' ? 'An interesting fact about the staff member' : isPlayer ? 'An interesting fact' : 'An interesting fact about the coach';
  return `<article class="pf" data-kind="${p.kind}">
  <header class="pf-hero${p.hero ? ' pf-hero--wide' : ''}">${p.hero ? `<img class="pf-hero-bg" src="${esc(p.hero)}" alt="" fetchpriority="high" decoding="async" />` : ''}
    <div class="wrap pf-hero-in">${p.hero ? '' : `<div class="pf-portrait">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}" width="600" height="750" fetchpriority="high" />` : `<svg viewBox="0 0 100 100" aria-hidden="true">${SIL}</svg>`}</div>`}
      <div class="pf-title">${isPlayer && p.number != null ? `<span class="pf-num" aria-hidden="true">${esc(p.number)}</span>` : ''}
        <p class="pf-kicker">${esc(isPlayer ? `${pos}${p.number != null ? ` · #${p.number}` : ''}` : p.role)}</p>
        <h1 class="pf-name">${twoLine ? `<span class="pf-first">${esc(p.firstName)}</span><span class="pf-last">${esc(p.surname)}</span>` : `<span class="pf-last">${esc(p.name)}</span>`}${isPlayer && p.number != null ? `<span class="sr-only">, number ${esc(p.number)}</span>` : ''}</h1>
        <ul class="pf-quick">${p.nationality[0] ? `<li><span class="pf-q-k">Nationality</span><span class="pf-q-v">${flagHtml(p.nationality[0])}</span></li>` : ''}<li><span class="pf-q-k">${isPlayer ? 'Position' : 'Role'}</span><span class="pf-q-v">${esc(pos)}</span></li>${p.age != null ? `<li><span class="pf-q-k">Age</span><span class="pf-q-v" data-age-of="${esc(p.dob || '')}">${esc(p.age)}</span></li>` : ''}</ul>
      </div>
    </div>
  </header>
  <div class="wrap pf-main"><div class="pf-col">
    ${shirtHref ? `<a class="pf-shirt" href="${esc(shirtHref)}"${p.shirtUrl ? ' target="_blank" rel="noopener"' : ''}><span class="pf-shirt-num" aria-hidden="true">${esc(p.number ?? '')}</span><span><b>Buy ${esc(p.shortName)}'s shirt</b><small>Official Lobi Stars FC shirt</small></span><span aria-hidden="true">→</span></a>` : ''}
    ${bio || p.bioHeadline || p.shortBio ? `<section class="pf-sec pf-bio" aria-labelledby="bio-h"><h2 class="pf-h2" id="bio-h">${esc(p.bioHeadline || 'Biography')}</h2>${bio || (p.shortBio ? `<p>${esc(p.shortBio)}</p>` : '')}</section>` : ''}
    ${p.interestingFact ? `<aside class="pf-fact" aria-labelledby="fact-h"><h2 id="fact-h">${fact}</h2><p>${esc(p.interestingFact)}</p></aside>` : ''}
    <section class="pf-sec" aria-labelledby="det-h"><h2 class="pf-h2" id="det-h">Details</h2><dl class="pf-details">${det.map(([k, v, cls = '', attr = '']) => `<div><dt>${k}</dt><dd${cls ? ` class="${cls}"` : ''}${attr ? ` ${attr}` : ''}>${v}</dd></div>`).join('')}</dl></section>
    <section class="pf-sec pf-tabs" data-tabs>
      <div class="pf-tablist" role="tablist" aria-label="More about this person" hidden>${isPlayer ? `<button role="tab" type="button" id="t-season" aria-controls="p-season">${esc(season)}</button>` : ''}<button role="tab" type="button" id="t-career" aria-controls="p-career">${isPlayer ? 'Before Lobi Stars' : 'Career'}</button>${isPlayer && p.internationalCareer.length ? '<button role="tab" type="button" id="t-intl" aria-controls="p-intl">International career</button>' : ''}${p.honours.length ? '<button role="tab" type="button" id="t-hon" aria-controls="p-hon">Honours</button>' : ''}</div>
      ${isPlayer ? `<div class="pf-panel" role="tabpanel" id="p-season" aria-labelledby="t-season"><h2 class="pf-h3">${esc(season)} season</h2><ul class="pf-stats" data-stats="${esc([p.slug, ...p.oldSlugs].join(','))}">${stats.map(([k, l]) => `<li><span class="pf-stat-v" data-stat="${k}">–</span><span class="pf-stat-k">${l}</span></li>`).join('')}</ul><p class="pf-note" data-stats-note>Worked out automatically from the club's match records.</p></div>` : ''}
      <div class="pf-panel" role="tabpanel" id="p-career" aria-labelledby="t-career"><h2 class="pf-h3">${isPlayer ? 'Before Lobi Stars' : 'Career'}</h2>${career.length ? `<ol class="pf-timeline">${isPlayer
        ? p.previousClubs.map(c => `<li><span class="pf-tl-years">${esc([c.startYear, c.endYear].filter(Boolean).join('–') || '–')}</span><span class="pf-tl-club">${esc(c.club)}</span>${c.country ? `<span class="pf-tl-country">${flagHtml(c.country, 14)}</span>` : ''}</li>`).join('')
        : p.previousRoles.map(r => `<li><span class="pf-tl-years">${esc(r.period || '–')}</span><span class="pf-tl-club">${esc(r.club)}</span><span class="pf-tl-country">${esc(r.position)}</span></li>`).join('')}</ol>` : !p.playingCareer ? '<p class="pf-note">No previous clubs listed yet.</p>' : ''}${!isPlayer && p.playingCareer ? `<div class="pf-playing"><h3 class="pf-h3 pf-h3-sub">Playing career</h3><p>${esc(p.playingCareer)}</p></div>` : ''}</div>
      ${isPlayer && p.internationalCareer.length ? `<div class="pf-panel" role="tabpanel" id="p-intl" aria-labelledby="t-intl"><h2 class="pf-h3">International career${p.nationalTeam ? ` · ${flagHtml(p.nationalTeam, 14)}` : ''}</h2><div class="pf-tablewrap"><table class="pf-table"><thead><tr><th scope="col">Level</th><th scope="col">Caps</th><th scope="col">Goals</th><th scope="col">Notable tournaments</th></tr></thead><tbody>${p.internationalCareer.map(r => `<tr><th scope="row">${esc(r.level)}</th><td>${esc(r.caps ?? '–')}</td><td>${esc(r.goals ?? '–')}</td><td>${esc(r.tournaments || '–')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      ${p.honours.length ? `<div class="pf-panel" role="tabpanel" id="p-hon" aria-labelledby="t-hon"><h2 class="pf-h3">Honours</h2><ul class="pf-honours">${p.honours.map(h => `<li><b>${esc(h.title)}</b>${[h.seasonOrYear, h.clubOrTeam].filter(Boolean).length ? `<span> · ${esc([h.seasonOrYear, h.clubOrTeam].filter(Boolean).join(', '))}</span>` : ''}</li>`).join('')}</ul></div>` : ''}
    </section>
    <div class="pf-actions">${socials.length ? `<ul class="pf-social" aria-label="${esc(p.name)} on social media">${socials.map(s => `<li><a href="${esc(s.href)}" target="_blank" rel="noopener noreferrer me" aria-label="${esc(p.name)} on ${s.label}" class="pf-soc pf-soc--${s.key}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[s.key]}</svg></a></li>`).join('')}</ul>` : ''}${share}</div>
  </div></div>
  ${prev || next || teammates.length ? `<section class="pf-others" aria-labelledby="others-h"><div class="wrap"><div class="pf-others-head"><h2 class="pf-h2" id="others-h">${isPlayer ? 'Other players' : 'Coaching staff'}</h2><nav class="pf-prevnext" aria-label="${isPlayer ? 'Previous and next player' : 'Previous and next staff member'}">${prev ? `<a href="${esc(prev.href)}" rel="prev">← ${esc(prev.name)}</a>` : ''}${next ? `<a href="${esc(next.href)}" rel="next">${esc(next.name)} →</a>` : ''}</nav></div>${teammates.length ? `<ul class="pf-others-grid">${teammates.map(t => `<li>${renderCard(t)}</li>`).join('')}</ul>` : ''}<p><a class="pf-all" href="/squad/">See the full squad</a></p></div></section>` : ''}
</article>`;
}

/** Previous, next and up to 4 others in the same group, for a profile. */
export function neighbours(list, p) {
  const i = list.findIndex(x => x.slug === p.slug);
  return { prev: list[i - 1] || null, next: list[i + 1] || null, teammates: list.filter(x => x !== p && (p.kind === 'staff' || x.group === p.group)).slice(0, 4) };
}

// ── For search engines ──
export function profileDescription(p) {
  const bio = String(p.bioText || '').split(/\n+/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).join(' ');
  if (bio) return clip(bio);
  const what = p.kind === 'player' ? `${p.position || p.groupLabel}${p.number != null ? ` (#${p.number})` : ''} for Lobi Stars FC` : `${p.role} at Lobi Stars FC`;
  return clip(`${p.name}, ${what}: profile, career and news.`);
}
export function personJsonLd(p, site) {
  const abs = path => new URL(path, site).toString();
  return {
    '@context': 'https://schema.org', '@type': 'Person', name: p.name,
    ...(p.firstName ? { givenName: p.firstName } : {}), ...(p.surname ? { familyName: p.surname } : {}),
    url: abs(p.href), ...(p.photo ? { image: abs(p.photo) } : {}),
    jobTitle: p.kind === 'player' ? `${p.position || p.groupLabel}, Lobi Stars FC` : `${p.role}, Lobi Stars FC`,
    ...(p.dob ? { birthDate: p.dob } : {}),
    ...(p.birthTown || p.birthCountry ? { birthPlace: { '@type': 'Place', name: [p.birthTown, countryName(p.birthCountry)].filter(Boolean).join(', ') } } : {}),
    ...(p.nationality[0] ? { nationality: { '@type': 'Country', name: countryName(p.nationality[0]) } } : {}),
    ...(p.heightCm ? { height: { '@type': 'QuantitativeValue', value: p.heightCm, unitCode: 'CMT' } } : {}),
    ...(p.bioText ? { description: profileDescription(p) } : {}),
    memberOf: { '@type': 'SportsTeam', name: 'Lobi Stars FC', sport: 'Football', url: abs('/') },
  };
}

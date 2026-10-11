// Build step: branded share images (Open Graph / Twitter) in dist/og/.
//  - Every indexable page that would otherwise share the general club image
//    gets its own card with its title (news stories and players with a photo
//    keep their photo; the homepage keeps its designed image).
//  - Partner pages: a card with the partner's logo.
//  - Match pages (made on the server): one card per opponent, home and away.
// If image tools aren't available the pages keep the general image.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { TEAM_LOGOS } from '../../functions/api/_lib/teamLogos.js';
import { teamSlug, matchImagePath, MATCH_FALLBACK_IMAGE } from '../../functions/api/_lib/shareImage.js';

const DEFAULT = '/images/og-default.jpg';
const HEADINGS = [
  [/^news\//, 'News'], [/^squad\//, 'Squad'], [/^club\//, 'The Club'], [/^partners\//, 'Partners'],
  [/^(fixtures|results|table|stats|watch|commentary|man-of-the-match|predict-and-win|awards|matchday-live|programme)\//, 'Matches'],
  [/^tickets\//, 'Tickets'], [/^shop\//, 'Club Shop'], [/^membership\//, 'Membership'], [/^food\//, 'Matchday'],
  [/^(hospitality)\//, 'Hospitality'], [/^(video|gallery)\//, 'Media'],
];
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const meta = (html, attr, name) => html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1];
const setMeta = (html, attr, name, value) => html.replace(new RegExp(`(<meta ${attr}="${name}" content=")[^"]*(")`), `$1${value}$2`);

export async function makeShareImages({ dist, site, files, logger }) {
  let cards;
  try { cards = await import('./shareImages.mjs'); } catch (err) { logger.warn(`share images skipped (${err.message})`); return; }
  const pub = p => path.join(dist, ...p.replace(/^\//, '').split('/'));
  const badge = pub('/images/lobi-stars-fc.jpg');
  await mkdir(path.join(dist, 'og', 'match'), { recursive: true });
  let pages = 0;

  for (const file of files) {
    const rel = path.relative(dist, file).split(path.sep).join('/');
    if (rel === 'index.html' || rel === '404.html' || /^(admin|offline|payment|fans|unsubscribe|scan)\b/.test(rel)) continue;
    let html = await readFile(file, 'utf8');
    if (/<meta name="robots" content="noindex/i.test(html)) continue;
    const og = meta(html, 'property', 'og:image');
    if (!og) continue;
    const ogPath = og.replace(site, '');
    const partner = /^partners\/[^/]+\/index\.html$/.test(rel);
    if (ogPath !== DEFAULT && !partner) continue; // has its own photo
    const title = decode(meta(html, 'property', 'og:title') || '').split(' | ')[0].trim();
    if (!title) continue;
    const name = rel.replace(/\/?index\.html$/, '').replace(/\.html$/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const out = `/og/${name}.jpg`;
    try {
      const logo = partner && ogPath.startsWith('/') && existsSync(pub(ogPath)) ? pub(ogPath) : badge;
      await cards.pageCard({ heading: partner ? 'Official Partner' : (HEADINGS.find(([re]) => re.test(rel))?.[1] || 'Lobi Stars FC'), title, badge: logo, out: pub(out) });
    } catch (err) { logger.warn(`share image for ${rel} failed: ${err.message}`); continue; }
    html = setMeta(setMeta(html, 'property', 'og:image', site + out), 'name', 'twitter:image', site + out);
    if (!html.includes('og:image:width')) html = html.replace(/(<meta property="og:image" content="[^"]*"\/?>)/, '$1<meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/>');
    html = setMeta(html, 'property', 'og:image:alt', `${title} | Lobi Stars FC`);
    await writeFile(file, html);
    pages++;
  }

  // Match cards: Lobi Stars against every team with a crest, both ways round.
  const lobi = pub(TEAM_LOGOS['Lobi Stars FC']);
  const teams = new Map();
  for (const [n, logo] of Object.entries(TEAM_LOGOS)) {
    if (/lobi stars/i.test(n)) continue;
    const display = n.replace(/\s+F\.?C\.?$/i, '');
    if (!teams.has(teamSlug(n))) teams.set(teamSlug(n), { display, crest: pub(logo) });
  }
  let matches = 0;
  for (const { display, crest } of teams.values()) {
    for (const [home, away, hc, ac] of [['Lobi Stars', display, lobi, crest], [display, 'Lobi Stars', crest, lobi]]) {
      try { await cards.matchCard({ home, away, homeCrest: hc, awayCrest: ac, out: pub(matchImagePath(home, away)) }); matches++; }
      catch (err) { logger.warn(`match image ${home} v ${away} failed: ${err.message}`); }
    }
  }
  try { await cards.pageCard({ heading: 'Match Centre', title: 'Lobi Stars FC Match Centre', badge, out: pub(MATCH_FALLBACK_IMAGE) }); } catch { /* general image used */ }
  logger.info(`share images: ${pages} pages, ${matches} match cards`);
}

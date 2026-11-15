// Guard (owner's rule, 15 Nov 2026): on the public website, only the main site header stays at the top of
// the screen. In-page bars (category tabs, match tabs, filters…) scroll with the page: on phones the header
// hides when you scroll down, and a bar stuck at a fixed distance from the top floated over the content with
// a gap above it (News, 15 Nov). Every `position: sticky` on a public page must be in APPROVED below with a
// reason, so a new one can't slip in unnoticed. Staff areas (admin, kitchen, scores, media, gate, staff
// portal) are separate apps and not checked. No server needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /[\\/](admin|staff|scores-centre|matchday-kitchen|media-centre|gate-control|lobi-gate-control)[\\/]|AdminNav|matchdayKitchen\.css|gateControl\.css|[\\/]scripts[\\/](mediaCentre|matchdayKitchen|gateControl|squadPortal)/;
// [file ends with, selector contains, why it's allowed]
const APPROVED = [
  ['src/components/programme/ProgrammeReader.astro', '.pr-bar', 'follows the header (top: var(--header-vis)), so no gap when it hides'],
  ['src/styles/kitchen.css', '.kx-seat', 'MatchDay Kitchen ordering: follows the header (--kx-stick)'],
  ['src/styles/kitchen.css', '.kx-tabs', 'MatchDay Kitchen ordering: follows the header (--kx-stick)'],
  ['src/components/league/LeagueRoot.astro', '.club', 'the club-name column of a wide table, sticks sideways only'],
  ['src/pages/club/stadium.astro', '.st-map', 'side panel beside the text on wide screens'],
  ['src/pages/media/interview-request.astro', '.iv-side', 'side panel on wide screens only (min-width: 980px)'],
  ['src/pages/media/press-releases/index.astro', '.prn-side', 'side panel on wide screens only (min-width: 980px)'],
  ['src/pages/tickets/index.astro', '.tk-sum', 'order summary beside the form on wide screens only (min-width: 1000px)'],
  ['src/pages/kitchen/poster.astro', '.bar', 'print/poster tool, not a reading page'],
  ['src/pages/matchday-live.astro', '.mv-confirm', 'sticks to the bottom while confirming a vote, not the top'],
];

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(astro|css|ts|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

test('public pages: no bar sticks to the top of the screen except the main header', () => {
  const found = [];
  for (const f of ['src/pages', 'src/components', 'src/styles', 'src/layouts'].flatMap(d => files(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (SKIP.test(f)) continue;
    const s = readFileSync(f, 'utf8');
    const re = /position\s*:\s*sticky/g;
    let m;
    while ((m = re.exec(s))) {
      const open = s.lastIndexOf('{', m.index), close = s.lastIndexOf('}', open);
      const selector = s.slice(Math.max(close + 1, s.lastIndexOf('\n', open) + 1, 0), open).trim() || s.slice(close + 1, open).trim();
      if (/\b(thead|th)\b/.test(selector)) continue; // table header rows
      const ok = APPROVED.some(([file, sel]) => rel.endsWith(file) && selector.includes(sel));
      if (!ok) found.push(`${rel}: ${selector.slice(-80)}`);
    }
  }
  assert.deepEqual(found, [], `A bar on a public page sticks to the screen. In-page bars must scroll with the page (only the main header stays). If this one really must stick, make it follow the header (top: var(--header-vis)) and add it to APPROVED with the reason:\n${found.join('\n')}`);
});

test('the News and match tab bars scroll with the page', () => {
  const news = readFileSync(path.join(ROOT, 'src/pages/news/index.astro'), 'utf8');
  const match = readFileSync(path.join(ROOT, 'src/pages/match-centre.astro'), 'utf8');
  assert.doesNotMatch(news.match(/\.nl-tabs\s*\{[^}]*\}/)[0], /sticky/);
  assert.doesNotMatch(match.match(/\.mc-tabs\)\s*\{[^}]*\}/)[0], /sticky/);
});

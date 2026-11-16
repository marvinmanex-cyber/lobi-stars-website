// Match pages (/matches/<slug>/ and /matches/<slug>/live/) send their main heading in the HTML itself, so search
// engines see exactly one <h1> without running scripts (SEO Scanner "No main heading", Nov 2026). The page scripts
// redraw that area with the same heading. No server needed: checks the code that adds it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(ROOT, p), 'utf8');

test('match page and Matchday Live page add their <h1> on the server, inside the area the script redraws', () => {
  for (const [file, holder, page, script] of [
    ['functions/matches/[slug].js', '#mcStatus', 'src/pages/match-centre.astro', "root.replaceChildren"],
    ['functions/matches/[slug]/live.js', '#mlStatus', 'src/pages/matchday-live.astro', "root.replaceChildren"],
  ]) {
    const s = read(file);
    const line = s.split(/\r?\n/).find(l => l.includes(`.on('${holder}'`)) || '';
    assert.ok(line.includes('el.before(`<h1 class="sr-only">${escHtml('), `${file}: server <h1> before ${holder}`);
    const pg = read(page);
    assert.ok(pg.includes(`id="${holder.slice(1)}"`), `${page}: ${holder} is inside the redrawn area`);
    assert.ok(pg.includes(script), `${page}: the script redraws the area (so there is only one <h1>)`);
    assert.equal((pg.match(/el\('h1'/g) || []).length, 1, `${page}: the script adds one <h1>`);
  }
});

#!/usr/bin/env node
// Man of the Match: checks a running site. Prints PASS/FAIL for each check and exits with 1 if any fail.
//   node scripts/check-motm-live.mjs https://lobistarsfc.com
//   node scripts/check-motm-live.mjs http://localhost:8788   (npm run dev:full: the site with its server functions)
const BASE = (process.argv[2] || 'https://lobistarsfc.com').replace(/\/$/, '');
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`); };
const get = async path => {
  try { const r = await fetch(BASE + path, { headers: { 'Cache-Control': 'no-cache' }, redirect: 'follow' }); return { status: r.status, text: await r.text(), type: r.headers.get('content-type') || '' }; }
  catch (e) { return { status: 0, text: '', type: '', error: e.message }; }
};
const text = html => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

console.log(`Man of the Match checks: ${BASE}\n`);
const page = await get('/man-of-the-match/');
const p = text(page.text);
check('/man-of-the-match/ returns 200', page.status === 200, `status ${page.status}${page.error ? `, ${page.error}` : ''}`);
check('the page mentions 4:00 pm', /4:00 pm/i.test(p));
check('the page mentions 5:50 pm', /5:50 pm/i.test(p));
check('the winner is announced before the final whistle', /announced[^.]*before the final whistle/i.test(p));
check('"announced after the final whistle" is gone', !/announced after the final whistle/i.test(page.text));
check('"(starting XI and substitutes)" is gone', !page.text.includes('(starting XI and substitutes)'));
check('"Unused substitutes cannot be voted for" is present', p.includes('Unused substitutes cannot be voted for'));
check('"top 3" is mentioned', /top 3/i.test(p));
check('"percentages" is mentioned', /percentages/i.test(p));
check('the tie-break rule is shown', /level on votes, the player who reached that total first wins/i.test(p));
check('"Moses Orkuma" is present', page.text.includes('Moses Orkuma'));
check('"Okuma" is not present', !/okuma/i.test(page.text.replace(/orkuma/gi, '')));
check('a data-motm-sponsor image or data-motm-sponsor-line exists', /data-motm-sponsor(-line)?[\s>=]/.test(page.text));

const rules = await get('/motm/rules/');
const r = text(rules.text);
check('/motm/rules/ returns 200', rules.status === 200, `status ${rules.status}`);
check('/motm/rules/ mentions 4:00 pm', /4:00 pm/i.test(r));
check('/motm/rules/ mentions 5:50 pm', /5:50 pm/i.test(r));
check('/motm/rules/ has no "after the final whistle"', !/after the final whistle/i.test(rules.text));

const api = await get('/api/motm/current.json');
let s = null;
try { s = JSON.parse(api.text); } catch { /* not JSON */ }
check('/api/motm/current.json returns JSON with status, opensAt and closesAt', !!s && typeof s.status === 'string' && 'opensAt' in s && 'closesAt' in s, `status ${api.status}`);
const gap = s && s.opensAt && s.closesAt ? (Date.parse(s.closesAt) - Date.parse(s.opensAt)) / 60000 : NaN;
check('closesAt - opensAt = 110 minutes', gap === 110, `${gap} minutes, status ${s?.status}`);

if (s && s.status === 'closed') {
  const a = s.announcement || {};
  check('closed: the announcement has no approval field', !Object.keys(a).some(k => /approv|pending/i.test(k)) && !Object.keys(s).some(k => /approv|pending/i.test(k)));
  const t = a.top3 || [];
  check('closed: top3 has at most 3 items, integer votes and percent, sorted by votes', t.length <= 3 && t.every(x => Number.isInteger(x.votes) && Number.isInteger(x.percent)) && t.every((x, i) => i === 0 || t[i - 1].votes >= x.votes));
  check("closed: the winner's photoUrl is a path or null", !a.winner || a.winner.photoUrl === null || /^\/[^\s]*$/.test(a.winner.photoUrl));
  check("closed: the winner's name appears on the page", !a.winner ? p.includes('No Man of the Match this game.') : p.includes(a.winner.name));
} else {
  console.log(`\n(Status is "${s?.status}", not closed: the 4 checks for a closed vote run once a match has closed.)`);
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);

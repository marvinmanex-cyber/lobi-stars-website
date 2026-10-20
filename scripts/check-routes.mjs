// Checks that public/_routes.json sends every Pages Functions route to the
// website code. Runs after "astro build" (npm run build).
//
// Why the file exists: with more than 100 function routes, Cloudflare gives up
// and runs the website code for EVERY request, including fonts, images and
// scripts. That uses the free plan's 100,000 function requests a day about 30
// times faster, and cold starts under busy moments hit the 10 ms CPU limit
// ("Worker exceeded CPU time limit"). So _routes.json lists only the first path
// segment of each function route; everything else is served as plain files.
//
// If you add a new top-level folder or file in functions/, add "/name" and
// "/name/*" to public/_routes.json (this check fails the build until you do).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = JSON.parse(fs.readFileSync(path.join(root, 'public/_routes.json'), 'utf8'));
const include = new Set(routes.include || []);
const missing = [];
for (const entry of fs.readdirSync(path.join(root, 'functions'), { withFileTypes: true })) {
  if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue; // _lib, _generated, _middleware
  const seg = entry.isDirectory() ? entry.name : entry.name.replace(/\.(js|ts|mjs)$/, '');
  if (!entry.isDirectory() && !/\.(js|ts|mjs)$/.test(entry.name)) continue;
  if (seg === 'index') { if (!include.has('/')) missing.push('/'); continue; }
  if (/^\[/.test(seg)) { missing.push(`functions/${entry.name} (a catch-all at the top level needs "/*": then _routes.json can't help)`); continue; }
  for (const rule of [`/${seg}`, `/${seg}/*`]) if (!include.has(rule)) missing.push(rule);
}
if ((routes.include || []).length + (routes.exclude || []).length > 100) missing.push('(more than 100 rules: Cloudflare allows at most 100)');
if (missing.length) {
  console.error(`public/_routes.json is missing: ${missing.join(', ')}\nAdd them, or the new function will not run on the live site.`);
  process.exit(1);
}
const dist = path.join(root, 'dist/_routes.json');
if (fs.existsSync(path.join(root, 'dist')) && !fs.existsSync(dist)) { console.error('dist/_routes.json missing after the build.'); process.exit(1); }
console.log(`_routes.json OK: ${include.size} rules cover every function route.`);

// Match Checklist jobs by hand (the timer Worker normally does these every minute).
//
//   CRON_SECRET=... node scripts/checklist.mjs generate            make / update checklists for upcoming matches now
//   CRON_SECRET=... node scripts/checklist.mjs remind --dry-run    who would get which reminder today (nothing sent)
//   CRON_SECRET=... node scripts/checklist.mjs remind --force      send today's reminders now (still once per person per day)
//
// --base http://127.0.0.1:8788 to run against a local `wrangler pages dev` (default: https://lobistarsfc.com).
// (Windows PowerShell:  $env:CRON_SECRET="..."; node scripts/checklist.mjs remind --dry-run)
const args = process.argv.slice(2);
const cmd = args[0];
const base = (args.includes('--base') ? args[args.indexOf('--base') + 1] : process.env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
const secret = process.env.CRON_SECRET;
if (!['generate', 'remind'].includes(cmd)) {
  console.error('Usage: node scripts/checklist.mjs generate | remind [--dry-run] [--force] [--base URL]');
  process.exit(1);
}
if (!secret) {
  console.error('Set CRON_SECRET first (the same value as on the Cloudflare Pages project).');
  process.exit(1);
}
const q = new URLSearchParams({ action: cmd });
if (args.includes('--dry-run')) q.set('dryRun', '1');
if (args.includes('--force')) q.set('force', '1');
const res = await fetch(`${base}/api/internal/checklist-run?${q}`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` } });
const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
console.log(JSON.stringify(d, null, 2));
process.exit(res.ok && d.ok !== false ? 0 : 1);

// AI Fix dry run: what the weekly check-up would send to Claude right now, what
// it would do without AI, and the estimated cost. No AI is used, nothing changes.
//
//   CRON_SECRET=... node scripts/ai-dry-run.mjs                       (live site)
//   CRON_SECRET=... node scripts/ai-dry-run.mjs --base http://127.0.0.1:8788
//
// (Windows PowerShell:  $env:CRON_SECRET="..."; node scripts/ai-dry-run.mjs)
const args = process.argv.slice(2);
const base = (args.includes('--base') ? args[args.indexOf('--base') + 1] : process.env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');
if (!process.env.CRON_SECRET) {
  console.error('Set CRON_SECRET first (the same value as on the Cloudflare Pages project).');
  process.exit(1);
}
const res = await fetch(`${base}/api/internal/ai-run?action=dry_run`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
if (!res.ok || d.ok === false) { console.error(d.error || d); process.exit(1); }
console.log(`Would send ${d.wouldSendToClaude.length} fix(es) to Claude, estimated $${d.estimatedCost.toFixed(4)} (${d.note})`);
for (const x of d.wouldSendToClaude) console.log(`  - ${x.fix}: ${x.id} (~$${x.estimatedCost.toFixed(5)})`);
for (const x of d.withoutAi) console.log(`  - without AI: ${x.fix}: ${x.id}${x.autoApply ? ' (applied automatically)' : ' (waits for approval)'}`);
if (d.alreadyPrepared.length) console.log(`Already prepared (no new cost): ${d.alreadyPrepared.join(', ')}`);

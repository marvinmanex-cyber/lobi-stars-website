// lobistars-kitchen-cron: a tiny Cloudflare Worker that runs every minute
// (Cron Trigger, free) and asks the website to:
//  - re-alert the kitchen about paid orders nobody has accepted yet, tell fans
//    when the radio show goes on air, and keep sending match alerts to fans
//    (/api/internal/kitchen-repeat);
//  - post Match Day Programmes to Telegram / Facebook at their scheduled time
//    (/api/internal/social-autopost, Share Hub);
//  - check the website is up, every 5 minutes (/api/internal/health-check);
//  - send last month's partner reports from the 2nd, when switched on (/api/internal/partner-reports);
//  - Lobi Stars Rewards: release ticket points of played matches, prediction results, birthdays (/api/internal/rewards-run, every 10 min).
// Pages Functions can't run on a timer, so this does it. The website checks
// CRON_SECRET (same value in both places). One failing call never stops the other.
const CALLS = ['/api/internal/kitchen-repeat', '/api/internal/social-autopost', '/api/internal/health-check', '/api/internal/partner-reports', '/api/internal/rewards-run', '/api/internal/newsletter-run'];

export default {
  async scheduled(event, env, ctx) {
    const site = env.SITE_URL || 'https://lobistarsfc.com';
    ctx.waitUntil(Promise.allSettled(CALLS.map(async path => {
      try {
        const r = await fetch(`${site}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
        if (!r.ok) console.error(path, r.status, await r.text());
      } catch (err) {
        console.error(`${path} failed`, err);
      }
    })));
  },
};

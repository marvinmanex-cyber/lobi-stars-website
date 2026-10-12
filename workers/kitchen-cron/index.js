// lobistars-kitchen-cron: a tiny Cloudflare Worker that runs every minute
// (Cron Trigger, free) and asks the website to:
//  - re-alert the kitchen about paid orders nobody has accepted yet, tell fans
//    when the radio show goes on air, and keep sending match alerts to fans
//    (/api/internal/kitchen-repeat);
//  - post Match Day Programmes to Telegram / Facebook at their scheduled time
//    (/api/internal/social-autopost, Share Hub).
// Pages Functions can't run on a timer, so this does it. The website checks
// CRON_SECRET (same value in both places). One failing call never stops the other.
const CALLS = ['/api/internal/kitchen-repeat', '/api/internal/social-autopost'];

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

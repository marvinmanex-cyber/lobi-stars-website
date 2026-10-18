// lobistars-kitchen-cron: a tiny Cloudflare Worker that runs every minute
// (Cron Trigger, free) and asks the website to:
//  - re-alert the kitchen about paid orders nobody has accepted yet, tell fans
//    when the radio show goes on air, and keep sending match alerts to fans
//    (/api/internal/kitchen-repeat);
//  - post Match Day Programmes to Telegram / Facebook at their scheduled time
//    (/api/internal/social-autopost, Share Hub);
//  - check the website is up, every 5 minutes, and run Website Health (hourly full check,
//    matchday quick checks, 08:00 summary) one step per call (/api/internal/health-check:
//    called again straight away while it answers { more: true }, at most 45 times);
//  - send last month's partner reports from the 2nd, when switched on (/api/internal/partner-reports);
//  - Lobi Stars Rewards: release ticket points of played matches, prediction results, birthdays (/api/internal/rewards-run, every 10 min).
//  - the monthly staff access review email to the Super Admins, on the 1st (/api/internal/access-review);
//  - keep the three Super Admin accounts in line with SUPER_ADMIN_EMAILS (/api/internal/super-admins);
//  - the automatic encrypted daily backup, a few tables a minute from 02:00 (/api/internal/backup-run).
// Pages Functions can't run on a timer, so this does it. The website checks
// CRON_SECRET (same value in both places). One failing call never stops the other.
const CALLS = ['/api/internal/kitchen-repeat', '/api/internal/social-autopost', '/api/internal/health-check', '/api/internal/partner-reports', '/api/internal/rewards-run', '/api/internal/newsletter-run', '/api/internal/access-review', '/api/internal/super-admins', '/api/internal/backup-run'];

export default {
  async scheduled(event, env, ctx) {
    const site = env.SITE_URL || 'https://lobistarsfc.com';
    ctx.waitUntil(Promise.allSettled(CALLS.map(async path => {
      try {
        // Website Health runs in steps: keep calling while there are steps left.
        for (let i = 0; i < (path === '/api/internal/health-check' ? 45 : 1); i++) {
          const r = await fetch(`${site}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
          if (!r.ok) { console.error(path, r.status, await r.text()); break; }
          if (path !== '/api/internal/health-check' || !(await r.json().catch(() => ({}))).more) break;
        }
      } catch (err) {
        console.error(`${path} failed`, err);
      }
    })));
  },
};

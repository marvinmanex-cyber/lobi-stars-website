// lobistars-kitchen-cron: a tiny Cloudflare Worker that runs every minute
// (Cron Trigger, free) and asks the website to re-alert the kitchen about
// paid orders nobody has accepted yet, tell fans when the radio show goes on
// air, and keep sending match alerts to fans. Pages Functions can't run on a timer,
// so this does it. The website checks CRON_SECRET (same value in both places).
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const r = await fetch(`${env.SITE_URL || 'https://lobistarsfc.com'}/api/internal/kitchen-repeat`, {
          method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        });
        if (!r.ok) console.error('kitchen-repeat', r.status, await r.text());
      } catch (err) {
        console.error('kitchen-repeat failed', err);
      }
    })());
  },
};

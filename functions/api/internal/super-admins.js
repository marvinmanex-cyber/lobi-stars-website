import { syncSuperAdmins } from '../_lib/superAdmins.js';

// POST /api/internal/super-admins -- called every minute by the cron Worker
// ("Authorization: Bearer <CRON_SECRET>"). Keeps the Super Admin accounts in line
// with the SUPER_ADMIN_EMAILS server setting: notices changes to the list (recorded
// and emailed to the Super Admins), makes or upgrades their accounts, sends their
// invites once invites are switched on, and moves anyone else with the role to Head of Media.
export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const r = await syncSuperAdmins(env, new URL(request.url).origin);
    return Response.json({ ok: true, list: r.list.length, created: r.created.length, upgraded: r.upgraded.length, invited: r.invited.length, moved: r.moved.length, changed: r.changed });
  } catch (err) {
    console.error('[super admins]', err);
    return Response.json({ ok: false }, { status: 500 });
  }
}

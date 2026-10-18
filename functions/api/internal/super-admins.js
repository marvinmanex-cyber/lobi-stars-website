import { syncSuperAdmins, superAdminEmails } from '../_lib/superAdmins.js';
import { notifyPendingStatements } from '../_lib/approvals.js';
import { securitySettings, saveSecuritySetting, securityEmail, sha256Hex } from '../_lib/adminSecurity.js';
import { logAdminAction } from '../_lib/adminSession.js';

// POST /api/internal/super-admins -- called every minute by the cron Worker
// ("Authorization: Bearer <CRON_SECRET>"). The security watch:
// - keeps the Super Admin accounts in line with the SUPER_ADMIN_EMAILS server setting
//   (changes recorded and emailed, accounts made or upgraded, invites sent once,
//   anyone else with the role moved to Head of Media);
// - emails the Super Admins once about each new official statement waiting for approval;
// - notices when a payment or email key is changed in Cloudflare (only a short
//   fingerprint is kept, never the key) and tells the Super Admins.
const WATCHED_KEYS = ['PAYSTACK_SECRET_KEY', 'PAYSTACK_PUBLIC_KEY', 'RESEND_API_KEY', 'RESEND_FROM', 'NEWSLETTER_FROM', 'TURNSTILE_SECRET_KEY'];

export async function onRequestPost({ request, env }) {
  if (!env.CRON_SECRET || request.headers.get('Authorization') !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  const origin = new URL(request.url).origin;
  const out = {};
  try {
    const r = await syncSuperAdmins(env, origin);
    Object.assign(out, { list: r.list.length, created: r.created.length, upgraded: r.upgraded.length, invited: r.invited.length, moved: r.moved.length, changed: r.changed });
  } catch (err) { console.error('[security watch] super admins', err); out.superAdminsError = true; }
  try { out.statementsNotified = await notifyPendingStatements(env, origin); } catch (err) { console.error('[security watch] statements', err); }
  try { out.keysChanged = await watchKeys(env, origin); } catch (err) { console.error('[security watch] keys', err); }
  return Response.json({ ok: true, ...out });
}

/** Payment and email keys: which ones changed since last time (by name only). */
async function watchKeys(env, origin) {
  const now = {};
  for (const k of WATCHED_KEYS) now[k] = env[k] ? (await sha256Hex(`lobi:${env[k]}`)).slice(0, 12) : '';
  const s = await securitySettings(env.DB);
  let before = null;
  try { before = s.key_fingerprints ? JSON.parse(s.key_fingerprints) : null; } catch { before = null; }
  const changed = before ? WATCHED_KEYS.filter(k => (before[k] || '') !== now[k]) : [];
  if (!before || changed.length) await saveSecuritySetting(env.DB, 'key_fingerprints', JSON.stringify(now), 'Security watch');
  if (!changed.length) return [];
  const what = changed.map(k => `${k} ${now[k] ? (before[k] ? 'changed' : 'added') : 'removed'}${k === 'PAYSTACK_SECRET_KEY' && env[k] ? ` (now ${String(env[k]).startsWith('sk_live') ? 'LIVE' : 'TEST'} mode)` : ''}`);
  await logAdminAction(env.DB, { id: 'system', name: 'Security watch' }, 'service_key_changed', what.join('; '));
  await securityEmail(env, superAdminEmails(env), 'Lobi Stars admin: a payment or email key was changed', [
    'A service key in Cloudflare (Workers & Pages › lobi-stars-website › Settings › Variables and Secrets) was changed:',
    what.map(w => `• ${w}`).join('<br>'),
    "If one of you did this, there's nothing to do. If not, check the setting in Cloudflare straight away and tell the developer."], origin);
  return changed;
}

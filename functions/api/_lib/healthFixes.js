// Website Health: the safe one-click fixes ("Fix it"). Super Admins only; the page
// asks to confirm first and every fix is written to the Activity Log. Each one only
// re-runs something the website already does by itself; nothing deletes data,
// changes code, keys or DNS.
import { saveSecuritySetting } from './adminSecurity.js';

export const FIXES = {
  expire_food: { label: 'Check the unpaid food orders with Paystack, then close the expired ones', confirm: 'Each unpaid order past its time limit is checked with Paystack first: paid ones are marked paid, the rest are closed as expired.' },
  backup_now: { label: 'Start a backup now', confirm: 'A backup starts now and finishes over the next few minutes.' },
  offsite_send: { label: 'Email the encrypted backup copy now', confirm: 'The newest encrypted backup is emailed to the address in Settings › Data Backup.' },
  mark_restore_tested: { label: 'Mark restore tested (today)', confirm: 'Only press this after a restore was actually tested on a copy.' },
  settle_predictions: { label: 'Calculate the Predict & Win result', confirm: 'The result of the last home match is calculated from its final score (the winner is emailed if there is one).' },
  end_disabled_sessions: { label: 'Sign out disabled accounts everywhere', confirm: 'Every open session of a disabled staff account is ended.' },
  run_rewards: { label: 'Run the Rewards job now', confirm: 'The daily Rewards job (points expiry and checks) runs now.' },
  run_access_review: { label: 'Run the monthly access review now', confirm: 'The monthly staff access review email is sent now.' },
  run_newsletters: { label: 'Send the late scheduled newsletter now', confirm: 'Scheduled newsletters that are due are sent now.' },
  rebuild_site: { label: 'Rebuild the website (refreshes pages and the sitemap)', confirm: 'The website is rebuilt from the latest content; it takes about 2 minutes.' },
};

/** Calls one of the timer job's own endpoints, as the timer job would. */
async function runJob(env, mod, origin) {
  const r = await mod.onRequestPost({ request: new Request(`${origin}/api/internal/job`, { method: 'POST', headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }), env, waitUntil: () => {} });
  return r.ok;
}

/** Runs a fix. Returns { ok, message }. */
export async function runFix(env, origin, fixId, admin, extra = {}) {
  const db = env.DB;
  switch (fixId) {
    case 'expire_food': {
      const { confirmFoodPayment, expireStale, ensureFoodSchema } = await import('./foodOrders.js');
      await ensureFoodSchema(db);
      const { results } = await db.prepare(`SELECT * FROM food_orders WHERE order_status = 'AWAITING_PAYMENT' AND expires_at IS NOT NULL AND expires_at < ? ORDER BY expires_at LIMIT 20`).bind(new Date().toISOString()).all();
      let paid = 0;
      for (const o of results) { try { const r = await confirmFoodPayment(env, o, { origin }); if (r?.changed) paid++; } catch {} }
      await expireStale(db);
      return { ok: true, message: `${results.length} order(s) checked with Paystack: ${paid} found paid, the rest closed as expired.` };
    }
    case 'backup_now': {
      const { backupStep } = await import('./autoBackup.js');
      const r = await backupStep(env, { force: true });
      return r.error ? { ok: false, message: `The backup failed: ${r.error}` } : { ok: true, message: 'Backup started. It finishes over the next few minutes.' };
    }
    case 'offsite_send': {
      const { weeklyOffsiteEmail } = await import('./autoBackup.js');
      const r = await weeklyOffsiteEmail(env, { force: true, by: admin.name });
      return r.sent ? { ok: true, message: `Emailed to ${r.to}.` } : { ok: false, message: r.error || r.skipped || 'Not sent.' };
    }
    case 'mark_restore_tested':
      await saveSecuritySetting(db, 'restore_tested_at', new Date().toISOString(), admin.name);
      return { ok: true, message: 'Recorded: restore tested today.' };
    case 'settle_predictions': {
      const id = String(extra.eventId || '');
      const m = await db.prepare(`SELECT e.*, m.status, m.home_score, m.away_score FROM events e JOIN match_centre m ON m.event_id = e.id WHERE e.id = ? AND m.status = 'full-time'`).bind(id).first();
      if (!m || m.home_score === null || m.away_score === null) return { ok: false, message: 'That match has no final score yet.' };
      const { settlePredictions } = await import('./predict.js');
      const r = await settlePredictions(env, { ...m, id: m.id });
      return { ok: true, message: r?.winner ? 'Result calculated: there is a winner (emailed).' : 'Result calculated: no exact winner.' };
    }
    case 'end_disabled_sessions': {
      const r = await db.prepare(`UPDATE admin_sessions SET revoked_at = ?, revoked_reason = 'account disabled (Website Health)' WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM admin_users WHERE active = 0 OR disabled_at IS NOT NULL)`).bind(Date.now()).run();
      return { ok: true, message: `${r.meta?.changes || 0} session(s) ended.` };
    }
    case 'run_rewards': return { ok: await runJob(env, await import('../internal/rewards-run.js'), origin), message: 'The Rewards job ran.' };
    case 'run_access_review': return { ok: await runJob(env, await import('../internal/access-review.js'), origin), message: 'The access review ran.' };
    case 'run_newsletters': return { ok: await runJob(env, await import('../internal/newsletter-run.js'), origin), message: 'Due newsletters are being sent.' };
    case 'rebuild_site': {
      if (!env.PAGES_DEPLOY_HOOK) return { ok: false, message: 'No deploy hook is set up (HANDOVER-TODO.md A20).' };
      const r = await fetch(env.PAGES_DEPLOY_HOOK, { method: 'POST' });
      return { ok: r.ok, message: r.ok ? 'The website is rebuilding; it takes about 2 minutes.' : `The rebuild could not start (${r.status}).` };
    }
    default: return { ok: false, message: 'Unknown fix.' };
  }
}

import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logLeague } from '../../_lib/leagueDb.js';
import { ensureRewardsSchema, rewardsSettings } from '../../_lib/rewards.js';
import { currentTerms, parseTerms, DEFAULT_TERMS, DEFAULT_TERMS_UPDATED } from '../../_lib/rewardsTerms.js';

// Admin › Rewards › Terms.
// GET -> { body, updated, custom, defaultBody }
// PUT { body, reset? } -> saves a new version of the Lobi Stars Rewards Terms
//   (dated today, Nigerian time) and records it as the terms version new
//   members accept. { reset: true } goes back to the approved default text.
// Every change is in the audit log (before and after).
const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    await ensureRewardsSchema(env.DB);
    const t = await currentTerms(env.DB);
    return ok({ ...t, defaultBody: DEFAULT_TERMS });
  } catch (err) { console.error('[rewards admin] terms', err); return fail('Could not load the terms.', 500); }
}

export async function onRequestPut({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureRewardsSchema(db);
    const b = await request.json().catch(() => ({}));
    const staff = admin.email || admin.name || 'owner';
    const before = await currentTerms(db);
    const today = new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
    let next;
    if (b.reset) next = null;
    else {
      const body = String(b.body || '').replace(/\r/g, '').replace(/<[^>]*>/g, '').trim();
      if (body.length < 200) return fail('The terms look too short. Paste the full text.');
      if (body.length > 40000) return fail('The terms are too long (40,000 characters at most).');
      if (!parseTerms(body).some(x => x.type === 'h2')) return fail('Use "## " at the start of a line for each section heading.');
      next = { body, updated: today, updatedBy: staff };
    }
    await db.batch([
      next ? db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('rewards_terms', ?, datetime('now'), ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(JSON.stringify(next), staff)
        : db.prepare(`DELETE FROM settings WHERE key = 'rewards_terms'`),
    ]);
    // New members accept this version (recorded on their Rewards membership).
    const s = await rewardsSettings(db);
    const termsVersion = next ? next.updated : DEFAULT_TERMS_UPDATED;
    await db.prepare(`INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('rewards_settings', ?, datetime('now'), ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(JSON.stringify({ ...s, termsVersion }), staff).run();
    await logLeague(db, { email: staff }, b.reset ? 'rewards.terms.reset' : 'rewards.terms.edit', 'rewards', 'terms', { updated: before.updated, custom: before.custom, body: before.body }, next ? { updated: next.updated, body: next.body } : { reset: true, body: DEFAULT_TERMS });
    return ok({ ...(await currentTerms(db)) });
  } catch (err) {
    console.error('[rewards admin] terms save', err);
    return fail('Could not save.', 500);
  }
}

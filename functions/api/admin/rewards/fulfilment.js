import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logLeague } from '../../_lib/leagueDb.js';
import { memberNo } from '../../_lib/rewards.js';
import { ensureCatalogueSchema, publicRedemption, refundRedemption, topUp } from '../../_lib/rewardsCatalogue.js';

// Admin › Rewards › Fulfilment and vouchers.
// GET ?view=queue          -> redemptions waiting for the club: airtime/data to send by hand or failing,
//                             experiences and items requested/confirmed (with the fan's contact details)
// GET ?code=LSR-XXXX-XXXX  -> look up a voucher (stadium food stands, club shop)
// POST { id, action, note } -> deliver (manual top-up sent), retry, confirm, fulfil, collect, use (voucher), refund (points back)
// Every action goes to the audit log.
const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

const withFan = async (db, r) => {
  const m = await db.prepare(`SELECT m.first_name, m.last_name, m.email, m.phone_e164, r.seq FROM members m JOIN rewards_members r ON r.member_id = m.id WHERE m.id = ?`).bind(r.member_id).first();
  return { ...publicRedemption(r), fan: m ? { name: `${m.first_name} ${m.last_name}`, email: m.email, phone: m.phone_e164, memberNo: memberNo(m.seq) } : null,
    fullPhone: JSON.parse(r.details_json || '{}').phone || null, attempts: r.attempts, lastError: r.last_error };
};

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureCatalogueSchema(db);
    const url = new URL(request.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (code) {
      const r = await db.prepare(`SELECT * FROM rewards_redemptions WHERE voucher_code = ?`).bind(code).first();
      if (!r) return fail('No voucher with that code.', 404);
      return ok({ voucher: await withFan(db, r) });
    }
    const { results } = await db.prepare(`SELECT * FROM rewards_redemptions WHERE status IN ('manual', 'retry', 'failed', 'requested', 'confirmed') ORDER BY created_at LIMIT 200`).all();
    const queue = [];
    for (const r of results) queue.push(await withFan(db, r));
    return ok({ queue });
  } catch (err) {
    console.error('[rewards admin] fulfilment', err);
    return fail('Could not load.', 500);
  }
}

const NEXT = {
  deliver: { from: ['manual', 'retry', 'failed'], to: 'delivered' },
  confirm: { from: ['requested'], to: 'confirmed' },
  fulfil: { from: ['requested', 'confirmed'], to: 'fulfilled' },
  collect: { from: ['requested', 'confirmed'], to: 'collected' },
  use: { from: ['issued'], to: 'used' },
};

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureCatalogueSchema(db);
    const b = await request.json().catch(() => ({}));
    const staff = admin.email || admin.name || 'owner';
    const r = await db.prepare(`SELECT * FROM rewards_redemptions WHERE id = ?`).bind(String(b.id || '')).first();
    if (!r) return fail('Not found.', 404);
    const note = String(b.note || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
    if (b.action === 'refund') {
      if (note.length < 3) return fail('Give the reason (it is shown to the fan).');
      if (!(await refundRedemption(env, r, note))) return fail('This one can no longer be refunded.', 409);
    } else if (b.action === 'retry') {
      if (!['retry', 'failed', 'manual'].includes(r.status)) return fail('Only airtime/data waiting or failing can be retried.', 409);
      await topUp(env, { ...r, details_json: JSON.stringify({ ...JSON.parse(r.details_json || '{}'), manual: false }) });
    } else if (NEXT[b.action]) {
      if (r.type === 'voucher' && r.status === 'issued' && r.expires_at && Date.parse(r.expires_at) < Date.now()) return fail('This voucher has expired.', 409);
      const n = NEXT[b.action];
      const u = await db.prepare(`UPDATE rewards_redemptions SET status = ?, updated_at = datetime('now'), updated_by = ?, last_error = COALESCE(?, last_error) WHERE id = ? AND status IN (${n.from.map(() => '?').join(',')})`)
        .bind(n.to, staff, note || null, r.id, ...n.from).run();
      if (!u.meta.changes) return fail(b.action === 'use' ? 'This voucher has already been used or is not valid.' : 'That step is not possible now.', 409);
    } else return fail('Unknown action.');
    await logLeague(db, { email: staff }, `rewards.redemption.${b.action}`, 'rewards_redemption', r.id, { status: r.status }, { action: b.action, note });
    return ok({ redemption: await withFan(db, await db.prepare(`SELECT * FROM rewards_redemptions WHERE id = ?`).bind(r.id).first()) });
  } catch (err) {
    console.error('[rewards admin] fulfilment action', err);
    return fail('Could not do that.', 500);
  }
}

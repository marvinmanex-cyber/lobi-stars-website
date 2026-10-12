import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { seasonSettings, availability, upcomingHomeMatches, ensureSeasonSchema, TIERS, TIER_LABELS } from '../_lib/seasonTickets.js';
import { seasonConfig } from '../_lib/seasonConfig.js';

// GET  /api/admin/season-tickets  -- settings, availability per stand, sales, passes
// POST /api/admin/season-tickets
//      { settings: { enabled, season, info, tiers: { VIP: { priceNaira, limit }, … } } }
//      { voidPass: id } / { restorePass: id }   -- cancel or restore one season ticket
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const s = await seasonSettings(db, (await seasonConfig(env, request)).currentSeason);
    const [orders, passes, scans] = await db.batch([
      db.prepare(`SELECT id, season, tier, quantity, total_kobo, buyer_name, buyer_email, buyer_phone, payment_status, emailed, created_at, paid_at
        FROM season_orders WHERE payment_status = 'paid' OR created_at > datetime('now', '-1 day') ORDER BY created_at DESC LIMIT 300`),
      db.prepare(`SELECT p.id, p.order_id, p.tier, p.status, p.holder_name, (SELECT COUNT(*) FROM season_pass_scans x WHERE x.pass_id = p.id) AS used
        FROM season_passes p WHERE p.season = ? ORDER BY p.created_at DESC LIMIT 1000`).bind(s.season),
      db.prepare(`SELECT COUNT(*) AS n FROM season_pass_scans x JOIN season_passes p ON p.id = x.pass_id WHERE p.season = ?`).bind(s.season),
    ]);
    const paid = orders.results.filter(o => o.payment_status === 'paid' && o.season === s.season);
    return Response.json({
      settings: s, labels: TIER_LABELS,
      availability: Object.values(await availability(db, s)),
      homeMatchesLeft: (await upcomingHomeMatches(db, s.season)).length,
      totals: { passes: paid.reduce((a, o) => a + o.quantity, 0), revenueKobo: paid.reduce((a, o) => a + o.total_kobo, 0), gateScans: scans.results[0]?.n || 0 },
      orders: orders.results, passes: passes.results,
      paystackLive: !!env.PAYSTACK_SECRET_KEY && !String(env.PAYSTACK_SECRET_KEY).startsWith('sk_test'),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[season admin]', err);
    return Response.json({ error: 'Could not load season tickets.' }, { status: 500 });
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureSeasonSchema(db);
    const b = await request.json().catch(() => ({}));
    if (b.settings) {
      const x = b.settings;
      const season = String(x.season || '').trim().slice(0, 20);
      if (!/^\d{4}\/\d{2}$/.test(season)) return Response.json({ error: 'Season must look like 2026/27.' }, { status: 400 });
      const tiers = {};
      for (const t of TIERS) {
        const naira = Number(x.tiers?.[t]?.priceNaira || 0), limit = Number(x.tiers?.[t]?.limit || 0);
        if (!Number.isFinite(naira) || naira < 0 || naira > 10_000_000) return Response.json({ error: `${TIER_LABELS[t]}: enter a price in naira (0 = not on sale).` }, { status: 400 });
        if (!Number.isInteger(limit) || limit < 0 || limit > 100_000) return Response.json({ error: `${TIER_LABELS[t]}: the number of season tickets must be a whole number (0 = no limit).` }, { status: 400 });
        tiers[t] = { priceKobo: Math.round(naira * 100), limit };
      }
      if (x.enabled === true && !TIERS.some(t => tiers[t].priceKobo > 0)) return Response.json({ error: 'Set a price for at least one stand before switching season tickets on.' }, { status: 400 });
      const info = String(x.info || '').replace(/<[^>]*>/g, '').trim().slice(0, 600);
      const now = new Date().toISOString();
      const put = (k, v) => db.prepare(`INSERT INTO season_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`).bind(k, v, now, admin.name);
      await db.batch([put('enabled', x.enabled === true ? 'true' : 'false'), put('season', season), put('info', info), put('tiers', JSON.stringify(tiers))]);
      await logAdminAction(db, admin, 'season_settings', `${season}: ${x.enabled === true ? 'ON' : 'off'}; ${TIERS.map(t => `${TIER_LABELS[t]} ₦${tiers[t].priceKobo / 100}${tiers[t].limit ? ` x${tiers[t].limit}` : ''}`).join(', ')}`);
      return Response.json({ ok: true });
    }
    for (const [key, status] of [['voidPass', 'void'], ['restorePass', 'valid']]) {
      if (b[key]) {
        const id = String(b[key]).toUpperCase();
        const r = await db.prepare(`UPDATE season_passes SET status = ? WHERE id = ?`).bind(status, id).run();
        if (!r.meta?.changes) return Response.json({ error: 'Season ticket not found.' }, { status: 404 });
        await logAdminAction(db, admin, key === 'voidPass' ? 'season_pass_void' : 'season_pass_restore', id);
        return Response.json({ ok: true });
      }
    }
    return Response.json({ error: 'Nothing to do.' }, { status: 400 });
  } catch (err) {
    console.error('[season admin] post', err);
    return Response.json({ error: 'Could not save.' }, { status: 500 });
  }
}

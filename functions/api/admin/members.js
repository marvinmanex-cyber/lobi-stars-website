import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureMembershipSchema, setMembership, MEMBERSHIP } from '../_lib/membership.js';
import { seasonConfig } from '../_lib/seasonConfig.js';

const noStore = { 'Cache-Control': 'no-store' };
const view = r => ({
  id: r.id, name: `${r.first_name} ${r.last_name}`.trim(), email: r.email, phone: r.phone_e164 || r.phone || '',
  verified: !!r.email_verified, signedUpAsMember: r.tier === 'Official', season: r.membership_season || null,
  since: r.membership_since || null, source: r.membership_source || null, note: r.membership_note || '',
});

// GET /api/admin/members[?q=search] -- this season's confirmed members, or
// fan accounts matching a name, email, phone or member number.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureMembershipSchema(env.DB);
  const { currentSeason } = await seasonConfig(env, request);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().toLowerCase().slice(0, 80);
  const cols = `id, first_name, last_name, email, phone, phone_e164, email_verified, tier, membership_season, membership_since, membership_source, membership_note`;
  let rows;
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/\D/g, '');
    rows = (await env.DB.prepare(
      `SELECT ${cols} FROM members WHERE lower(id) LIKE ? OR lower(email) LIKE ? OR lower(first_name || ' ' || last_name) LIKE ? OR (? != '' AND phone_e164 LIKE ?)
       ORDER BY created_at DESC LIMIT 30`
    ).bind(like, like, like, digits, `%${digits.slice(-9)}%`).all()).results;
  } else {
    rows = (await env.DB.prepare(`SELECT ${cols} FROM members WHERE membership_season = ? ORDER BY membership_since DESC`).bind(currentSeason).all()).results;
  }
  const pending = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE tier = 'Official' AND (membership_season IS NULL OR membership_season != ?)`).bind(currentSeason).first()).n;
  return Response.json({ season: currentSeason, priceKobo: MEMBERSHIP.priceKobo, onlinePayment: MEMBERSHIP.onlinePayment, pendingSignups: pending, query: q, members: rows.map(view) }, { headers: noStore });
}

// POST /api/admin/members { memberId, action: 'confirm' | 'remove', note } -- confirm a fan's
// membership for the current season (after they have paid) or remove it.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { b = {}; }
  await ensureMembershipSchema(env.DB);
  const m = await env.DB.prepare(`SELECT id, first_name, last_name FROM members WHERE id = ?`).bind(String(b.memberId || '')).first();
  if (!m) return Response.json({ error: 'Fan account not found.' }, { status: 404 });
  const { currentSeason } = await seasonConfig(env, request);
  if (b.action === 'confirm') {
    const note = String(b.note || '').trim().slice(0, 200);
    if (!note) return Response.json({ error: 'Note how the membership was paid (e.g. "Cash at club office, receipt 0123").' }, { status: 400 });
    await setMembership(env.DB, m.id, { season: currentSeason, source: 'staff', note: `${note} (by ${admin.name})` });
    await logAdminAction(env.DB, admin, 'membership_confirm', `${m.first_name} ${m.last_name} (${m.id}) ${currentSeason}`);
  } else if (b.action === 'remove') {
    await setMembership(env.DB, m.id, { season: null });
    await logAdminAction(env.DB, admin, 'membership_remove', `${m.first_name} ${m.last_name} (${m.id})`);
  } else return Response.json({ error: 'Unknown action' }, { status: 400 });
  return Response.json({ ok: true }, { headers: noStore });
}

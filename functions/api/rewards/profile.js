import { readSession } from '../_lib/session.js';
import { ensureFanSchema, clientIp, rateLimit, tooMany } from '../_lib/fans.js';
import { ensureRewardsSchema, profileBonus, cleanDob, NIGERIAN_STATES, pointsSummary } from '../_lib/rewards.js';

// POST /api/rewards/profile { state, dateOfBirth } -- the fan's state of
// residence and date of birth (YYYY-MM-DD). When both are set, a Rewards
// member gets the profile bonus once (needs a verified email).
export async function onRequestPost({ request, env }) {
  try {
    const db = env.DB;
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `rewards-profile:${clientIp(request)}`, 30, 3600))) return tooMany();
    const memberId = await readSession(request, env.SESSION_SECRET);
    if (!memberId) return Response.json({ error: 'Please log in first.' }, { status: 401 });
    const b = await request.json().catch(() => ({}));
    const state = String(b.state || '').trim();
    if (!NIGERIAN_STATES.includes(state)) return Response.json({ errors: { state: 'Choose your state of residence.' } }, { status: 400 });
    const dob = cleanDob(b.dateOfBirth);
    if (!dob) return Response.json({ errors: { dateOfBirth: 'Enter your real date of birth.' } }, { status: 400 });
    await ensureRewardsSchema(db);
    await db.prepare(`UPDATE members SET state = ?, date_of_birth = ? WHERE id = ?`).bind(state, dob, memberId).run();
    const awarded = await profileBonus(db, memberId);
    const sum = await pointsSummary(db, memberId);
    return Response.json({ ok: true, awarded, balance: sum.balance });
  } catch (err) {
    console.error('[rewards] profile', err);
    return Response.json({ error: 'Could not save just now. Please try again.' }, { status: 500 });
  }
}

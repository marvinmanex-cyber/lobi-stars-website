import { readSession } from '../_lib/session.js';
import { ensureFanSchema } from '../_lib/fans.js';

export async function onRequestGet({ request, env }) {
  const memberId = await readSession(request, env.SESSION_SECRET);
  if (!memberId) return Response.json({ member: null });

  await ensureFanSchema(env.DB);
  const member = await env.DB.prepare(
    `SELECT id, first_name, last_name, email, tier, email_verified FROM members WHERE id = ?`
  ).bind(memberId).first();
  if (!member) return Response.json({ member: null });

  return Response.json({
    member: {
      id: member.id, firstName: member.first_name, lastName: member.last_name, email: member.email,
      tier: member.tier, emailVerified: !!member.email_verified,
    },
  });
}

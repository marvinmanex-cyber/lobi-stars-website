import { ensureFanSchema, consumeToken, safeNext } from '../_lib/fans.js';

// GET /api/fans/verify?token=... -- the link in the confirmation email.
// Marks the account verified and sends the fan to the login page.
export async function onRequestGet({ request, env }) {
  await ensureFanSchema(env.DB);
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const memberId = await consumeToken(env.DB, url.searchParams.get('token'), 'verify');

  const login = new URL('/fans/login/', url);
  if (next !== '/') login.searchParams.set('next', next);
  if (!memberId) {
    login.searchParams.set('verify', 'expired');
  } else {
    await env.DB.prepare(`UPDATE members SET email_verified = 1, email_verified_at = datetime('now') WHERE id = ?`).bind(memberId).run();
    login.searchParams.set('confirmed', '1');
  }
  return Response.redirect(login.toString(), 302);
}

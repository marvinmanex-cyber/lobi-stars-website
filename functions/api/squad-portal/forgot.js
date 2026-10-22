import { requestNewPassword, portalJson } from '../_lib/squadPortal.js';

// POST /api/squad-portal/forgot { name, contact, turnstile? }
// "Forgot the password?" on the portal sign-in page: a new password is made and
// emailed only to the Super Admins. The answer never contains it, just the message
// to show: "Contact your admin for your new password."
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return portalJson({ error: 'This request came from another website and was refused.' }, 403);
  const b = await request.json().catch(() => ({}));
  const r = await requestNewPassword(env, request, b);
  if (r.error) return portalJson({ error: r.error, field: r.field || null, needTurnstile: !!r.needTurnstile }, r.status || 400);
  return portalJson({ ok: true, message: 'Contact your admin for your new password.' });
}

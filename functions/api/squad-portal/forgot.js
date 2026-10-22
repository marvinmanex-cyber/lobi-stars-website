import { requestNewPassword, portalJson } from '../_lib/squadPortal.js';
import { notifyPasswordRequest } from '../_lib/squadNotify.js';

// POST /api/squad-portal/forgot { name, contact, turnstile? }
// "Forgot the password?" on the portal sign-in page: the Super Admins are told
// (email + bell) and send a new password themselves. Nothing secret is sent back.
export async function onRequestPost({ request, env, waitUntil }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return portalJson({ error: 'This request came from another website and was refused.' }, 403);
  const b = await request.json().catch(() => ({}));
  const r = await requestNewPassword(env, request, b);
  if (r.error) return portalJson({ error: r.error, field: r.field || null, needTurnstile: !!r.needTurnstile }, r.status || 400);
  const mail = notifyPasswordRequest(env, r.request).catch(err => console.error('[squad] reset email', err));
  if (waitUntil) waitUntil(mail); else await mail;
  return portalJson({ ok: true });
}

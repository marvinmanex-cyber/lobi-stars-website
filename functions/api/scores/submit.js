import { submitterFor, openFixtures, submitFromForm } from '../_lib/scores/submitters.js';
import { ensureFanSchema, rateLimit, checkTurnstile } from '../_lib/fans.js';

// POST /api/scores/submit -- the club network score form (/scores/submit/), no login:
// the approved submitter's secret link token (t) or 8-digit PIN identifies them.
// { action: 'open', t | pin }                                   -- who they are and today's matches
// { action: 'send', t | pin, fixtureId, homeGoals, awayGoals, status, minute, turnstile }
// Rate-limited per connection; wrong links/PINs are limited harder. Human check (Turnstile) on sending.
const j = (d, status = 200) => Response.json(d, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  await ensureFanSchema(db);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `scoresub:${ip}`, 60, 3600))) return j({ error: 'Too many requests. Please wait a few minutes.' }, 429);
  const b = await request.json().catch(() => ({}));
  const s = await submitterFor(env, { token: String(b.t || ''), pin: String(b.pin || '').replace(/\D/g, '') });
  if (!s) {
    if (!(await rateLimit(db, `scoresub-bad:${ip}`, 10, 3600))) return j({ error: 'Too many wrong attempts. Try again in an hour.' }, 429);
    return j({ error: 'This link or PIN is not valid (or has been replaced). Ask the Lobi Stars Website & Data Officer for a new one.' }, 403);
  }
  if (b.action === 'open') {
    const fixtures = await openFixtures(env);
    return j({ ok: true, submitter: { name: s.name, club: s.club }, fixtures });
  }
  if (b.action === 'send') {
    if (!(await rateLimit(db, `scoresub-sender:${s.id}`, 40, 3600))) return j({ error: 'That is a lot of updates in one hour. Please wait a little.' }, 429);
    if (!(await checkTurnstile(env, b.turnstile, ip))) return j({ error: 'Please complete the human check and try again.' }, 400);
    const r = await submitFromForm(env, s, b);
    if (r.error) return j(r, 400);
    return j({ ok: true, received: true });
  }
  return j({ error: 'Unknown action' }, 400);
}

import { ensureAccreditationSchema, openMatches, eventById, checkApplication, apply, updateApplication, publicByUpdateToken, prefillFromInvite, ROLES } from '../../_lib/mediaAccreditation.js';
import { formToken, formTokenProblem } from '../../_lib/mediaFormToken.js';
import { mcSettings } from '../../_lib/mediaCentre.js';
import { storeFile } from '../../_lib/mediaFiles.js';
import { ensureFanSchema, rateLimit } from '../../_lib/fans.js';
import { matchSlug } from '../../_lib/matchSlug.js';

// Public: the media accreditation form (/media/accreditation/).
// GET  ?match=<slug|id>&update=<token>&invite=<token> -- upcoming home matches (and whether each is still open), roles,
//      the match to preselect, an application to update (after "more information needed"), the saved details
//      of a journalist an invitation was emailed to, and the form token.
// POST multipart: eventId, fullName, phone, email, organisation, employment, role, equipment, needs, agree,
//      pressDoc (PDF/JPG, 5 MB), photo (JPEG passport photo, cropped in the browser), update (token), invite, website (must stay empty),
//      formToken (from the GET).
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function onRequestGet({ request, env }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const u = new URL(request.url), settings = await mcSettings(db);
  const matches = await openMatches(db, settings);
  const pick = u.searchParams.get('match');
  let selected = null;
  if (pick) { const e = await eventById(db, pick); if (e) selected = matches.find(m => m.id === e.id || m.slug === matchSlug(e)) || null; }
  const update = u.searchParams.get('update') ? await publicByUpdateToken(db, u.searchParams.get('update')) : null;
  const invited = u.searchParams.get('invite') ? await prefillFromInvite(db, u.searchParams.get('invite')) : null;
  return J({ matches, selected: selected?.id || update?.eventId || null, roles: ROLES, closeHours: Number(settings.accreditation_close_hours), update, invited, formToken: await formToken(env, 'accreditation') });
}

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  await ensureFanSchema(db); await ensureAccreditationSchema(db);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return J({ error: 'This request came from another website and was refused.' }, 403);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!(await rateLimit(db, `accred:${ip}`, 6, 3600))) return J({ error: 'Too many applications from this connection. Please try again later.' }, 429);
  let form;
  try { form = await request.formData(); } catch { return J({ error: 'Please fill in the form.' }, 400); }
  if (String(form.get('website') || '').trim()) return J({ ok: true }); // spam trap: looks accepted, nothing saved
  const tokenProblem = await formTokenProblem(env, 'accreditation', form.get('formToken'));
  if (tokenProblem) return J({ error: tokenProblem }, 400);
  const b = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const checked = checkApplication({ ...b, agree: b.agree });
  if (checked.error) return J({ error: checked.error }, 400);
  const v = checked.value;
  const store = async (field, kind) => {
    const f = form.get(field);
    if (!f || typeof f === 'string' || !f.size) return { id: null };
    const r = await storeFile(env, { blob: f, kind, name: f.name, owner: 'accreditation', byName: v.fullName });
    return r.error ? { error: `${field === 'photo' ? 'Passport photo' : 'Press ID / letter'}: ${r.error}` } : { id: r.file.id };
  };
  const doc = await store('pressDoc', 'document'); if (doc.error) return J({ error: doc.error }, 400);
  const photo = await store('photo', 'photo'); if (photo.error) return J({ error: photo.error }, 400);
  if (b.update) {
    const r = await updateApplication(env, request, b.update, v, { pressDocId: doc.id, photoId: photo.id });
    return r.ok ? J({ ok: true, updated: true }) : J({ error: r.error }, r.status || 400);
  }
  const r = await apply(env, request, v, { pressDocId: doc.id, photoId: photo.id, inviteToken: /^[\w-]{8,40}$/.test(b.invite || '') ? b.invite : null });
  return r.ok ? J({ ok: true }) : J({ error: r.error }, 400);
}

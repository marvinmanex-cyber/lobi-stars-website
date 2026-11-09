// /api/scores-centre/* -- the Scores Update Centre (see _lib/scoresCentre.js).
// POST login { code, name } · POST logout · GET session · GET week?week=<n> · POST update { fixtureId, homeGoals, awayGoals, status } · POST clear { fixtureId }
import { signIn, getSession, signOut, csrfProblem, weekView, updateScore, clearScore, clearCookie, json, IDLE_MS, STATUSES } from '../_lib/scoresCentre.js';

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
  try {
    if (route === 'login' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const r = await signIn(env, request, b);
      if (r.error) return json({ error: r.error }, r.status || 400);
      return json({ ok: true }, 200, { 'Set-Cookie': r.cookie });
    }
    const s = await getSession(request, env, { touch: route !== 'session' || method !== 'GET' });
    if (!s) return json({ error: 'Please sign in.', signedOut: true }, 401, { 'Set-Cookie': clearCookie() });
    if (method === 'POST') {
      const bad = csrfProblem(request, s);
      if (bad) return json({ error: bad }, 403);
    }
    const b = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const q = new URL(request.url).searchParams;
    switch (`${method} ${route}`) {
      case 'GET session': return json({ name: s.name, csrf: s.csrf, idleMinutes: IDLE_MS / 60e3, statuses: STATUSES });
      case 'POST logout': await signOut(env, s); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
      case 'GET week': {
        const r = await weekView(env, q.get('week'));
        return r.error ? json(r, 404) : json(r);
      }
      case 'POST update': {
        const r = await updateScore(env, s, b);
        return r.error ? json(r, 400) : json(r);
      }
      case 'POST clear': {
        const r = await clearScore(env, s, b.fixtureId);
        return r.error ? json(r, 400) : json(r);
      }
      default: return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[scores-centre]', err);
    return json({ error: 'Something went wrong; nothing was saved. Please try again.' }, 500);
  }
}

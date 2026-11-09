// /api/scores-centre/* -- the Scores Update Centre (see _lib/scoresCentre.js).
// POST login { code, name } · POST logout · GET session
// GET week?week=<n>|live · GET history?fixtureId=
// POST update { fixtureId, homeGoals, awayGoals, status, version, force } · POST undo { fixtureId } · POST clear { fixtureId }
// POST event { fixtureId, kind, side, player, minute } · POST event-remove { id } · POST note { fixtureId, note }
// POST clock { fixtureId, action: kickoff|second-half|reset } · POST cover { fixtureId, on }
import { signIn, getSession, signOut, csrfProblem, weekView, updateScore, clearScore, undoLast, history, addEvent, removeEvent, saveNote, setClock, setCover,
  clearCookie, json, IDLE_MS, STATUSES, EVENT_KINDS } from '../_lib/scoresCentre.js';

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
    const out = (r, okStatus = 200) => (r.conflict ? json(r, 409) : r.error ? json(r, 400) : json(r, okStatus));
    switch (`${method} ${route}`) {
      case 'GET session': return json({ name: s.name, csrf: s.csrf, idleMinutes: IDLE_MS / 60e3, statuses: STATUSES, eventKinds: EVENT_KINDS });
      case 'POST logout': await signOut(env, s); return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
      case 'GET week': {
        const w = q.get('week');
        const r = await weekView(env, w === null || w === '' ? null : w, s);
        return r.error ? json(r, 404) : json(r);
      }
      case 'GET history': { const r = await history(env, q.get('fixtureId')); return r.error ? json(r, 404) : json(r); }
      case 'POST update': return out(await updateScore(env, s, b));
      case 'POST undo': return out(await undoLast(env, s, b.fixtureId));
      case 'POST clear': return out(await clearScore(env, s, b.fixtureId));
      case 'POST event': return out(await addEvent(env, s, b));
      case 'POST event-remove': return out(await removeEvent(env, s, b.id));
      case 'POST note': return out(await saveNote(env, s, b));
      case 'POST clock': return out(await setClock(env, s, b));
      case 'POST cover': return out(await setCover(env, s, b));
      default: return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[scores-centre]', err);
    return json({ error: 'Something went wrong; nothing was saved. Please try again.' }, 500);
  }
}

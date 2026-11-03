// /api/gate-control/<route>: every Gate Control action (the session is checked
// by _middleware.js; data.gc = { id, csrf, user }).
//   POST login {login, password}   POST logout   GET session   POST gate {gate}
//   POST check {ticket, mode: admit|lookup, how: camera|typed}
//   POST readmit {ticket, reason}  (supervisors)
//   GET today   GET activity?staff&day&page[&format=csv]
//   GET staff   POST staff {action: add|edit|gates, …}  (Super Admins)
import { signIn, signOut, json, gateSettings, saveGates, permissions, gcLog, setGate, activityPage, listStaff, createStaff, updateStaff,
  onDuty, ROLES, oneLine, clearGateCookie } from '../_lib/gateControl.js';
import { checkTicket, readmitTicket, todayView } from '../_lib/gateCheck.js';

const denied = () => json({ error: "Your role can't do this. Ask a Gate Supervisor or a Super Admin.", denied: true }, 403);
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
const RESULT_WORDS = { admitted: 'Checked in', readmitted: 'Re-admitted', used: 'Refused: already used', fake: 'Refused: fake ticket', not_lobi: 'Refused: not a Lobi Stars ticket',
  wrong_match: 'Refused: wrong match', void: 'Refused: cancelled', unpaid: 'Refused: not paid', valid: 'Looked up (valid)', bad_number: 'Number to check' };

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const db = env.DB;
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  const q = new URL(request.url).searchParams;
  try {
    if (route === 'login' && method === 'POST') {
      const r = await signIn(env, request, body);
      if (!r.ok) return json({ error: r.error }, r.status || 400);
      return json({ ok: true }, 200, { 'Set-Cookie': r.cookie });
    }
    const S = data.gc;
    if (!S) return json({ error: 'Please sign in to Gate Control again.', signedOut: true }, 401);
    const user = S.user;
    const perms = permissions(user);

    switch (`${method} ${route}`) {
      case 'POST logout':
        await signOut(db, S, request);
        return json({ ok: true }, 200, { 'Set-Cookie': clearGateCookie() });
      case 'GET session':
        return json({ csrf: S.csrf, user: { name: user.name, firstName: user.firstName, code: user.code, role: user.role, roleLabel: user.roleLabel, kind: user.kind, gate: user.gate }, perms, gates: (await gateSettings(db)).gates });
      case 'POST gate': {
        const r = await setGate(db, S, body.gate, request);
        return r.error ? json({ error: r.error }, 400) : json(r);
      }
      case 'POST check': {
        if (!user.gate) return json({ error: 'Choose your gate first.', needGate: true }, 409);
        const mode = body.mode === 'lookup' ? 'lookup' : 'admit';
        const r = await checkTicket(env, String(body.ticket || '').slice(0, 300), { mode, how: body.how === 'typed' ? 'typed' : 'camera', who: { user, gate: user.gate }, request });
        await gcLog(db, user, `${RESULT_WORDS[r.code] || r.code}: ${r.ticket?.id || oneLine(body.ticket, 60)}${body.how === 'typed' ? ' (typed)' : ''}`,
          { kind: 'scan', details: r.code === 'admitted' || r.code === 'valid' ? null : r.reason, request });
        return json(r);
      }
      case 'POST readmit': {
        if (!perms.readmit) return denied();
        const r = await readmitTicket(env, body.ticket, { reason: body.reason, who: { user, gate: user.gate } });
        if (r.error) return json({ error: r.error }, 400);
        await gcLog(db, user, `Re-admitted ticket ${r.ticket.id}`, { kind: 'scan', details: body.reason, request });
        return json(r);
      }
      case 'GET today': return json({ ...(await todayView(env)), onDuty: await onDuty(db) });
      case 'GET activity': {
        const userId = perms.activityAll ? (q.get('staff') || '') : user.id;
        const csv = q.get('format') === 'csv';
        if (csv && !perms.activityAll) return denied();
        const r = await activityPage(db, { userId, day: q.get('day') || '', page: q.get('page') || 1, all: csv });
        if (csv) {
          const lines = [['Time (UTC)', 'Who', 'Staff ID / email', 'Gate', 'What happened', 'Details', 'IP address'].join(',')]
            .concat(r.rows.map(a => [a.at, a.actor_name, a.actor_code, a.gate, a.action, a.details, a.ip].map(csvCell).join(',')));
          await gcLog(db, user, 'Downloaded the activity log (CSV)', { kind: 'open', request });
          return new Response(`﻿${lines.join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="gate-control-activity-${q.get('day') || 'all'}.csv"`, 'Cache-Control': 'no-store' } });
        }
        return json({ ...r, rows: r.rows.map(a => ({ at: a.at, who: a.actor_name, code: a.actor_code, gate: a.gate, action: a.action, details: a.details })), all: perms.activityAll,
          staff: perms.activityAll ? (await listStaff(db)).map(s => ({ id: s.id, name: `${s.name} (${s.staffId})` })) : [] });
      }
      case 'GET staff':
        if (!perms.staff) return denied();
        return json({ staff: await listStaff(db), roles: ROLES, gates: (await gateSettings(db)).gates });
      case 'POST staff': {
        if (!perms.staff) return denied();
        if (body.action === 'add') { const r = await createStaff(env, user, request, body); return r.error ? json({ error: r.error }, 400) : json({ ok: true }); }
        if (body.action === 'edit') { const r = await updateStaff(env, user, request, body.id, body); return r.error ? json({ error: r.error }, 400) : json({ ok: true }); }
        if (body.action === 'gates') {
          const r = await saveGates(db, user.code, body.gates);
          if (r.error) return json({ error: r.error }, 400);
          await gcLog(db, user, 'Changed the list of gates', { kind: 'settings', details: r.gates.join(', '), request });
          return json(r);
        }
        return json({ error: 'Unknown action.' }, 400);
      }
      default:
        return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[gate control]', route, err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

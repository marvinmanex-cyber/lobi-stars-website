import { requireAdminUser } from '../_lib/adminEvents.js';
import { listDevices, createDevice, renewPasscode, revokeDevice, updateDevice, gateSettings, saveGates, saveGateStands, gcLog, ROLES } from '../_lib/gateControl.js';
import { todayView, dayStart } from '../_lib/gateCheck.js';
import { watchList } from '../_lib/gateExtras.js';

// Admin › Commerce › Lobi Gate Control: the scanners (phones / laptops) that check tickets
// at the gates. Live: how many scanners are active now, what each is doing (gate, scans
// today, last scan), the latest scans at every gate. Add a scanner (one-time passcode for
// the phone), give a new passcode, revoke a scanner at once, gates and stands.
//   GET                       -> { devices, activeNow, totals, latest, byGate, watch, gates, stands, roles }
//   POST { action: 'add', name, holder, role, gate }      -> { passcode, code, until }
//   POST { action: 'passcode' | 'revoke', id }  POST { action: 'edit', id, name, holder, role }
//   POST { action: 'gates', gates }  POST { action: 'stands', stands }
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
const who = admin => admin?.email || admin?.name || 'admin';

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    const [devices, today, g] = await Promise.all([listDevices(db, dayStart()), todayView(env), gateSettings(db)]);
    return J({
      devices, activeNow: devices.filter(d => d.online).length, switchedOn: devices.filter(d => d.status === 'active').length,
      totals: today.totals, match: today.match, latest: today.latest, byGate: today.byGate, stands: today.stands, byStaff: today.byStaff,
      watch: await watchList(db), gates: g.gates, gateStands: g.stands, roles: ROLES, at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin gate control]', err);
    return J({ error: 'Could not load the scanners.' }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB, b = await request.json().catch(() => ({})), by = who(admin);
    let r;
    if (b.action === 'add') r = await createDevice(env, by, b, request);
    else if (b.action === 'passcode') r = await renewPasscode(env, by, b.id, request);
    else if (b.action === 'revoke') r = await revokeDevice(env, by, b.id, request);
    else if (b.action === 'edit') r = await updateDevice(env, by, b.id, b, request);
    else if (b.action === 'gates') {
      r = await saveGates(db, by, b.gates);
      if (!r.error) await gcLog(db, { kind: 'admin', name: by, code: by }, 'Changed the list of gates', { kind: 'settings', details: r.gates.join(', '), request });
    } else if (b.action === 'stands') {
      r = await saveGateStands(db, by, b.stands);
      if (!r.error) await gcLog(db, { kind: 'admin', name: by, code: by }, 'Changed which stands each gate is for', { kind: 'settings', details: JSON.stringify(r.stands), request });
    } else return J({ error: 'Unknown action.' }, 400);
    return r.error ? J({ error: r.error }, 400) : J(r);
  } catch (err) {
    console.error('[admin gate control] post', err);
    return J({ error: 'Could not save.' }, 500);
  }
}

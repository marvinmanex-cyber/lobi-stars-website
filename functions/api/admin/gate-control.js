import { requireAdminUser } from '../_lib/adminEvents.js';
import { listDevices, createDevice, renewPasscode, revokeDevice, updateDevice, gateSettings, saveGates, saveGateStands, gcLog, ROLES, oneLine } from '../_lib/gateControl.js';
import { todayView, dayStart } from '../_lib/gateCheck.js';
import { watchList } from '../_lib/gateExtras.js';
import { todaysHomeMatch } from '../_lib/seasonTickets.js';
import {
  ensureMatchdaySchema, gatesStatus, setGates, capacitySettings, saveCapacity, capacityView, queueView, listBans, addBan, removeBan, systemMessage,
  readinessOf, reportRecipients, saveReportSettings, reportDelay, buildReport, reportHtml, sendReport, PRACTICE, PASS_CATEGORIES, passZones, savePassZones,
  listPasses, savePass, revokePass,
} from '../_lib/gateMatchday.js';

// Admin › Commerce › Lobi Gate Control: the scanners (phones / laptops) that check tickets
// at the gates, and running the gates on match day. Live: how many scanners are active
// and ready, what each is doing, the latest scans, how full each stand is, queue speed.
//   GET                       -> { devices (with readiness), activeNow, totals, latest, byGate, watch, gates, stands, roles,
//                                  gatesState, capacity, capacitySizes, queue, bans, report, practice }
//   GET ?view=report          -> the match-day report (HTML preview)
//   GET ?view=passes          -> { passes, zones, categories }
//   POST { action: 'add', name, holder, role, gate }      -> { passcode, code, until }
//   POST { action: 'passcode' | 'revoke', id }  POST { action: 'edit', id, name?, holder?, role?, gate? }  (supervisors: all gates)
//   POST { action: 'gates', gates }  POST { action: 'stands', stands }
//   POST { action: 'gates_mode', mode: auto|open|closed, openBefore? }   POST { action: 'capacity', capacity: {VIP, Premium, Regular} }
//   POST { action: 'ban_add', value, name, reason, until }   POST { action: 'ban_remove', id }
//   POST { action: 'message', to: all | gate:<name> | device:<id>, text, hours }
//   POST { action: 'report_settings', emails, delay }   POST { action: 'report_send' }
//   POST { action: 'pass_save', id?, name, organisation, category, zones, phone, notes, from, to }   POST { action: 'pass_revoke', id }   POST { action: 'zones', zones }
const J = (d, s = 200) => Response.json(d, { status: s, headers: { 'Cache-Control': 'no-store' } });
const who = admin => admin?.email || admin?.name || 'admin';

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureMatchdaySchema(db);
    const view = new URL(request.url).searchParams.get('view');
    if (view === 'report') {
      const r = await buildReport(env);
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Match-day gate report</title><body style="margin:0;padding:16px;background:#f3f4f6">${reportHtml(r)}</body>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    if (view === 'passes') {
      return J({ passes: await listPasses(db), zones: await passZones(db), categories: Object.fromEntries(Object.entries(PASS_CATEGORIES).map(([k, v]) => [k, v.label])), colours: Object.fromEntries(Object.entries(PASS_CATEGORIES).map(([k, v]) => [k, v.colour])) });
    }
    const match = await todaysHomeMatch(db).catch(() => null);
    const [devices, today, g] = await Promise.all([listDevices(db, dayStart()), todayView(env), gateSettings(db)]);
    const withReady = devices.map(d => ({ ...d, ready: readinessOf({ status: d.status, last_seen: d.lastSeen, role: d.role, gate: d.gateSet, gate_now: d.gate, readiness: d.readinessRaw, readiness_at: d.readinessAt }, match), readinessRaw: undefined }));
    const sent = await db.prepare(`SELECT value FROM gc_settings WHERE key = ?`).bind(`report_sent_${match?.id || ''}`).first();
    return J({
      devices: withReady, activeNow: devices.filter(d => d.online).length, switchedOn: devices.filter(d => d.status === 'active').length,
      readyNow: withReady.filter(d => d.status === 'active' && d.ready.ready).length,
      totals: today.totals, match: today.match, latest: today.latest, byGate: today.byGate, stands: today.stands, byStaff: today.byStaff,
      watch: await watchList(db), gates: g.gates, gateStands: g.stands, roles: ROLES, at: new Date().toISOString(),
      gatesState: await gatesStatus(db, match), capacity: await capacityView(db), capacitySizes: await capacitySettings(db), queue: await queueView(db),
      bans: await listBans(db), report: { emails: await reportRecipients(db, env), delay: await reportDelay(db), sent: sent ? JSON.parse(sent.value) : null },
      practice: Object.entries(PRACTICE).map(([id, p]) => ({ id, label: p.label })),
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
    await ensureMatchdaySchema(db);
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
    } else if (b.action === 'gates_mode') r = await setGates(db, by, b, request);
    else if (b.action === 'capacity') r = await saveCapacity(db, by, b.capacity, request);
    else if (b.action === 'ban_add') r = await addBan(db, by, b, request);
    else if (b.action === 'ban_remove') r = await removeBan(db, by, b.id, request);
    else if (b.action === 'message') {
      const text = oneLine(b.text, 240);
      if (text.length < 3) return J({ error: 'Write the message first.' }, 400);
      const hours = Math.max(0.25, Math.min(12, Number(b.hours) || 1));
      const to = String(b.to || 'all');
      let gate = null, deviceId = null, label = 'every gate';
      if (to.startsWith('gate:')) { gate = to.slice(5); if (!(await gateSettings(db)).gates.includes(gate)) return J({ error: 'Choose a gate on the list.' }, 400); label = gate; }
      if (to.startsWith('device:')) {
        const d = await db.prepare(`SELECT id, code, name FROM gc_devices WHERE id = ?`).bind(to.slice(7)).first();
        if (!d) return J({ error: 'That scanner no longer exists.' }, 400);
        deviceId = d.id; label = `${d.code} ${d.name}`;
      }
      await systemMessage(db, text, { gate, deviceId, hours, from: `${admin?.name || by} (control room)` });
      await gcLog(db, { kind: 'admin', name: by, code: by }, `Sent a message to ${label}`, { kind: 'message', details: text, request });
      r = { ok: true };
    } else if (b.action === 'report_settings') r = await saveReportSettings(db, by, b, request);
    else if (b.action === 'report_send') r = await sendReport(env, { by, force: true });
    else if (b.action === 'pass_save') r = await savePass(db, by, b, request);
    else if (b.action === 'pass_revoke') r = await revokePass(db, by, b.id, request);
    else if (b.action === 'zones') r = await savePassZones(db, by, b.zones, request);
    else return J({ error: 'Unknown action.' }, 400);
    return r.error ? J({ error: r.error }, 400) : J(r);
  } catch (err) {
    console.error('[admin gate control] post', err);
    return J({ error: 'Could not save.' }, 500);
  }
}

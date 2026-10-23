// Squad › Approvals (only the three Super Admins: permission squad.approve).
// Nothing reaches the website without a Super Admin's approval:
//  - new profiles and changes to live profiles (from squad_profiles: status or
//    pending = PENDING_APPROVAL);
//  - requests (squad_requests): left the club, out on loan, back from loan,
//    delete, restore, a new role. These are added by the portal in later phases;
//    each kind's "approve" is registered in REQUEST_KINDS.
// The Super Admins hear about it through the admin bell and an email digest at
// most every 30 minutes while something new is waiting (removals at once), plus
// a reminder for anything waiting more than 48 hours.
import { getProfile, profileView, reviewAction, changeList, rowName, logProfile, ensureProfileSchema } from './squadProfiles.js';
import { PUBLIC_STATUSES, STATUSES } from '../../../src/lib/squadFields.js';
import { getPortalSettings, setPortalSetting } from './squadPortal.js';
import { requestRebuild } from './squadPublish.js';
import { superAdminEmails } from './superAdmins.js';
import { sendEmail } from './email.js';

const nowIso = () => new Date().toISOString();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SITE = env => String(env.SITE_URL || 'https://lobistarsfc.com').replace(/\/+$/, '');

export const KIND_LABEL = { new: 'New profile', edit: 'Edit', left: 'Left the club', loan: 'Out on loan', return: 'Back from loan', delete: 'Delete', restore: 'Restore', new_role: 'New role' };
// What approving a request does, per kind (filled in by later phases).
export const REQUEST_KINDS = {};
export const REMOVALS = ['left', 'delete'];

let ready = false;
export async function ensureApprovalSchema(db) {
  if (ready) return;
  await ensureProfileSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT, kind TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending', submitted_by TEXT, submitted_at TEXT NOT NULL, decided_by TEXT, decided_at TEXT, note TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_squad_requests_status ON squad_requests (status, submitted_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_squad_profiles_waiting ON squad_profiles (status, pending)`),
  ]);
  ready = true;
}

/** Everything waiting, oldest first. */
export async function queue(env) {
  const db = env.DB;
  await ensureApprovalSchema(db);
  const rows = (await db.prepare(`SELECT id, season, type, status, pending, live_json IS NOT NULL AS was_live, public_name, display_name, submitted_by, submitted_at, updated_at, photos_json
    FROM squad_profiles WHERE deleted_at IS NULL AND (status = 'PENDING_APPROVAL' OR pending = 'PENDING_APPROVAL') ORDER BY COALESCE(submitted_at, updated_at)`).all()).results;
  const reqs = (await db.prepare(`SELECT r.*, p.public_name, p.display_name, p.type, p.season FROM squad_requests r LEFT JOIN squad_profiles p ON p.id = r.profile_id WHERE r.status = 'pending' ORDER BY r.submitted_at`).all()).results;
  const now = Date.now();
  const thumb = p => { const ph = parse(p.photos_json, {}).profile; return ph ? `/api/squad-portal/file/${p.id}/profile/w400.webp${ph.rev ? `?rev=${ph.rev}` : ''}` : null; };
  const items = [
    ...rows.map(p => { const kind = PUBLIC_STATUSES.includes(p.status) || p.was_live ? 'edit' : 'new'; const at = p.submitted_at || p.updated_at;
      return { key: `p:${p.id}`, kind, kindLabel: KIND_LABEL[kind], profileId: p.id, name: p.public_name || p.display_name || 'Unnamed', type: p.type, season: p.season, submittedBy: p.submitted_by, submittedAt: at, waitingHours: Math.floor((now - Date.parse(at)) / 3600e3), thumb: thumb(p) }; }),
    ...reqs.map(r => ({ key: `r:${r.id}`, kind: r.kind, kindLabel: KIND_LABEL[r.kind] || r.kind, requestId: r.id, profileId: r.profile_id, name: r.public_name || r.display_name || parse(r.payload_json, {}).name || '–', type: r.type, season: r.season,
      submittedBy: r.submitted_by, submittedAt: r.submitted_at, waitingHours: Math.floor((now - Date.parse(r.submitted_at)) / 3600e3), payload: parse(r.payload_json, {}), removal: REMOVALS.includes(r.kind) })),
  ].sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
  return items;
}
export async function queueCount(db) {
  try {
    await ensureApprovalSchema(db);
    const a = await db.prepare(`SELECT COUNT(*) AS n FROM squad_profiles WHERE deleted_at IS NULL AND (status = 'PENDING_APPROVAL' OR pending = 'PENDING_APPROVAL')`).first();
    const b = await db.prepare(`SELECT COUNT(*) AS n FROM squad_requests WHERE status = 'pending'`).first();
    return (a?.n || 0) + (b?.n || 0);
  } catch { return 0; }
}

/** One item: the profile, what changed (before / after) and the photos. */
export async function detail(env, profileId) {
  const db = env.DB;
  const p = await getProfile(db, profileId);
  if (!p) return { error: 'Profile not found.', status: 404 };
  const view = profileView(p);
  const live = parse(p.live_json, null);
  const isEdit = !!live && (PUBLIC_STATUSES.includes(p.status) || p.status === 'PENDING_APPROVAL');
  const file = (kind, ph, liveSide) => ph ? `/api/squad-portal/file/${p.id}/${kind}/w400.webp?${liveSide ? 'live=1' : ph.rev ? `rev=${ph.rev}` : ''}` : null;
  const workPhotos = parse(p.photos_json, {}), livePhotos = live?.photos || {};
  const photos = ['profile', 'action', 'hero'].map(k => ({ kind: k, before: file(k, livePhotos[k], true), after: file(k, workPhotos[k], false),
    changed: (livePhotos[k]?.rev || livePhotos[k]?.uploadedAt || null) !== (workPhotos[k]?.rev || workPhotos[k]?.uploadedAt || null) })).filter(x => x.before || x.after);
  return { kind: isEdit ? 'edit' : 'new', profile: view, liveN: p.live_n || null, changes: isEdit ? changeList(p) : [], photos: isEdit ? photos : photos.map(x => ({ ...x, before: null, changed: true })),
    previewUrl: `/squad/_preview/${encodeURIComponent(p.id)}/`, statusLabel: STATUSES[p.status] };
}

const lagosWhen = (t = Date.now()) => new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Approve a new profile or a change (goes live at once; the website shows it within about 10 seconds). */
export async function approveProfile(env, admin, profileId, { waitUntil } = {}) {
  const p = await getProfile(env.DB, profileId);
  if (!p) return { error: 'Profile not found.', status: 404 };
  const changes = p.live_json ? changeList(p) : [];
  const r = await reviewAction(env, admin, profileId, 'approve', '', { summary: summaryOf(admin, p, changes) });
  if (r.ok) { const j = requestRebuild(env, `approved ${rowName(p)}`).catch(() => null); if (waitUntil) waitUntil(j); }
  return r;
}
/** "Marvin (Super Admin) approved Grace's change to Musa Adeyemi: shirt number 19 → 9, 22 Oct 2026, 12:40." */
export function summaryOf(admin, p, changes) {
  const who = `${admin.name} (Super Admin)`, by = String(p.submitted_by || 'the portal').replace(/ \(Squad Data Portal\)$/, '');
  const name = rowName(p) || 'a profile';
  const what = changes.length ? `: ${changes.slice(0, 6).map(c => c.private ? `${c.label.toLowerCase()} changed` : `${c.label.toLowerCase()} ${c.fromText} → ${c.toText}`).join('; ')}${changes.length > 6 ? `; and ${changes.length - 6} more` : ''}` : '';
  return p.live_json ? `${who} approved ${by}'s change to ${name}${what}, ${lagosWhen()}` : `${who} approved and published ${by}'s new profile of ${name}, ${lagosWhen()}`;
}

export async function requestChanges(env, admin, profileId, note) {
  return reviewAction(env, admin, profileId, 'request_changes', note);
}

/** Bulk approve (new profiles only; each checked like a single approval). */
export async function approveMany(env, admin, ids, opts) {
  const out = { approved: [], failed: [] };
  for (const id of ids.slice(0, 50)) {
    const p = await getProfile(env.DB, id);
    if (!p || p.live_json) { out.failed.push({ id, error: 'Only new profiles can be approved together.' }); continue; }
    const r = await approveProfile(env, admin, id, opts);
    if (r.ok) out.approved.push(rowName(p)); else out.failed.push({ id, name: rowName(p), error: r.error });
  }
  return out;
}

/** A request (left, loan, delete, …): approve (runs its action) or reject (with a note). */
export async function decideRequest(env, admin, requestId, decision, note = '') {
  const db = env.DB;
  await ensureApprovalSchema(db);
  const r = await db.prepare(`SELECT * FROM squad_requests WHERE id = ?`).bind(Number(requestId)).first();
  if (!r || r.status !== 'pending') return { error: 'This request is no longer waiting.', status: 409 };
  const n = String(note || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 500);
  const p = r.profile_id ? await getProfile(db, r.profile_id) : null;
  const name = rowName(p) || parse(r.payload_json, {}).name || 'a profile';
  if (decision === 'reject') {
    if (n.length < 5) return { error: 'Write why it is rejected (the portal shows the note).', status: 400 };
    await db.prepare(`UPDATE squad_requests SET status = 'rejected', decided_by = ?, decided_at = ?, note = ? WHERE id = ?`).bind(admin.name, nowIso(), n, r.id).run();
    await logProfile(db, admin, 'squad_request', `${admin.name} (Super Admin) rejected the "${KIND_LABEL[r.kind] || r.kind}" request for ${name} sent by ${r.submitted_by || 'the portal'}: ${n}, ${lagosWhen()}`);
    return { ok: true };
  }
  const run = REQUEST_KINDS[r.kind];
  if (!run) return { error: 'This kind of request cannot be approved yet.', status: 400 };
  const res = await run(env, admin, r, parse(r.payload_json, {}));
  if (res?.error) return res;
  await db.prepare(`UPDATE squad_requests SET status = 'approved', decided_by = ?, decided_at = ?, note = ? WHERE id = ?`).bind(admin.name, nowIso(), n || null, r.id).run();
  await logProfile(db, admin, 'squad_request', `${admin.name} (Super Admin) approved the "${KIND_LABEL[r.kind] || r.kind}" request for ${name} sent by ${r.submitted_by || 'the portal'}, ${lagosWhen()}`);
  return { ok: true };
}

// ── Emails to the Super Admins ──
async function mail(env, subject, html) {
  const to = superAdminEmails(env);
  if (!to.length || !env.RESEND_API_KEY) return false;
  await sendEmail(env, { to, subject, html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16181D">${html}<p><a href="${SITE(env)}/admin/squad-approvals/" style="display:inline-block;background:#1C3F7A;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:bold">Open the Approval Queue</a></p><p style="color:#4A505C;font-size:13px">Lobi Stars FC website · Squad approvals (Super Admins)</p></div>` });
  return true;
}
const line = i => `<li><b>${esc(i.kindLabel)}</b>: ${esc(i.name)}${i.submittedBy ? ` (sent by ${esc(String(i.submittedBy).replace(/ \(Squad Data Portal\)$/, ''))})` : ''}</li>`;
/** A removal request (left the club, delete): the Super Admins are emailed at once. */
export async function notifyRemovalNow(env, item) {
  try { return await mail(env, `Squad: ${KIND_LABEL[item.kind] || item.kind} request for ${item.name}`, `<p>A request is waiting for your approval:</p><ul>${line(item)}</ul>`); } catch (err) { console.error('[squad] removal email', err); return false; }
}

/**
 * Every minute from the timer (cheap: one settings read). At most every 30 minutes:
 * a digest of what arrived since the last one; once per item, a reminder after 48 hours.
 */
let lastCheck = 0;
export async function digestTick(env, { force = false } = {}) {
  if (!force && Date.now() - lastCheck < 5 * 60e3) return { skipped: true };
  lastCheck = Date.now();
  const db = env.DB;
  const s = await getPortalSettings(db);
  if (!force && s.approval_digest_at && Date.now() - Date.parse(s.approval_digest_at) < 30 * 60e3) return { skipped: true };
  const items = await queue(env);
  const since = s.approval_digest_at || '1970-01-01';
  const fresh = items.filter(i => String(i.submittedAt) > since && !i.removal);
  const reminded = new Set(parse(s.approval_reminded, []));
  const old = items.filter(i => i.waitingHours >= 48 && !reminded.has(`${i.key}@${i.submittedAt}`));
  let sent = 0;
  if (fresh.length) {
    if (await mail(env, `Squad: ${fresh.length} ${fresh.length === 1 ? 'profile or change' : 'profiles or changes'} waiting for approval`, `<p>Waiting for a Super Admin's approval (nothing goes on the website before that):</p><ul>${fresh.map(line).join('')}</ul>${items.length > fresh.length ? `<p>${items.length} waiting in total.</p>` : ''}`)) sent++;
  }
  if (old.length) {
    if (await mail(env, `Reminder: ${old.length} squad ${old.length === 1 ? 'request has' : 'requests have'} been waiting over 48 hours`, `<p>These have been waiting for approval for more than two days:</p><ul>${old.map(line).join('')}</ul>`)) sent++;
    for (const i of old) reminded.add(`${i.key}@${i.submittedAt}`);
    await setPortalSetting(db, 'approval_reminded', JSON.stringify([...reminded].slice(-200)), 'system');
  }
  await setPortalSetting(db, 'approval_digest_at', nowIso(), 'system');
  return { fresh: fresh.length, reminders: old.length, sent };
}

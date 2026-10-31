// Squad Phase 4 (31 Oct 2026): leaving, loans, deletion and former players.
// The portal (and Super Admins) ask; a Super Admin approves in Squad › Approvals:
//  - left:    "Left the club" (reason, leaving date, new club) → FORMER: off the
//             Squad page, everything kept (stats, history), still in the partner feed;
//  - loan:    "Out on loan" (club, start, expected return) → ON_LOAN: "Out on loan"
//             section of /squad and a banner on the profile;
//  - return:  "Return from loan" → LIVE again;
//  - delete:  "Delete permanently" (profiles made by mistake; the name typed to
//             confirm) → DELETED: gone everywhere, restorable for 30 days, then
//             erased (record, photos, versions) by the daily job;
//  - restore: "Restore previous profile" for someone who comes back → LIVE again
//             (in the current season), history kept.
// "Left the club" and "Delete" requests are emailed to the Super Admins at once.
import { getProfile, rowName, logProfile, ensureProfileSchema, deleteFiles } from './squadProfiles.js';
import { getPortalSettings } from './squadPortal.js';
import { PUBLIC_STATUSES, STATUSES } from '../../../src/lib/squadFields.js';

const nowIso = () => new Date().toISOString();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const rid = () => `sp_${[...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;
const clean = (v, max = 60) => String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && String(s) >= '1990-01-01' && String(s) <= '2100-12-31';
const longDay = s => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
export const LEAVE_REASONS = ['Transfer', 'Release', 'Retirement', 'End of contract', 'Other'];
export const DELETE_KEEP_DAYS = 30;
export const LIFECYCLE_KINDS = ['left', 'loan', 'return', 'delete', 'restore'];
// What each status may ask for.
const ALLOWED = { LIVE: ['left', 'loan', 'delete'], ON_LOAN: ['return', 'left', 'delete'], FORMER: ['restore'] };

/** Checks what was sent; returns { payload, display } (display: [[label, value]] for the Approval Queue) or { error }. */
export function checkRequest(kind, p, b = {}) {
  if (kind === 'left') {
    const reason = LEAVE_REASONS.includes(b.reason) ? b.reason : null;
    if (!reason) return { error: 'Choose why they left.' };
    const reasonOther = reason === 'Other' ? clean(b.reasonOther, 80) : '';
    if (reason === 'Other' && reasonOther.length < 3) return { error: 'Say why they left.' };
    if (!isDay(b.date)) return { error: 'Enter the leaving date.' };
    const newClub = clean(b.newClub);
    const payload = { reason, reasonOther, date: b.date, newClub };
    return { payload, display: [['Reason', reason === 'Other' ? `Other: ${reasonOther}` : reason], ['Leaving date', longDay(b.date)], ...(newClub ? [['New club', newClub]] : [])] };
  }
  if (kind === 'loan') {
    const club = clean(b.club);
    if (club.length < 2) return { error: 'Enter the club they are going to on loan.' };
    if (!isDay(b.start)) return { error: 'Enter the start date of the loan.' };
    if (!isDay(b.until) || b.until < b.start) return { error: 'Enter the expected return date (after the start).' };
    return { payload: { club, start: b.start, until: b.until }, display: [['Loan club', club], ['Starts', longDay(b.start)], ['Expected back', longDay(b.until)]] };
  }
  if (kind === 'return') {
    const date = isDay(b.date) ? b.date : new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
    return { payload: { date }, display: [['Back from', parse(p.loan_json, {})?.club || 'loan'], ['Back on', longDay(date)]] };
  }
  if (kind === 'delete') {
    const name = rowName(p);
    if (!name || clean(b.confirm, 120).toLowerCase() !== name.toLowerCase()) return { error: `Type the name exactly as shown (${name || 'the name'}) to confirm.` };
    return { payload: { confirm: name, why: clean(b.why, 200) }, display: [['Profile', name], ['Why', clean(b.why, 200) || 'Created by mistake']] };
  }
  if (kind === 'restore') {
    return { payload: { draftId: b.draftId ? String(b.draftId) : null }, display: [['Profile', rowName(p)], ['Left', p.left_at ? longDay(p.left_at.slice(0, 10)) : '–']] };
  }
  return { error: 'Unknown request.' };
}

/** A request from the portal (or a Super Admin). apply: a Super Admin's own action, approved at once. */
export async function createRequest(env, actor, profileId, kind, body = {}, { apply = false } = {}) {
  const db = env.DB;
  const { ensureApprovalSchema, notifyRemovalNow, decideRequest, KIND_LABEL } = await import('./squadApprovals.js');
  await ensureApprovalSchema(db);
  if (!LIFECYCLE_KINDS.includes(kind)) return { error: 'Unknown request.', status: 400 };
  const p = await getProfile(db, profileId);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!(ALLOWED[p.status] || []).includes(kind)) return { error: `This cannot be asked for a profile that is ${STATUSES[p.status]?.toLowerCase() || p.status}.`, status: 409 };
  const busy = await db.prepare(`SELECT kind FROM squad_requests WHERE profile_id = ? AND status = 'pending' AND kind IN ('left', 'loan', 'return', 'delete', 'restore') LIMIT 1`).bind(p.id).first();
  if (busy) return { error: `A "${KIND_LABEL[busy.kind]}" request for this profile is already waiting for approval.`, status: 409 };
  const c = checkRequest(kind, p, body);
  if (c.error) return { error: c.error, status: 400 };
  const at = nowIso();
  const r = await db.prepare(`INSERT INTO squad_requests (profile_id, kind, payload_json, submitted_by, submitted_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(p.id, kind, JSON.stringify({ ...c.payload, display: c.display, name: rowName(p) }), actor.name, at).run();
  const id = r.meta?.last_row_id;
  await logProfile(db, actor, 'squad_request', `${actor.name} asked for "${KIND_LABEL[kind]}" for ${rowName(p) || 'a profile'} (${p.season}); waiting for a Super Admin`);
  if (apply) return decideRequest(env, actor, id, 'approve');
  if (['left', 'delete'].includes(kind)) await notifyRemovalNow(env, { kind, kindLabel: KIND_LABEL[kind], name: rowName(p), submittedBy: actor.name });
  return { ok: true, requestId: id };
}
/** The request waiting for a profile, if any (for the portal and the review page). */
export async function pendingFor(db, profileId) {
  try {
    return await db.prepare(`SELECT id, kind, payload_json, submitted_by, submitted_at FROM squad_requests WHERE profile_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`).bind(profileId).first();
  } catch { return null; }
}

// ── What approving each request does ──
async function moveHistory(db, p, key, entry) {
  const meta = parse(p.meta_json, {});
  meta[key] = [...(meta[key] || []), entry].slice(-20);
  return JSON.stringify(meta);
}
export const HANDLERS = {
  async left(env, admin, req, x) {
    const db = env.DB, p = await getProfile(db, req.profile_id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    const leave = { reason: x.reason, reasonOther: x.reasonOther || '', date: x.date, newClub: x.newClub || '' };
    await db.prepare(`UPDATE squad_profiles SET status = 'FORMER', pending = NULL, left_at = ?, leave_json = ?, loan_json = NULL, meta_json = ?, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`)
      .bind(`${x.date}T12:00:00.000Z`, JSON.stringify(leave), await moveHistory(db, p, '_leaves', leave), admin.name, nowIso(), p.id).run();
    return { ok: true };
  },
  async loan(env, admin, req, x) {
    const db = env.DB, p = await getProfile(db, req.profile_id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    await db.prepare(`UPDATE squad_profiles SET status = 'ON_LOAN', loan_json = ?, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`)
      .bind(JSON.stringify({ club: x.club, start: x.start, until: x.until }), admin.name, nowIso(), p.id).run();
    return { ok: true };
  },
  async return(env, admin, req, x) {
    const db = env.DB, p = await getProfile(db, req.profile_id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    const loan = parse(p.loan_json, {});
    await db.prepare(`UPDATE squad_profiles SET status = 'LIVE', loan_json = NULL, meta_json = ?, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`)
      .bind(await moveHistory(db, p, '_loans', { ...loan, back: x.date }), admin.name, nowIso(), p.id).run();
    return { ok: true };
  },
  async delete(env, admin, req) {
    const db = env.DB, p = await getProfile(db, req.profile_id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    const meta = parse(p.meta_json, {}); meta._deletedFrom = p.status;
    await db.prepare(`UPDATE squad_profiles SET status = 'DELETED', deleted_at = ?, deleted_by = ?, meta_json = ? WHERE id = ?`).bind(nowIso(), admin.name, JSON.stringify(meta), p.id).run();
    return { ok: true };
  },
  // Someone who comes back: live again in the current season (a copy into it if they left in an earlier season).
  async restore(env, admin, req, x) {
    const db = env.DB, p = await getProfile(db, req.profile_id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    const season = (await getPortalSettings(db)).season, at = nowIso();
    if (p.season === season) {
      await db.prepare(`UPDATE squad_profiles SET status = 'LIVE', left_at = NULL, leave_json = NULL, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`).bind(admin.name, at, p.id).run();
    } else {
      const id = rid();
      await db.prepare(`INSERT INTO squad_profiles (id, season, type, status, data_json, meta_json, photos_json, audio_json, display_name, full_name, surname, first_name, middle_name, website_name, public_name, name_status,
        dob, shirt_number, role, position, created_at, created_by, updated_at, updated_by, carried_from, person_id, public_slug, old_slugs, live_json, live_n, pending)
        SELECT ?, ?, type, 'LIVE', data_json, '{}', photos_json, audio_json, display_name, full_name, surname, first_name, middle_name, website_name, public_name, name_status,
        dob, shirt_number, role, position, ?, ?, ?, ?, id, COALESCE(person_id, id), public_slug, old_slugs, live_json, 1, 'DRAFT' FROM squad_profiles WHERE id = ?`)
        .bind(id, season, at, admin.name, at, admin.name, p.id).run();
      await db.prepare(`INSERT INTO squad_profile_versions (profile_id, n, snapshot_json, approved_by, approved_at, note) VALUES (?, 1, ?, ?, ?, ?)`).bind(id, p.live_json || '{}', admin.name, at, `Back at the club (restored from ${p.season})`).run();
      await db.prepare(`UPDATE squad_profiles SET public_slug = NULL WHERE id = ?`).bind(p.id).run();
      if (env.SQUAD_BUCKET) {
        const l = await env.SQUAD_BUCKET.list({ prefix: `profiles/${p.id}/` }).catch(() => null);
        for (const ob of l?.objects || []) { const o = await env.SQUAD_BUCKET.get(ob.key).catch(() => null); if (o) await env.SQUAD_BUCKET.put(ob.key.replace(`profiles/${p.id}/`, `profiles/${id}/`), await o.arrayBuffer(), { httpMetadata: o.httpMetadata }); }
      }
    }
    // The new draft typed for the same person is no longer needed.
    if (x.draftId) await db.prepare(`UPDATE squad_profiles SET status = 'DELETED', deleted_at = ?, deleted_by = ? WHERE id = ? AND status = 'DRAFT'`).bind(at, admin.name, x.draftId).run();
    return { ok: true };
  },
};

// ── Deleted profiles (Super Admins: restore within 30 days) ──
export async function deletedList(db) {
  await ensureProfileSchema(db);
  const rows = (await db.prepare(`SELECT id, season, type, public_name, display_name, deleted_at, deleted_by, meta_json, live_json IS NOT NULL AS was_live FROM squad_profiles WHERE deleted_at IS NOT NULL AND status = 'DELETED' ORDER BY deleted_at DESC LIMIT 100`).all()).results;
  return rows.map(r => ({ id: r.id, season: r.season, type: r.type, name: r.public_name || r.display_name || 'Unnamed', deletedAt: r.deleted_at, deletedBy: r.deleted_by, wasLive: !!r.was_live,
    eraseOn: new Date(Date.parse(r.deleted_at) + DELETE_KEEP_DAYS * 864e5).toISOString().slice(0, 10) }));
}
export async function restoreDeleted(env, admin, id) {
  const db = env.DB;
  const r = await db.prepare(`SELECT * FROM squad_profiles WHERE id = ? AND status = 'DELETED'`).bind(String(id || '')).first();
  if (!r) return { error: 'That profile is not in the deleted list.', status: 404 };
  const meta = parse(r.meta_json, {}), back = meta._deletedFrom && meta._deletedFrom !== 'DELETED' ? meta._deletedFrom : r.live_json ? 'LIVE' : 'DRAFT';
  delete meta._deletedFrom;
  await db.prepare(`UPDATE squad_profiles SET status = ?, deleted_at = NULL, deleted_by = NULL, meta_json = ? WHERE id = ?`).bind(back, JSON.stringify(meta), r.id).run();
  await logProfile(db, admin, 'squad_profile_restore', `${admin.name} restored the deleted profile of ${r.public_name || r.display_name || 'a profile'} (${STATUSES[back].toLowerCase()})`);
  return { ok: true, status: back };
}
/** Daily: deleted profiles older than 30 days are erased for good (record, photos, versions, requests). */
export async function purgeDeleted(env, { now = Date.now() } = {}) {
  const db = env.DB;
  await ensureProfileSchema(db);
  const cutoff = new Date(now - DELETE_KEEP_DAYS * 864e5).toISOString();
  const rows = (await db.prepare(`SELECT id, public_name, display_name, season FROM squad_profiles WHERE status = 'DELETED' AND deleted_at IS NOT NULL AND deleted_at < ? LIMIT 20`).bind(cutoff).all()).results;
  for (const r of rows) {
    await deleteFiles(env, r.id);
    await db.batch([
      db.prepare(`DELETE FROM squad_profile_versions WHERE profile_id = ?`).bind(r.id),
      db.prepare(`DELETE FROM squad_requests WHERE profile_id = ?`).bind(r.id),
      db.prepare(`DELETE FROM squad_profiles WHERE id = ?`).bind(r.id),
    ]);
    // Match stats keep the player's address as plain text; the name is not kept.
    await logProfile(db, { id: 'system', name: 'Clean-up' }, 'squad_profile_erased', `A deleted profile (${r.season}) was erased for good after ${DELETE_KEEP_DAYS} days`);
  }
  return { erased: rows.length };
}

// ── "Search current and former players and staff by name" (forgiving) ──
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function close(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return false;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length] <= max;
}
/** Every word typed must match a word of the name: its start ("Adey" → Adeyemi) or with a small typo. */
export function nameMatches(query, name) {
  const q = norm(query).split(' ').filter(Boolean), words = norm(name).split(' ').filter(Boolean);
  if (!q.length || !words.length) return false;
  return q.every(t => words.some(w => w.startsWith(t) || (t.length >= 4 && close(t, w.slice(0, Math.max(t.length, Math.min(w.length, t.length + 1))), t.length >= 7 ? 2 : 1))));
}
/** Matching profiles, newest season of each person first; FORMER included. */
export async function searchPeople(db, query, { limit = 40 } = {}) {
  await ensureProfileSchema(db);
  const rows = (await db.prepare(`SELECT * FROM squad_profiles WHERE deleted_at IS NULL AND status != 'DELETED' ORDER BY season DESC, updated_at DESC LIMIT 1500`).all()).results;
  const seen = new Set(), out = [];
  for (const r of rows) {
    const key = r.person_id || r.id;
    if (seen.has(key)) continue;
    const name = [r.public_name, r.display_name, r.first_name && r.surname ? `${r.first_name} ${r.surname}` : '', r.website_name].filter(Boolean).join(' ');
    if (!nameMatches(query, name)) continue;
    seen.add(key); out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
export { PUBLIC_STATUSES };

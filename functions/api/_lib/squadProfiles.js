// Squad & Staff Data Portal: profiles. A profile is created as a DRAFT when the
// type is chosen; every answer is saved on its own (autosave), later saves win
// per field and the other editor is told. Statuses:
//   DRAFT → SUBMITTED → VERIFIED, or CHANGES_REQUESTED (with the reviewer's note;
//   editable again in the portal), and LEFT_THE_CLUB (hidden from the website).
// The portal deletes drafts only; Super Admins can remove any profile (logged).
// Photos and recordings live in the private R2 bucket SQUAD_BUCKET.
// Every change is written to the Activity Log in plain English.
import { FIELD, FIELDS, STATUSES, EDITABLE, cleanValue, missingForSubmit, labelOf, ageOn, PRIVATE_KEYS } from '../../../src/lib/squadFields.js';
import { logAdminAction } from './adminSession.js';
import { getPortalSettings, setPortalSetting } from './squadPortal.js';

const nowIso = () => new Date().toISOString();
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const rid = () => `sp_${[...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;

let ready = false;
export async function ensureProfileSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_profiles (id TEXT PRIMARY KEY, season TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
      data_json TEXT NOT NULL DEFAULT '{}', meta_json TEXT NOT NULL DEFAULT '{}', photos_json TEXT NOT NULL DEFAULT '{}', audio_json TEXT NOT NULL DEFAULT '{}',
      display_name TEXT, full_name TEXT, dob TEXT, shirt_number INTEGER, role TEXT, position TEXT,
      created_at TEXT NOT NULL, created_by TEXT, updated_at TEXT NOT NULL, updated_by TEXT, version INTEGER NOT NULL DEFAULT 1,
      submitted_at TEXT, submitted_by TEXT, verified_at TEXT, verified_by TEXT, review_note TEXT, review_by TEXT, review_at TEXT,
      left_at TEXT, deleted_at TEXT, deleted_by TEXT, carried_from TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_squad_profiles_season ON squad_profiles (season, deleted_at, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_export_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, by TEXT NOT NULL, place TEXT NOT NULL, format TEXT NOT NULL,
      filters TEXT, profiles INTEGER, ok INTEGER NOT NULL DEFAULT 1, note TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS squad_team (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_by TEXT, updated_at TEXT)`),
  ]);
  ready = true;
}

/** Plain-English activity log line for a profile ("Grace (Squad Data Portal) changed …"). */
export async function logProfile(db, actor, action, text) { await logAdminAction(db, actor, action, text); }
const whoName = p => p.display_name || (p.type === 'staff' ? 'a staff member' : 'a player') ;
const fmtVal = (key, v) => {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return 'blank';
  if (Array.isArray(v)) return FIELD[key]?.type === 'rows' ? `${v.length} row${v.length === 1 ? '' : 's'}` : v.join(', ');
  if (v === true) return 'ticked'; if (v === false) return 'not ticked';
  return String(v).length > 60 ? `${String(v).slice(0, 57)}…` : String(v);
};

/** The view of a profile for the portal / the club review (everything, including private details). */
export function profileView(p, { thumbs = 'portal' } = {}) {
  const data = parse(p.data_json, {}), photos = parse(p.photos_json, {}), audio = parse(p.audio_json, {});
  const file = (kind, variant) => `/api/squad-portal/file/${p.id}/${kind}/${variant}`;
  return {
    id: p.id, season: p.season, type: p.type, status: p.status, statusLabel: STATUSES[p.status] || p.status, version: p.version,
    data, meta: parse(p.meta_json, {}), name: p.display_name || '', fileBase: fileBase(p, data),
    shirtNumber: p.shirt_number, role: p.role, position: p.position,
    photos: Object.fromEntries(Object.entries(photos).map(([k, v]) => [k, { ...v, url: file(k, 'w1200.webp'), thumb: file(k, 'w400.webp'), jpg: file(k, 'w1200.jpg') }])),
    audio: audio.mp3 || audio.original ? { ...audio, url: file('audio', audio.mp3 ? 'mp3' : 'original') } : null,
    createdAt: p.created_at, createdBy: p.created_by, updatedAt: p.updated_at, updatedBy: p.updated_by,
    submittedAt: p.submitted_at, submittedBy: p.submitted_by, verifiedAt: p.verified_at, verifiedBy: p.verified_by,
    reviewNote: p.review_note, reviewBy: p.review_by, reviewAt: p.review_at, leftAt: p.left_at, carriedFrom: p.carried_from,
    editable: EDITABLE.includes(p.status),
  };
}

// ── File names: players "09-musa-adeyemi", staff "staff-headcoach-terver-iorliam" (from the public display name) ──
const slug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function fileBase(p, data = parse(p.data_json, {})) {
  const name = slug(data.displayName || p.display_name) || 'profile';
  if (p.type === 'staff') {
    const role = String(data.role === 'Other' ? data.roleOther || 'staff' : data.role || 'staff').toLowerCase().replace(/[^a-z]/g, '');
    return `staff-${role || 'staff'}-${name}`;
  }
  const n = Number(data.shirtNumber);
  return `${Number.isInteger(n) && n > 0 ? String(n).padStart(2, '0') : 'xx'}-${name}`;
}
export const photoName = (p, kind, ext, data) => `${fileBase(p, data)}${kind === 'action' ? '-action' : ''}.${ext}`;
export const audioName = (p, ext, data) => `${fileBase(p, data)}-pronunciation.${ext}`;

const cached = (type, data) => ({
  display_name: data.displayName || null, full_name: data.fullName || null, dob: data.dob || null,
  shirt_number: type === 'player' && Number.isInteger(data.shirtNumber) ? data.shirtNumber : null,
  role: type === 'staff' ? (data.role === 'Other' ? data.roleOther || 'Other' : data.role || null) : null,
  position: type === 'player' ? data.primaryPosition || null : null,
});

export async function getProfile(db, id) {
  await ensureProfileSchema(db);
  return db.prepare(`SELECT * FROM squad_profiles WHERE id = ? AND deleted_at IS NULL`).bind(String(id || '')).first();
}

/** New draft when the type is chosen. */
export async function createProfile(env, actor, { type, season }) {
  const db = env.DB;
  await ensureProfileSchema(db);
  if (!['player', 'staff'].includes(type)) return { error: 'Choose Player or Coach / Staff Member.' };
  const s = season || (await getPortalSettings(db)).season;
  const id = rid(), at = nowIso();
  await db.prepare(`INSERT INTO squad_profiles (id, season, type, status, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?)`)
    .bind(id, s, type, at, actor.name, at, actor.name).run();
  await logProfile(db, actor, 'squad_profile_create', `${actor.name} started a new ${type === 'staff' ? 'coach / staff' : 'player'} profile (draft) for ${s}`);
  return { ok: true, id };
}

/**
 * Saves answers: { changes: { key: value }, since, commit, sessionId }. Later saves
 * win per field. Returns the saved values, field errors, and fields someone
 * else changed since `since` (so the page can show "updated by … just now").
 * commit: the person left the field (or chose an option): written to the Activity Log.
 */
export async function saveFields(env, actor, id, { changes = {}, since = null, commit = false, sessionId = null, type: newType = null, allowAnyStatus = false }) {
  const db = env.DB;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await getProfile(db, id);
    if (!p) return { error: 'Profile not found.', status: 404 };
    if (!allowAnyStatus && !EDITABLE.includes(p.status)) return { error: `This profile is ${STATUSES[p.status].toLowerCase()} and can only be viewed.`, status: 409 };
    const data = parse(p.data_json, {}), meta = parse(p.meta_json, {});
    const at = nowIso(), errors = {}, saved = {}, logged = [];
    let type = p.type;
    if (newType && newType !== p.type && ['player', 'staff'].includes(newType)) type = newType;
    for (const [key, raw] of Object.entries(changes || {})) {
      if (!FIELD[key]) { errors[key] = 'Unknown field.'; continue; }
      const r = cleanValue(key, raw);
      if (r.error) { errors[key] = r.error; continue; }
      const before = data[key];
      if (JSON.stringify(before ?? null) === JSON.stringify(r.value ?? null)) { saved[key] = r.value; continue; }
      data[key] = r.value; saved[key] = r.value;
      const prevCommitted = meta[key]?.committed;
      meta[key] = { at, by: actor.name, sid: sessionId, committed: commit ? r.value : prevCommitted !== undefined ? prevCommitted : before ?? null };
      if (commit) logged.push({ key, from: prevCommitted !== undefined ? prevCommitted : before, to: r.value });
    }
    // Nothing new (a check for other people's changes): nothing is written.
    if (!Object.keys(saved).some(k => JSON.stringify(parse(p.data_json, {})[k] ?? null) !== JSON.stringify(saved[k] ?? null)) && type === p.type) {
      const others = since ? Object.entries(meta).filter(([k, m]) => m && m.at > since && m.sid !== sessionId && !(k in changes)).map(([k, m]) => ({ key: k, value: data[k], by: m.by, at: m.at })) : [];
      return { ok: true, version: p.version, updatedAt: p.updated_at, saved, errors, others, type, fileBase: fileBase(p, data) };
    }
    const c = cached(type, data);
    const res = await db.prepare(`UPDATE squad_profiles SET type = ?, data_json = ?, meta_json = ?, display_name = ?, full_name = ?, dob = ?, shirt_number = ?, role = ?, position = ?,
      updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ? AND version = ?`)
      .bind(type, JSON.stringify(data), JSON.stringify(meta), c.display_name, c.full_name, c.dob, c.shirt_number, c.role, c.position, at, actor.name, p.id, p.version).run();
    if (!res.meta?.changes) continue; // someone saved at the same moment: read again and re-apply
    const name = c.display_name || whoName(p);
    if (type !== p.type) await logProfile(db, actor, 'squad_profile_edit', `${actor.name} changed the profile type of ${name} to ${type === 'staff' ? 'coach / staff member' : 'player'}`);
    for (const l of logged) {
      const f = FIELD[l.key], label = (f.short || labelOf(f, type)).toLowerCase();
      const text = f.use === 'private' ? `${actor.name} updated the ${label} for ${name}` // private values never go in the log
        : `${actor.name} changed the ${label} for ${name} from ${fmtVal(l.key, l.from)} to ${fmtVal(l.key, l.to)}`;
      await logProfile(db, actor, 'squad_profile_edit', `${text} (${p.season})`);
    }
    const others = since ? Object.entries(meta).filter(([k, m]) => m && m.at > since && m.sid !== sessionId && !(k in changes)).map(([k, m]) => ({ key: k, value: data[k], by: m.by, at: m.at })) : [];
    return { ok: true, version: p.version + 1, updatedAt: at, saved, errors, others, type, fileBase: fileBase({ ...p, type }, data) };
  }
  return { error: 'The profile is busy. Please try again.', status: 409 };
}

/** Shirt number already given to another player this season? */
// While typing, any other profile with the number is a warning; to submit, only submitted / verified ones block (drafts don't).
export async function shirtTaken(db, { season, number, exceptId, forSubmit = false }) {
  if (!Number.isInteger(Number(number))) return null;
  return db.prepare(`SELECT id, display_name, status FROM squad_profiles WHERE season = ? AND type = 'player' AND shirt_number = ? AND id != ? AND deleted_at IS NULL
    AND status NOT IN ('LEFT_THE_CLUB'${forSubmit ? ", 'DRAFT'" : ''}) ORDER BY CASE status WHEN 'VERIFIED' THEN 0 WHEN 'SUBMITTED' THEN 1 ELSE 2 END LIMIT 1`)
    .bind(season, Number(number), String(exceptId || '')).first();
}
/** "A profile for this person may already exist": same display or legal name and the same date of birth. */
export async function samePerson(db, { name, fullName, dob, exceptId }) {
  if (!dob || (!name && !fullName)) return null;
  return db.prepare(`SELECT id, display_name, season, status FROM squad_profiles WHERE dob = ? AND id != ? AND deleted_at IS NULL
    AND (lower(display_name) = lower(?) OR lower(full_name) = lower(?) OR lower(display_name) = lower(?) OR lower(full_name) = lower(?)) ORDER BY updated_at DESC LIMIT 1`)
    .bind(dob, String(exceptId || ''), name || '', name || '', fullName || '', fullName || '').first();
}

/** Submit for club review: everything required, the profile photo, a free shirt number. */
export async function submitProfile(env, actor, id) {
  const db = env.DB;
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!EDITABLE.includes(p.status)) return { error: 'This profile has already been submitted.', status: 409 };
  const data = parse(p.data_json, {}), photos = parse(p.photos_json, {});
  const missing = missingForSubmit(p.type, data);
  if (!photos.profile) missing.push({ key: 'photo_profile', label: 'Profile photo', section: 'photos' });
  if (missing.length) return { error: 'Some required answers are missing.', missing, status: 400 };
  if (p.type === 'player') {
    const taken = await shirtTaken(db, { season: p.season, number: data.shirtNumber, exceptId: p.id, forSubmit: true });
    if (taken) return { error: `Shirt number ${data.shirtNumber} is already assigned to ${taken.display_name || 'another player'} this season.`, missing: [{ key: 'shirtNumber', label: 'Shirt number', section: 'playing' }], status: 409 };
  }
  const at = nowIso();
  await db.prepare(`UPDATE squad_profiles SET status = 'SUBMITTED', submitted_at = ?, submitted_by = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(at, actor.name, at, actor.name, p.id).run();
  await logProfile(db, actor, 'squad_profile_submit', `${actor.name} submitted the profile of ${p.display_name} for club review (${p.season})`);
  return { ok: true, profile: { ...p, status: 'SUBMITTED' } };
}

/** The portal deletes drafts only. Super Admins can remove any profile (force). */
export async function deleteProfile(env, actor, id, { force = false } = {}) {
  const db = env.DB;
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!force && p.status !== 'DRAFT') return { error: 'Only drafts can be deleted here. Ask a Super Admin to remove a submitted profile.', status: 409 };
  await db.prepare(`UPDATE squad_profiles SET deleted_at = ?, deleted_by = ? WHERE id = ?`).bind(nowIso(), actor.name, p.id).run();
  await deleteFiles(env, p.id);
  await logProfile(db, actor, 'squad_profile_delete', `${actor.name} deleted the ${STATUSES[p.status].toLowerCase()} profile of ${p.display_name || 'an unnamed person'} (${p.season})`);
  return { ok: true };
}

// ── Files (private R2) ──
const KINDS = { profile: ['w400.webp', 'w1200.webp', 'w1200.jpg'], action: ['w400.webp', 'w1200.webp', 'w1200.jpg'], audio: ['original', 'mp3'] };
const keyOf = (id, kind, variant) => `profiles/${id}/${kind}/${variant}`;
export const validFile = (kind, variant) => !!KINDS[kind]?.includes(variant);
export async function readFile(env, id, kind, variant) {
  if (!env.SQUAD_BUCKET || !validFile(kind, variant)) return null;
  return env.SQUAD_BUCKET.get(keyOf(id, kind, variant));
}
async function deleteFiles(env, id, kind = null) {
  if (!env.SQUAD_BUCKET) return;
  const kinds = kind ? [kind] : Object.keys(KINDS);
  await env.SQUAD_BUCKET.delete(kinds.flatMap(k => KINDS[k].map(v => keyOf(id, k, v)))).catch(() => {});
}
const magic = async (blob, kind) => {
  const b = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const s = String.fromCharCode(...b);
  if (kind === 'webp') return s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP';
  if (kind === 'jpeg') return b[0] === 0xFF && b[1] === 0xD8;
  if (kind === 'mp3') return s.startsWith('ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0);
  if (kind === 'audio') return s.slice(4, 8) === 'ftyp' || (b[0] === 0x1A && b[1] === 0x45) || s.startsWith('OggS') || s.startsWith('RIFF');
  return false;
};

/**
 * A photo, already processed in the browser (rotation fixed, location/EXIF data
 * removed by re-drawing, 4:5 crop, 400 px and 1200 px WebP + 1200 px JPG).
 * form: kind, w400 (webp), w1200 (webp), jpg (jpeg), width, height, warnings (JSON).
 */
export async function savePhoto(env, actor, id, form) {
  const db = env.DB;
  if (!env.SQUAD_BUCKET) return { error: 'Photo storage is not set up yet (SQUAD_BUCKET).', status: 503 };
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!EDITABLE.includes(p.status)) return { error: 'This profile can only be viewed.', status: 409 };
  const kind = String(form.get('kind') || '');
  if (!['profile', 'action'].includes(kind)) return { error: 'Unknown photo.', status: 400 };
  if (kind === 'action' && p.type !== 'player') return { error: 'Action photos are for players.', status: 400 };
  const parts = { 'w400.webp': form.get('w400'), 'w1200.webp': form.get('w1200'), 'w1200.jpg': form.get('jpg') };
  for (const [v, f] of Object.entries(parts)) {
    if (!f || typeof f === 'string' || !f.size) return { error: 'The photo did not arrive. Please try again.', status: 400 };
    if (f.size > 4 * 1024 * 1024) return { error: 'The processed photo is too large.', status: 413 };
    // Browsers that cannot make WebP (Safari) send JPEG for the WebP versions; the real type is kept.
    if (!(await magic(f, 'jpeg')) && (v.endsWith('.jpg') || !(await magic(f, 'webp')))) return { error: 'That file is not a photo.', status: 400 };
  }
  for (const [v, f] of Object.entries(parts)) {
    const type = (await magic(f, 'webp')) ? 'image/webp' : 'image/jpeg';
    await env.SQUAD_BUCKET.put(keyOf(p.id, kind, v), await f.arrayBuffer(), { httpMetadata: { contentType: type } });
  }
  const photos = parse(p.photos_json, {});
  let warnings = parse(String(form.get('warnings') || '[]'), []);
  if (!Array.isArray(warnings)) warnings = [];
  photos[kind] = { width: Number(form.get('width')) || null, height: Number(form.get('height')) || null, warnings: warnings.slice(0, 5).map(w => String(w).slice(0, 120)),
    sizes: Object.fromEntries(Object.entries(parts).map(([v, f]) => [v, f.size])), uploadedAt: nowIso(), by: actor.name };
  await db.prepare(`UPDATE squad_profiles SET photos_json = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(JSON.stringify(photos), nowIso(), actor.name, p.id).run();
  await logProfile(db, actor, 'squad_profile_photo', `${actor.name} added the ${kind} photo for ${p.display_name || 'a new profile'} (${p.season})`);
  return { ok: true, photo: photos[kind], name: photoName(p, kind, 'webp') };
}
export async function deletePhoto(env, actor, id, kind) {
  const db = env.DB;
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!EDITABLE.includes(p.status)) return { error: 'This profile can only be viewed.', status: 409 };
  if (!['profile', 'action', 'audio'].includes(kind)) return { error: 'Unknown file.', status: 400 };
  await deleteFiles(env, p.id, kind);
  if (kind === 'audio') await db.prepare(`UPDATE squad_profiles SET audio_json = '{}', updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(nowIso(), actor.name, p.id).run();
  else {
    const photos = parse(p.photos_json, {}); delete photos[kind];
    await db.prepare(`UPDATE squad_profiles SET photos_json = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(JSON.stringify(photos), nowIso(), actor.name, p.id).run();
  }
  await logProfile(db, actor, 'squad_profile_photo', `${actor.name} removed the ${kind === 'audio' ? 'pronunciation recording' : `${kind} photo`} for ${p.display_name || 'a profile'}`);
  return { ok: true };
}
/** Name pronunciation (up to 10 seconds): the recording as made and an MP3 copy (made in the browser). */
export async function saveAudio(env, actor, id, form) {
  const db = env.DB;
  if (!env.SQUAD_BUCKET) return { error: 'Recording storage is not set up yet (SQUAD_BUCKET).', status: 503 };
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  if (!EDITABLE.includes(p.status)) return { error: 'This profile can only be viewed.', status: 409 };
  const original = form.get('original'), mp3 = form.get('mp3');
  const seconds = Number(form.get('seconds'));
  if (!original || typeof original === 'string' || !original.size || original.size > 1024 * 1024) return { error: 'The recording did not arrive or is too long.', status: 400 };
  if (!(await magic(original, 'audio'))) return { error: 'That file is not a recording.', status: 400 };
  if (!(seconds > 0 && seconds <= 10.6)) return { error: 'Recordings can be up to 10 seconds.', status: 400 };
  await env.SQUAD_BUCKET.put(keyOf(p.id, 'audio', 'original'), await original.arrayBuffer(), { httpMetadata: { contentType: (original.type || 'audio/webm').split(';')[0] } });
  let hasMp3 = false;
  if (mp3 && typeof mp3 !== 'string' && mp3.size && mp3.size < 1024 * 1024 && await magic(mp3, 'mp3')) {
    await env.SQUAD_BUCKET.put(keyOf(p.id, 'audio', 'mp3'), await mp3.arrayBuffer(), { httpMetadata: { contentType: 'audio/mpeg' } });
    hasMp3 = true;
  }
  const audio = { original: { type: (original.type || 'audio/webm').split(';')[0], size: original.size }, mp3: hasMp3 ? { size: mp3.size } : null, seconds: Math.round(seconds * 10) / 10, uploadedAt: nowIso(), by: actor.name };
  await db.prepare(`UPDATE squad_profiles SET audio_json = ?, updated_at = ?, updated_by = ?, version = version + 1 WHERE id = ?`).bind(JSON.stringify(audio), nowIso(), actor.name, p.id).run();
  await logProfile(db, actor, 'squad_profile_audio', `${actor.name} recorded the name pronunciation for ${p.display_name || 'a profile'}`);
  return { ok: true, audio };
}

// ── Lists and counts ──
const FILTERS = {
  all: `status != 'LEFT_THE_CLUB'`, players: `type = 'player' AND status != 'LEFT_THE_CLUB'`, staff: `type = 'staff' AND status != 'LEFT_THE_CLUB'`,
  drafts: `status = 'DRAFT'`, submitted: `status = 'SUBMITTED'`, verified: `status = 'VERIFIED'`, changes: `status = 'CHANGES_REQUESTED'`, left: `status = 'LEFT_THE_CLUB'`,
};
export async function listProfiles(db, { season, filter = 'all', q = '' } = {}) {
  await ensureProfileSchema(db);
  const where = [`deleted_at IS NULL`, FILTERS[filter] || FILTERS.all], binds = [];
  if (season && season !== 'all') { where.push(`season = ?`); binds.push(season); }
  const s = String(q || '').trim().toLowerCase();
  if (s) { where.push(/^\d{1,2}$/.test(s) ? `shirt_number = ?` : `lower(COALESCE(display_name, '')) LIKE ?`); binds.push(/^\d{1,2}$/.test(s) ? Number(s) : `%${s.replace(/[%_]/g, '')}%`); }
  const rows = (await db.prepare(`SELECT * FROM squad_profiles WHERE ${where.join(' AND ')} ORDER BY CASE type WHEN 'player' THEN 0 ELSE 1 END, COALESCE(shirt_number, 999), display_name LIMIT 500`).bind(...binds).all()).results;
  return rows.map(p => {
    const photos = parse(p.photos_json, {});
    return { id: p.id, season: p.season, type: p.type, status: p.status, statusLabel: STATUSES[p.status], name: p.display_name || '', shirtNumber: p.shirt_number, position: p.position, role: p.role,
      thumb: photos.profile ? `/api/squad-portal/file/${p.id}/profile/w400.webp?v=${encodeURIComponent(photos.profile.uploadedAt || '')}` : null,
      updatedAt: p.updated_at, updatedBy: p.updated_by, reviewNote: p.status === 'CHANGES_REQUESTED' ? p.review_note : null, editable: EDITABLE.includes(p.status) };
  });
}
export async function counts(db, season) {
  await ensureProfileSchema(db);
  const r = await db.prepare(`SELECT
    SUM(type = 'player' AND status != 'LEFT_THE_CLUB') AS players, SUM(type = 'staff' AND status != 'LEFT_THE_CLUB') AS staff,
    SUM(status = 'DRAFT') AS drafts, SUM(status = 'SUBMITTED') AS submitted, SUM(status = 'VERIFIED') AS verified,
    SUM(status = 'CHANGES_REQUESTED') AS changes, SUM(status = 'LEFT_THE_CLUB') AS left
    FROM squad_profiles WHERE deleted_at IS NULL AND (? = 'all' OR season = ?)`).bind(season || 'all', season || 'all').first();
  return Object.fromEntries(Object.entries(r || {}).map(([k, v]) => [k, v || 0]));
}
export async function seasons(db) {
  await ensureProfileSchema(db);
  const cur = (await getPortalSettings(db)).season;
  const rows = (await db.prepare(`SELECT DISTINCT season FROM squad_profiles WHERE deleted_at IS NULL`).all()).results.map(r => r.season);
  return [...new Set([cur, ...rows])].sort().reverse();
}

// ── Club review (main admin) ──
export async function reviewAction(env, admin, id, action, note = '') {
  const db = env.DB;
  const p = await getProfile(db, id);
  if (!p) return { error: 'Profile not found.', status: 404 };
  const at = nowIso(), name = p.display_name || 'a profile';
  const actor = { ...admin };
  if (action === 'verify') {
    if (!['SUBMITTED', 'CHANGES_REQUESTED'].includes(p.status)) return { error: 'Only submitted profiles can be verified.', status: 409 };
    if (p.type === 'player') {
      const data = parse(p.data_json, {});
      const taken = await db.prepare(`SELECT display_name FROM squad_profiles WHERE season = ? AND type = 'player' AND shirt_number = ? AND id != ? AND deleted_at IS NULL AND status = 'VERIFIED' LIMIT 1`).bind(p.season, data.shirtNumber, p.id).first();
      if (taken) return { error: `Shirt number ${data.shirtNumber} is already used by ${taken.display_name} (verified). Request a change first.`, status: 409 };
    }
    await db.prepare(`UPDATE squad_profiles SET status = 'VERIFIED', verified_at = ?, verified_by = ?, review_note = NULL, review_by = ?, review_at = ?, left_at = NULL, version = version + 1 WHERE id = ?`).bind(at, admin.name, admin.name, at, p.id).run();
    await logProfile(db, actor, 'squad_profile_verify', `${admin.name} verified and published the profile of ${name} (${p.season})`);
  } else if (action === 'request_changes') {
    const n = String(note || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 500);
    if (n.length < 5) return { error: 'Write what needs changing (the portal shows this note).', status: 400 };
    if (!['SUBMITTED', 'VERIFIED'].includes(p.status)) return { error: 'Changes can be requested for submitted or verified profiles.', status: 409 };
    await db.prepare(`UPDATE squad_profiles SET status = 'CHANGES_REQUESTED', review_note = ?, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`).bind(n, admin.name, at, p.id).run();
    await logProfile(db, actor, 'squad_profile_changes', `${admin.name} requested changes to the profile of ${name}: ${n}`);
  } else if (action === 'left') {
    if (p.status === 'DRAFT') return { error: 'Delete a draft instead.', status: 409 };
    await db.prepare(`UPDATE squad_profiles SET status = 'LEFT_THE_CLUB', left_at = ?, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`).bind(at, admin.name, at, p.id).run();
    await logProfile(db, actor, 'squad_profile_left', `${admin.name} marked ${name} as having left the club (${p.season})`);
  } else if (action === 'restore') {
    if (p.status !== 'LEFT_THE_CLUB') return { error: 'Only profiles marked as left can be restored.', status: 409 };
    await db.prepare(`UPDATE squad_profiles SET status = 'VERIFIED', left_at = NULL, review_by = ?, review_at = ?, version = version + 1 WHERE id = ?`).bind(admin.name, at, p.id).run();
    await logProfile(db, actor, 'squad_profile_verify', `${admin.name} restored the profile of ${name} (back at the club)`);
  } else return { error: 'Unknown action.', status: 400 };
  return { ok: true };
}

/** New season: verified profiles are copied into it as drafts (history and photos kept). */
export async function carryOver(env, admin, { from, to }) {
  const db = env.DB;
  await ensureProfileSchema(db);
  if (!/^20\d\d\/\d\d$/.test(String(to || '')) || from === to) return { error: 'Choose a different new season, like 2027/28.', status: 400 };
  const rows = (await db.prepare(`SELECT * FROM squad_profiles WHERE season = ? AND status = 'VERIFIED' AND deleted_at IS NULL`).bind(from).all()).results;
  let n = 0;
  for (const p of rows) {
    if (await db.prepare(`SELECT 1 FROM squad_profiles WHERE carried_from = ? AND season = ? AND deleted_at IS NULL`).bind(p.id, to).first()) continue;
    const id = rid(), at = nowIso(), data = parse(p.data_json, {});
    for (const k of ['confirmAccurate', 'confirmConsent', 'guardianConsent']) data[k] = false; // confirmed again each season
    await db.prepare(`INSERT INTO squad_profiles (id, season, type, status, data_json, meta_json, photos_json, audio_json, display_name, full_name, dob, shirt_number, role, position,
      created_at, created_by, updated_at, updated_by, carried_from) VALUES (?, ?, ?, 'DRAFT', ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, to, p.type, JSON.stringify(data), p.photos_json, p.audio_json, p.display_name, p.full_name, p.dob, p.shirt_number, p.role, p.position, at, admin.name, at, admin.name, p.id).run();
    if (env.SQUAD_BUCKET) for (const kind of Object.keys(KINDS)) for (const v of KINDS[kind]) {
      const o = await env.SQUAD_BUCKET.get(keyOf(p.id, kind, v)).catch(() => null);
      if (o) await env.SQUAD_BUCKET.put(keyOf(id, kind, v), await o.arrayBuffer(), { httpMetadata: o.httpMetadata });
    }
    n++;
  }
  await setPortalSetting(db, 'season', to, admin.name);
  await logProfile(db, admin, 'squad_carry_over', `${admin.name} carried over ${n} verified profile${n === 1 ? '' : 's'} from ${from} into ${to} as drafts for review; the portal season is now ${to}`);
  return { ok: true, copied: n };
}

// ── Keeping private details (Privacy Policy: player and staff profiles) ──
// The private details (legal name, phone, email, emergency contact, guardian,
// exact date of birth) of people marked "left the club" are erased a set number
// of seasons after they left (portal setting retention_seasons, default 2), also
// from the earlier seasons' copies of their profile. The public profile stays as
// club history. Runs once a day from the timer (/api/internal/backup-run).
export const RETENTION_DEFAULT = 2;
export async function erasePrivateAfterLeaving(db, { now = Date.now(), force = false } = {}) {
  await ensureProfileSchema(db);
  const s = await getPortalSettings(db);
  const day = new Date(now + 3600e3).toISOString().slice(0, 10);
  if (!force && s.retention_day === day) return { skipped: 'done today' };
  const seasons = Math.min(10, Math.max(1, Number(s.retention_seasons) || RETENTION_DEFAULT));
  const cutoff = new Date(now - seasons * 365 * 864e5).toISOString();
  const left = (await db.prepare(`SELECT id, carried_from FROM squad_profiles WHERE status = 'LEFT_THE_CLUB' AND left_at IS NOT NULL AND left_at < ?`).bind(cutoff).all()).results;
  const ids = new Set();
  for (const p of left) {
    ids.add(p.id);
    let from = p.carried_from;
    for (let i = 0; from && i < 20 && !ids.has(from); i++) { ids.add(from); from = (await db.prepare(`SELECT carried_from FROM squad_profiles WHERE id = ?`).bind(from).first())?.carried_from; }
  }
  let n = 0;
  for (const id of ids) {
    const p = await db.prepare(`SELECT id, data_json, meta_json, display_name, season FROM squad_profiles WHERE id = ?`).bind(id).first();
    if (!p) continue;
    const data = parse(p.data_json, {}), meta = parse(p.meta_json, {});
    if (meta._privateErased && !PRIVATE_KEYS.some(k => k in data)) continue;
    for (const k of PRIVATE_KEYS) { delete data[k]; delete meta[k]; }
    meta._privateErased = nowIso();
    await db.prepare(`UPDATE squad_profiles SET data_json = ?, meta_json = ?, full_name = NULL, dob = NULL WHERE id = ?`).bind(JSON.stringify(data), JSON.stringify(meta), id).run();
    await logProfile(db, { id: 'system', name: 'Privacy clean-up' }, 'squad_private_erased', `Private details of ${p.display_name || 'a former profile'} (${p.season}) erased: left the club more than ${seasons} season${seasons === 1 ? '' : 's'} ago`);
    n++;
  }
  await setPortalSetting(db, 'retention_day', day);
  return { erased: n, seasons };
}

// ── Team details (for the Data Package) ──
export const TEAM_DEFAULT = {
  id: 'lobi-stars-fc', name: 'Lobi Stars FC', shortName: 'Lobi Stars', nickname: 'Pride of Benue', crest: 'team/lobi-stars-crest.png',
  kitColours: { home: ['#C4161C', '#F2B705'], away: ['#FFFFFF', '#F2B705'] }, stadium: 'McCarthy Stadium', city: 'Makurdi', state: 'Benue', competition: 'Nigeria National League',
};
export async function getTeam(db) {
  await ensureProfileSchema(db);
  const r = await db.prepare(`SELECT json FROM squad_team WHERE id = 1`).first();
  return { ...TEAM_DEFAULT, ...parse(r?.json, {}), id: 'lobi-stars-fc', crest: 'team/lobi-stars-crest.png' };
}
export async function saveTeam(db, admin, t) {
  const hex = c => /^#[0-9A-Fa-f]{6}$/.test(String(c || ''));
  const clean = {
    name: String(t.name || TEAM_DEFAULT.name).slice(0, 60), shortName: String(t.shortName || TEAM_DEFAULT.shortName).slice(0, 30), nickname: String(t.nickname || '').slice(0, 40),
    stadium: String(t.stadium || '').slice(0, 60), city: String(t.city || '').slice(0, 40), state: String(t.state || '').slice(0, 40), competition: String(t.competition || '').slice(0, 60),
    kitColours: { home: [].concat(t.kitColours?.home || []).filter(hex).slice(0, 3), away: [].concat(t.kitColours?.away || []).filter(hex).slice(0, 3) },
  };
  if (!clean.kitColours.home.length) clean.kitColours.home = TEAM_DEFAULT.kitColours.home;
  if (!clean.kitColours.away.length) clean.kitColours.away = TEAM_DEFAULT.kitColours.away;
  await db.prepare(`INSERT INTO squad_team (id, json, updated_by, updated_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(clean), admin.name, nowIso()).run();
  await logAdminAction(db, admin, 'squad_team', `${admin.name} updated the team details used in the Data Package`);
  return getTeam(db);
}

export async function logExport(db, { by, place, format, filters, profiles, ok = true, note = null }) {
  await ensureProfileSchema(db);
  await db.prepare(`INSERT INTO squad_export_log (at, by, place, format, filters, profiles, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(nowIso(), by, place, format, JSON.stringify(filters || {}), Number(profiles) || 0, ok ? 1 : 0, note).run();
}
export { parse as parseJson, PRIVATE_KEYS, FIELDS };

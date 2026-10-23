// One source of truth (23 Oct 2026): the players and staff still kept as hand-made
// files in the website code (src/content) are listed for a Super Admin first
// (/admin/squad-legacy.json, built with the site). Chosen people become LIVE
// portal profiles marked "migrated – please review"; then the old files are
// switched off, so the Squad pages show portal profiles only. Placeholders
// ("Sample Forward", a "Head Coach" file without a name) are listed but are not
// people: switching off simply removes them from the website.
import { cleanValue } from '../../../src/lib/squadFields.js';
import { partsFromName } from '../../../src/lib/names.js';
import { countryFromText } from '../../../src/lib/countries.js';
import { ensureProfileSchema, logProfile } from './squadProfiles.js';
import { getPortalSettings, setPortalSetting } from './squadPortal.js';

const GROUP = { GK: 'Goalkeeper', DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward' };
const rid = () => `sp_${[...crypto.getRandomValues(new Uint8Array(9))].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16)}`;

export async function legacyList(env, origin) {
  const r = env.ASSETS ? await env.ASSETS.fetch(new Request(`${origin}/admin/squad-legacy.json`)).catch(() => null) : null;
  const d = r?.ok ? await r.json().catch(() => null) : null;
  const s = await getPortalSettings(env.DB);
  const done = new Set(JSON.parse(s.legacy_migrated || '[]'));
  const list = d ? [...d.players, ...d.staff].map(e => ({ ...e, migrated: done.has(e.key) })) : null;
  return { list, legacyOff: s.legacy_off === '1', offAt: s.legacy_off_at || null, offBy: s.legacy_off_by || null };
}

/** The portal answers for an old file (only values the portal accepts; the rest is left for review). */
export function answersFor(e) {
  const out = {};
  const set = (k, v) => { if (v === null || v === undefined || v === '') return; const c = cleanValue(k, v); if (!c.error && c.value !== null && c.value !== undefined) out[k] = c.value; };
  const n = partsFromName(e.name);
  set('surname', n.surname); set('firstName', n.firstName);
  set('nationality', countryFromText(e.nationality || '') || null);
  if (e.kind === 'player') {
    set('shirtNumber', e.number);
    set('positionGroup', GROUP[e.position]);
    set('stateOfOrigin', String(e.stateOfOrigin || '').replace(/\s+state$/i, ''));
    set('dob', e.dob);
    const h = String(e.height || '').match(/(\d(?:\.\d+)?)\s*m/i);
    if (h) set('heightCm', Math.round(Number(h[1]) * 100));
    set('preferredFoot', e.preferredFoot);
  } else {
    set('role', e.role);
  }
  set('bio', e.bio);
  return out;
}

export async function migrateLegacy(env, admin, origin, { keys = [], switchOff = false }) {
  const db = env.DB;
  await ensureProfileSchema(db);
  const { list } = await legacyList(env, origin);
  if (!list) return { error: 'The list of old squad files could not be read. Rebuild the website and try again.', status: 503 };
  const s = await getPortalSettings(db);
  const done = new Set(JSON.parse(s.legacy_migrated || '[]'));
  const chosen = list.filter(e => keys.includes(e.key) && !done.has(e.key));
  const at = new Date().toISOString(), made = [];
  for (const e of chosen) {
    const id = rid(), data = answersFor(e);
    const snap = { type: e.kind, data, photos: {}, at, by: admin.name };
    const name = [data.firstName, data.surname].filter(Boolean).join(' ') || e.name;
    await db.batch([
      db.prepare(`INSERT INTO squad_profiles (id, season, type, status, data_json, created_at, created_by, updated_at, updated_by, surname, first_name, public_name, dob, shirt_number, role, position,
        person_id, live_json, live_n, migrated, verified_at, verified_by) VALUES (?, ?, ?, 'LIVE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)`)
        .bind(id, s.season, e.kind, JSON.stringify(data), at, admin.name, at, admin.name, data.surname || null, data.firstName || null, name, data.dob || null,
          e.kind === 'player' ? data.shirtNumber ?? null : null, e.kind === 'staff' ? data.role || null : null, null, id, JSON.stringify(snap), at, admin.name),
      db.prepare(`INSERT INTO squad_profile_versions (profile_id, n, snapshot_json, approved_by, approved_at, note) VALUES (?, 1, ?, ?, ?, ?)`)
        .bind(id, JSON.stringify(snap), admin.name, at, `Migrated from the old squad file ${e.key}`),
    ]);
    done.add(e.key);
    made.push(name);
    await logProfile(db, admin, 'squad_migrate', `${admin.name} moved ${name} from the old squad files into the Squad & Staff Data Portal (live, marked "migrated – please review")`);
  }
  await setPortalSetting(db, 'legacy_migrated', JSON.stringify([...done]), admin.name);
  if (switchOff) {
    await setPortalSetting(db, 'legacy_off', '1', admin.name);
    await setPortalSetting(db, 'legacy_off_at', at, admin.name);
    await setPortalSetting(db, 'legacy_off_by', admin.name, admin.name);
    const skipped = list.filter(e => !done.has(e.key)).map(e => e.name);
    await logProfile(db, admin, 'squad_migrate', `${admin.name} switched off the old squad files: the Squad pages now show portal profiles only${skipped.length ? ` (not moved: ${skipped.join(', ')})` : ''}`);
  }
  return { ok: true, migrated: made, switchedOff: !!switchOff };
}

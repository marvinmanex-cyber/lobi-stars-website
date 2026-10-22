// Squad & Staff Data Portal: publishing. Only VERIFIED profiles reach the
// website (public fields only: age, never the date of birth) and the partner
// API (public + media fields, never private ones). The website's Squad pages are
// built from /api/squad/public (scripts/fetch-squad.mjs runs before each build);
// verifying, changing or removing a published profile starts a rebuild
// (PAGES_DEPLOY_HOOK, at most once every 2 minutes).
import { shareable } from '../../../src/lib/squadFields.js';
import { buildPackage } from '../../../src/lib/squadPackage.js';
import { ensureProfileSchema, getTeam, fileBase, parseJson } from './squadProfiles.js';
import { getPortalSettings, setPortalSetting } from './squadPortal.js';

const GROUP = { Goalkeeper: 'GK', 'Right back': 'DEF', 'Centre back': 'DEF', 'Left back': 'DEF', 'Defensive midfielder': 'MID', 'Central midfielder': 'MID', 'Attacking midfielder': 'MID', 'Right winger': 'FWD', 'Left winger': 'FWD', Striker: 'FWD' };
const slug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function profilesFor(db, { season = null, statuses = ['VERIFIED'], type = null, since = null } = {}) {
  await ensureProfileSchema(db);
  const where = [`deleted_at IS NULL`, `status IN (${statuses.map(() => '?').join(',')})`], binds = [...statuses];
  if (season && season !== 'all') { where.push(`season = ?`); binds.push(season); }
  if (type) { where.push(`type = ?`); binds.push(type); }
  if (since) { where.push(`updated_at > ?`); binds.push(since); }
  return (await db.prepare(`SELECT * FROM squad_profiles WHERE ${where.join(' AND ')} ORDER BY type, COALESCE(shirt_number, 999), display_name`).bind(...binds).all()).results;
}
/** The Data Package input for a row (what squadPackage.js reads). */
export const packageInput = r => {
  const photos = parseJson(r.photos_json, {}), audio = parseJson(r.audio_json, {});
  return { id: r.id, type: r.type, status: r.status, updatedAt: r.updated_at, data: parseJson(r.data_json, {}), hasAudio: !!(audio.mp3 || audio.original), hasMp3: !!audio.mp3, hasAction: !!photos.action, hasPhoto: !!photos.profile, fileBase: fileBase(r), season: r.season, photos, audio };
};

/** For the website build: verified profiles of the current season, public fields only. */
export async function publicSquad(env) {
  const db = env.DB;
  const season = (await getPortalSettings(db)).season;
  const rows = await profilesFor(db, { season });
  const left = await profilesFor(db, { season, statuses: ['LEFT_THE_CLUB'] });
  const used = new Set();
  const uniq = s => { let x = s || 'profile', i = 2; while (used.has(x)) x = `${s}-${i++}`; used.add(x); return x; };
  const photo = (r, kind) => (parseJson(r.photos_json, {})[kind] ? `/api/squad/photo/${r.id}/${kind}/w1200.webp?v=${encodeURIComponent(parseJson(r.photos_json, {})[kind].uploadedAt || '')}` : null);
  const out = { season, updatedAt: new Date().toISOString(), players: [], staff: [], left: left.map(r => r.display_name).filter(Boolean) };
  for (const r of rows) {
    const d = shareable(r.type, parseJson(r.data_json, {}), { media: false });
    const base = { id: r.id, slug: uniq(slug(d.displayName)), name: d.displayName, nickname: d.nickname || null, age: d.age, nationality: d.nationality === 'Other' ? d.nationalityOther : d.nationality,
      stateOfOrigin: d.stateOfOrigin, hometown: d.hometown, social: d.social, honours: d.honours || [], photo: photo(r, 'profile'), updatedAt: r.updated_at };
    if (r.type === 'player') out.players.push({ ...base, number: d.shirtNumber, position: d.primaryPosition, group: GROUP[d.primaryPosition] || 'MID', secondaryPositions: d.secondaryPositions || [],
      preferredFoot: d.preferredFoot, heightCm: d.heightCm, joined: d.joined, international: d.international, previousClubs: d.previousClubs || [], actionPhoto: photo(r, 'action') });
    else out.staff.push({ ...base, role: d.role === 'Other' ? d.roleOther || 'Staff' : d.role, joined: d.joinedStaff, qualifications: d.qualifications, playingCareer: d.playingCareer, previousRoles: d.previousRoles || [] });
  }
  return out;
}

/** Rebuild the website so the Squad pages show the change (at most once every 2 minutes). */
export async function requestRebuild(env, why) {
  const db = env.DB;
  const s = await getPortalSettings(db);
  if (!env.PAGES_DEPLOY_HOOK) return { ok: false, reason: 'no deploy hook' };
  if (s.last_rebuild && Date.now() - Date.parse(s.last_rebuild) < 120e3) return { ok: true, skipped: true };
  await setPortalSetting(db, 'last_rebuild', new Date().toISOString(), why);
  const r = await fetch(env.PAGES_DEPLOY_HOOK, { method: 'POST' }).catch(() => null);
  return { ok: !!r?.ok };
}

// ── Signed links for the partner (24 hours) ──
async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}
const signKey = env => `${env.LOBI_PARTNER_API_KEY || ''}|${env.SESSION_SECRET || ''}|squad-files`;
export async function signedFileUrl(env, origin, id, kind, variant, ttl = 24 * 3600e3) {
  const exp = Date.now() + ttl;
  return `${origin}/api/partner/file/${id}/${kind}/${variant}?exp=${exp}&sig=${await hmac(signKey(env), `${id}/${kind}/${variant}/${exp}`)}`;
}
export async function checkSignature(env, id, kind, variant, exp, sig) {
  if (!(Number(exp) > Date.now())) return false;
  return sig === await hmac(signKey(env), `${id}/${kind}/${variant}/${exp}`);
}

/** The partner feed: data.json structure with absolute signed links. */
export async function partnerFeed(env, origin, { since = null } = {}) {
  const db = env.DB;
  const season = (await getPortalSettings(db)).season;
  const rows = (await profilesFor(db, { season, since })).map(packageInput);
  const links = new Map();
  for (const p of rows) {
    links.set(`${p.id}:profile`, p.hasPhoto ? await signedFileUrl(env, origin, p.id, 'profile', 'w1200.jpg') : null);
    if (p.hasAction) links.set(`${p.id}:action`, await signedFileUrl(env, origin, p.id, 'action', 'w1200.jpg'));
    if (p.hasAudio) links.set(`${p.id}:audio`, await signedFileUrl(env, origin, p.id, 'audio', p.hasMp3 ? 'mp3' : 'original'));
  }
  const files = { photo: (p, kind) => links.get(`${p.id}:${kind}`) || null, audio: p => links.get(`${p.id}:audio`) || null };
  return buildPackage({ profiles: rows, team: await getTeam(db), season, filters: { status: 'verified', type: 'all', ...(since ? { since } : {}) }, files });
}

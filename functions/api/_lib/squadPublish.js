// Squad & Staff Data Portal: publishing. Only the approved LIVE version of LIVE
// profiles that are not hidden reaches the website (public fields only; the full
// date of birth and middle name only from age 18) and the partner API (public +
// media fields, never private ones); an edit waiting for approval never does. The
// website's Squad pages are
// built from /api/squad/public (scripts/fetch-squad.mjs runs before each build);
// verifying, changing or removing a published profile starts a rebuild
// (PAGES_DEPLOY_HOOK, at most once every 2 minutes).
import { shareable, nameOf, profileName } from '../../../src/lib/squadFields.js';
import { buildPackage } from '../../../src/lib/squadPackage.js';
import { officialName, shortName, nameSlug, partsFromName } from '../../../src/lib/names.js';
import { ensureProfileSchema, getTeam, fileBase, parseJson, rowName, liveOf, slugFor } from './squadProfiles.js';
import { getPortalSettings, setPortalSetting } from './squadPortal.js';
import { roleMap } from './squadRoles.js';

const GROUP = { Goalkeeper: 'GK', Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD' };

/** A row with its LIVE version in place of the working copy (what the website and partner see). */
export function liveRow(r) {
  const l = liveOf(r);
  return l ? { ...r, type: l.type || r.type, data_json: JSON.stringify(l.data || {}), photos_json: JSON.stringify(l.photos || {}) } : r;
}
// live: true = each row's live version (rows never approved are left out); false = the working copies.
export async function profilesFor(db, { season = null, statuses = ['LIVE'], type = null, since = null, live = true } = {}) {
  await ensureProfileSchema(db);
  const where = [`deleted_at IS NULL`, `status IN (${statuses.map(() => '?').join(',')})`], binds = [...statuses];
  if (season && season !== 'all') { where.push(`season = ?`); binds.push(season); }
  if (type) { where.push(`type = ?`); binds.push(type); }
  if (since) { where.push(`updated_at > ?`); binds.push(since); }
  const rows = (await db.prepare(`SELECT * FROM squad_profiles WHERE ${where.join(' AND ')} ORDER BY type, COALESCE(shirt_number, 999), COALESCE(surname, public_name, display_name)`).bind(...binds).all()).results;
  return live ? rows.filter(r => r.live_json).map(liveRow) : rows;
}
/** The Data Package input for a row (what squadPackage.js reads). */
export const packageInput = r => {
  const photos = parseJson(r.photos_json, {});
  return { id: r.id, type: r.type, status: r.status, updatedAt: r.updated_at, data: parseJson(r.data_json, {}), hasAction: !!photos.action, hasHero: !!photos.hero, hasPhoto: !!photos.profile, fileBase: fileBase(r), season: r.season, photos };
};

// The public photo of a live profile (the version on the website: ?v= changes when the photo does).
const livePhoto = (r, kind, variant = 'w1200.webp') => { const ph = parseJson(r.photos_json, {})[kind]; return ph ? `/api/squad/photo/${r.id}/${kind}/${variant}?v=${encodeURIComponent(ph.rev || ph.uploadedAt || '')}` : null; };

/** One person as the website shows them (public fields only). photo(r, kind, variant) gives the photo addresses. */
export function feedItem(r, slug, photo = livePhoto) {
  const d = shareable(r.type, parseJson(r.data_json, {}), { media: false });
  // Before the name check (old single name): best-effort parts, so nothing disappears.
  const n = d.surname && d.firstName ? nameOf(d) : { ...partsFromName(profileName(parseJson(r.data_json, {}))), middleName: '', websiteName: d.websiteName || '' };
  const name = profileName({ ...n }) || rowName(r);
  const base = { id: r.id, slug, name, firstName: n.firstName, surname: n.surname, websiteName: d.websiteName || null,
    officialName: officialName(n), shortName: shortName(n), nickname: d.nickname || null, dob: d.dob || null, age: d.age,
    nationality: d.nationality || null, nationality2: d.nationality2 || null, birthTown: d.birthTown || null, birthCountry: d.birthCountry || null, stateOfOrigin: d.stateOfOrigin, hometown: d.hometown,
    socials: { instagram: d.socialInstagram || null, x: d.socialX || null, tiktok: d.socialTiktok || null }, honours: d.honours || [], interestingFact: d.interestingFact || null,
    bioHeadline: d.bioHeadline || null, bio: d.bio || null, shirtShopUrl: d.shirtShopUrl || null,
    photo: photo(r, 'profile'), photoSmall: photo(r, 'profile', 'w400.webp'), heroPhoto: photo(r, 'hero', 'w2000.webp') || photo(r, 'hero'), updatedAt: r.updated_at,
    oldSlugs: parseJson(r.old_slugs, []).filter(x => x !== slug) };
  if (r.type === 'player') return { ...base, number: d.shirtNumber, positionGroup: d.positionGroup || null, group: GROUP[d.positionGroup] || 'MID', position: d.primaryPosition || null,
    secondaryPositions: d.secondaryPositions || [], preferredFoot: d.preferredFoot, heightCm: d.heightCm, joined: d.joined, debutDate: d.debutDate || null, nationalTeam: d.nationalTeam || null,
    previousClubs: d.previousClubs || [], internationalCareer: d.internationalCareer || [], actionPhoto: photo(r, 'action') };
  return { ...base, role: d.role === 'Other' ? d.roleOther || 'Staff' : d.role, joined: d.joinedStaff, licence: d.qualifications || null, playingCareer: d.playingCareer, previousRoles: d.previousRoles || [] };
}

/** The working copy (what is waiting for approval) as the website would show it: the Approval Queue preview. */
export async function previewItem(env, r) {
  const season = r.season;
  const photo = (row, kind, variant = 'w1200.webp') => { const ph = parseJson(row.photos_json, {})[kind]; return ph ? `/api/squad-portal/file/${row.id}/${kind}/${variant}${ph.rev ? `?rev=${ph.rev}` : ''}` : null; };
  const slug = r.public_slug || (await slugFor(env.DB, r, parseJson(r.data_json, {}))).slug;
  return { ...feedItem(r, slug, photo), season };
}

/** For the website: the live, not hidden profiles of the current season, public fields only. */
export async function publicSquad(env) {
  const db = env.DB;
  const season = (await getPortalSettings(db)).season;
  const rows = (await profilesFor(db, { season })).filter(r => !parseJson(r.data_json, {}).hideFromWebsite);
  const left = await profilesFor(db, { season, statuses: ['FORMER'] });
  const settings = await getPortalSettings(db);
  const used = new Set();
  const uniq = s => { let x = s || 'profile', i = 2; while (used.has(x)) x = `${s}-${i++}`; used.add(x); return x; };
  // legacyOff: the old hand-made squad files are switched off (Super Admin, after the migration list).
  // clubStaff: the web addresses of non-coaching staff (they have no public page: /squad/staff/<slug>/ goes to /squad/).
  const out = { season, updatedAt: new Date().toISOString(), players: [], staff: [], clubStaff: [], left: left.map(rowName).filter(Boolean), redirects: [], legacyOff: settings.legacy_off === '1' };
  const roles = await roleMap(db);
  const slugWrites = [];
  for (const r of rows) {
    // The web address is fixed when a profile is approved (slugFor); older live profiles get theirs now.
    let slug = r.public_slug;
    if (!slug) {
      const f = await slugFor(db, r, parseJson(r.data_json, {}));
      slug = f.slug;
      slugWrites.push(db.prepare(`UPDATE squad_profiles SET public_slug = ?, old_slugs = ? WHERE id = ?`).bind(f.slug, JSON.stringify(f.olds), r.id));
      r.old_slugs = JSON.stringify(f.olds);
    }
    const item = feedItem(r, uniq(slug));
    if (r.type === 'player') { out.players.push(item); continue; }
    // Only COACHING roles are on the Squad page (Squad › Roles); club staff and roles still waiting for approval are not.
    const role = roles.get(item.role);
    if (role?.category === 'COACHING') out.staff.push({ ...item, roleCategory: 'COACHING', roleOrder: role.sort });
    else out.clubStaff.push(item.slug);
  }
  if (slugWrites.length) await db.batch(slugWrites);
  // Old addresses → current ones (never an address someone else uses now).
  for (const [list, prefix] of [[out.players, '/squad/'], [out.staff, '/squad/staff/']]) {
    const current = new Set(list.map(x => x.slug));
    for (const x of list) for (const o of x.oldSlugs) if (!current.has(o)) out.redirects.push({ from: `${prefix}${o}/`, to: `${prefix}${x.slug}/` });
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
    if (p.hasHero) links.set(`${p.id}:hero`, await signedFileUrl(env, origin, p.id, 'hero', 'w1200.jpg'));
  }
  const files = { photo: (p, kind) => links.get(`${p.id}:${kind}`) || null };
  return buildPackage({ profiles: rows, team: await getTeam(db), season, filters: { status: 'verified', type: 'all', ...(since ? { since } : {}) }, files });
  // (Data Package status "verified" = live; former players join the feed in Phase 4.)
}

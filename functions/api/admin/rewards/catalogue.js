import { requireAdminUser } from '../../_lib/adminEvents.js';
import { logLeague } from '../../_lib/leagueDb.js';
import { ensureCatalogueSchema, listItems, TYPES } from '../../_lib/rewardsCatalogue.js';

// Admin › Rewards › Catalogue.
// GET -> { items } (all, including inactive and archived)
// POST { item: { id?, name, description, image, type, points, valueNaira, tier, kind, appliesTo,
//        stock, perFanLimit, minAge, minTier, sponsor, startsAt, endsAt, active, archived, sort } } -> add or edit
// Every change goes to the audit log. Points have no cash value.
const ok = (d = {}) => Response.json({ ok: true, ...d }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (error, status = 400) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
const intOrNull = v => (v === '' || v === null || v === undefined ? null : Number(v));
const clean = (v, n) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, n);
const lagosIso = v => { if (!v) return null; const t = Date.parse(/T\d{2}:\d{2}$/.test(v) ? `${v}:00+01:00` : v); return Number.isNaN(t) ? NaN : new Date(t).toISOString(); };

export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try { return ok({ items: await listItems(env.DB, { all: true }), types: TYPES }); }
  catch (err) { console.error('[rewards admin] catalogue', err); return fail('Could not load the catalogue.', 500); }
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  try {
    const db = env.DB;
    await ensureCatalogueSchema(db);
    const x = (await request.json().catch(() => ({}))).item || {};
    const staff = admin.email || admin.name || 'owner';
    const before = x.id ? (await listItems(db, { all: true })).find(i => i.id === x.id) : null;
    if (x.id && !before) return fail('Reward not found.', 404);
    const type = before ? before.type : String(x.type || '');
    if (!TYPES.includes(type)) return fail('Choose the type of reward.');
    const name = clean(x.name ?? before?.name, 80);
    if (name.length < 3) return fail('Give the reward a name.');
    const points = Number(x.points ?? before?.points);
    if (!Number.isInteger(points) || points < 1 || points > 1_000_000) return fail('Points: a whole number from 1.');
    const config = { ...(before?.config || {}) };
    const naira = v => (v === undefined || v === '' ? undefined : Math.round(Number(v) * 100));
    if (type === 'voucher') {
      config.kind = x.kind ?? config.kind ?? 'shop';
      if (!['shop', 'food'].includes(config.kind)) return fail('Voucher: for the shop or for food.');
      if (x.appliesTo !== undefined) config.appliesTo = clean(x.appliesTo, 30) || undefined;
      if (naira(x.valueNaira) !== undefined) config.valueKobo = naira(x.valueNaira);
      if (config.valueKobo !== undefined && !(config.valueKobo >= 0)) return fail('Voucher value: naira.');
    }
    if (type === 'ticket') { config.tier = x.tier ?? config.tier ?? 'Regular'; if (!['VIP', 'Premium', 'Regular'].includes(config.tier)) return fail('Ticket: choose the stand.'); }
    const startsAt = x.startsAt === undefined ? before?.startsAt ?? null : lagosIso(x.startsAt);
    const endsAt = x.endsAt === undefined ? before?.endsAt ?? null : lagosIso(x.endsAt);
    if (Number.isNaN(startsAt) || Number.isNaN(endsAt)) return fail('Enter real dates.');
    const row = {
      name, description: clean(x.description ?? before?.description, 300), image: clean(x.image ?? before?.image, 200) || null, type, points,
      config_json: JSON.stringify(config),
      stock: x.stock === undefined ? before?.stock ?? null : intOrNull(x.stock), per_fan_limit: x.perFanLimit === undefined ? before?.perFanLimit ?? null : intOrNull(x.perFanLimit),
      min_age: x.minAge === undefined ? before?.minAge ?? null : intOrNull(x.minAge), min_tier: x.minTier === undefined ? before?.minTier ?? null : (x.minTier || null),
      sponsor: x.sponsor === undefined ? before?.sponsor ?? null : (clean(x.sponsor, 60) || null), starts_at: startsAt, ends_at: endsAt,
      active: x.active === undefined ? (before ? (before.active ? 1 : 0) : 1) : (x.active ? 1 : 0), archived: x.archived === undefined ? (before?.archived ? 1 : 0) : (x.archived ? 1 : 0),
      sort: x.sort === undefined ? before?.sort ?? 100 : Number(x.sort) || 100,
    };
    for (const k of ['stock', 'per_fan_limit', 'min_age']) if (row[k] !== null && (!Number.isInteger(row[k]) || row[k] < 0 || row[k] > 1_000_000)) return fail(`${k.replace(/_/g, ' ')}: a whole number (empty = no limit).`);
    if (row.min_tier && !['gold', 'legend'].includes(row.min_tier)) return fail('Tier: Gold or Legend (or any).');
    if (row.image && !/^(\/images\/|https:\/\/)/.test(row.image)) return fail('Image: a site path like /images/... or an https:// address.');
    if (before) {
      await db.prepare(`UPDATE rewards_catalogue SET name = ?, description = ?, image = ?, points = ?, config_json = ?, stock = ?, per_fan_limit = ?, min_age = ?, min_tier = ?, sponsor = ?, starts_at = ?, ends_at = ?, active = ?, archived = ?, sort = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
        .bind(row.name, row.description, row.image, row.points, row.config_json, row.stock, row.per_fan_limit, row.min_age, row.min_tier, row.sponsor, row.starts_at, row.ends_at, row.active, row.archived, row.sort, staff, before.id).run();
    } else {
      const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-${Math.random().toString(36).slice(2, 6)}`;
      await db.prepare(`INSERT INTO rewards_catalogue (id, name, description, image, type, points, config_json, stock, per_fan_limit, min_age, min_tier, sponsor, starts_at, ends_at, active, archived, sort, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, row.name, row.description, row.image, row.type, row.points, row.config_json, row.stock, row.per_fan_limit, row.min_age, row.min_tier, row.sponsor, row.starts_at, row.ends_at, row.active, row.archived, row.sort, staff).run();
      x.id = id;
    }
    const after = (await listItems(db, { all: true })).find(i => i.id === x.id);
    await logLeague(db, { email: staff }, before ? 'rewards.catalogue.edit' : 'rewards.catalogue.add', 'rewards_catalogue', x.id, before, after);
    return ok({ item: after });
  } catch (err) {
    console.error('[rewards admin] catalogue save', err);
    return fail('Could not save.', 500);
  }
}

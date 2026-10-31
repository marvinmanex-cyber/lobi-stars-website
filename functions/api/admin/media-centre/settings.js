import { requireAdminUser } from '../../_lib/adminEvents.js';
import { ensureMediaSchema, mcSettings, setMcSetting, categories, mcLog, adminActor, SETTING_DEFAULTS, NEWS_TABS, json, oneLine, newId } from '../../_lib/mediaCentre.js';

// Super Admins: Media Centre settings and news categories.
// GET  -- settings, categories (including hidden ones).
// POST { action: 'settings', values } | { action: 'category_add', name, tab } | { action: 'category', id, name?, tab?, hidden?, sort? }
const CHECK = {
  accreditation_close_hours: v => /^\d{1,3}$/.test(v) && Number(v) <= 336,
  accreditation_max: v => /^\d{1,3}$/.test(v) && Number(v) >= 1,
  newsletter_deadline: v => /^[0-6]\|([01]\d|2[0-3]):[0-5]\d$/.test(v),
  newsletter_publish: v => /^[0-6]\|([01]\d|2[0-3]):[0-5]\d$/.test(v),
  media_team_email: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  press_contact: v => v.length >= 5 && v.length <= 200,
};
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  return json({ settings: await mcSettings(env.DB), categories: await categories(env.DB, { all: true }), tabs: NEWS_TABS });
}

export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureMediaSchema(db);
  const b = await request.json().catch(() => ({}));
  const A = adminActor(admin), by = admin.email || admin.name;
  if (b.action === 'settings') {
    const changed = [];
    for (const [k, v] of Object.entries(b.values || {})) {
      if (!(k in SETTING_DEFAULTS)) continue;
      const s = oneLine(v, 200);
      if (!CHECK[k](s)) return json({ error: `Please check "${k.replace(/_/g, ' ')}".` }, 400);
      await setMcSetting(db, k, s, by); changed.push(`${k}=${s}`);
    }
    await mcLog(db, A, 'settings', { section: 'settings', details: changed.join('; '), request });
  } else if (b.action === 'category_add') {
    const name = oneLine(b.name, 40), tab = NEWS_TABS.includes(b.tab) ? b.tab : 'Club';
    if (name.length < 3) return json({ error: 'Enter the category name.' }, 400);
    if (/women|ladies|female|academy|youth team|u-?\d\d/i.test(name)) return json({ error: 'Lobi Stars has no women\'s or academy team.' }, 400);
    if (await db.prepare(`SELECT id FROM mc_categories WHERE lower(name) = lower(?)`).bind(name).first()) return json({ error: 'That category already exists.' }, 400);
    const max = (await db.prepare(`SELECT MAX(sort) AS m FROM mc_categories`).first())?.m || 0;
    await db.prepare(`INSERT INTO mc_categories (id, name, tab, sort) VALUES (?, ?, ?, ?)`).bind(newId('cat'), name, tab, max + 1).run();
    await mcLog(db, A, 'category_add', { section: 'news', itemType: 'category', itemTitle: name, details: `Listed under ${tab}`, request });
  } else if (b.action === 'category') {
    const c = await db.prepare(`SELECT * FROM mc_categories WHERE id = ?`).bind(String(b.id || '')).first();
    if (!c) return json({ error: 'Category not found.' }, 404);
    const name = b.name !== undefined ? oneLine(b.name, 40) : c.name;
    if (name.length < 3) return json({ error: 'Enter the category name.' }, 400);
    if (/women|ladies|female|academy/i.test(name)) return json({ error: 'Lobi Stars has no women\'s or academy team.' }, 400);
    const tab = b.tab !== undefined ? (NEWS_TABS.includes(b.tab) ? b.tab : c.tab) : c.tab;
    const hidden = b.hidden !== undefined ? (b.hidden ? 1 : 0) : c.hidden;
    const sort = b.sort !== undefined && Number.isInteger(Number(b.sort)) ? Number(b.sort) : c.sort;
    await db.prepare(`UPDATE mc_categories SET name = ?, tab = ?, hidden = ?, sort = ? WHERE id = ?`).bind(name, tab, hidden, sort, c.id).run();
    await mcLog(db, A, 'category_edit', { section: 'news', itemType: 'category', itemId: c.id, itemTitle: name, details: [c.name !== name ? `renamed from ${c.name}` : null, c.tab !== tab ? `tab ${tab}` : null, c.hidden !== hidden ? (hidden ? 'hidden' : 'shown') : null].filter(Boolean).join('; ') || null, request });
  } else return json({ error: 'Unknown action.' }, 400);
  return json({ ok: true, settings: await mcSettings(db), categories: await categories(db, { all: true }) });
}

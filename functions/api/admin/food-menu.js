import { requireAdminUser } from '../_lib/adminEvents.js';
import { logAdminAction } from '../_lib/adminSession.js';
import { ensureMenuSchema, parseItem, history, wasOrdered, photoUrl, naira, orderingState } from '../_lib/foodMenuDb.js';
import { foodSettings, saveFoodSetting, WA_TEMPLATES } from '../_lib/foodOrders.js';
import { normalizeNigerianPhone } from '../_lib/fans.js';
import { randomId } from '../_lib/crypto.js';

const noStore = { 'Cache-Control': 'no-store' };
const bad = (error, status = 400) => Response.json({ error }, { status, headers: noStore });

async function state(env) {
  const db = env.DB;
  const { results: categories } = await db.prepare(`SELECT * FROM food_categories ORDER BY sort, name`).all();
  const { results: items } = await db.prepare(`SELECT * FROM food_items ORDER BY archived, sort, name`).all();
  const { results: hist } = await db.prepare(`SELECT item_id, at, by, text FROM food_item_history ORDER BY id DESC LIMIT 400`).all();
  const settings = await foodSettings(db);
  return {
    categories: categories.map(c => ({ id: c.id, name: c.name, count: items.filter(i => i.category_id === c.id && !i.archived).length })),
    items: items.map(i => ({
      id: i.id, name: i.name, description: i.description || '', price: i.price_kobo / 100, category: i.category_id,
      photoId: i.photo_id, photo: photoUrl(i.photo_id), emoji: i.emoji || '', available: !!i.available, soldOut: !!i.sold_out,
      archived: !!i.archived, maxPerOrder: i.max_per_order, stock: i.stock, adult: !!i.adult, spice: i.spice || 0, badge: i.badge || '', updatedAt: i.updated_at,
      history: hist.filter(h => h.item_id === i.id).slice(0, 8),
    })),
    settings: { ...settings, minOrder: settings.minOrderKobo / 100 },
    ordering: await orderingState(env, settings),
  };
}

// GET /api/admin/food-menu -- every item (including archived), categories, settings.
export async function onRequestGet({ request, env }) {
  const { denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  await ensureMenuSchema(env.DB);
  return Response.json(await state(env), { headers: noStore });
}

// POST /api/admin/food-menu { action, ... } -- see the cases below.
export async function onRequestPost({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const db = env.DB;
  await ensureMenuSchema(db);
  let b;
  try { b = await request.json(); } catch { b = {}; }
  const now = new Date().toISOString();
  const item = b.id ? await db.prepare(`SELECT * FROM food_items WHERE id = ?`).bind(String(b.id)).first() : null;
  const needItem = () => (item ? null : bad('Item not found.', 404));
  const log = (what, detail) => logAdminAction(db, admin, `food_menu_${what}`, detail);

  switch (b.action) {
    case 'save': {
      const { results: cats } = await db.prepare(`SELECT id FROM food_categories`).all();
      const { value: v, error } = parseItem(b.item || {}, cats);
      if (error) return bad(error);
      if (!v.photo_id && !v.emoji) return bad('Please add a photo (or at least an emoji) so fans can see the item.');
      if (item) {
        await db.prepare(`UPDATE food_items SET name = ?, description = ?, price_kobo = ?, category_id = ?, photo_id = ?, emoji = ?, available = ?, sold_out = ?,
          adult = ?, max_per_order = ?, stock = ?, spice = ?, badge = ?, updated_at = ? WHERE id = ?`)
          .bind(v.name, v.description, v.price_kobo, v.category_id, v.photo_id, v.emoji, v.available, v.sold_out, v.adult, v.max_per_order, v.stock, v.spice, v.badge, now, item.id).run();
        if (v.price_kobo !== item.price_kobo) await history(db, item.id, admin.name, `Price changed from ${naira(item.price_kobo)} to ${naira(v.price_kobo)}`);
        if (v.name !== item.name) await history(db, item.id, admin.name, `Renamed from "${item.name}"`);
        if (v.photo_id !== item.photo_id) await history(db, item.id, admin.name, v.photo_id ? 'New photo' : 'Photo removed');
        await log('edit', v.name);
        return Response.json({ ok: true, id: item.id }, { headers: noStore });
      }
      const id = randomId('fi', 8);
      const sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM food_items`).first()).m ?? -1) + 1;
      await db.prepare(`INSERT INTO food_items (id, name, description, price_kobo, category_id, photo_id, emoji, available, sold_out, adult, max_per_order, stock, spice, badge, sort, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, v.name, v.description, v.price_kobo, v.category_id, v.photo_id, v.emoji, v.available, v.sold_out, v.adult, v.max_per_order, v.stock, v.spice, v.badge, sort, now, now).run();
      await history(db, id, admin.name, `Added at ${naira(v.price_kobo)}`);
      await log('add', v.name);
      return Response.json({ ok: true, id }, { headers: noStore });
    }
    case 'soldOut': {
      if (needItem()) return needItem();
      const on = b.value ? 1 : 0;
      // Marking an item back in stock also clears a stock count of 0.
      await db.prepare(`UPDATE food_items SET sold_out = ?, stock = CASE WHEN ? = 0 AND stock = 0 THEN NULL ELSE stock END, updated_at = ? WHERE id = ?`).bind(on, on, now, item.id).run();
      await history(db, item.id, admin.name, on ? 'Marked sold out' : 'Back in stock');
      await log('soldout', `${item.name}: ${on ? 'sold out' : 'available'}`);
      break;
    }
    case 'price': {
      if (needItem()) return needItem();
      const price = Number(b.price);
      if (!Number.isInteger(price) || price <= 0 || price > 1_000_000) return bad('The price must be a whole number of naira above 0.');
      if (price * 100 !== item.price_kobo) {
        await db.prepare(`UPDATE food_items SET price_kobo = ?, updated_at = ? WHERE id = ?`).bind(price * 100, now, item.id).run();
        await history(db, item.id, admin.name, `Price changed from ${naira(item.price_kobo)} to ${naira(price * 100)}`);
        await log('price', `${item.name}: ${naira(item.price_kobo)} → ${naira(price * 100)}`);
      }
      break;
    }
    case 'delete': {
      if (needItem()) return needItem();
      if (await wasOrdered(db, item.id)) {
        await db.prepare(`UPDATE food_items SET archived = 1, updated_at = ? WHERE id = ?`).bind(now, item.id).run();
        await history(db, item.id, admin.name, 'Archived (it has past orders, so it was kept for reports)');
        await log('archive', item.name);
        return Response.json({ ok: true, archived: true, ...(await state(env)) }, { headers: noStore });
      }
      await db.batch([
        db.prepare(`DELETE FROM food_items WHERE id = ?`).bind(item.id),
        db.prepare(`DELETE FROM food_item_history WHERE item_id = ?`).bind(item.id),
      ]);
      await log('delete', item.name);
      return Response.json({ ok: true, deleted: true, ...(await state(env)) }, { headers: noStore });
    }
    case 'restore': {
      if (needItem()) return needItem();
      await db.prepare(`UPDATE food_items SET archived = 0, updated_at = ? WHERE id = ?`).bind(now, item.id).run();
      await history(db, item.id, admin.name, 'Restored');
      await log('restore', item.name);
      break;
    }
    case 'duplicate': {
      if (needItem()) return needItem();
      const id = randomId('fi', 8);
      const sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM food_items`).first()).m ?? -1) + 1;
      await db.prepare(`INSERT INTO food_items (id, name, description, price_kobo, category_id, photo_id, emoji, available, sold_out, adult, max_per_order, stock, spice, badge, sort, created_at, updated_at)
        SELECT ?, substr(name || ' (copy)', 1, 60), description, price_kobo, category_id, photo_id, emoji, 0, sold_out, adult, max_per_order, stock, spice, badge, ?, ?, ? FROM food_items WHERE id = ?`)
        .bind(id, sort, now, now, item.id).run();
      await history(db, id, admin.name, `Copied from "${item.name}" (hidden until you switch it on)`);
      await log('duplicate', item.name);
      return Response.json({ ok: true, id, ...(await state(env)) }, { headers: noStore });
    }
    case 'order': {
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 500) : [];
      if (ids.length) await db.batch(ids.map((id, i) => db.prepare(`UPDATE food_items SET sort = ? WHERE id = ?`).bind(i, id)));
      break;
    }
    case 'category-add': {
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return bad('Please type a category name.');
      const sort = ((await db.prepare(`SELECT MAX(sort) AS m FROM food_categories`).first()).m ?? -1) + 1;
      await db.prepare(`INSERT INTO food_categories (id, name, sort) VALUES (?, ?, ?)`).bind(randomId('fc', 6), name, sort).run();
      await log('category', `added ${name}`);
      break;
    }
    case 'category-rename': {
      const name = String(b.name || '').trim().slice(0, 40);
      if (!name) return bad('Please type a category name.');
      await db.prepare(`UPDATE food_categories SET name = ? WHERE id = ?`).bind(name, String(b.id || '')).run();
      break;
    }
    case 'category-order': {
      const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 100) : [];
      if (ids.length) await db.batch(ids.map((id, i) => db.prepare(`UPDATE food_categories SET sort = ? WHERE id = ?`).bind(i, id)));
      break;
    }
    case 'category-delete': {
      const n = (await db.prepare(`SELECT COUNT(*) AS n FROM food_items WHERE category_id = ? AND archived = 0`).bind(String(b.id || '')).first()).n;
      if (n) return bad('Move or delete the items in this category first. Only empty categories can be deleted.');
      await db.prepare(`UPDATE food_items SET category_id = NULL WHERE category_id = ?`).bind(String(b.id || '')).run();
      await db.prepare(`DELETE FROM food_categories WHERE id = ?`).bind(String(b.id || '')).run();
      await log('category', `deleted ${b.id}`);
      break;
    }
    case 'settings': {
      const s = b.settings || {};
      if (!['open', 'closed', 'auto'].includes(s.orderingMode)) return bad('Choose open, closed or automatic.');
      const auto = Math.round(Number(s.autoOpenMinutes));
      if (!(auto >= 0 && auto <= 600)) return bad('Opening time before kick-off must be 0 to 600 minutes.');
      const expiry = Math.round(Number(s.paymentExpiryMinutes));
      if (!(expiry >= 1 && expiry <= 120)) return bad('The payment time limit must be 1 to 120 minutes.');
      const min = s.minOrder === '' || s.minOrder == null ? 0 : Number(s.minOrder);
      if (!(Number.isInteger(min) && min >= 0 && min <= 1_000_000)) return bad('The minimum order must be a whole number of naira (0 for none).');
      const stands = (Array.isArray(s.stands) ? s.stands : String(s.stands || '').split('\n')).map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 40);
      for (const [k, v] of [['orderingMode', s.orderingMode], ['autoOpenMinutes', auto], ['paymentExpiryMinutes', expiry], ['minOrderKobo', min * 100], ['stands', JSON.stringify(stands)]]) {
        await saveFoodSetting(db, k, v, admin.name);
      }
      await log('settings', `ordering ${s.orderingMode}, ${stands.length} stands, min ${min}, expiry ${expiry}`);
      break;
    }
    case 'ordering_mode': {
      // The big OPEN / CLOSED button on the live order board.
      if (!['open', 'closed', 'auto'].includes(b.mode)) return bad('Choose open, closed or automatic.');
      await saveFoodSetting(db, 'orderingMode', b.mode, admin.name);
      await log('settings', `ordering ${b.mode} (live board)`);
      break;
    }
    case 'whatsapp_settings': {
      // Order on WhatsApp: the club number, pickup points, bank details and the staff reply messages.
      const w = b.settings || {};
      const num = normalizeNigerianPhone(w.whatsappNumber);
      if (w.whatsappEnabled && !num) return bad('Please enter the club WhatsApp number (e.g. 0903 039 9416).');
      const hours = Math.round(Number(w.whatsappExpiryHours));
      if (!(hours >= 1 && hours <= 48)) return bad('Unconfirmed WhatsApp orders must expire after 1 to 48 hours.');
      const points = (Array.isArray(w.pickupPoints) ? w.pickupPoints : String(w.pickupPoints || '').split('\n')).map(x => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 20);
      const pairs = [['whatsappEnabled', w.whatsappEnabled ? '1' : '0'], ['whatsappExpiryHours', hours], ['pickupPoints', JSON.stringify(points)], ['bankDetails', String(w.bankDetails || '').trim().slice(0, 300)]];
      if (num) pairs.push(['whatsappNumber', num.replace(/\D/g, '')]);
      for (const k of Object.keys(WA_TEMPLATES)) pairs.push([k, String(w[k] || '').trim().slice(0, 500) || WA_TEMPLATES[k]]);
      for (const [k, v] of pairs) await saveFoodSetting(db, k, v, admin.name);
      await log('whatsapp_settings', `WhatsApp ordering ${w.whatsappEnabled ? 'on' : 'off'}, ${points.length} pickup points`);
      break;
    }
    default:
      return bad('Unknown action');
  }
  return Response.json({ ok: true, ...(await state(env)) }, { headers: noStore });
}

import { ensureNewsletterSchema } from '../_lib/newsletter.js';
import { unsubscribeContact } from '../_lib/contacts.js';
import { clientIp, rateLimit, tooMany } from '../_lib/fans.js';

// Newsletter options from the link in every newsletter (/newsletter/?t=<token>).
// GET  /api/newsletter/prefs?t=  -- who it is (email partly hidden) and their options
// POST /api/newsletter/prefs { t, weekly, matchday, offers }  or  { t, unsubscribeAll: true }
const TOKEN = /^[a-f0-9]{36}$/;
async function find(db, t) {
  if (!TOKEN.test(t || '')) return null;
  await ensureNewsletterSchema(db);
  return db.prepare(`SELECT * FROM contacts WHERE unsub_token = ?`).bind(t).first();
}
const mask = e => e.replace(/^(.{2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`);

export async function onRequestGet({ request, env }) {
  const t = new URL(request.url).searchParams.get('t') || '';
  const c = await find(env.DB, t);
  if (!c) return Response.json({ error: 'This link is not valid. Use the link at the bottom of a recent newsletter.' }, { status: 404 });
  const n = await env.DB.prepare(`SELECT * FROM newsletter_subscribers WHERE email = ?`).bind(c.email).first();
  const subscribed = c.marketing_consent === 1 && !c.unsubscribed_at;
  return Response.json({
    email: mask(c.email || ''), firstName: c.first_name || '', subscribed,
    prefs: { weekly: subscribed && (n ? n.pref_weekly === 1 : true), matchday: subscribed && !!n?.pref_matchday, offers: subscribed && !!n?.pref_offers },
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestPost({ request, env }) {
  const b = await request.json().catch(() => ({}));
  if (!(await rateLimit(env.DB, `nlprefs:${clientIp(request)}`, 30, 3600))) return tooMany();
  const c = await find(env.DB, b.t);
  if (!c) return Response.json({ error: 'This link is not valid.' }, { status: 404 });
  const now = new Date().toISOString();
  if (b.unsubscribeAll || (!b.weekly && !b.matchday && !b.offers)) {
    await unsubscribeContact(env.DB, c);
    await env.DB.prepare(`UPDATE newsletter_subscribers SET pref_weekly = 0, pref_matchday = 0, pref_offers = 0, updated_at = ? WHERE email = ?`).bind(now, c.email).run();
    return Response.json({ ok: true, subscribed: false });
  }
  // Choosing an option from their own link means they want club emails again.
  await env.DB.prepare(`UPDATE contacts SET marketing_consent = 1, unsubscribed_at = NULL WHERE id = ?`).bind(c.id).run();
  await env.DB.prepare(`INSERT INTO newsletter_subscribers (email, source, full_name, consent_at, updated_at, pref_weekly, pref_matchday, pref_offers)
    VALUES (?, 'options', ?, ?, ?, ?, ?, ?)
    ON CONFLICT (email) DO UPDATE SET pref_weekly = excluded.pref_weekly, pref_matchday = excluded.pref_matchday, pref_offers = excluded.pref_offers, updated_at = excluded.updated_at`)
    .bind(c.email, [c.first_name, c.surname].filter(Boolean).join(' ') || null, now, now, b.weekly ? 1 : 0, b.matchday ? 1 : 0, b.offers ? 1 : 0).run();
  return Response.json({ ok: true, subscribed: true });
}

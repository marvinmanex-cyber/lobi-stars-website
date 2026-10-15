// Lobi Stars Rewards notifications: on-site messages (My Rewards and the dot
// on the header points badge) and, if the fan wants them, emails. One message
// per event (UNIQUE member + kind + ref), so a job that runs twice never
// notifies twice. Emails a fan asked for directly (e.g. the voucher code after
// redeeming) are always sent and are not part of these preferences.
import { sendEmail } from './email.js';

export const NOTIFY_KINDS = {
  points: { label: 'Star Points arriving (ticket points after the match, birthday bonus)', emailDefault: false },
  tier: { label: 'Reaching a new tier', emailDefault: true },
  rewards: { label: 'My rewards (ready, arranged, points returned, voucher about to expire)', emailDefault: true },
  expiry: { label: 'Points about to expire', emailDefault: true },
};

let ready = false;
export async function ensureNotifySchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS rewards_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      UNIQUE (member_id, kind, ref))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_rewards_notifications_member ON rewards_notifications (member_id, read_at)`),
  ]);
  const rc = new Set((await db.prepare(`PRAGMA table_info(rewards_members)`).all()).results.map(c => c.name));
  if (!rc.has('notify_email')) await db.prepare(`ALTER TABLE rewards_members ADD COLUMN notify_email TEXT`).run().catch(e => { if (!/duplicate column/i.test(String(e?.message))) throw e; });
  ready = true;
}

/** { points: bool, tier: bool, rewards: bool, expiry: bool } from the saved choice or the defaults. */
export function emailPrefs(saved) {
  let s = {}; try { s = JSON.parse(saved || '{}') || {}; } catch { s = {}; }
  return Object.fromEntries(Object.entries(NOTIFY_KINDS).map(([k, v]) => [k, typeof s[k] === 'boolean' ? s[k] : v.emailDefault]));
}

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The standard Rewards email around a message (or `html` for a custom body). */
export function rewardsEmailHtml({ firstName, title, body, html, link, linkText = 'See My Rewards' }) {
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#15181D">
  <h2 style="color:#A3161B">${esc(title)}</h2>
  <p>Hi ${esc(firstName)},</p>
  ${html || `<p>${esc(body)}</p>`}
  <p><a href="https://lobistarsfc.com${esc(link || '/rewards/me/')}" style="color:#A3161B;font-weight:bold">${esc(linkText)}</a></p>
  <p style="font-size:12px;color:#888">Star Points have no cash value. Choose which Rewards emails you get on My Rewards: lobistarsfc.com/rewards/me</p>
</div>`;
}

/**
 * Adds an on-site message and, if the fan wants this kind by email, emails it.
 * { kind, ref, title, body, link, email: true | { subject, html } | false }. Never throws.
 */
export async function notify(env, memberId, { kind, ref, title, body, link = '/rewards/me/', email = true }) {
  try {
    const db = env.DB;
    await ensureNotifySchema(db);
    const r = await db.prepare(`INSERT OR IGNORE INTO rewards_notifications (member_id, kind, ref, title, body, link) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(memberId, kind, String(ref), String(title).slice(0, 120), String(body).slice(0, 400), link).run();
    if (!r.meta.changes || !email || !env.RESEND_API_KEY) return !!r.meta.changes;
    const m = await db.prepare(`SELECT m.email, m.first_name, m.email_verified, r.notify_email, r.status FROM members m JOIN rewards_members r ON r.member_id = m.id WHERE m.id = ?`).bind(memberId).first();
    if (!m || !m.email_verified || m.status !== 'active' || !emailPrefs(m.notify_email)[kind]) return true;
    const custom = typeof email === 'object' ? email : {};
    await sendEmail(env, { to: m.email, subject: custom.subject || `${title} – Lobi Stars Rewards`,
      html: custom.html ? rewardsEmailHtml({ firstName: m.first_name, title, html: custom.html, link }) : rewardsEmailHtml({ firstName: m.first_name, title, body, link }) })
      .catch(err => console.error('[rewards] notify email', err));
    return true;
  } catch (err) { console.error('[rewards] notify', err); return false; }
}

export async function listNotifications(db, memberId, limit = 20) {
  await ensureNotifySchema(db);
  const [{ results }, u] = await Promise.all([
    db.prepare(`SELECT id, kind, title, body, link, created_at, read_at FROM rewards_notifications WHERE member_id = ? ORDER BY id DESC LIMIT ?`).bind(memberId, limit).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM rewards_notifications WHERE member_id = ? AND read_at IS NULL`).bind(memberId).first(),
  ]);
  return { items: results.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, createdAt: n.created_at, read: !!n.read_at })), unread: Number(u?.n) || 0 };
}

export async function unreadCount(db, memberId) {
  await ensureNotifySchema(db);
  return Number((await db.prepare(`SELECT COUNT(*) AS n FROM rewards_notifications WHERE member_id = ? AND read_at IS NULL`).bind(memberId).first())?.n) || 0;
}

export async function markRead(db, memberId, id = null) {
  await ensureNotifySchema(db);
  const q = id ? `UPDATE rewards_notifications SET read_at = datetime('now') WHERE member_id = ? AND id = ? AND read_at IS NULL`
    : `UPDATE rewards_notifications SET read_at = datetime('now') WHERE member_id = ? AND read_at IS NULL`;
  return (await (id ? db.prepare(q).bind(memberId, Number(id)) : db.prepare(q).bind(memberId)).run()).meta.changes;
}

export async function savePrefs(db, memberId, prefs) {
  await ensureNotifySchema(db);
  const clean = Object.fromEntries(Object.keys(NOTIFY_KINDS).map(k => [k, prefs?.[k] === true]));
  await db.prepare(`UPDATE rewards_members SET notify_email = ? WHERE member_id = ?`).bind(JSON.stringify(clean), memberId).run();
  return clean;
}

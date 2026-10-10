// Fan database: one merged row per person ("contacts"), linked back to every
// original record they came from ("contact_sources"). The original form
// records are never deleted by merging.
//
// Merging rules: emails are lower-cased and trimmed, phones converted to
// +234 format. Two records are the same person if the email matches OR the
// phone matches. The most recent non-empty name and state win.
import { normalizeNigerianPhone } from './fans.js';

export const SOURCES = {
  newsletter: 'Newsletter',
  contact_form: 'Contact Form',
  fan_account: 'Fan Account / Predict & Win',
  membership: 'Membership',
  ticket_buyer: 'Ticket Buyer',
  sponsorship: 'Sponsorship Enquiry',
  food_order: 'Food Order',
  download_lead: 'Download Lead',
  shop_order: 'Shop Order',
  hospitality: 'Hospitality Enquiry',
};

let ready = false;
export async function ensureContactsSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      first_name TEXT,
      surname TEXT,
      state TEXT,
      first_source TEXT,
      first_seen TEXT,
      last_seen TEXT,
      marketing_consent INTEGER NOT NULL DEFAULT 0,
      unsubscribed_at TEXT,
      unsub_token TEXT UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS contact_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL REFERENCES contacts(id),
      source TEXT NOT NULL,
      ref_table TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      label TEXT,
      UNIQUE (source, ref_table, ref_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_contact_sources_contact ON contact_sources(contact_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen)`),
    // Contact Us + partnership enquiries (they also still go to the Formspree inbox).
    db.prepare(`CREATE TABLE IF NOT EXISTS enquiries (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('contact', 'partnership')),
      first_name TEXT, surname TEXT, company TEXT,
      email TEXT NOT NULL, phone TEXT, subject TEXT, interest TEXT, category TEXT, message TEXT,
      privacy_consent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`),
    // People who gave their details to download a file (e.g. the partnership brochure).
    db.prepare(`CREATE TABLE IF NOT EXISTS download_leads (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      first_name TEXT, surname TEXT, company TEXT,
      email TEXT NOT NULL, phone TEXT,
      marketing_consent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )`),
  ]);
  ready = true;
}

const clean = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 100) : '');
export const normEmail = v => (typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? v.trim().toLowerCase() : null);
const toIso = v => {
  if (!v) return new Date().toISOString();
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(v) ? v : String(v).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};
const token = () => [...crypto.getRandomValues(new Uint8Array(18))].map(b => b.toString(16).padStart(2, '0')).join('');
const newId = () => 'c_' + [...crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('');

/** Splits "Terna Akaa" into first name + surname. */
export function splitName(full) {
  const parts = clean(full).split(' ').filter(Boolean);
  if (!parts.length) return { firstName: '', surname: '' };
  return { firstName: parts[0], surname: parts.slice(1).join(' ') };
}

/**
 * Adds one form record to the fan database, merging it into an existing
 * person when the email or phone matches. Idempotent per (source, refTable, refId).
 * rec: { email, phone, firstName, surname, state, source, refTable, refId, seenAt, consent, label }
 */
export async function upsertContact(db, rec) {
  await ensureContactsSchema(db);
  if (!SOURCES[rec.source]) throw new Error(`Unknown source ${rec.source}`);
  const email = normEmail(rec.email);
  const phone = normalizeNigerianPhone(rec.phone);
  if (!email && !phone) return null;
  const refId = String(rec.refId ?? '');
  const already = await db.prepare(`SELECT contact_id FROM contact_sources WHERE source = ? AND ref_table = ? AND ref_id = ?`)
    .bind(rec.source, rec.refTable, refId).first();
  if (already) return already.contact_id;

  const seen = toIso(rec.seenAt);
  const byEmail = email ? await db.prepare(`SELECT * FROM contacts WHERE email = ?`).bind(email).first() : null;
  const byPhone = phone ? await db.prepare(`SELECT * FROM contacts WHERE phone = ?`).bind(phone).first() : null;

  let c = byEmail || byPhone;
  if (byEmail && byPhone && byEmail.id !== byPhone.id) {
    // The email belongs to one person and the phone to another: same person, merge them.
    c = await mergeContacts(db, byEmail, byPhone);
  }

  if (!c) {
    const id = newId();
    await db.prepare(
      `INSERT INTO contacts (id, email, phone, first_name, surname, state, first_source, first_seen, last_seen, marketing_consent, unsub_token)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, email, phone, clean(rec.firstName) || null, clean(rec.surname) || null, clean(rec.state) || null,
      rec.source, seen, seen, rec.consent === true ? 1 : 0, token()).run();
    c = { id };
  } else {
    const newer = !c.last_seen || seen >= c.last_seen;
    const pick = (incoming, existing) => (newer && clean(incoming) ? clean(incoming) : existing || clean(incoming) || null);
    const earlier = !c.first_seen || seen < c.first_seen;
    // Consent: a new opt-in counts unless they unsubscribed after it.
    const consent = rec.consent === true && (!c.unsubscribed_at || seen > c.unsubscribed_at) ? 1 : c.marketing_consent;
    const emailFree = email && !c.email && !(await db.prepare(`SELECT 1 FROM contacts WHERE email = ? AND id != ?`).bind(email, c.id).first());
    const phoneFree = phone && !c.phone && !(await db.prepare(`SELECT 1 FROM contacts WHERE phone = ? AND id != ?`).bind(phone, c.id).first());
    await db.prepare(
      `UPDATE contacts SET first_name = ?, surname = ?, state = ?, email = COALESCE(email, ?), phone = COALESCE(phone, ?),
         first_source = ?, first_seen = ?, last_seen = ?, marketing_consent = ? WHERE id = ?`
    ).bind(
      pick(rec.firstName, c.first_name), pick(rec.surname, c.surname), pick(rec.state, c.state),
      emailFree ? email : null, phoneFree ? phone : null,
      earlier ? rec.source : c.first_source, earlier ? seen : c.first_seen,
      newer ? seen : c.last_seen, consent, c.id
    ).run();
  }

  await db.prepare(`INSERT OR IGNORE INTO contact_sources (contact_id, source, ref_table, ref_id, seen_at, label) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(c.id, rec.source, rec.refTable, refId, seen, rec.label ? String(rec.label).slice(0, 200) : null).run();
  return c.id;
}

/** Moves everything from `b` into `a` and deletes `b`. Returns the merged row. */
async function mergeContacts(db, a, b) {
  const [keep, drop] = (a.first_seen || '') <= (b.first_seen || '') ? [a, b] : [b, a];
  const newer = (drop.last_seen || '') > (keep.last_seen || '') ? drop : keep;
  await db.batch([
    db.prepare(`UPDATE contact_sources SET contact_id = ? WHERE contact_id = ?`).bind(keep.id, drop.id),
    db.prepare(`DELETE FROM contacts WHERE id = ?`).bind(drop.id),
  ]);
  await db.prepare(
    `UPDATE contacts SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), first_name = ?, surname = ?, state = ?,
       last_seen = ?, marketing_consent = ? WHERE id = ?`
  ).bind(
    drop.email, drop.phone,
    newer.first_name || keep.first_name || drop.first_name, newer.surname || keep.surname || drop.surname, newer.state || keep.state || drop.state,
    newer.last_seen, keep.marketing_consent || drop.marketing_consent ? 1 : 0, keep.id
  ).run();
  return db.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(keep.id).first();
}

/** Safely runs upsertContact without ever failing the form that triggered it. */
export async function captureContact(env, rec) {
  try { return await upsertContact(env.DB, rec); } catch (err) { console.error('[contacts] capture failed', err); return null; }
}

async function tableExists(db, name) {
  return !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first());
}

/**
 * One-off backfill (safe to run again): imports every existing record from
 * the original tables into the fan database, oldest first.
 */
export async function backfillContacts(db) {
  await ensureContactsSchema(db);
  const recs = [];
  if (await tableExists(db, 'newsletter_subscribers')) {
    const { results } = await db.prepare(`SELECT * FROM newsletter_subscribers`).all();
    results.forEach(r => recs.push({ source: 'newsletter', refTable: 'newsletter_subscribers', refId: r.email, email: r.email, seenAt: r.created_at, consent: true }));
  }
  if (await tableExists(db, 'members')) {
    const cols = new Set((await db.prepare(`PRAGMA table_info(members)`).all()).results.map(r => r.name));
    const { results } = await db.prepare(`SELECT * FROM members`).all();
    results.forEach(r => recs.push({
      source: r.tier === 'Fan' ? 'fan_account' : 'membership', refTable: 'members', refId: r.id,
      email: r.email, phone: cols.has('phone_e164') ? (r.phone_e164 || r.phone) : r.phone,
      firstName: r.first_name, surname: r.last_name, state: r.state, seenAt: r.created_at,
      consent: cols.has('marketing_opt_in') ? r.marketing_opt_in === 1 : false,
    }));
  }
  if (await tableExists(db, 'orders')) {
    const { results } = await db.prepare(`SELECT * FROM orders WHERE payment_status = 'paid'`).all();
    results.forEach(r => { const n = splitName(r.buyer_name); recs.push({ source: 'ticket_buyer', refTable: 'orders', refId: r.id, email: r.buyer_email, phone: r.buyer_phone, firstName: n.firstName, surname: n.surname, seenAt: r.paid_at || r.created_at, label: r.event_id }); });
  }
  if (await tableExists(db, 'food_orders')) {
    const { results } = await db.prepare(`SELECT * FROM food_orders WHERE payment_status = 'paid'`).all();
    results.forEach(r => recs.push({ source: 'food_order', refTable: 'food_orders', refId: r.id, email: r.email, phone: r.phone, seenAt: r.paid_at || r.created_at }));
  }
  {
    const { results } = await db.prepare(`SELECT * FROM enquiries`).all();
    results.forEach(r => recs.push({ source: r.kind === 'partnership' ? 'sponsorship' : 'contact_form', refTable: 'enquiries', refId: r.id, email: r.email, phone: r.phone, firstName: r.first_name, surname: r.surname, seenAt: r.created_at }));
    const leads = await db.prepare(`SELECT * FROM download_leads`).all();
    leads.results.forEach(r => recs.push({ source: 'download_lead', refTable: 'download_leads', refId: r.id, email: r.email, phone: r.phone, firstName: r.first_name, surname: r.surname, seenAt: r.created_at, consent: r.marketing_consent === 1, label: r.file }));
  }
  recs.sort((a, b) => toIso(a.seenAt).localeCompare(toIso(b.seenAt)));
  let added = 0;
  for (const r of recs) {
    const before = await db.prepare(`SELECT 1 FROM contact_sources WHERE source = ? AND ref_table = ? AND ref_id = ?`).bind(r.source, r.refTable, String(r.refId)).first();
    if (!before && (await upsertContact(db, r))) added++;
  }
  return { records: recs.length, added };
}

/** Marketing opt-out (from an email link or by staff). */
export async function unsubscribeContact(db, contact) {
  await db.prepare(`UPDATE contacts SET marketing_consent = 0, unsubscribed_at = ? WHERE id = ?`).bind(new Date().toISOString(), contact.id).run();
  if (contact.email && (await tableExists(db, 'members'))) {
    const cols = new Set((await db.prepare(`PRAGMA table_info(members)`).all()).results.map(r => r.name));
    if (cols.has('marketing_opt_in')) await db.prepare(`UPDATE members SET marketing_opt_in = 0 WHERE email = ?`).bind(contact.email).run();
  }
}

export function unsubscribeUrl(contact, origin = 'https://lobistarsfc.com') {
  return `${origin}/unsubscribe/?t=${contact.unsub_token}`;
}

/**
 * Right-to-erasure: removes the person from the fan database and every
 * source. Payment records (tickets, food orders) are kept for accounting
 * but their personal details are blanked out.
 */
export async function deleteContactEverywhere(db, contactId) {
  await ensureContactsSchema(db);
  const c = await db.prepare(`SELECT * FROM contacts WHERE id = ?`).bind(contactId).first();
  if (!c) return false;
  const { results: sources } = await db.prepare(`SELECT * FROM contact_sources WHERE contact_id = ?`).bind(contactId).all();
  const stmts = [];
  for (const s of sources) {
    if (s.ref_table === 'newsletter_subscribers') stmts.push(db.prepare(`DELETE FROM newsletter_subscribers WHERE email = ?`).bind(s.ref_id));
    if (s.ref_table === 'enquiries') stmts.push(db.prepare(`DELETE FROM enquiries WHERE id = ?`).bind(s.ref_id));
    if (s.ref_table === 'download_leads') stmts.push(db.prepare(`DELETE FROM download_leads WHERE id = ?`).bind(s.ref_id));
    if (s.ref_table === 'orders') stmts.push(db.prepare(`UPDATE orders SET buyer_name = 'Deleted', buyer_email = 'deleted@deleted.invalid', buyer_phone = '' WHERE id = ?`).bind(s.ref_id));
    if (s.ref_table === 'shirt_orders') stmts.push(db.prepare(`UPDATE shirt_orders SET buyer_name = 'Deleted', buyer_email = 'deleted@deleted.invalid', buyer_phone = '', member_id = NULL WHERE id = ?`).bind(s.ref_id));
    if (s.ref_table === 'food_orders') stmts.push(db.prepare(`UPDATE food_orders SET email = 'deleted@deleted.invalid', phone = '', seat = '', stand = '' WHERE id = ?`).bind(s.ref_id));
    if (s.ref_table === 'members') {
      if (await tableExists(db, 'auth_tokens')) stmts.push(db.prepare(`DELETE FROM auth_tokens WHERE member_id = ?`).bind(s.ref_id));
      // Keep the vote counted for the match result but unlink it from the person.
      if (await tableExists(db, 'motm_votes')) stmts.push(db.prepare(`UPDATE motm_votes SET member_id = 'deleted-' || id WHERE member_id = ?`).bind(s.ref_id));
      if (await tableExists(db, 'predictions')) stmts.push(db.prepare(`UPDATE predictions SET member_id = 'deleted-' || id WHERE member_id = ?`).bind(s.ref_id));
      if (await tableExists(db, 'shirt_orders')) stmts.push(db.prepare(`UPDATE shirt_orders SET member_id = NULL WHERE member_id = ?`).bind(s.ref_id));
      if (await tableExists(db, 'membership_payments')) stmts.push(db.prepare(`UPDATE membership_payments SET member_id = 'deleted-' || id WHERE member_id = ?`).bind(s.ref_id));
      if (await tableExists(db, 'award_votes')) stmts.push(db.prepare(`UPDATE award_votes SET member_id = 'deleted-' || id WHERE member_id = ?`).bind(s.ref_id));
      stmts.push(db.prepare(`DELETE FROM members WHERE id = ?`).bind(s.ref_id));
    }
  }
  stmts.push(db.prepare(`DELETE FROM contact_sources WHERE contact_id = ?`).bind(contactId));
  stmts.push(db.prepare(`DELETE FROM contacts WHERE id = ?`).bind(contactId));
  await db.batch(stmts);
  return true;
}

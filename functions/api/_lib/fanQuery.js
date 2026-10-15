// Queries behind /admin/fans and the fan database exports.
import { SOURCES, ensureContactsSchema } from './contacts.js';
import { rewardsTierMap } from './rewardsTiers.js';

// The columns of the contact downloads (one row per person, no duplicates).
export const FAN_COLUMNS = [
  'First Name', 'Surname', 'Email', 'Phone', 'State', 'All Sources', 'First Source', 'First Seen', 'Last Seen',
  'Number of Interactions', 'Email Verified', 'Member', 'Marketing Consent', 'Rewards Member', 'Rewards Tier', 'Star Points',
];

const SORTS = {
  last_seen: 'c.last_seen', first_seen: 'c.first_seen', name: "LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.surname, ''))",
  state: "LOWER(COALESCE(c.state, ''))", interactions: 'interactions',
};

async function tableExists(db, name) {
  return !!(await db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first());
}
async function hasColumn(db, table, col) {
  if (!(await tableExists(db, table))) return false;
  return (await db.prepare(`PRAGMA table_info(${table})`).all()).results.some(r => r.name === col);
}

/** Builds the WHERE clause from the /admin/fans filters. */
function whereFrom(p) {
  const where = [], binds = [];
  const q = (p.get('q') || '').trim().toLowerCase().slice(0, 100);
  if (q) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    // Phone search only for number-like input ("0803 123", "+234803..."), ignoring the leading 0.
    const digits = /^[\d\s+()-]+$/.test(q) ? q.replace(/\D/g, '').replace(/^0/, '') : '';
    where.push(`(LOWER(COALESCE(c.first_name, '') || ' ' || COALESCE(c.surname, '')) LIKE ? OR c.email LIKE ?${digits.length >= 3 ? ' OR c.phone LIKE ?' : ''})`);
    binds.push(like, like);
    if (digits.length >= 3) binds.push(`%${digits}%`);
  }
  const source = p.get('source');
  if (source && /^[a-z0-9_]{1,40}$/.test(source)) { where.push(`EXISTS (SELECT 1 FROM contact_sources s2 WHERE s2.contact_id = c.id AND s2.source = ?)`); binds.push(source); }
  // Contact Sources page: by FIRST source, and people who first reached us in a date range.
  const firstSource = p.get('firstSource');
  if (firstSource && /^[a-z0-9_]{1,40}$/.test(firstSource)) { where.push('c.first_source = ?'); binds.push(firstSource); }
  const ff = p.get('firstFrom'), ft = p.get('firstTo');
  if (ff && !Number.isNaN(Date.parse(ff))) { where.push('c.first_seen >= ?'); binds.push(new Date(ff).toISOString()); }
  if (ft && !Number.isNaN(Date.parse(ft))) { where.push('c.first_seen < ?'); binds.push(new Date(ft).toISOString()); }
  const consent = p.get('consent');
  if (consent === 'Y') where.push('c.marketing_consent = 1');
  if (consent === 'N') where.push('c.marketing_consent = 0');
  const state = (p.get('state') || '').trim();
  if (state) { where.push(`LOWER(c.state) = ?`); binds.push(state.toLowerCase()); }
  const from = p.get('from'), to = p.get('to');
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push('c.last_seen >= ?'); binds.push(`${from}T00:00:00.000Z`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push('c.last_seen <= ?'); binds.push(`${to}T23:59:59.999Z`); }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', binds };
}

/**
 * Contacts with their engagement figures.
 * opts: { params (URLSearchParams), page, pageSize, all, marketingOnly }
 */
export async function queryContacts(db, opts = {}) {
  await ensureContactsSchema(db);
  const p = opts.params || new URLSearchParams();
  const w = whereFrom(p);
  if (opts.marketingOnly) w.sql = w.sql ? `${w.sql} AND c.marketing_consent = 1` : 'WHERE c.marketing_consent = 1';
  const sortKey = SORTS[p.get('sort')] ? p.get('sort') : 'last_seen';
  const dir = p.get('dir') === 'asc' ? 'ASC' : 'DESC';

  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM contacts c ${w.sql}`).bind(...w.binds).first()).n;
  const pageSize = opts.all ? 1_000_000 : Math.min(100, Math.max(5, opts.pageSize || 25));
  const page = Math.max(1, opts.page || 1);

  const { results } = await db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM contact_sources s WHERE s.contact_id = c.id) AS interactions,
       (SELECT GROUP_CONCAT(DISTINCT s.source) FROM contact_sources s WHERE s.contact_id = c.id) AS source_keys
     FROM contacts c ${w.sql} ORDER BY ${SORTS[sortKey]} ${dir}, c.id LIMIT ? OFFSET ?`
  ).bind(...w.binds, pageSize, (page - 1) * pageSize).all();

  await addEngagement(db, results);
  return { total, page, pageSize, rows: results };
}

/**
 * Email Verified / Member / Predict & Win figures, from the fan accounts.
 * Uses a fixed handful of queries however many contacts there are (D1 limits
 * the number of queries per request), so downloads work for thousands.
 */
async function addEngagement(db, rows) {
  if (!rows.length) return;
  for (const r of rows) {
    r.sources = (r.source_keys || '').split(',').filter(Boolean);
    r.email_verified = 0; r.member = 0; r.matches_predicted = 0; r.motm_votes = 0; r.prize_wins = 0;
    if (r.sources.includes('membership')) r.member = 1;
  }
  if (!(await tableExists(db, 'members'))) return;
  const verifiedCol = await hasColumn(db, 'members', 'email_verified');
  const want = new Set(rows.map(r => r.id));
  const { results: links } = await db.prepare(
    `SELECT s.contact_id, m.id AS mid, m.tier${verifiedCol ? ', m.email_verified' : ''} FROM contact_sources s JOIN members m ON m.id = s.ref_id WHERE s.ref_table = 'members'`
  ).all();
  const byContact = new Map();
  for (const l of links) if (want.has(l.contact_id)) { const a = byContact.get(l.contact_id) || []; a.push(l); byContact.set(l.contact_id, a); }
  const counts = async (table, extra = '') => {
    if (!(await hasColumn(db, table, 'member_id'))) return new Map();
    const { results } = await db.prepare(`SELECT member_id, COUNT(*) AS n FROM ${table} ${extra} GROUP BY member_id`).all();
    return new Map(results.map(x => [x.member_id, x.n]));
  };
  const votes = await counts('motm_votes');
  const preds = await counts('predictions');
  const wins = (await hasColumn(db, 'predictions', 'is_winner')) ? await counts('predictions', 'WHERE is_winner = 1') : new Map();
  // Lobi Stars Rewards: member (Yes / On hold), tier and Star Points balance.
  const rewards = (await tableExists(db, 'rewards_members')) ? await rewardsTierMap(db).catch(() => new Map()) : new Map();
  for (const r of rows) {
    const mem = byContact.get(r.id) || [];
    if (!mem.length) continue;
    r.member = mem.some(m => m.tier && m.tier !== 'Fan') || r.member ? 1 : 0;
    r.email_verified = mem.some(m => (verifiedCol ? m.email_verified === 1 : true)) ? 1 : 0;
    for (const m of mem) {
      if (!r.rewards && rewards.get(m.mid)) r.rewards = rewards.get(m.mid);
      r.motm_votes += votes.get(m.mid) || 0;
      r.matches_predicted += preds.get(m.mid) || 0;
      r.prize_wins += wins.get(m.mid) || 0;
    }
  }
}

/** "2026-10-09 14:05" in Nigerian time. */
export function watTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function exportRow(r, labels = SOURCES) {
  const yn = v => (v ? 'Yes' : 'No');
  return [
    r.first_name || '', r.surname || '', r.email || '', r.phone || '', r.state || '',
    r.sources.map(s => labels[s] || s).join(', '), labels[r.first_source] || r.first_source || '',
    watTime(r.first_seen), watTime(r.last_seen), r.interactions || 0,
    yn(r.email_verified), yn(r.member), yn(r.marketing_consent),
    r.rewards ? (r.rewards.status === 'active' ? 'Yes' : 'On hold') : 'No', r.rewards ? r.rewards.tier : '', r.rewards ? r.rewards.balance : '',
  ];
}

/** Hides most of an email/phone for staff without export permission. */
export const maskEmail = e => (e ? e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1***$2***$3') : '');
export const maskPhone = p => (p ? p.slice(0, 7) + '****' + p.slice(-2) : '');

/** Nigerian date for file names, e.g. 2026-10-09. */
export const watDate = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

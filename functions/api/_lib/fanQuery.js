// Queries behind /admin/fans and the fan database exports.
import { SOURCES, ensureContactsSchema } from './contacts.js';

export const FAN_COLUMNS = [
  'First Name', 'Surname', 'Email', 'Phone', 'State', 'Sources', 'First Source', 'First Seen', 'Last Seen',
  'Interactions', 'Email Verified', 'Member', 'Marketing Consent', 'Matches Predicted', 'MOTM Votes', 'Prize Wins',
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
  if (source && SOURCES[source]) { where.push(`EXISTS (SELECT 1 FROM contact_sources s2 WHERE s2.contact_id = c.id AND s2.source = ?)`); binds.push(source); }
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

/** Email Verified / Member / Predict & Win figures, from the fan accounts. */
async function addEngagement(db, rows) {
  if (!rows.length) return;
  const hasMembers = await tableExists(db, 'members');
  const verifiedCol = hasMembers && (await hasColumn(db, 'members', 'email_verified'));
  // Phase 6-7 tables (MOTM voting, Predict & Win). Counted once they exist.
  const votes = (await hasColumn(db, 'motm_votes', 'member_id'));
  const preds = (await hasColumn(db, 'predictions', 'member_id'));
  const wins = preds && (await hasColumn(db, 'predictions', 'is_winner'));
  for (const r of rows) {
    r.sources = (r.source_keys || '').split(',').filter(Boolean);
    r.email_verified = 0; r.member = 0; r.matches_predicted = 0; r.motm_votes = 0; r.prize_wins = 0;
    if (!hasMembers) continue;
    const { results: mem } = await db.prepare(
      `SELECT m.id, m.tier${verifiedCol ? ', m.email_verified' : ''} FROM contact_sources s JOIN members m ON m.id = s.ref_id
       WHERE s.contact_id = ? AND s.ref_table = 'members'`
    ).bind(r.id).all();
    r.member = mem.some(m => m.tier && m.tier !== 'Fan') || r.sources.includes('membership') ? 1 : 0;
    r.email_verified = mem.some(m => (verifiedCol ? m.email_verified === 1 : true)) ? 1 : 0;
    const ids = mem.map(m => m.id);
    if (!ids.length) continue;
    const inList = ids.map(() => '?').join(',');
    if (votes) r.motm_votes = (await db.prepare(`SELECT COUNT(*) AS n FROM motm_votes WHERE member_id IN (${inList})`).bind(...ids).first()).n;
    if (preds) r.matches_predicted = (await db.prepare(`SELECT COUNT(*) AS n FROM predictions WHERE member_id IN (${inList})`).bind(...ids).first()).n;
    if (wins) r.prize_wins = (await db.prepare(`SELECT COUNT(*) AS n FROM predictions WHERE is_winner = 1 AND member_id IN (${inList})`).bind(...ids).first()).n;
  }
}

/** "2026-10-09 14:05" in Nigerian time. */
export function watTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16).replace('T', ' ');
}

export function exportRow(r) {
  const yn = v => (v ? 'Y' : 'N');
  return [
    r.first_name || '', r.surname || '', r.email || '', r.phone || '', r.state || '',
    r.sources.map(s => SOURCES[s] || s).join(', '), SOURCES[r.first_source] || r.first_source || '',
    watTime(r.first_seen), watTime(r.last_seen), r.interactions || 0,
    yn(r.email_verified), yn(r.member), yn(r.marketing_consent),
    r.matches_predicted || 0, r.motm_votes || 0, r.prize_wins || 0,
  ];
}

/** Hides most of an email/phone for staff without export permission. */
export const maskEmail = e => (e ? e.replace(/^(.)[^@]*(@.).*(\.[^.]+)$/, '$1***$2***$3') : '');
export const maskPhone = p => (p ? p.slice(0, 7) + '****' + p.slice(-2) : '');

/** Nigerian date for file names, e.g. 2026-10-09. */
export const watDate = () => new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

// Statistics Center: data retention, archiving and privacy (owner's brief, 27 Nov 2026).
//
// Safe by default:
//  - core match history (matches, events, line-ups, scores) is NEVER deleted by the job or the pages; old seasons are
//    ARCHIVED (a full export is stored, the season becomes read only, everything stays so public and career stats work);
//  - the daily clean-up runs in DRY-RUN mode (it only logs what it would do) for the first 7 days, in small batches,
//    and can be paused; every live action is logged with counts and ids only (never personal details);
//  - retention periods are settings (sx_retention_policies), changed only by a Super Admin, after a preview.
// Personal data: coach rating notes and event notes are "personal notes"; a player's statistics are "performance"
// and are kept. A player can be marked youth/minor (shorter note retention, hidden from public stats unless the club
// publishes them) and anonymised (notes removed, numbers kept). This is not legal advice: the club should confirm its
// periods with its own data-protection adviser.
import { ensureStatsCentreSchema, sxSettings, setSxSetting, sxLog, statsActor, newId, oneLine, sha256Hex } from './statsCentre.js';
import { seasonExport, eventsCsv, matchesCsv } from './statsCentreData.js';
import { ensureBstSchema } from './statsBst.js';
import { ensurePhase2Schema } from './statsPhase2.js';
import { ensureLineupSchema } from './lineupService.js';

const nowIso = () => new Date().toISOString();
const DAY = 864e5;
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };

export const POLICY_DEFAULTS = [
  ['core_match_data', 'Matches, events, line-ups, final scores', null, 'keep', 'Kept forever; old seasons are archived, never deleted.'],
  ['player_season_stats', 'Player statistics (worked out, not stored)', null, 'keep', 'Worked out from the events.'],
  ['bst_final', 'BST analyses marked Final', null, 'keep', 'Staff only.'],
  ['bst_draft', 'BST drafts never finalised', 365, 'archive', 'Archived after 365 days, deleted after another 365.'],
  ['lineup_revisions', 'Line-up history', 1095, 'purge', 'Full history for 3 seasons, then only the last version of each line-up.'],
  ['audit_log', 'Activity log', 1095, 'purge', '3 years.'],
  ['soft_deleted', 'Recycle bin (removed analyses, notes, tags, opponent players)', 90, 'purge', 'Match history in the recycle bin is never deleted.'],
  ['backups', 'Nightly backups', 365, 'purge', 'Daily for 30 days, weekly for 90 days, monthly for 365 days.'],
  ['sync_queue_presence', '"Who is editing" records', 7, 'purge', 'Offline queues stay on the device and clear when sent.'],
  ['share_links', 'Coach share links (after they expire)', 14, 'purge', 'Links expire after 1–30 days (14 by default).'],
  ['exports', 'Generated exports (PDF, Excel, CSV)', 90, 'purge', 'Made on demand and not stored; season archives are kept.'],
  ['video_links', 'Match video links', null, 'keep', 'Checked once a month.'],
  ['opponent_registry', 'Opponent players not seen for a long time', 1825, 'anonymise', 'After 5 seasons: name and number kept only when linked to a match; otherwise removed.'],
  ['personal_notes', 'Coach rating notes and event notes', 1095, 'anonymise', '3 seasons (2 for youth players), or when the player leaves: the note text is removed, the numbers kept.'],
  ['scouting_notes', 'Scouting notes', 1825, 'archive', 'Archived after 5 seasons.'],
  ['scheduled_reports', 'Monthly reports', 730, 'archive', 'Archived after 24 months.'],
];
const FOREVER = new Set(['core_match_data', 'player_season_stats', 'bst_final', 'video_links']);
export const CLASSIFICATION = [
  { data: 'Goals, appearances, minutes, cards, ratings (numbers)', table: 'sx_events, sx_lineups', classification: 'performance', policy: 'core_match_data' },
  { data: 'Coach rating notes', table: 'sx_lineups.rating_note', classification: 'personal_note', policy: 'personal_notes' },
  { data: 'Event notes', table: 'sx_events.notes', classification: 'personal_note', policy: 'personal_notes' },
  { data: 'Youth / minor flag', table: 'sx_player_privacy', classification: 'youth_or_minor', policy: 'personal_notes' },
  { data: 'Opponent players (name, number, position)', table: 'sx_opponent_players', classification: 'opponent_personal', policy: 'opponent_registry' },
  { data: 'BST analyses (overview, half notes, grid)', table: 'sx_bst_analyses, sx_bst_cells', classification: 'performance', policy: 'bst_final / bst_draft' },
  { data: 'Line-up history', table: 'sx_lineup_revisions', classification: 'performance', policy: 'lineup_revisions' },
  { data: '"Who is editing"', table: 'sx_lineup_presence, sx_bst_presence', classification: 'operational', policy: 'sync_queue_presence' },
  { data: 'Activity log', table: 'sx_activity', classification: 'operational', policy: 'audit_log' },
  { data: 'Coach share links', table: 'sx_share_links', classification: 'operational', policy: 'share_links' },
  { data: 'Scouting notes', table: 'sx_scouting_notes', classification: 'scouting', policy: 'scouting_notes' },
  { data: 'Training themes and tags', table: 'sx_training_themes, sx_training_tags', classification: 'performance', policy: 'soft_deleted' },
  { data: 'Monthly reports', table: 'sx_reports', classification: 'performance', policy: 'scheduled_reports' },
  { data: 'Season archives', table: 'sx_archive_exports + backup storage', classification: 'performance', policy: 'core_match_data' },
  { data: 'Video links', table: 'sx_matches.video_url', classification: 'performance', policy: 'video_links' },
  { data: 'Nightly backups', table: 'backup storage (encrypted)', classification: 'all of the above', policy: 'backups' },
];

let ready = false;
export async function ensureRetentionSchema(db) {
  await ensureStatsCentreSchema(db);
  if (ready) return;
  await ensureBstSchema(db); await ensurePhase2Schema(db); await ensureLineupSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_retention_policies (id TEXT PRIMARY KEY, data_key TEXT NOT NULL UNIQUE, label TEXT NOT NULL, retention_days INTEGER, action TEXT NOT NULL, notes TEXT, updated_by TEXT, updated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_retention_runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, mode TEXT NOT NULL, counts_json TEXT, errors TEXT, started_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_seasons (season TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active', archived_at TEXT, archived_by TEXT, offsite_copied_at TEXT, offsite_noted_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_archive_exports (id TEXT PRIMARY KEY, season TEXT NOT NULL, file_path TEXT NOT NULL, checksum TEXT NOT NULL, size INTEGER NOT NULL, created_by TEXT, created_at TEXT NOT NULL, verified_at TEXT, verified_ok INTEGER)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_archive_files (path TEXT NOT NULL, part INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (path, part))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_player_privacy (slug TEXT PRIMARY KEY, youth INTEGER NOT NULL DEFAULT 0, youth_public INTEGER NOT NULL DEFAULT 0, left_at TEXT, anonymised_at TEXT, full_anon INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT)`),
  ]);
  // Columns used by the policies (archive markers), added to existing tables.
  const add = async (table, cols) => { try { const have = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(r => r.name)); for (const [c, t] of cols) if (!have.has(c)) await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${c} ${t}`).run(); } catch { /* table not created yet */ } };
  await add('sx_bst_analyses', [['archived_at', 'TEXT']]);
  await add('sx_scouting_notes', [['archived_at', 'TEXT']]);
  await add('sx_reports', [['archived_at', 'TEXT']]);
  await add('sx_matches', [['video_checked_at', 'TEXT'], ['video_ok', 'INTEGER']]);
  // Seed the policies once (values are settings from then on).
  const at = nowIso();
  await db.batch(POLICY_DEFAULTS.map(([k, l, d, a, n]) => db.prepare(`INSERT OR IGNORE INTO sx_retention_policies (id, data_key, label, retention_days, action, notes, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'default', ?)`).bind(newId('rtp'), k, l, d, a, n, at)));
  const s = await sxSettings(db);
  if (!s.retention_installed_at) await setSxSetting(db, 'retention_installed_at', at, 'system');
  ready = true;
}

export async function policies(db) {
  await ensureRetentionSchema(db);
  return (await db.prepare(`SELECT * FROM sx_retention_policies ORDER BY rowid`).all()).results.map(p => ({ key: p.data_key, label: p.label, days: p.retention_days, action: p.action, notes: p.notes, forever: FOREVER.has(p.data_key), updatedBy: p.updated_by, updatedAt: p.updated_at }));
}
/** Mode: dry-run for the first 7 days after install (unless switched to live), and paused when chosen. */
export async function retentionState(db) {
  await ensureRetentionSchema(db);
  const s = await sxSettings(db);
  const installed = Date.parse(s.retention_installed_at || nowIso());
  const forcedLive = s.retention_live === '1';
  const dry = !forcedLive && Date.now() - installed < 7 * DAY;
  return { installedAt: s.retention_installed_at, dryRun: dry, dryRunUntil: new Date(installed + 7 * DAY).toISOString(), paused: s.retention_paused === '1', lastRun: parse(s.retention_last_run, null) };
}

/** Changing a policy: forever data cannot get a deletion period; shortening needs a preview first (the page shows it). */
export async function savePolicy(db, user, key, { days, action }, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can change retention.' };
  await ensureRetentionSchema(db);
  const p = await db.prepare(`SELECT * FROM sx_retention_policies WHERE data_key = ?`).bind(String(key)).first();
  if (!p) return { error: 'Unknown policy.' };
  const d = days === '' || days === null || days === undefined ? null : Math.round(Number(days));
  if (FOREVER.has(p.data_key) && (d !== null || (action && action !== 'keep'))) return { error: `"${p.label}" is kept forever: it cannot be given a deletion period.` };
  if (d !== null && !(d >= 1 && d <= 3650)) return { error: 'Days must be from 1 to 3650 (or empty for "keep forever").' };
  const act = ['keep', 'archive', 'anonymise', 'purge'].includes(action) ? action : p.action;
  if (d === null && act !== 'keep') return { error: 'Without a period the action must be "keep".' };
  await db.prepare(`UPDATE sx_retention_policies SET retention_days = ?, action = ?, updated_by = ?, updated_at = ? WHERE data_key = ?`).bind(d, act, user.fullName, nowIso(), p.data_key).run();
  await sxLog(db, statsActor(user), 'retention_policy', { itemType: 'policy', itemId: p.data_key, before: { days: p.retention_days, action: p.action }, after: { days: d, action: act }, request });
  return { ok: true };
}
export async function setRetentionSwitch(db, user, { paused, live }, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can change this.' };
  if (paused !== undefined) await setSxSetting(db, 'retention_paused', paused ? '1' : '0', user.fullName);
  if (live !== undefined) await setSxSetting(db, 'retention_live', live ? '1' : '0', user.fullName);
  await sxLog(db, statsActor(user), 'retention_switch', { after: { paused, live }, request });
  return { ok: true, state: await retentionState(db) };
}

// ── The handlers: what each policy would touch (preview) and does (live) ──
const cutoffIso = days => new Date(Date.now() - days * DAY).toISOString();
async function count(db, sql, args) { const r = await db.prepare(sql).bind(...args).first(); return { n: r?.n || 0, oldest: r?.oldest || null, newest: r?.newest || null }; }
async function youthSlugs(db) { return (await db.prepare(`SELECT slug FROM sx_player_privacy WHERE youth = 1`).all()).results.map(r => r.slug); }
export const HANDLERS = {
  async bst_draft(db, days, live) {
    const c1 = cutoffIso(days);
    const a = await count(db, `SELECT COUNT(*) n, MIN(updated_at) oldest, MAX(updated_at) newest FROM sx_bst_analyses WHERE status = 'draft' AND archived_at IS NULL AND updated_at < ?`, [c1]);
    const b = await count(db, `SELECT COUNT(*) n, MIN(archived_at) oldest, MAX(archived_at) newest FROM sx_bst_analyses WHERE status = 'draft' AND archived_at IS NOT NULL AND archived_at < ?`, [cutoffIso(days)]);
    if (live) {
      await db.prepare(`UPDATE sx_bst_analyses SET archived_at = ? WHERE id IN (SELECT id FROM sx_bst_analyses WHERE status = 'draft' AND archived_at IS NULL AND updated_at < ? LIMIT 100)`).bind(nowIso(), c1).run();
      const ids = (await db.prepare(`SELECT id FROM sx_bst_analyses WHERE status = 'draft' AND archived_at IS NOT NULL AND archived_at < ? LIMIT 50`).bind(cutoffIso(days)).all()).results.map(r => r.id);
      for (const id of ids) await db.batch([db.prepare(`DELETE FROM sx_bst_cells WHERE analysis_id = ?`).bind(id), db.prepare(`DELETE FROM sx_bst_analyses WHERE id = ? AND status = 'draft'`).bind(id)]);
      return { archived: a.n, purged: ids.length, ids };
    }
    return { wouldArchive: a.n, wouldPurge: b.n, oldest: a.oldest || b.oldest, newest: a.newest || b.newest };
  },
  async lineup_revisions(db, days, live) {
    const c = cutoffIso(days);
    const sql = `FROM sx_lineup_revisions r WHERE r.created_at < ? AND r.version < (SELECT MAX(version) FROM sx_lineup_revisions x WHERE x.sheet_id = r.sheet_id)`;
    const k = await count(db, `SELECT COUNT(*) n, MIN(created_at) oldest, MAX(created_at) newest ${sql}`, [c]);
    if (live) { const r = await db.prepare(`DELETE FROM sx_lineup_revisions WHERE id IN (SELECT r.id ${sql} LIMIT 500)`).bind(c).run(); return { purged: r.meta?.changes || 0 }; }
    return { wouldPurge: k.n, oldest: k.oldest, newest: k.newest };
  },
  async audit_log(db, days, live) {
    const c = cutoffIso(days);
    const k = await count(db, `SELECT COUNT(*) n, MIN(at) oldest, MAX(at) newest FROM sx_activity WHERE at < ?`, [c]);
    if (live && k.n) {
      // The log cannot be changed: the guard is lifted only for this one deletion of old rows, then put back.
      await db.batch([
        db.prepare(`DROP TRIGGER IF EXISTS sx_activity_no_delete`),
        db.prepare(`DELETE FROM sx_activity WHERE id IN (SELECT id FROM sx_activity WHERE at < ? ORDER BY id LIMIT 2000)`).bind(c),
        db.prepare(`CREATE TRIGGER IF NOT EXISTS sx_activity_no_delete BEFORE DELETE ON sx_activity BEGIN SELECT RAISE(ABORT, 'The Statistics Center activity log cannot be deleted.'); END`),
      ]);
      return { purged: Math.min(k.n, 2000) };
    }
    return { wouldPurge: k.n, oldest: k.oldest, newest: k.newest };
  },
  async soft_deleted(db, days, live) {
    // Only items outside match history: analyses that are not Final, scouting notes, training themes and tags, opponent players.
    const c = cutoffIso(days), out = { purged: 0, wouldPurge: 0 };
    const sets = [
      ['sx_bst_analyses', `is_deleted = 1 AND status <> 'final' AND updated_at < ?`, 'updated_at'],
      ['sx_scouting_notes', `is_deleted = 1 AND IFNULL(updated_at, created_at) < ?`, 'created_at'],
      ['sx_training_tags', `is_deleted = 1 AND created_at < ?`, 'created_at'],
      ['sx_training_themes', `is_deleted = 1 AND IFNULL(updated_at, created_at) < ?`, 'created_at'],
      ['sx_opponent_players', `is_deleted = 1 AND IFNULL(updated_at, created_at) < ?`, 'created_at'],
    ];
    for (const [t, where, col] of sets) {
      let k; try { k = await count(db, `SELECT COUNT(*) n, MIN(${col}) oldest, MAX(${col}) newest FROM ${t} WHERE ${where}`, [c]); } catch { continue; }
      out.wouldPurge += k.n; out.oldest = out.oldest && k.oldest ? (k.oldest < out.oldest ? k.oldest : out.oldest) : out.oldest || k.oldest;
      if (live && k.n) {
        if (t === 'sx_bst_analyses') { const ids = (await db.prepare(`SELECT id FROM sx_bst_analyses WHERE ${where} LIMIT 50`).bind(c).all()).results.map(r => r.id); for (const id of ids) await db.batch([db.prepare(`DELETE FROM sx_bst_cells WHERE analysis_id = ?`).bind(id), db.prepare(`DELETE FROM sx_bst_analyses WHERE id = ?`).bind(id)]); out.purged += ids.length; }
        else { const r = await db.prepare(`DELETE FROM ${t} WHERE rowid IN (SELECT rowid FROM ${t} WHERE ${where} LIMIT 200)`).bind(c).run(); out.purged += r.meta?.changes || 0; }
      }
    }
    return live ? { purged: out.purged } : { wouldPurge: out.wouldPurge, oldest: out.oldest };
  },
  async sync_queue_presence(db, days, live) {
    const c = cutoffIso(days);
    let n = 0;
    for (const t of ['sx_lineup_presence', 'sx_bst_presence']) {
      const col = t === 'sx_lineup_presence' ? 'last_heartbeat' : 'last_seen';
      try { n += (await db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE ${col} < ?`).bind(c).first()).n; if (live) await db.prepare(`DELETE FROM ${t} WHERE ${col} < ?`).bind(c).run(); } catch { /* table not created yet */ }
    }
    return live ? { purged: n } : { wouldPurge: n };
  },
  async share_links(db, days, live) {
    const c = cutoffIso(days);
    let k = { n: 0 }; try { k = await count(db, `SELECT COUNT(*) n, MIN(expires_at) oldest, MAX(expires_at) newest FROM sx_share_links WHERE (expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?))`, [c, c]); } catch { return { wouldPurge: 0 }; }
    if (live && k.n) { const r = await db.prepare(`DELETE FROM sx_share_links WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`).bind(c, c).run(); return { purged: r.meta?.changes || 0 }; }
    return { wouldPurge: k.n, oldest: k.oldest, newest: k.newest };
  },
  async exports() { return { note: 'Exports are made on demand and not stored; nothing to remove.' }; },
  async opponent_registry(db, days, live) {
    const c = cutoffIso(days);
    const base = `FROM sx_opponent_players p LEFT JOIN sx_matches m ON m.id = p.last_seen_match_id WHERE p.is_deleted = 0 AND IFNULL(m.match_date, p.created_at) < ?`;
    let k; try { k = await count(db, `SELECT COUNT(*) n, MIN(IFNULL(m.match_date, p.created_at)) oldest, MAX(IFNULL(m.match_date, p.created_at)) newest ${base}`, [c]); } catch { return { wouldAnonymise: 0 }; }
    if (!live) return { wouldAnonymise: k.n, oldest: k.oldest, newest: k.newest };
    const rows = (await db.prepare(`SELECT p.id, (SELECT COUNT(*) FROM sx_lineups l WHERE l.opponent_player_id = p.id) AS linked ${base} LIMIT 200`).bind(c).all()).results;
    let kept = 0, removed = 0;
    for (const r of rows) {
      if (r.linked) { await db.prepare(`UPDATE sx_opponent_players SET usual_position = NULL, is_active = 0, updated_by = 'Retention', updated_at = ? WHERE id = ?`).bind(nowIso(), r.id).run(); kept++; }
      else { await db.prepare(`DELETE FROM sx_opponent_players WHERE id = ?`).bind(r.id).run(); removed++; }
    }
    return { anonymised: kept, purged: removed };
  },
  async personal_notes(db, days, live) {
    // Notes older than the period (2 seasons ≈ 730 days for youth players), or of a player who has left: the text goes.
    const c = cutoffIso(days), cy = cutoffIso(Math.min(days, 730));
    const youth = await youthSlugs(db);
    const left = (await db.prepare(`SELECT slug FROM sx_player_privacy WHERE left_at IS NOT NULL AND left_at < ?`).bind(nowIso()).all()).results.map(r => r.slug);
    const inList = list => (list.length ? `IN (${list.map(() => '?').join(',')})` : 'IN (NULL)');
    const lu = `FROM sx_lineups l JOIN sx_matches m ON m.id = l.match_id WHERE l.rating_note IS NOT NULL AND l.rating_note <> '' AND (m.match_date < ? OR (l.player_slug ${inList(youth)} AND m.match_date < ?) OR l.player_slug ${inList(left)})`;
    const ev = `FROM sx_events e WHERE e.notes IS NOT NULL AND e.notes <> '' AND (e.created_at < ? OR (e.player_slug ${inList(youth)} AND e.created_at < ?) OR e.player_slug ${inList(left)})`;
    let a = { n: 0 }, b = { n: 0 };
    try { a = await count(db, `SELECT COUNT(*) n, MIN(m.match_date) oldest, MAX(m.match_date) newest ${lu}`, [c, ...youth, cy, ...left]); } catch { /* no rating notes column yet */ }
    b = await count(db, `SELECT COUNT(*) n, MIN(e.created_at) oldest, MAX(e.created_at) newest ${ev}`, [c, ...youth, cy, ...left]);
    if (!live) return { wouldAnonymise: a.n + b.n, oldest: a.oldest || b.oldest, newest: a.newest || b.newest };
    if (a.n) await db.prepare(`UPDATE sx_lineups SET rating_note = NULL WHERE id IN (SELECT l.id ${lu} LIMIT 500)`).bind(c, ...youth, cy, ...left).run();
    if (b.n) await db.prepare(`UPDATE sx_events SET notes = NULL WHERE id IN (SELECT e.id ${ev} LIMIT 500)`).bind(c, ...youth, cy, ...left).run();
    return { anonymised: Math.min(a.n, 500) + Math.min(b.n, 500) };
  },
  async scouting_notes(db, days, live) {
    const c = cutoffIso(days);
    let k; try { k = await count(db, `SELECT COUNT(*) n, MIN(created_at) oldest, MAX(created_at) newest FROM sx_scouting_notes WHERE is_deleted = 0 AND archived_at IS NULL AND created_at < ?`, [c]); } catch { return { wouldArchive: 0 }; }
    if (live && k.n) { await db.prepare(`UPDATE sx_scouting_notes SET archived_at = ? WHERE is_deleted = 0 AND archived_at IS NULL AND created_at < ?`).bind(nowIso(), c).run(); return { archived: k.n }; }
    return { wouldArchive: k.n, oldest: k.oldest, newest: k.newest };
  },
  async scheduled_reports(db, days, live) {
    const c = cutoffIso(days);
    let k; try { k = await count(db, `SELECT COUNT(*) n, MIN(generated_at) oldest, MAX(generated_at) newest FROM sx_reports WHERE archived_at IS NULL AND generated_at < ?`, [c]); } catch { return { wouldArchive: 0 }; }
    if (live && k.n) { await db.prepare(`UPDATE sx_reports SET archived_at = ? WHERE archived_at IS NULL AND generated_at < ?`).bind(nowIso(), c).run(); return { archived: k.n }; }
    return { wouldArchive: k.n, oldest: k.oldest, newest: k.newest };
  },
};

/** How many records a policy would touch (with the given days, or its saved value). Never touches "keep" data. */
export async function previewPolicy(db, key, days) {
  await ensureRetentionSchema(db);
  const p = (await policies(db)).find(x => x.key === key);
  if (!p) return { error: 'Unknown policy.' };
  if (p.forever || p.action === 'keep') return { key, keep: true, note: 'Kept forever: nothing is ever removed.' };
  if (key === 'backups') return { key, note: 'Daily backups for 30 days, one a week up to 90 days, one a month up to 365 days. See the backup list.' };
  const d = days === undefined || days === '' ? p.days : Math.round(Number(days));
  if (!(d >= 1)) return { error: 'Choose a number of days.' };
  const h = HANDLERS[key];
  try { return h ? { key, days: d, ...(await h(db, d, false)) } : { key, note: 'Nothing to do.' }; } catch (err) { return { key, error: 'Could not count: ' + String(err.message || err).slice(0, 120) }; }
}

/** The daily clean-up (and "Run now"): dry run or live, small batches, a time limit, safe to run twice. */
export async function runRetention(db, user, { force = false, request = null, timeLimitMs = 20000 } = {}) {
  await ensureRetentionSchema(db);
  const st = await retentionState(db);
  if (st.paused && !force) return { skipped: true, reason: 'paused' };
  const mode = st.dryRun ? 'dry-run' : 'live';
  const runId = newId('rtr'), started = Date.now();
  await db.prepare(`INSERT INTO sx_retention_runs (id, started_at, mode, started_by) VALUES (?, ?, ?, ?)`).bind(runId, nowIso(), mode, user ? user.fullName : 'Automatic').run();
  const counts = {}, errors = [];
  for (const p of await policies(db)) {
    if (Date.now() - started > timeLimitMs) { errors.push('time limit reached: the rest runs tomorrow'); break; }
    if (p.forever || p.action === 'keep' || !p.days || !HANDLERS[p.key]) continue;
    try {
      counts[p.key] = await HANDLERS[p.key](db, p.days, mode === 'live');
      if (mode === 'live') {
        const r = counts[p.key];
        if ((r.purged || r.anonymised || r.archived)) await sxLog(db, user ? statsActor(user) : { kind: 'system', id: null, name: 'Retention (automatic)' }, 'retention_' + (r.anonymised ? 'anonymise' : r.archived ? 'archive' : 'purge'), { itemType: 'policy', itemId: p.key, details: `purged ${r.purged || 0}, anonymised ${r.anonymised || 0}, archived ${r.archived || 0}${r.ids?.length ? ` · ids ${r.ids.slice(0, 20).join(', ')}` : ''}`, request });
      }
    } catch (err) { errors.push(`${p.key}: ${String(err.message || err).slice(0, 160)}`); }
  }
  await db.prepare(`UPDATE sx_retention_runs SET finished_at = ?, counts_json = ?, errors = ? WHERE id = ?`).bind(nowIso(), JSON.stringify(counts), errors.join(' | ') || null, runId).run();
  await setSxSetting(db, 'retention_last_run', JSON.stringify({ at: nowIso(), mode, errors: errors.length }), 'system');
  return { ok: true, mode, counts, errors };
}
export async function retentionRuns(db) {
  await ensureRetentionSchema(db);
  return (await db.prepare(`SELECT * FROM sx_retention_runs ORDER BY started_at DESC LIMIT 30`).all()).results.map(r => ({ ...r, counts: parse(r.counts_json, {}) }));
}
/** Run by the timer: once a day, from 03:00 Lagos time. */
export async function retentionTick(env, now = Date.now()) {
  const db = env.DB;
  await ensureRetentionSchema(db);
  const lagos = new Date(now + 3600e3), day = lagos.toISOString().slice(0, 10);
  if (lagos.getUTCHours() < 3) return { skipped: true };
  const s = await sxSettings(db);
  if (s.retention_day === day) return { skipped: true };
  await setSxSetting(db, 'retention_day', day, 'system');
  const r = await runRetention(db, null);
  try { await checkVideoLinks(env); } catch { /* next time */ }
  return r;
}
/** Video links stay forever; once a month each is checked (a few per day). */
export async function checkVideoLinks(env) {
  const db = env.DB;
  const rows = (await db.prepare(`SELECT id, video_url FROM sx_matches WHERE video_url IS NOT NULL AND is_deleted = 0 AND (video_checked_at IS NULL OR video_checked_at < ?) LIMIT 5`).bind(cutoffIso(30)).all()).results;
  for (const r of rows) {
    let ok = 0;
    try { const res = await fetch(r.video_url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) }); ok = res.ok || res.status === 405 ? 1 : 0; } catch { ok = 0; }
    await db.prepare(`UPDATE sx_matches SET video_checked_at = ?, video_ok = ? WHERE id = ?`).bind(nowIso(), ok, r.id).run();
  }
  return { checked: rows.length };
}

// ── Seasons: archive (never delete) ──
export async function seasonsList(db, startMonth = 8) {
  await ensureRetentionSchema(db);
  const { results } = await db.prepare(`SELECT season, MAX(match_date) AS last, COUNT(*) AS n FROM sx_matches WHERE is_deleted = 0 GROUP BY season ORDER BY season DESC`).all();
  const st = new Map((await db.prepare(`SELECT * FROM sx_seasons`).all()).results.map(r => [r.season, r]));
  const ex = (await db.prepare(`SELECT * FROM sx_archive_exports ORDER BY created_at DESC`).all()).results;
  return results.map(r => {
    const end = Date.parse(`${Number(String(r.season).slice(0, 4)) + 1}-${String(startMonth).padStart(2, '0')}-01T00:00:00Z`);
    const s = st.get(r.season) || {};
    return { season: r.season, matches: r.n, lastMatch: r.last, status: s.status || 'active', archivedAt: s.archived_at || null, archivedBy: s.archived_by || null, offsiteCopiedAt: s.offsite_copied_at || null,
      endedDaysAgo: Number.isFinite(end) ? Math.floor((Date.now() - end) / DAY) : null, exports: ex.filter(e => e.season === r.season).map(e => ({ id: e.id, path: e.file_path, checksum: e.checksum, size: e.size, createdAt: e.created_at, verifiedAt: e.verified_at, verifiedOk: e.verified_ok === null ? null : !!e.verified_ok })) };
  });
}
export async function isSeasonArchived(db, season) {
  try { const r = await db.prepare(`SELECT status FROM sx_seasons WHERE season = ?`).bind(String(season || '')).first(); return r?.status === 'archived'; } catch { return false; }
}
async function storeFile(env, path, body) {
  if (env.BACKUP_BUCKET) { await env.BACKUP_BUCKET.put(path, body, { httpMetadata: { contentType: path.endsWith('.json') ? 'application/json' : 'text/csv' } }); return 'r2'; }
  const db = env.DB, CH = 400000;
  await db.prepare(`DELETE FROM sx_archive_files WHERE path = ?`).bind(path).run();
  for (let i = 0, part = 0; i < body.length; i += CH, part++) await db.prepare(`INSERT INTO sx_archive_files (path, part, body) VALUES (?, ?, ?)`).bind(path, part, body.slice(i, i + CH)).run();
  return 'd1';
}
export async function readFile(env, path) {
  if (env.BACKUP_BUCKET) { const o = await env.BACKUP_BUCKET.get(path); if (o) return await o.text(); }
  const parts = (await env.DB.prepare(`SELECT body FROM sx_archive_files WHERE path = ? ORDER BY part`).bind(path).all()).results;
  return parts.length ? parts.map(p => p.body).join('') : null;
}
/** Archive a season: full export (JSON + CSV), checksum, then read only. Nothing is deleted. */
export async function archiveSeason(env, user, season, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can archive a season.' };
  const db = env.DB;
  await ensureRetentionSchema(db);
  if (!/^\d{4}\/\d{2}$/.test(String(season))) return { error: 'Choose a season.' };
  const data = await seasonExport(db, season, { includeNotes: true });
  const json = JSON.stringify(data);
  const files = [[`archives/${season.replace('/', '-')}/season.json`, json], [`archives/${season.replace('/', '-')}/events.csv`, await eventsCsv(db, { season, includeNotes: true })], [`archives/${season.replace('/', '-')}/matches.csv`, await matchesCsv(db, { season })]];
  const at = nowIso();
  for (const [path, body] of files) {
    await storeFile(env, path, body);
    await db.prepare(`INSERT INTO sx_archive_exports (id, season, file_path, checksum, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(newId('arc'), season, path, await sha256Hex(body), body.length, user.fullName, at).run();
  }
  await db.prepare(`INSERT INTO sx_seasons (season, status, archived_at, archived_by) VALUES (?, 'archived', ?, ?) ON CONFLICT (season) DO UPDATE SET status = 'archived', archived_at = excluded.archived_at, archived_by = excluded.archived_by`).bind(season, at, user.fullName).run();
  await sxLog(db, statsActor(user), 'season_archive', { itemType: 'season', itemId: season, details: `${data.matches.length} matches, ${data.events.length} events archived; season read only`, request });
  return { ok: true, files: files.map(f => f[0]), matches: data.matches.length, events: data.events.length };
}
export async function unarchiveSeason(db, user, season, { reason = '', request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can do this.' };
  if (String(reason).trim().length < 3) return { error: 'Give a reason.' };
  await db.prepare(`UPDATE sx_seasons SET status = 'active' WHERE season = ?`).bind(season).run();
  await sxLog(db, statsActor(user), 'season_unarchive', { itemType: 'season', itemId: season, details: `Reason: ${oneLine(reason, 200)}`, request });
  return { ok: true };
}
export async function verifyArchive(env, user, id, { request = null } = {}) {
  const db = env.DB;
  const e = await db.prepare(`SELECT * FROM sx_archive_exports WHERE id = ?`).bind(String(id)).first();
  if (!e) return { error: 'Archive file not found.' };
  const body = await readFile(env, e.file_path);
  const ok = body !== null && (await sha256Hex(body)) === e.checksum;
  await db.prepare(`UPDATE sx_archive_exports SET verified_at = ?, verified_ok = ? WHERE id = ?`).bind(nowIso(), ok ? 1 : 0, e.id).run();
  if (user) await sxLog(db, statsActor(user), 'archive_verify', { itemType: 'archive', itemId: e.id, details: ok ? 'checksum matches' : 'CHECKSUM DOES NOT MATCH', request });
  return { ok: true, matches: ok };
}
export async function noteOffsite(db, user, season, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can record this.' };
  await db.prepare(`INSERT INTO sx_seasons (season, status, offsite_copied_at, offsite_noted_by) VALUES (?, 'active', ?, ?) ON CONFLICT (season) DO UPDATE SET offsite_copied_at = excluded.offsite_copied_at, offsite_noted_by = excluded.offsite_noted_by`).bind(season, nowIso(), user.fullName).run();
  await sxLog(db, statsActor(user), 'archive_offsite', { itemType: 'season', itemId: season, request });
  return { ok: true };
}

// ── Players' privacy ──
export async function privacyList(db) {
  await ensureRetentionSchema(db);
  return (await db.prepare(`SELECT * FROM sx_player_privacy`).all()).results.map(r => ({ slug: r.slug, youth: !!r.youth, youthPublic: !!r.youth_public, leftAt: r.left_at, anonymisedAt: r.anonymised_at, fullAnon: !!r.full_anon }));
}
export async function setPrivacy(db, user, slug, { youth, youthPublic, leftAt }, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can change this.' };
  await ensureRetentionSchema(db);
  const left = leftAt === '' || leftAt === null || leftAt === undefined ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(leftAt)) ? `${leftAt}T00:00:00Z` : undefined;
  if (left === undefined) return { error: 'Give the date as a date.' };
  await db.prepare(`INSERT INTO sx_player_privacy (slug, youth, youth_public, left_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (slug) DO UPDATE SET youth = excluded.youth, youth_public = excluded.youth_public, left_at = excluded.left_at, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(String(slug), youth ? 1 : 0, youthPublic ? 1 : 0, left, user.fullName, nowIso()).run();
  await sxLog(db, statsActor(user), 'player_privacy', { itemType: 'player', itemId: slug, after: { youth: !!youth, youthPublic: !!youthPublic, leftAt: left }, request });
  return { ok: true };
}
/** Youth players hidden from public stats (unless the club publishes them). */
export { hiddenYouth } from './statsPrivacy.js';
/** Removes a player's personal notes for good; numbers stay. Optional: their name shows as "Former player #N" in staff data. */
export async function anonymisePlayer(db, user, slug, { reason, full = false }, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can anonymise a player.' };
  if (String(reason || '').trim().length < 3) return { error: 'Give a reason (kept in the activity log).' };
  await ensureRetentionSchema(db);
  const s = String(slug);
  let notes = 0;
  try { notes += (await db.prepare(`UPDATE sx_lineups SET rating_note = NULL WHERE player_slug = ? AND rating_note IS NOT NULL`).bind(s).run()).meta?.changes || 0; } catch { /* no rating notes yet */ }
  notes += (await db.prepare(`UPDATE sx_events SET notes = NULL WHERE player_slug = ? AND notes IS NOT NULL`).bind(s).run()).meta?.changes || 0;
  if (full) {
    const nums = (await db.prepare(`SELECT shirt_number FROM sx_lineups WHERE player_slug = ? AND shirt_number IS NOT NULL ORDER BY rowid DESC LIMIT 1`).bind(s).first());
    const label = `Former player #${nums?.shirt_number ?? '?'}`;
    await db.batch([
      db.prepare(`UPDATE sx_lineups SET player_name = ? WHERE player_slug = ?`).bind(label, s),
      db.prepare(`UPDATE sx_events SET player_name = ? WHERE player_slug = ?`).bind(label, s),
      db.prepare(`UPDATE sx_events SET related_name = ? WHERE related_slug = ?`).bind(label, s),
    ]);
  }
  await db.prepare(`INSERT INTO sx_player_privacy (slug, anonymised_at, full_anon, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (slug) DO UPDATE SET anonymised_at = excluded.anonymised_at, full_anon = MAX(sx_player_privacy.full_anon, excluded.full_anon), updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(s, nowIso(), full ? 1 : 0, user.fullName, nowIso()).run();
  await sxLog(db, statsActor(user), 'anonymise_player', { itemType: 'player', itemId: s, details: `Reason: ${oneLine(reason, 200)}. ${notes} note(s) removed${full ? '; name replaced in staff data' : ''}. Cannot be undone.`, request });
  return { ok: true, notes };
}

export { backupsToDelete } from './autoBackup.js';
export const INVENTORY = () => CLASSIFICATION;

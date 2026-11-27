// Statistics Center › BST Analysis Form (owner's brief, 27 Nov 2026): the paper match-analysis form, on screen.
//
// Every fact is recorded ONCE (the brief's core rule):
//  - match details, line-ups and starting formations: sx_matches / sx_lineups (Match Setup), read-only here
//    (the finishing formations are saved to sx_matches too);
//  - goals, shots on/off target, blocked shots, free kicks, corners, keeper saves, fouls, tackles won, offsides and
//    cards are EVENTS (sx_events, the same list as live entry): a + in the grid adds one event, a − removes the
//    latest one in that block, so the grid and the live screen always agree;
//  - only the analyst's own numbers with no event (Offence/Attack, Defense, Dangerous Attack, Crossing, xG, xA) are
//    stored here (sx_bst_cells), plus the Game Overview and half notes (sx_bst_analyses);
//  - Goal Attempt, Goal For / Against and every total are worked out, never stored.
// Staff only: nothing here is ever shown on the public website.
import { ensureStatsCentreSchema, sxLog, statsActor, newId, clean } from './statsCentre.js';
import { getMatch, validate } from './statsCentreData.js';

export const BST_FORMATIONS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '5-3-2', '4-1-4-1', '3-4-3', '4-5-1'];
// The rows, in the paper form's order. kind: cell (analyst count) | decimal (xG, xA) | event | calc | derived
export const METRICS = [
  { key: 'offence_attack', label: 'Offence/Attack', kind: 'cell' },
  { key: 'defense', label: 'Defense', kind: 'cell' },
  { key: 'goal_attempt', label: 'Goal Attempt', kind: 'calc' },
  { key: 'dangerous_attack', label: 'Dangerous Attack', kind: 'cell' },
  { key: 'shot_on', label: 'Shot on Target', kind: 'event' },
  { key: 'shot_off', label: 'Shot off Target', kind: 'event' },
  { key: 'blocked', label: 'Blocked Shots', kind: 'event' },
  { key: 'free_kick', label: 'Free Kicks', kind: 'event' },
  { key: 'corner', label: 'Corner Kicks', kind: 'event' },
  { key: 'crossing', label: 'Crossing', kind: 'cell' },
  { key: 'gk_save', label: 'Keeper Saves', kind: 'event' },
  { key: 'foul', label: 'Foul Committed', kind: 'event' },
  { key: 'tackle_won', label: 'Tackles Won', kind: 'event' },
  { key: 'offside', label: 'Offside', kind: 'event' },
  { key: 'cards', label: 'Cards', kind: 'event' },
  { key: 'xa', label: 'Exp. Assist (xA)', kind: 'decimal' },
  { key: 'xg', label: 'Exp. Goal (xG)', kind: 'decimal' },
  { key: 'goal_for', label: 'Goal For', kind: 'derived' },
  { key: 'goal_against', label: 'Goal Against', kind: 'derived' },
];
const CELL_METRICS = new Set(METRICS.filter(m => m.kind === 'cell' || m.kind === 'decimal').map(m => m.key));
// How an event counts in a row, and the event a + creates.
export const EVENT_ROWS = {
  shot_on: { test: e => (e.type === 'shot' && e.outcome === 'on_target') || (e.type === 'goal' && e.detail !== 'own_goal'), create: { type: 'shot', outcome: 'on_target' }, removable: e => e.type === 'shot' && e.outcome === 'on_target' },
  shot_off: { test: e => e.type === 'shot' && (e.outcome === 'off_target' || e.outcome === 'woodwork'), create: { type: 'shot', outcome: 'off_target' } },
  blocked: { test: e => e.type === 'shot' && e.outcome === 'blocked', create: { type: 'shot', outcome: 'blocked' } },
  free_kick: { test: e => e.type === 'free_kick', create: { type: 'free_kick' } },
  corner: { test: e => e.type === 'corner', create: { type: 'corner' } },
  gk_save: { test: e => e.type === 'gk_save', create: { type: 'gk_save' } },
  foul: { test: e => e.type === 'foul_committed', create: { type: 'foul_committed' } },
  tackle_won: { test: e => e.type === 'tackle' && e.outcome !== 'lost', create: { type: 'tackle', outcome: 'won' } },
  offside: { test: e => e.type === 'offside', create: { type: 'offside' } },
  cards: { test: e => e.type === 'yellow_card' || e.type === 'red_card', create: { type: 'yellow_card' } },
};

// ── Blocks: 2-minute columns per half, in the paper form's labels ──
// Keys are the block's last minute as the form shows it: 1st half 2, 4 … 44, 45, then stoppage 45+2, 45+4 …;
// 2nd half 47 … 89, 90, 90+2 …; extra time 92 … 104, 105, 105+2 … and 107 … 119, 120, 120+2 ….
export const PERIOD_START = { '1H': 0, '2H': 45, ET1: 90, ET2: 105 };
export const PERIOD_LEN = { '1H': 45, '2H': 45, ET1: 15, ET2: 15 };
export function blocksFor(period, stoppage = 0) {
  const s = PERIOD_START[period], len = PERIOD_LEN[period], out = [];
  for (let r = 2; r < len; r += 2) out.push(String(s + r));
  out.push(String(s + len));
  for (let i = 1; i <= stoppage; i++) out.push(`${s + len}+${i * 2}`);
  return out;
}
/** The block an event falls in. */
export function blockOf(e) {
  if (!(e.period in PERIOD_START)) return null;
  const s = PERIOD_START[e.period], len = PERIOD_LEN[e.period], end = s + len;
  if (e.stoppage) return `${end}+${Math.max(2, Math.ceil(e.stoppage / 2) * 2)}`;
  const rel = e.minute - s;
  if (rel >= len) return String(end);
  return String(s + Math.max(2, Math.ceil(rel / 2) * 2));
}
/** The minute (and added time) a + in a block records. */
export function minuteOfBlock(period, block) {
  const [base, plus] = String(block).split('+').map(Number);
  return plus ? { period, minute: base, stoppage: plus } : { period, minute: base, stoppage: null };
}
const validBlock = (period, block) => {
  if (!(period in PERIOD_START)) return false;
  const [base, plus] = String(block).split('+');
  const end = PERIOD_START[period] + PERIOD_LEN[period];
  if (plus !== undefined) return Number(base) === end && /^\d{1,2}$/.test(plus) && Number(plus) % 2 === 0 && Number(plus) >= 2 && Number(plus) <= 30;
  return blocksFor(period).includes(String(block));
};

const nowIso = () => new Date().toISOString();
const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const byName = user => (user.admin ? `${user.fullName} (Super Admin)` : `${user.fullName} (${user.loginId})`);

let ready = false;
export async function ensureBstSchema(db) {
  await ensureStatsCentreSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_bst_analyses (
      id TEXT PRIMARY KEY, match_id TEXT NOT NULL UNIQUE,      -- one analysis per match
      overview TEXT, half1_note TEXT, half2_note TEXT, stoppage_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',                     -- draft | final
      prepared_by TEXT, finalised_by TEXT, finalised_at TEXT,
      created_by TEXT, updated_by TEXT, created_at TEXT NOT NULL, updated_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_bst_cells (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, metric TEXT NOT NULL,
      team_side TEXT NOT NULL,                                  -- lobi | opponent
      period TEXT NOT NULL, block TEXT NOT NULL, value REAL NOT NULL DEFAULT 0,
      updated_by TEXT, updated_at TEXT,
      UNIQUE (analysis_id, metric, team_side, period, block))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_bst_cells_a ON sx_bst_cells (analysis_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_bst_presence (analysis_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT, last_seen TEXT NOT NULL, PRIMARY KEY (analysis_id, user_id))`),
  ]);
  // The finishing formations (owned by the match, like the starting ones).
  const cols = new Set((await db.prepare(`PRAGMA table_info(sx_matches)`).all()).results.map(r => r.name));
  for (const c of ['formation_home_finish', 'formation_away_finish']) if (!cols.has(c)) await db.prepare(`ALTER TABLE sx_matches ADD COLUMN ${c} TEXT`).run();
  ready = true;
}

const view = r => r && ({ id: r.id, matchId: r.match_id, overview: r.overview || '', half1Note: r.half1_note || '', half2Note: r.half2_note || '', stoppage: parse(r.stoppage_json, {}),
  status: r.status, preparedBy: r.prepared_by, finalisedBy: r.finalised_by, finalisedAt: r.finalised_at, createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by, version: r.version });
async function row(db, id) { await ensureBstSchema(db); return db.prepare(`SELECT * FROM sx_bst_analyses WHERE id = ? AND is_deleted = 0`).bind(String(id || '')).first(); }

export async function listAnalyses(db) {
  await ensureBstSchema(db);
  const { results } = await db.prepare(`SELECT a.*, m.home_team, m.away_team, m.match_date, m.is_lobi_home, m.competition, m.season FROM sx_bst_analyses a JOIN sx_matches m ON m.id = a.match_id
    WHERE a.is_deleted = 0 AND m.is_deleted = 0 ORDER BY m.match_date DESC LIMIT 300`).all();
  const open = (await db.prepare(`SELECT m.id, m.home_team, m.away_team, m.match_date, m.competition FROM sx_matches m LEFT JOIN sx_bst_analyses a ON a.match_id = m.id AND a.is_deleted = 0
    WHERE m.is_deleted = 0 AND a.id IS NULL ORDER BY m.match_date DESC LIMIT 100`).all()).results;
  return {
    analyses: results.map(r => ({ ...view(r), home: r.home_team, away: r.away_team, opponent: r.is_lobi_home ? r.away_team : r.home_team, date: r.match_date, competition: r.competition, season: r.season })),
    matchesWithout: open.map(m => ({ id: m.id, home: m.home_team, away: m.away_team, date: m.match_date, competition: m.competition })),
  };
}

export async function createAnalysis(db, user, matchId, { request = null } = {}) {
  await ensureBstSchema(db);
  const m = await db.prepare(`SELECT id, home_team, away_team, match_date FROM sx_matches WHERE id = ? AND is_deleted = 0`).bind(String(matchId || '')).first();
  if (!m) return { error: 'Choose a match first (create it on the New match page).', needMatch: true };
  const had = await db.prepare(`SELECT id FROM sx_bst_analyses WHERE match_id = ? AND is_deleted = 0`).bind(m.id).first();
  if (had) return { error: 'This match already has an analysis.', id: had.id };
  const id = newId('bst'), at = nowIso();
  await db.prepare(`INSERT INTO sx_bst_analyses (id, match_id, status, prepared_by, created_by, updated_by, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`)
    .bind(id, m.id, user.fullName, byName(user), byName(user), at, at).run();
  await sxLog(db, statsActor(user), 'bst_create', { itemType: 'bst', itemId: id, itemTitle: `${m.home_team} v ${m.away_team}`, request });
  return { ok: true, id };
}

/** The grid worked out from the events and the analyst's cells. side: 'lobi' | 'opponent'. */
export function bstGrid(match, events, cells, stoppage = {}) {
  const lobiSide = match.lobiHome ? 'home' : 'away';
  const sideOf = s => (s === 'lobi' ? lobiSide : lobiSide === 'home' ? 'away' : 'home');
  const periods = ['1H', '2H', ...(match.length === 120 ? ['ET1', 'ET2'] : [])];
  const evs = events.filter(e => !e.deleted && e.period in PERIOD_START);
  // Stoppage blocks: at least what the form has added, and enough for any event or cell already in added time.
  const stop = {};
  for (const p of periods) {
    let n = Number(stoppage[p] || 0);
    for (const e of evs) if (e.period === p && e.stoppage) n = Math.max(n, Math.ceil(e.stoppage / 2));
    for (const c of cells) if (c.period === p && String(c.block).includes('+')) n = Math.max(n, Number(String(c.block).split('+')[1]) / 2);
    stop[p] = Math.min(15, n);
  }
  const cols = periods.map(p => ({ period: p, blocks: blocksFor(p, stop[p]) }));
  const grid = { lobi: {}, opponent: {} };
  for (const side of ['lobi', 'opponent']) {
    const ms = sideOf(side), os = ms === 'home' ? 'away' : 'home';
    for (const m of METRICS) {
      const r = (grid[side][m.key] = {});
      for (const c of cols) { r[c.period] = {}; for (const b of c.blocks) r[c.period][b] = 0; }
    }
    for (const e of evs) {
      const b = blockOf(e); if (!b) continue;
      for (const [k, rule] of Object.entries(EVENT_ROWS)) if (e.side === ms && rule.test(e) && grid[side][k][e.period]?.[b] !== undefined) grid[side][k][e.period][b]++;
      if (e.type === 'goal') { const key = e.side === ms ? 'goal_for' : e.side === os ? 'goal_against' : null; if (key && grid[side][key][e.period]?.[b] !== undefined) grid[side][key][e.period][b]++; }
    }
    for (const c of cells) if (c.side === side && grid[side][c.metric]?.[c.period]?.[c.block] !== undefined) grid[side][c.metric][c.period][c.block] = c.value;
    for (const c of cols) for (const b of c.blocks) grid[side].goal_attempt[c.period][b] = grid[side].shot_on[c.period][b] + grid[side].shot_off[c.period][b] + grid[side].blocked[c.period][b];
  }
  const round = v => Math.round(v * 100) / 100;
  const totals = { lobi: {}, opponent: {} };
  for (const side of ['lobi', 'opponent']) for (const m of METRICS) {
    const t = (totals[side][m.key] = { full: 0 });
    for (const c of cols) { t[c.period] = round(Object.values(grid[side][m.key][c.period]).reduce((a, b) => a + b, 0)); t.full = round(t.full + t[c.period]); }
  }
  const acc = side => { const t = totals[side]; return t.goal_attempt.full ? Math.round((t.shot_on.full / t.goal_attempt.full) * 100) : null; };
  return { cols, grid, totals, accuracy: { lobi: acc('lobi'), opponent: acc('opponent') }, stoppage: stop };
}

/** One analysis with the match, line-ups, grid, checks and who else has it open. */
export async function getAnalysis(db, id, user = null) {
  const a = await row(db, id);
  if (!a) return null;
  const full = await getMatch(db, a.match_id);
  if (!full) return null;
  const m = await db.prepare(`SELECT formation_home_finish, formation_away_finish FROM sx_matches WHERE id = ?`).bind(a.match_id).first();
  full.match.formationHomeFinish = m?.formation_home_finish || '';
  full.match.formationAwayFinish = m?.formation_away_finish || '';
  const cells = (await db.prepare(`SELECT metric, team_side, period, block, value, updated_by, updated_at FROM sx_bst_cells WHERE analysis_id = ?`).bind(a.id).all()).results
    .map(c => ({ metric: c.metric, side: c.team_side, period: c.period, block: c.block, value: c.value, by: c.updated_by, at: c.updated_at }));
  const analysis = view(a);
  const grid = bstGrid(full.match, full.events, cells, analysis.stoppage);
  const others = user ? (await db.prepare(`SELECT name, last_seen FROM sx_bst_presence WHERE analysis_id = ? AND user_id <> ? AND last_seen > ?`).bind(a.id, user.id, new Date(Date.now() - 45e3).toISOString()).all()).results : [];
  return { analysis, match: full.match, lineups: full.lineups, events: full.events, ...grid, checks: finalChecks(full.match, full.lineups, full.events), others };
}

/** Checks before Final: errors stop it. */
export function finalChecks(match, lineups, events) {
  const v = validate(match, lineups, events);
  const errors = v.errors.filter(e => /starters|does not match the goal events|after full time|outside the/.test(e));
  const lobiSide = match.lobiHome ? 'home' : 'away';
  const fStart = lobiSide === 'home' ? match.formationHome : match.formationAway;
  const fEnd = lobiSide === 'home' ? match.formationHomeFinish : match.formationAwayFinish;
  if (!fStart || !fEnd) errors.push('Set the Lobi Stars starting and finishing formations.');
  const notices = lineups.some(l => l.side !== lobiSide) ? [] : ['No opponent line-up (that is fine; add it in Match Setup if you have it).'];
  return { errors, notices, ok: !errors.length };
}

const editable = a => (a.status === 'final' ? 'This analysis is Final. A Super Admin can reopen it.' : null);
async function touch(db, user, id) {
  await db.prepare(`UPDATE sx_bst_analyses SET version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), id).run();
  return (await db.prepare(`SELECT version, updated_at FROM sx_bst_analyses WHERE id = ?`).bind(id).first());
}

/** An analyst cell: delta (+1/−1, for counts, so two people tapping at once both count) or value (xG/xA, 0.00–9.99). */
export async function setCell(db, user, id, b, { request = null } = {}) {
  const a = await row(db, id);
  if (!a) return { error: 'Analysis not found.' };
  const bad = editable(a); if (bad) return { error: bad };
  const metric = String(b.metric || ''), side = b.side === 'opponent' ? 'opponent' : 'lobi', period = String(b.period || ''), block = String(b.block || '');
  if (!CELL_METRICS.has(metric)) return { error: 'That row is worked out from the events or is calculated; it cannot be typed.' };
  if (!validBlock(period, block)) return { error: 'Unknown block.' };
  const decimal = metric === 'xg' || metric === 'xa';
  const old = await db.prepare(`SELECT value FROM sx_bst_cells WHERE analysis_id = ? AND metric = ? AND team_side = ? AND period = ? AND block = ?`).bind(a.id, metric, side, period, block).first();
  let value;
  if (decimal) {
    const v = Number(b.value);
    if (!(v >= 0 && v <= 9.99)) return { error: 'xG and xA are from 0.00 to 9.99.' };
    value = Math.round(v * 100) / 100;
  } else {
    const d = Math.round(Number(b.delta));
    if (d !== 1 && d !== -1) return { error: 'Use + or −.' };
    value = Math.max(0, Math.min(99, (old?.value || 0) + d));
  }
  const at = nowIso();
  if (value === 0) await db.prepare(`DELETE FROM sx_bst_cells WHERE analysis_id = ? AND metric = ? AND team_side = ? AND period = ? AND block = ?`).bind(a.id, metric, side, period, block).run();
  else if (decimal) await db.prepare(`INSERT INTO sx_bst_cells (id, analysis_id, metric, team_side, period, block, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (analysis_id, metric, team_side, period, block) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(newId('bsc'), a.id, metric, side, period, block, value, byName(user), at).run();
  else await db.prepare(`INSERT INTO sx_bst_cells (id, analysis_id, metric, team_side, period, block, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (analysis_id, metric, team_side, period, block) DO UPDATE SET value = MAX(0, MIN(99, sx_bst_cells.value + ?)), updated_by = excluded.updated_by, updated_at = excluded.updated_at`).bind(newId('bsc'), a.id, metric, side, period, block, Math.max(1, value), byName(user), at, Math.round(Number(b.delta))).run();
  const now = await db.prepare(`SELECT value FROM sx_bst_cells WHERE analysis_id = ? AND metric = ? AND team_side = ? AND period = ? AND block = ?`).bind(a.id, metric, side, period, block).first();
  const t = await touch(db, user, a.id);
  await sxLog(db, statsActor(user), 'bst_cell', { itemType: 'bst', itemId: a.id, itemTitle: `${metric} ${side} ${period} ${block}`, before: { value: old?.value || 0 }, after: { value: now?.value || 0 }, request });
  return { ok: true, value: now?.value || 0, version: t.version, savedAt: t.updated_at };
}

/** Game Overview and half notes, with optimistic locking: a save made from an older version is refused, not overwritten. */
export async function setText(db, user, id, b, { request = null } = {}) {
  const a = await row(db, id);
  if (!a) return { error: 'Analysis not found.' };
  const bad = editable(a); if (bad) return { error: bad };
  const col = { overview: 'overview', half1Note: 'half1_note', half2Note: 'half2_note' }[b.field];
  if (!col) return { error: 'Unknown field.' };
  const value = clean(b.value, 20000);
  if ((a[col] || '') === value) return { ok: true, version: a.version, savedAt: a.updated_at };
  // The text changed on the server since this person last loaded it (someone else saved it): a conflict.
  if (b.baseText !== undefined && (a[col] || '') !== String(b.baseText ?? '')) return { conflict: true, error: `${a.updated_by || 'Someone'} changed this text at ${String(a.updated_at).slice(11, 19)} while you were typing.`, current: a[col] || '', by: a.updated_by, version: a.version };
  await db.prepare(`UPDATE sx_bst_analyses SET ${col} = ? WHERE id = ?`).bind(value, a.id).run();
  const t = await touch(db, user, a.id);
  await sxLog(db, statsActor(user), 'bst_text', { itemType: 'bst', itemId: a.id, itemTitle: col, details: `${value.length} characters`, request });
  return { ok: true, version: t.version, savedAt: t.updated_at };
}

export async function setStoppage(db, user, id, { period, count }, { request = null } = {}) {
  const a = await row(db, id);
  if (!a) return { error: 'Analysis not found.' };
  const bad = editable(a); if (bad) return { error: bad };
  if (!(period in PERIOD_START)) return { error: 'Unknown half.' };
  const n = Math.max(0, Math.min(15, Math.round(Number(count) || 0)));
  const s = { ...parse(a.stoppage_json, {}), [period]: n };
  await db.prepare(`UPDATE sx_bst_analyses SET stoppage_json = ? WHERE id = ?`).bind(JSON.stringify(s), a.id).run();
  const t = await touch(db, user, a.id);
  await sxLog(db, statsActor(user), 'bst_stoppage', { itemType: 'bst', itemId: a.id, details: `${period}: ${n} added-time blocks`, request });
  return { ok: true, version: t.version, savedAt: t.updated_at };
}

export async function finalise(db, user, id, { request = null } = {}) {
  const d = await getAnalysis(db, id);
  if (!d) return { error: 'Analysis not found.' };
  if (d.analysis.status === 'final') return { ok: true };
  if (!d.checks.ok) return { error: 'Fix the problems first.', checks: d.checks };
  const at = nowIso();
  await db.prepare(`UPDATE sx_bst_analyses SET status = 'final', finalised_by = ?, finalised_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(user.fullName, at, byName(user), at, id).run();
  await sxLog(db, statsActor(user), 'bst_final', { itemType: 'bst', itemId: id, itemTitle: `${d.match.home} v ${d.match.away}`, request });
  return { ok: true };
}
export async function reopenAnalysis(db, user, id, { request = null } = {}) {
  if (!user.admin) return { error: 'Only a Super Admin can reopen a Final analysis.' };
  const a = await row(db, id);
  if (!a) return { error: 'Analysis not found.' };
  await db.prepare(`UPDATE sx_bst_analyses SET status = 'draft', version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`).bind(byName(user), nowIso(), id).run();
  await sxLog(db, statsActor(user), 'bst_reopen', { itemType: 'bst', itemId: id, request });
  return { ok: true };
}

/** "Someone else has this open": a heartbeat every 20 seconds; seen in the last 45 seconds counts. */
export async function heartbeat(db, user, id) {
  await ensureBstSchema(db);
  await db.prepare(`INSERT INTO sx_bst_presence (analysis_id, user_id, name, last_seen) VALUES (?, ?, ?, ?) ON CONFLICT (analysis_id, user_id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`)
    .bind(String(id), user.id, user.fullName, nowIso()).run();
  const a = await db.prepare(`SELECT version, updated_by, updated_at FROM sx_bst_analyses WHERE id = ?`).bind(String(id)).first();
  const others = (await db.prepare(`SELECT name FROM sx_bst_presence WHERE analysis_id = ? AND user_id <> ? AND last_seen > ?`).bind(String(id), user.id, new Date(Date.now() - 45e3).toISOString()).all()).results.map(r => r.name);
  return { ok: true, others, version: a?.version, updatedBy: a?.updated_by, updatedAt: a?.updated_at };
}

// ── Exports (Excel and CSV; the PDF is the print page) ──
const label = (period, block) => { const [b, p] = String(block).split('+'); return p ? `${b}+${p}'` : `${b}'`; };
export function bstSheets(d, { includeOpponent = false } = {}) {
  const sides = includeOpponent ? ['lobi', 'opponent'] : ['lobi'];
  const m = d.match, lobi = m.lobiHome ? m.home : m.away, opp = m.lobiHome ? m.away : m.home;
  const name = s => (s === 'lobi' ? lobi : opp);
  const head = ['Team', 'Metric', ...d.cols.flatMap(c => c.blocks.map(b => `${c.period} ${label(c.period, b)}`)), ...d.cols.map(c => `${c.period} total`), 'Match total'];
  const gridRows = sides.flatMap(s => METRICS.map(mt => [name(s), mt.label, ...d.cols.flatMap(c => c.blocks.map(b => d.grid[s][mt.key][c.period][b])), ...d.cols.map(c => d.totals[s][mt.key][c.period]), d.totals[s][mt.key].full]));
  const totalRows = sides.flatMap(s => METRICS.map(mt => [name(s), mt.label, ...d.cols.map(c => d.totals[s][mt.key][c.period]), d.totals[s][mt.key].full]));
  const lu = d.lineups.filter(l => sides.includes((l.side === (m.lobiHome ? 'home' : 'away')) ? 'lobi' : 'opponent'));
  const info = [['Match', `${m.home} v ${m.away}`], ['Score', `${m.homeScore}–${m.awayScore}`], ['Date', String(m.date).slice(0, 10)], ['Kick-off', m.kickoff || ''], ['Venue', m.venue || ''], ['Competition', m.competition],
    ['Season', m.season], ['Starting formation (Lobi Stars)', m.lobiHome ? m.formationHome || '' : m.formationAway || ''], ['Finishing formation (Lobi Stars)', m.lobiHome ? m.formationHomeFinish || '' : m.formationAwayFinish || ''],
    ['Status', d.analysis.status === 'final' ? 'Final' : 'Draft'], ['Prepared by', d.analysis.preparedBy || ''], ['Game overview', d.analysis.overview], [], ['Line-up', ''],
    ...lu.map(l => [`${l.side === (m.lobiHome ? 'home' : 'away') ? lobi : opp} ${l.starter ? 'starter' : 'reserve'}`, `${l.number ?? ''} ${l.name}${l.position ? ` (${l.position})` : ''}`])];
  return [
    { name: 'Grid', columns: head, rows: gridRows },
    { name: 'Totals', columns: ['Team', 'Metric', ...d.cols.map(c => c.period), 'Match'], rows: totalRows },
    { name: 'Match & line-up', columns: ['Item', 'Value'], rows: info },
  ];
}

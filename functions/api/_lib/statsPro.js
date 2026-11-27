// Statistics Center professional add-ons (owner's request, 27 Nov 2026):
//  passing and advanced team numbers (game state, expected points, field tilt, pressing, shot quality), goalkeeper
//  numbers, injury and availability (with automatic suspensions), training load and wellness (players' own phone
//  links), player development targets and radar, milestones and records, the public stats hub data, branded match
//  reports and opposition packs (print to PDF), and versioned stat definitions.
// Everything is worked out from the recorded events; nothing here changes match history.
import { ensureStatsCentreSchema, sxSettings, setSxSetting, sxLog, statsActor, newId, oneLine, clean, sha256Hex, randomToken } from './statsCentre.js';
import { publishedMatches, playerTotals, teamTotals, getMatch, passFlags, EVENT_TYPES } from './statsCentreData.js';
import { hiddenYouth, redactSnapshot } from './statsPrivacy.js';

const nowIso = () => new Date().toISOString();
const DAY = 864e5;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ready = false;
export async function ensureProSchema(db) {
  await ensureStatsCentreSchema(db);
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_availability (id TEXT PRIMARY KEY, slug TEXT NOT NULL, status TEXT NOT NULL, reason TEXT, from_date TEXT, expected_return TEXT, notes TEXT,
      created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT, cleared_at TEXT, cleared_by TEXT)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_avail_slug ON sx_availability (slug, cleared_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_wellness_links (id TEXT PRIMARY KEY, slug TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_by TEXT, created_at TEXT NOT NULL, revoked_at TEXT, last_used_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_wellness (id TEXT PRIMARY KEY, slug TEXT NOT NULL, entry_date TEXT NOT NULL, session_type TEXT NOT NULL, minutes INTEGER, rpe INTEGER, load INTEGER,
      sleep INTEGER, soreness INTEGER, fatigue INTEGER, stress INTEGER, mood INTEGER, note TEXT, created_at TEXT NOT NULL, UNIQUE (slug, entry_date, session_type))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sx_well_slug ON sx_wellness (slug, entry_date)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_player_targets (id TEXT PRIMARY KEY, slug TEXT NOT NULL, season TEXT NOT NULL, metric TEXT NOT NULL, target REAL NOT NULL, deadline TEXT, note TEXT,
      created_by TEXT, created_at TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_milestones (key TEXT PRIMARY KEY, kind TEXT NOT NULL, slug TEXT, title TEXT NOT NULL, detail TEXT, match_id TEXT, achieved_on TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_definition_versions (version INTEGER PRIMARY KEY, note TEXT, created_by TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sx_definitions (version INTEGER NOT NULL, key TEXT NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (version, key))`),
  ]);
  if (!(await db.prepare(`SELECT 1 FROM sx_definition_versions LIMIT 1`).first())) {
    const at = nowIso();
    await db.batch([db.prepare(`INSERT INTO sx_definition_versions (version, note, created_by, created_at) VALUES (1, 'First version', 'system', ?)`).bind(at),
      ...DEFINITIONS.map(([k, l, t]) => db.prepare(`INSERT INTO sx_definitions (version, key, label, text) VALUES (1, ?, ?, ?)`).bind(k, l, t))]);
    await db.prepare(`UPDATE sx_matches SET definitions_version = 1 WHERE definitions_version IS NULL`).run();
  }
  ready = true;
}

// ── 12. Stat definitions, with versions ──
export const DEFINITIONS = [
  ['goal', 'Goal', 'The ball crosses the line and the referee gives it. Record it for the team the goal counts for. An own goal: type "Own goal", and choose the player from the other team who put it in. A goal also counts as a shot on target.'],
  ['assist', 'Assist', 'The last pass or touch by a team-mate that led directly to the goal. No assist for an own goal, or a penalty won by the scorer.'],
  ['shot', 'Shot', 'Any attempt to score. On target: it would have gone in without a save or a defender on the line (goals count as on target). Off target: wide or over. Blocked: stopped by an outfield player. Woodwork: hit the post or bar and did not go in.'],
  ['pass', 'Pass', 'An intentional ball played to a team-mate. Complete: a team-mate receives it. Progressive: moves the ball at least a quarter of the way closer to the goal and ends in the opponents\' half (or gains 30 m), or enters the box. Final third: ends in the attacking third having started outside it. Into the box: ends in the penalty area.'],
  ['key_pass', 'Key pass', 'A pass that leads straight to a shot that does not score.'],
  ['corner', 'Corner', 'A corner kick taken by the team.'],
  ['foul', 'Foul', 'A foul given by the referee: record it for the player who committed it. "Foul won" is for the player fouled.'],
  ['cards', 'Yellow / red card', 'Shown by the referee. A second yellow is recorded as a red card (type "second yellow"). A sent-off player cannot appear in later events.'],
  ['offside', 'Offside', 'Given against the attacking player.'],
  ['substitution', 'Substitution', 'Player going off, player coming on, and the reason. The league allows 5.'],
  ['save', 'Save', 'The goalkeeper stops a shot on target. Record it for the goalkeeper\'s team.'],
  ['defending', 'Tackle, interception, clearance, block, aerial duel', 'Defensive actions, recorded in Review or from video.'],
  ['minutes', 'Minutes played', 'Worked out: a starter plays from 0 until substituted or sent off (or full time); a substitute from the minute they came on. Added time counts as the period\'s last minute.'],
  ['clean_sheet', 'Clean sheet', 'A goalkeeper who played at least 60 minutes in a match where Lobi Stars conceded no goals.'],
  ['possession', 'Possession', 'Typed in after the match (an estimate), or the share of recorded passes when passes are recorded for both teams.'],
  ['xg', 'xG (expected goals)', 'The chance a shot is scored, from where it was taken, the angle, the body part and the situation (0 to 1). Penalties 0.76.'],
  ['xpts', 'Expected points', 'The points the team would get on average from the chances both teams had (from the xG of every shot).'],
  ['field_tilt', 'Field tilt', 'Our share of the recorded actions in the attacking third (ours plus theirs in theirs).'],
  ['ppda', 'Pressing (PPDA)', 'Passes the opponents make in their own 60% of the pitch for each defensive action we make there (tackle, interception, foul). Lower means more intense pressing.'],
  ['goals_prevented', 'Goals prevented (goalkeeper)', 'The xG of the shots on target the goalkeeper faced, minus the goals conceded. Above zero: better than an average goalkeeper.'],
];
export async function definitions(db) {
  await ensureProSchema(db);
  const cur = (await db.prepare(`SELECT MAX(version) AS v FROM sx_definition_versions`).first()).v;
  const versions = (await db.prepare(`SELECT * FROM sx_definition_versions ORDER BY version DESC`).all()).results;
  const rows = (await db.prepare(`SELECT * FROM sx_definitions ORDER BY version, rowid`).all()).results;
  const at = v => rows.filter(r => r.version === v).map(r => ({ key: r.key, label: r.label, text: r.text }));
  const history = versions.map(v => ({ ...v, items: at(v.version) }));
  return { current: cur, items: at(cur), history };
}
/** A new version: the full list with the changed texts. Matches keep the version they were recorded under. */
export async function newDefinitionsVersion(db, user, { changes, note }, { request = null } = {}) {
  if (!user.canPublish) return { error: 'Only a senior statistician or a Super Admin can change the definitions.' };
  if (String(note || '').trim().length < 3) return { error: 'Say what changed (kept with the version).' };
  const d = await definitions(db);
  const ch = changes && typeof changes === 'object' ? changes : {};
  const items = d.items.map(i => ({ ...i, text: ch[i.key] !== undefined ? clean(ch[i.key], 2000) : i.text }));
  if (items.every((i, n) => i.text === d.items[n].text)) return { error: 'Nothing changed.' };
  if (items.some(i => i.text.trim().length < 5)) return { error: 'A definition cannot be empty.' };
  const v = d.current + 1, at = nowIso();
  await db.batch([db.prepare(`INSERT INTO sx_definition_versions (version, note, created_by, created_at) VALUES (?, ?, ?, ?)`).bind(v, oneLine(note, 300), user.fullName, at),
    ...items.map(i => db.prepare(`INSERT INTO sx_definitions (version, key, label, text) VALUES (?, ?, ?, ?)`).bind(v, i.key, i.label, i.text))]);
  await sxLog(db, statsActor(user), 'definitions_version', { itemType: 'definitions', itemId: String(v), details: `${oneLine(note, 200)} (${items.filter((i, n) => i.text !== d.items[n].text).map(i => i.label).join(', ')})`, request });
  return { ok: true, version: v };
}

// ── 1–3. Passing, advanced team numbers and goalkeepers (one match) ──
const shotsOf = (evs, side) => evs.filter(e => e.side === side && (e.type === 'shot' || e.type === 'goal') && e.detail !== 'own_goal');
/** Win / draw / loss chances from each shot's xG (exact, not simulated). */
export function expectedPoints(xgFor, xgAgainst) {
  const dist = list => { let d = [1]; for (const p0 of list) { const p = Math.max(0, Math.min(1, p0 || 0)); const n = new Array(d.length + 1).fill(0); d.forEach((v, i) => { n[i] += v * (1 - p); n[i + 1] += v * p; }); d = n; } return d; };
  const a = dist(xgFor), b = dist(xgAgainst);
  let w = 0, dr = 0, l = 0;
  a.forEach((pa, i) => b.forEach((pb, j) => { if (i > j) w += pa * pb; else if (i === j) dr += pa * pb; else l += pa * pb; }));
  return { win: r2(w), draw: r2(dr), loss: r2(l), xPts: r2(3 * w + dr) };
}
const isGk = l => /^GK/i.test(l.position || '');
export function matchAdvanced(full) {
  const m = full.match, evs = full.events.filter(e => !e.deleted), L = m.length || 90;
  const lobi = m.lobiHome ? 'home' : 'away', opp = lobi === 'home' ? 'away' : 'home';
  const sideName = s => (s === 'home' ? m.home : m.away);
  // Passing
  const passing = {};
  for (const s of ['home', 'away']) {
    const ps = evs.filter(e => e.side === s && e.type === 'pass');
    const done = ps.filter(e => e.outcome !== 'incomplete');
    const f = done.map(passFlags);
    passing[s] = { passes: ps.length, complete: done.length, completion: pct(done.length, ps.length), progressive: f.filter(x => x.progressive).length, finalThird: f.filter(x => x.finalThird).length, box: f.filter(x => x.box).length };
  }
  const pAll = passing.home.passes + passing.away.passes;
  const passPossession = passing.home.passes && passing.away.passes ? { home: pct(passing.home.passes, pAll), away: pct(passing.away.passes, pAll) } : null;
  // Pass network (Lobi Stars): average position of each player's actions and completed passes between pairs.
  const pos = new Map(), pairs = new Map();
  for (const e of evs.filter(x => x.side === lobi && x.slug && x.x !== null && x.x !== undefined)) { const p = pos.get(e.slug) || { slug: e.slug, name: e.name, x: 0, y: 0, n: 0 }; p.x += e.x; p.y += e.y ?? 50; p.n++; pos.set(e.slug, p); }
  for (const e of evs.filter(x => x.side === lobi && x.type === 'pass' && x.outcome !== 'incomplete' && x.slug && x.relatedSlug)) { const k = `${e.slug}>${e.relatedSlug}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
  const network = { nodes: [...pos.values()].map(p => ({ slug: p.slug, name: p.name, x: r1(p.x / p.n), y: r1(p.y / p.n), actions: p.n })), links: [...pairs.entries()].map(([k, n]) => { const [from, to] = k.split('>'); return { from, to, passes: n }; }).sort((a, b) => b.passes - a.passes) };
  // Game state (from Lobi Stars' point of view)
  const states = { winning: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 }, drawing: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 }, losing: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 } };
  const ord = { '1H': 1, '2H': 2, ET1: 3, ET2: 4, PEN: 5 };
  const sorted = evs.filter(e => e.period !== 'PEN').slice().sort((a, b) => (ord[a.period] - ord[b.period]) || (a.minute - b.minute) || ((a.stoppage || 0) - (b.stoppage || 0)));
  let gf = 0, ga = 0, last = 0;
  const state = () => (gf > ga ? 'winning' : gf < ga ? 'losing' : 'drawing');
  for (const e of sorted) {
    const t = Math.min(L, e.minute);
    if (t > last) { states[state()].minutes += t - last; last = t; }
    const s = states[state()];
    if ((e.type === 'shot' || e.type === 'goal') && e.detail !== 'own_goal' && e.xg) { if (e.side === lobi) s.xgf = r2(s.xgf + e.xg); else s.xga = r2(s.xga + e.xg); }
    if (e.type === 'goal') { if (e.side === lobi) { s.gf++; gf++; } else { s.ga++; ga++; } }
  }
  if (L > last) states[state()].minutes += L - last;
  // Expected points
  const xp = expectedPoints(shotsOf(evs, lobi).map(e => e.xg || 0), shotsOf(evs, opp).map(e => e.xg || 0));
  const lg = m.lobiHome ? m.homeScore : m.awayScore, og = m.lobiHome ? m.awayScore : m.homeScore;
  const points = lg > og ? 3 : lg === og ? 1 : 0;
  // Field tilt: actions with a position in the attacking third (x ≥ 66.7 in the acting team's direction).
  const positioned = evs.filter(e => e.x !== null && e.x !== undefined && e.type !== 'substitution');
  const att = s => positioned.filter(e => e.side === s && e.x >= 66.7).length;
  const tiltSrc = att(lobi) + att(opp) ? 'positions' : null;
  let tilt = tiltSrc ? pct(att(lobi), att(lobi) + att(opp)) : null;
  if (tilt === null && passing[lobi].finalThird + passing[opp].finalThird) tilt = pct(passing[lobi].finalThird, passing[lobi].finalThird + passing[opp].finalThird);
  // PPDA: their passes in their own 60% ÷ our defensive actions in that area (positions; without positions: all of them, marked approximate).
  const DEF = new Set(['tackle', 'interception', 'foul_committed']);
  const oppPasses = evs.filter(e => e.side === opp && e.type === 'pass'), ourDef = evs.filter(e => e.side === lobi && DEF.has(e.type));
  const withPos = oppPasses.some(e => e.x !== null && e.x !== undefined) && ourDef.some(e => e.x !== null && e.x !== undefined);
  const ppdaN = withPos ? oppPasses.filter(e => e.x !== null && e.x < 60).length : oppPasses.length;
  const ppdaD = withPos ? ourDef.filter(e => e.x !== null && e.x >= 40).length : ourDef.length;
  const ppda = ppdaN && ppdaD ? { value: r1(ppdaN / ppdaD), approximate: !withPos } : null;
  // Shot quality
  const quality = {};
  for (const s of ['home', 'away']) { const sh = shotsOf(evs, s); const xg = sh.reduce((t, e) => t + (e.xg || 0), 0); quality[s] = { shots: sh.length, xg: r2(xg), xgPerShot: sh.length ? r2(xg / sh.length) : null, bigChances: sh.filter(e => (e.xg || 0) >= 0.3).length }; }
  // Goalkeepers (each side's keeper on the pitch: starters marked GK, or anyone with saves)
  const keepers = [];
  for (const s of ['home', 'away']) {
    const gks = full.lineups.filter(l => l.side === s && isGk(l) && (l.starter || evs.some(e => e.relatedSlug === l.slug && e.type === 'substitution')));
    const facing = shotsOf(evs, s === 'home' ? 'away' : 'home').filter(e => e.type === 'goal' || e.outcome === 'on_target');
    const conceded = evs.filter(e => e.type === 'goal' && e.side !== s && e.detail !== 'own_goal').length;
    const xgot = r2(facing.reduce((t, e) => t + (e.xg || 0), 0));
    const saves = evs.filter(e => e.side === s && e.type === 'gk_save').length;
    const byZone = {};
    for (const e of facing.filter(x => x.type !== 'goal')) { const z = e.x === null || e.x === undefined ? 'unknown' : e.x >= 84.3 ? 'inside the box' : 'outside the box'; byZone[z] = (byZone[z] || 0) + 1; }
    const byBody = {};
    for (const e of facing.filter(x => x.type !== 'goal')) { const b = e.bodyPart || 'unknown'; byBody[b] = (byBody[b] || 0) + 1; }
    const gkSlugs = new Set(gks.map(g => g.slug || g.name));
    const dist = evs.filter(e => e.side === s && e.type === 'pass' && gkSlugs.has(e.slug || e.name));
    const long = dist.filter(e => e.endX !== null && e.endX !== undefined && e.x !== null && e.endX - e.x >= 40);
    keepers.push({ side: s, team: sideName(s), keepers: gks.map(g => g.name), shotsOnTargetFaced: facing.length, saves, conceded, savePct: pct(facing.length - conceded, facing.length), xgOnTargetFaced: xgot, goalsPrevented: r2(xgot - conceded),
      savesByZone: byZone, savesByBodyPart: byBody, distribution: { passes: dist.length, complete: dist.filter(e => e.outcome !== 'incomplete').length, completion: pct(dist.filter(e => e.outcome !== 'incomplete').length, dist.length), long: long.length, longComplete: long.filter(e => e.outcome !== 'incomplete').length } });
  }
  return { lobiSide: lobi, passing, passPossession, network, gameState: states, expected: { ...xp, actualPoints: points }, fieldTilt: tilt === null ? null : { lobi: tilt, source: tiltSrc || 'final-third passes' }, ppda, quality, keepers };
}
export async function seasonAdvanced(db, season) {
  await ensureProSchema(db);
  const snaps = await publishedMatches(db, season);
  const per = snaps.map(s => ({ s, a: matchAdvanced({ match: s.match, events: s.events, lineups: s.lineups }) }));
  const sum = (f) => per.reduce((t, x) => t + (f(x) || 0), 0);
  const gs = { winning: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 }, drawing: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 }, losing: { minutes: 0, gf: 0, ga: 0, xgf: 0, xga: 0 } };
  for (const { a } of per) for (const k of Object.keys(gs)) for (const f of Object.keys(gs[k])) gs[k][f] = r2(gs[k][f] + a.gameState[k][f]);
  const tilts = per.map(x => x.a.fieldTilt?.lobi).filter(v => v !== null && v !== undefined), ppdas = per.map(x => x.a.ppda?.value).filter(Boolean);
  const gk = new Map();
  for (const { a } of per) { const k = a.keepers.find(x => x.side === a.lobiSide); if (!k) continue; for (const name of k.keepers.length ? [k.keepers[0]] : []) { const g = gk.get(name) || { name, matches: 0, shotsOnTargetFaced: 0, saves: 0, conceded: 0, xgOnTargetFaced: 0 }; g.matches++; g.shotsOnTargetFaced += k.shotsOnTargetFaced; g.saves += k.saves; g.conceded += k.conceded; g.xgOnTargetFaced = r2(g.xgOnTargetFaced + k.xgOnTargetFaced); gk.set(name, g); } }
  return {
    season, matches: per.length,
    expected: { xPts: r2(sum(x => x.a.expected.xPts)), points: sum(x => x.a.expected.actualPoints), byMatch: per.map(({ s, a }) => ({ id: s.id, date: s.match.date, opponent: s.match.lobiHome ? s.match.away : s.match.home, score: `${s.match.homeScore}–${s.match.awayScore}`, xPts: a.expected.xPts, points: a.expected.actualPoints, xgFor: a.quality[a.lobiSide].xg, xgAgainst: a.quality[a.lobiSide === 'home' ? 'away' : 'home'].xg, tilt: a.fieldTilt?.lobi ?? null, ppda: a.ppda?.value ?? null })) },
    gameState: gs, fieldTilt: tilts.length ? r1(tilts.reduce((t, v) => t + v, 0) / tilts.length) : null, ppda: ppdas.length ? r1(ppdas.reduce((t, v) => t + v, 0) / ppdas.length) : null,
    passing: { passes: sum(x => x.a.passing[x.a.lobiSide].passes), complete: sum(x => x.a.passing[x.a.lobiSide].complete), progressive: sum(x => x.a.passing[x.a.lobiSide].progressive), box: sum(x => x.a.passing[x.a.lobiSide].box) },
    keepers: [...gk.values()].map(g => ({ ...g, savePct: pct(g.shotsOnTargetFaced - g.conceded, g.shotsOnTargetFaced), goalsPrevented: r2(g.xgOnTargetFaced - g.conceded) })),
  };
}

// ── 4. Injury and availability (with automatic suspensions from cards) ──
export const AVAIL = { injured: 'Injured', ill: 'Ill', suspended: 'Suspended', doubtful: 'Doubtful', unavailable: 'Unavailable (other)' };
export async function setAvailability(db, user, b, { request = null } = {}) {
  await ensureProSchema(db);
  const slug = oneLine(b.slug, 80); if (!/^[a-z0-9-]{2,80}$/.test(slug)) return { error: 'Choose a player.' };
  const at = nowIso();
  if (b.status === 'available') {
    await db.prepare(`UPDATE sx_availability SET cleared_at = ?, cleared_by = ? WHERE slug = ? AND cleared_at IS NULL`).bind(at, user.fullName, slug).run();
    await sxLog(db, statsActor(user), 'availability', { itemType: 'player', itemId: slug, details: 'Available again', request });
    return { ok: true };
  }
  if (!AVAIL[b.status]) return { error: 'Choose a status.' };
  const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  await db.prepare(`UPDATE sx_availability SET cleared_at = ?, cleared_by = ? WHERE slug = ? AND cleared_at IS NULL`).bind(at, user.fullName, slug).run();
  await db.prepare(`INSERT INTO sx_availability (id, slug, status, reason, from_date, expected_return, notes, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('av'), slug, b.status, oneLine(b.reason, 120) || null, date(b.from) || at.slice(0, 10), date(b.expectedReturn), oneLine(b.notes, 300) || null, user.fullName, at).run();
  await sxLog(db, statsActor(user), 'availability', { itemType: 'player', itemId: slug, details: `${AVAIL[b.status]}${b.reason ? `: ${oneLine(b.reason, 80)}` : ''}`, request });
  return { ok: true };
}
/** Suspensions worked out from published matches: a red card bans the next match; every Nth yellow (default 5) too. */
export function autoSuspensions(snaps, { yellowBan = 5 } = {}) {
  const out = new Map(), yellows = new Map();
  snaps.forEach((s, i) => {
    const lobi = s.match.lobiHome ? 'home' : 'away';
    for (const e of s.events.filter(x => x.side === lobi && x.slug)) {
      let why = null;
      if (e.type === 'red_card') why = `Red card v ${lobi === 'home' ? s.match.away : s.match.home}`;
      if (e.type === 'yellow_card') { const n = (yellows.get(e.slug) || 0) + 1; yellows.set(e.slug, n); if (n % yellowBan === 0) why = `${n} yellow cards this season`; }
      if (why && i === snaps.length - 1) out.set(e.slug, { status: 'suspended', reason: why, auto: true, expectedReturn: 'after the next match' });
    }
  });
  return { suspended: out, yellows: Object.fromEntries(yellows) };
}
export async function availability(db, season) {
  await ensureProSchema(db);
  const rows = (await db.prepare(`SELECT * FROM sx_availability WHERE cleared_at IS NULL`).all()).results;
  const s = await sxSettings(db);
  const auto = autoSuspensions(await publishedMatches(db, season), { yellowBan: Number(s.yellow_ban) || 5 });
  const map = {};
  for (const [slug, v] of auto.suspended) map[slug] = v;
  for (const r of rows) map[r.slug] = { status: r.status, label: AVAIL[r.status], reason: r.reason || '', from: r.from_date, expectedReturn: r.expected_return, notes: r.notes || '', by: r.created_by, auto: false };
  const history = (await db.prepare(`SELECT * FROM sx_availability ORDER BY created_at DESC LIMIT 100`).all()).results.map(r => ({ slug: r.slug, status: r.status, reason: r.reason, from: r.from_date, clearedAt: r.cleared_at, by: r.created_by }));
  return { players: map, yellows: auto.yellows, yellowBan: Number(s.yellow_ban) || 5, history };
}

// ── 5. Training load and wellness (each player has a private phone link) ──
const SESSION_TYPES = ['training', 'match', 'gym', 'recovery', 'other'];
export async function makeWellnessLink(db, user, slug, { request = null } = {}) {
  await ensureProSchema(db);
  if (!/^[a-z0-9-]{2,80}$/.test(String(slug || ''))) return { error: 'Choose a player.' };
  const token = randomToken(24).replace(/[^A-Za-z0-9]/g, 'x');
  await db.prepare(`UPDATE sx_wellness_links SET revoked_at = ? WHERE slug = ? AND revoked_at IS NULL`).bind(nowIso(), slug).run();
  await db.prepare(`INSERT INTO sx_wellness_links (id, slug, token_hash, created_by, created_at) VALUES (?, ?, ?, ?, ?)`).bind(newId('wl'), slug, await sha256Hex(token), user.fullName, nowIso()).run();
  await sxLog(db, statsActor(user), 'wellness_link', { itemType: 'player', itemId: slug, details: 'New wellness link (the old one stops working)', request });
  return { ok: true, token };
}
export async function revokeWellnessLink(db, user, slug, { request = null } = {}) {
  await db.prepare(`UPDATE sx_wellness_links SET revoked_at = ? WHERE slug = ? AND revoked_at IS NULL`).bind(nowIso(), String(slug)).run();
  await sxLog(db, statsActor(user), 'wellness_link', { itemType: 'player', itemId: slug, details: 'Wellness link switched off', request });
  return { ok: true };
}
export async function wellnessLinkSlug(db, token) {
  await ensureProSchema(db);
  if (!/^[A-Za-z0-9]{20,60}$/.test(String(token || ''))) return null;
  const r = await db.prepare(`SELECT slug FROM sx_wellness_links WHERE token_hash = ? AND revoked_at IS NULL`).bind(await sha256Hex(token)).first();
  return r?.slug || null;
}
const scale = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
/** A player's own entry from their phone link (one per day and session type; sending again updates it). */
export async function submitWellness(db, token, b) {
  const slug = await wellnessLinkSlug(db, token);
  if (!slug) return { error: 'This link is not valid any more. Ask the staff for a new one.', status: 403 };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : new Date(Date.now() + 3600e3).toISOString().slice(0, 10);
  if (Math.abs(Date.parse(`${date}T12:00:00Z`) - Date.now()) > 8 * DAY) return { error: 'Choose a date in the last week.' };
  const type = SESSION_TYPES.includes(b.session) ? b.session : 'training';
  const minutes = b.minutes === '' || b.minutes === undefined ? null : scale(b.minutes, 0, 300), rpe = b.rpe === '' || b.rpe === undefined ? null : scale(b.rpe, 1, 10);
  const w = k => (b[k] === '' || b[k] === undefined ? null : scale(b[k], 1, 5));
  const vals = { sleep: w('sleep'), soreness: w('soreness'), fatigue: w('fatigue'), stress: w('stress'), mood: w('mood') };
  if (rpe === null && Object.values(vals).every(v => v === null)) return { error: 'Fill in the session effort or how you feel.' };
  if (rpe !== null && minutes === null) return { error: 'How many minutes was the session?' };
  await db.prepare(`INSERT INTO sx_wellness (id, slug, entry_date, session_type, minutes, rpe, load, sleep, soreness, fatigue, stress, mood, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (slug, entry_date, session_type) DO UPDATE SET minutes = excluded.minutes, rpe = excluded.rpe, load = excluded.load, sleep = excluded.sleep, soreness = excluded.soreness, fatigue = excluded.fatigue, stress = excluded.stress, mood = excluded.mood, note = excluded.note, created_at = excluded.created_at`)
    .bind(newId('wb'), slug, date, type, minutes, rpe, rpe !== null && minutes !== null ? rpe * minutes : null, vals.sleep, vals.soreness, vals.fatigue, vals.stress, vals.mood, oneLine(b.note, 300) || null, nowIso()).run();
  await db.prepare(`UPDATE sx_wellness_links SET last_used_at = ? WHERE token_hash = ?`).bind(nowIso(), await sha256Hex(token)).run();
  return { ok: true };
}
/** Load: acute = the last 7 days, chronic = the weekly average of the last 28 days. Ratio over 1.5 = a sudden jump. */
export function loadSummary(entries, today = new Date().toISOString().slice(0, 10)) {
  const t = Date.parse(`${today}T00:00:00Z`), age = d => Math.floor((t - Date.parse(`${d}T00:00:00Z`)) / DAY);
  const acute = entries.filter(e => age(e.entry_date) >= 0 && age(e.entry_date) < 7).reduce((s, e) => s + (e.load || 0), 0);
  const chronic = entries.filter(e => age(e.entry_date) >= 0 && age(e.entry_date) < 28).reduce((s, e) => s + (e.load || 0), 0) / 4;
  const ratio = chronic ? r2(acute / chronic) : null;
  const latest = entries.filter(e => e.sleep || e.soreness || e.fatigue || e.stress || e.mood).sort((a, b) => b.entry_date.localeCompare(a.entry_date))[0] || null;
  const wb = latest ? ['sleep', 'soreness', 'fatigue', 'stress', 'mood'].map(k => latest[k]).filter(Boolean) : [];
  const wellness = wb.length ? r1(wb.reduce((s, v) => s + v, 0) / wb.length) : null;
  const flags = [];
  if (ratio !== null && ratio > 1.5) flags.push('Load jumped (over 1.5 × the usual): injury risk');
  if (ratio !== null && ratio < 0.8 && chronic > 0) flags.push('Load dropped well below the usual');
  if (wellness !== null && wellness <= 2.5) flags.push('Feeling poorly in the latest check-in');
  if (latest && latest.soreness !== null && latest.soreness <= 2) flags.push('Very sore');
  return { acute, chronic: Math.round(chronic), ratio, wellness, latestDate: latest?.entry_date || null, flags };
}
export async function wellnessOverview(db) {
  await ensureProSchema(db);
  const since = new Date(Date.now() - 35 * DAY).toISOString().slice(0, 10);
  const rows = (await db.prepare(`SELECT * FROM sx_wellness WHERE entry_date >= ? ORDER BY entry_date`).bind(since).all()).results;
  const links = new Map((await db.prepare(`SELECT slug, created_at, last_used_at FROM sx_wellness_links WHERE revoked_at IS NULL`).all()).results.map(r => [r.slug, r]));
  const by = new Map(); for (const r of rows) (by.get(r.slug) || by.set(r.slug, []).get(r.slug)).push(r);
  const slugs = new Set([...by.keys(), ...links.keys()]);
  return [...slugs].map(slug => ({ slug, link: links.has(slug) ? { made: links.get(slug).created_at, lastUsed: links.get(slug).last_used_at } : null, ...loadSummary(by.get(slug) || []),
    recent: (by.get(slug) || []).slice(-14).map(e => ({ date: e.entry_date, session: e.session_type, minutes: e.minutes, rpe: e.rpe, load: e.load, sleep: e.sleep, soreness: e.soreness, fatigue: e.fatigue, stress: e.stress, mood: e.mood })) }));
}

// ── 7. Player development: targets and a radar against the squad ──
export const TARGET_METRICS = { goals: 'Goals', assists: 'Assists', apps: 'Appearances', starts: 'Starts', minutes: 'Minutes', cleanSheets: 'Clean sheets', shotsOnTarget: 'Shots on target',
  passesComplete: 'Completed passes', progressivePasses: 'Progressive passes', keyPasses: 'Key passes', tackles: 'Tackles', interceptions: 'Interceptions', motm: 'Man of the Match' };
const GROUP = p => (/^GK/i.test(p || '') ? 'GK' : /^(DF|CB|LB|RB|WB|D)/i.test(p || '') ? 'DF' : /^(MF|CM|DM|AM|M)/i.test(p || '') ? 'MF' : 'FW');
const RADAR = { GK: ['saves', 'cleanSheets', 'passesComplete', 'minutes'], DF: ['tackles', 'interceptions', 'passesComplete', 'progressivePasses', 'goals', 'yellowFree'],
  MF: ['passesComplete', 'progressivePasses', 'keyPasses', 'assists', 'tackles', 'shots'], FW: ['goals', 'shots', 'shotsOnTarget', 'assists', 'keyPasses', 'xg'] };
const RADAR_LABEL = { saves: 'Saves', cleanSheets: 'Clean sheets', passesComplete: 'Passes completed', minutes: 'Minutes', tackles: 'Tackles', interceptions: 'Interceptions', progressivePasses: 'Progressive passes', goals: 'Goals', yellowFree: 'Discipline',
  keyPasses: 'Key passes', assists: 'Assists', shots: 'Shots', shotsOnTarget: 'Shots on target', xg: 'xG' };
export async function saveTarget(db, user, b, { request = null } = {}) {
  await ensureProSchema(db);
  if (b.remove) { await db.prepare(`UPDATE sx_player_targets SET is_deleted = 1 WHERE id = ?`).bind(String(b.remove)).run(); await sxLog(db, statsActor(user), 'target_remove', { itemType: 'target', itemId: b.remove, request }); return { ok: true }; }
  if (!/^[a-z0-9-]{2,80}$/.test(String(b.slug || ''))) return { error: 'Choose a player.' };
  if (!TARGET_METRICS[b.metric]) return { error: 'Choose what to measure.' };
  const target = Number(b.target); if (!(target > 0 && target < 10000)) return { error: 'Enter the target number.' };
  if (!/^\d{4}\/\d{2}$/.test(String(b.season || ''))) return { error: 'Choose the season.' };
  const id = newId('tg');
  await db.prepare(`INSERT INTO sx_player_targets (id, slug, season, metric, target, deadline, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, b.slug, b.season, b.metric, target, /^\d{4}-\d{2}-\d{2}$/.test(String(b.deadline || '')) ? b.deadline : null, oneLine(b.note, 200) || null, user.fullName, nowIso()).run();
  await sxLog(db, statsActor(user), 'target_add', { itemType: 'player', itemId: b.slug, details: `${TARGET_METRICS[b.metric]}: ${target}`, request });
  return { ok: true, id };
}
export async function development(db, slug, season, roster) {
  await ensureProSchema(db);
  const snaps = await publishedMatches(db, season);
  const all = playerTotals(snaps);
  const posOf = s => roster.find(p => p.slug === s)?.position || all.find(p => p.slug === s)?.position || '';
  const me = all.find(p => p.slug === slug) || { slug, name: roster.find(p => p.slug === slug)?.name || slug, minutes: 0 };
  const group = GROUP(posOf(slug));
  const value = (p, k) => (k === 'yellowFree' ? -((p.yellow || 0) + 3 * (p.red || 0)) : (p[k] || 0));
  const per90 = (p, k) => (k === 'minutes' || k === 'yellowFree' ? value(p, k) : p.minutes ? (value(p, k) * 90) / p.minutes : 0);
  const peers = all.filter(p => GROUP(posOf(p.slug)) === group && p.minutes >= 180);
  const radar = RADAR[group].map(k => {
    const mine = per90(me, k), vals = peers.map(p => per90(p, k));
    const below = vals.filter(v => v < mine).length, same = vals.filter(v => v === mine).length;
    return { key: k, label: RADAR_LABEL[k], per90: r2(mine), percentile: vals.length ? Math.round(((below + same / 2) / vals.length) * 100) : null, squadAverage: vals.length ? r2(vals.reduce((t, v) => t + v, 0) / vals.length) : null };
  });
  const targets = (await db.prepare(`SELECT * FROM sx_player_targets WHERE slug = ? AND is_deleted = 0 ORDER BY season DESC, created_at`).bind(slug).all()).results.map(t => {
    const p = t.season === season ? me : playerTotals(snaps).find(x => x.slug === slug) || {};
    const now = p[t.metric] || 0;
    return { id: t.id, season: t.season, metric: t.metric, label: TARGET_METRICS[t.metric], target: t.target, deadline: t.deadline, note: t.note, current: now, progress: Math.min(100, Math.round((now / t.target) * 100)), by: t.created_by };
  });
  return { slug, name: me.name, group, peers: peers.length, minutes: me.minutes || 0, totals: me, radar, targets, metrics: TARGET_METRICS };
}

// ── 8. Milestones and records ──
const APPS = [1, 50, 100, 150, 200, 250, 300], GOALS = [1, 10, 25, 50, 75, 100], ASSISTS = [10, 25, 50], CLEAN = [10, 25, 50];
/** Works out milestones across every published match (career), saves new ones, returns the new ones. */
export async function updateMilestones(db) {
  await ensureProSchema(db);
  const snaps = await publishedMatches(db, '');
  const found = [];
  const add = (key, kind, slug, title, detail, s) => found.push({ key, kind, slug, title, detail, matchId: s.id, on: String(s.match.date).slice(0, 10) });
  const run = new Map();
  let win = 0, unbeaten = 0, clean = 0, bestWin = 0, bestUnbeaten = 0, bestClean = 0, bestMargin = 0;
  for (const s of snaps) {
    const lobi = s.match.lobiHome ? 'home' : 'away', opp = lobi === 'home' ? s.match.away : s.match.home;
    const gf = s.match.lobiHome ? s.match.homeScore : s.match.awayScore, ga = s.match.lobiHome ? s.match.awayScore : s.match.homeScore;
    for (const p of s.derived.players.filter(x => x.side === lobi && x.slug)) {
      const t = run.get(p.slug) || { apps: 0, goals: 0, assists: 0, clean: 0, name: p.name };
      const before = { ...t };
      if (p.played) t.apps++;
      t.goals += p.goals; t.assists += p.assists;
      if (ga === 0 && p.played && /^GK/i.test(p.position || '') && p.minutes >= 60) t.clean++;
      run.set(p.slug, t);
      for (const n of APPS) if (before.apps < n && t.apps >= n) add(`apps:${p.slug}:${n}`, 'player', p.slug, n === 1 ? `${p.name}: first appearance` : `${p.name}: ${n} appearances`, `v ${opp}`, s);
      for (const n of GOALS) if (before.goals < n && t.goals >= n) add(`goals:${p.slug}:${n}`, 'player', p.slug, n === 1 ? `${p.name}: first goal` : `${p.name}: ${n} goals`, `v ${opp}`, s);
      for (const n of ASSISTS) if (before.assists < n && t.assists >= n) add(`assists:${p.slug}:${n}`, 'player', p.slug, `${p.name}: ${n} assists`, `v ${opp}`, s);
      for (const n of CLEAN) if (before.clean < n && t.clean >= n) add(`clean:${p.slug}:${n}`, 'player', p.slug, `${p.name}: ${n} clean sheets`, `v ${opp}`, s);
      if (p.goals >= 3) add(`hattrick:${p.slug}:${s.id}`, 'player', p.slug, `${p.name}: hat-trick${p.goals > 3 ? ` (${p.goals} goals)` : ''}`, `v ${opp}`, s);
    }
    win = gf > ga ? win + 1 : 0; unbeaten = gf >= ga ? unbeaten + 1 : 0; clean = ga === 0 ? clean + 1 : 0;
    if (win >= 3 && win > bestWin) add(`record:wins:${win}`, 'record', null, `Club record (recorded matches): ${win} wins in a row`, `v ${opp}`, s);
    if (unbeaten >= 5 && unbeaten > bestUnbeaten) add(`record:unbeaten:${unbeaten}`, 'record', null, `Club record (recorded matches): ${unbeaten} matches unbeaten`, `v ${opp}`, s);
    if (clean >= 3 && clean > bestClean) add(`record:clean:${clean}`, 'record', null, `Club record (recorded matches): ${clean} clean sheets in a row`, `v ${opp}`, s);
    if (gf - ga >= 3 && gf - ga > bestMargin) add(`record:margin:${gf - ga}`, 'record', null, `Biggest win (recorded matches): ${gf}–${ga}`, `v ${opp}`, s);
    bestWin = Math.max(bestWin, win); bestUnbeaten = Math.max(bestUnbeaten, unbeaten); bestClean = Math.max(bestClean, clean); bestMargin = Math.max(bestMargin, gf - ga);
  }
  const have = new Set((await db.prepare(`SELECT key FROM sx_milestones`).all()).results.map(r => r.key));
  const fresh = found.filter(f => !have.has(f.key));
  const at = nowIso();
  for (let i = 0; i < fresh.length; i += 50) await db.batch(fresh.slice(i, i + 50).map(f => db.prepare(`INSERT OR IGNORE INTO sx_milestones (key, kind, slug, title, detail, match_id, achieved_on, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(f.key, f.kind, f.slug, f.title, f.detail, f.matchId, f.on, at)));
  return fresh;
}
export async function milestones(db, { publicOnly = false } = {}) {
  await ensureProSchema(db);
  const rows = (await db.prepare(`SELECT * FROM sx_milestones ORDER BY achieved_on DESC, created_at DESC LIMIT 200`).all()).results;
  const hidden = publicOnly ? await hiddenYouth(db) : new Set();
  return rows.filter(r => !r.slug || !hidden.has(r.slug)).map(r => ({ key: r.key, kind: r.kind, slug: r.slug, title: r.title, detail: r.detail, matchId: r.match_id, on: r.achieved_on }));
}

// ── 9. Public stats hub (published matches only; youth players unnamed unless allowed) ──
export async function publicHub(db, season) {
  await ensureProSchema(db);
  const hidden = await hiddenYouth(db);
  const all = (await publishedMatches(db, '')).map(s => redactSnapshot(s, hidden));
  const seasonSnaps = all.filter(s => s.match.season === season);
  const seasonPlayers = playerTotals(seasonSnaps), career = playerTotals(all), team = teamTotals(all);
  const board = (list, k, n = 10) => list.filter(p => p[k] > 0).sort((a, b) => b[k] - a[k] || a.name.localeCompare(b.name)).slice(0, n).map(p => ({ slug: p.slug, name: p.name, value: p[k], apps: p.apps }));
  let best = null, mostGoals = null, run = { win: 0, unbeaten: 0 }, longest = { win: 0, unbeaten: 0 };
  for (const s of all) {
    const gf = s.match.lobiHome ? s.match.homeScore : s.match.awayScore, ga = s.match.lobiHome ? s.match.awayScore : s.match.homeScore, opp = s.match.lobiHome ? s.match.away : s.match.home;
    if (!best || gf - ga > best.margin) best = { margin: gf - ga, score: `${gf}–${ga}`, opponent: opp, date: s.match.date };
    run.win = gf > ga ? run.win + 1 : 0; run.unbeaten = gf >= ga ? run.unbeaten + 1 : 0;
    longest = { win: Math.max(longest.win, run.win), unbeaten: Math.max(longest.unbeaten, run.unbeaten) };
    const lobi = s.match.lobiHome ? 'home' : 'away';
    for (const p of s.derived.players.filter(x => x.side === lobi && x.slug && x.goals)) if (!mostGoals || p.goals > mostGoals.goals) mostGoals = { slug: p.slug, name: p.name, goals: p.goals, opponent: opp, date: s.match.date };
  }
  const slim = p => ({ slug: p.slug, name: p.name, apps: p.apps, starts: p.starts, minutes: p.minutes, goals: p.goals, assists: p.assists, shots: p.shots, shotsOnTarget: p.shotsOnTarget, cleanSheets: p.cleanSheets, yellow: p.yellow, red: p.red, motm: p.motm });
  return {
    season, generatedAt: nowIso(), matchesRecorded: all.length,
    leaders: { goals: board(seasonPlayers, 'goals'), assists: board(seasonPlayers, 'assists'), apps: board(seasonPlayers, 'apps'), cleanSheets: board(seasonPlayers, 'cleanSheets'), motm: board(seasonPlayers, 'motm') },
    allTime: { goals: board(career, 'goals'), apps: board(career, 'apps'), assists: board(career, 'assists') },
    records: { biggestWin: best && best.margin > 0 ? best : null, mostGoalsInAMatch: mostGoals, longestWinRun: longest.win, longestUnbeatenRun: longest.unbeaten },
    headToHead: team.h2h, players: { season: seasonPlayers.map(slim), career: career.map(slim) },
    milestones: (await milestones(db, { publicOnly: true })).slice(0, 20),
  };
}

// ── 6. Branded match report and opposition pack (HTML made for printing to PDF) ──
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>:root{--blue:#123A7A;--navy:#0B2350;--red:#C8102E;--gold:#FFC72C;--ink:#14213D;--muted:#5B6475;--line:#DDE3EE}*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--ink);background:#EEF1F6}
.sheet{max-width:900px;margin:16px auto;background:#fff;padding:28px 32px;border-radius:10px}header.brand{display:flex;align-items:center;gap:14px;border-bottom:4px solid var(--red);padding-bottom:12px;margin-bottom:16px}
header.brand img{width:56px;height:56px}header.brand h1{margin:0;font-size:22px;color:var(--navy)}header.brand p{margin:2px 0 0;color:var(--muted)}h2{color:var(--navy);font-size:16px;margin:20px 0 8px;border-left:4px solid var(--gold);padding-left:8px}
.score{display:flex;justify-content:center;align-items:center;gap:18px;font-size:22px;font-weight:700;margin:6px 0 4px}.score b{font-size:40px;color:var(--navy)}.sub{text-align:center;color:var(--muted)}
table{width:100%;border-collapse:collapse;margin:6px 0}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left}th{font-size:12px;text-transform:uppercase;color:var(--muted)}td.n,th.n{text-align:right}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.note{background:#F6F8FC;border-radius:8px;padding:10px 12px;white-space:pre-wrap}.muted{color:var(--muted);font-size:12px}svg{width:100%;height:auto;display:block}
.bar{display:grid;grid-template-columns:3em 1fr 3em;align-items:center;gap:8px;margin:4px 0}.bar span{text-align:center}.bar i{display:flex;height:10px;border-radius:5px;overflow:hidden;background:#E6EAF2}.bar i b{display:block;background:var(--blue)}.bar i b+b{background:var(--red)}
.actions{max-width:900px;margin:12px auto 0;display:flex;gap:8px;justify-content:flex-end}.actions button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer}
@media (max-width:640px){.sheet{padding:18px 16px;margin:8px}.grid{grid-template-columns:1fr}}@media print{body{background:#fff}.sheet{margin:0;max-width:none;border-radius:0;padding:0}.actions{display:none}h2{break-after:avoid}table,svg{break-inside:avoid}}
@page{size:A4;margin:14mm}</style></head><body><div class="actions"><button onclick="window.print()">Save as PDF / print</button></div><div class="sheet">${body}<p class="muted" style="margin-top:20px">Lobi Stars FC Statistics Center · made ${esc(new Date().toISOString().slice(0, 10))} · staff only</p></div></body></html>`;
const brand = (title, sub) => `<header class="brand"><img src="/images/lobi-stars-badge.webp" alt="" onerror="this.remove()"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></header>`;
function shotMapSvg(evs, lobi) {
  const W = 105, H = 68, dots = [];
  for (const e of evs.filter(x => (x.type === 'shot' || x.type === 'goal') && x.detail !== 'own_goal' && x.x !== null && x.x !== undefined)) {
    const ours = e.side === lobi, x = ours ? (e.x * W) / 100 : W - (e.x * W) / 100, y = ours ? ((e.y ?? 50) * H) / 100 : H - ((e.y ?? 50) * H) / 100;
    const r = 0.9 + Math.sqrt(e.xg || 0.05) * 3.2;
    dots.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${e.type === 'goal' ? '#FFC72C' : ours ? '#123A7A' : '#C8102E'}" fill-opacity="${e.type === 'goal' ? 1 : 0.7}" stroke="#fff" stroke-width=".3"/>`);
  }
  if (!dots.length) return '<p class="muted">No shot positions recorded.</p>';
  const line = 'fill="none" stroke="#9AA7BD" stroke-width=".35"';
  return `<svg viewBox="-1 -1 ${W + 2} ${H + 2}" role="img" aria-label="Shot map"><rect x="-1" y="-1" width="${W + 2}" height="${H + 2}" fill="#F3F6FA"/><rect x="0" y="0" width="${W}" height="${H}" ${line}/><line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${H}" ${line}/><circle cx="${W / 2}" cy="${H / 2}" r="9.15" ${line}/>
    <rect x="0" y="${H / 2 - 20.16}" width="16.5" height="40.32" ${line}/><rect x="${W - 16.5}" y="${H / 2 - 20.16}" width="16.5" height="40.32" ${line}/>${dots.join('')}</svg><p class="muted">Lobi Stars attack to the right (blue), opponents to the left (red); gold = goal; bigger = higher xG.</p>`;
}
function xgTimelineSvg(evs, lobi, L) {
  const W = 300, H = 90, sx = m => (Math.min(m, L) / L) * W;
  const series = side => { let t = 0; const pts = [[0, 0]]; for (const e of evs.filter(x => x.side === side && (x.type === 'shot' || x.type === 'goal') && x.detail !== 'own_goal').sort((a, b) => a.minute - b.minute)) { pts.push([e.minute, t]); t += e.xg || 0; pts.push([e.minute, t]); } pts.push([L, t]); return { pts, total: t }; };
  const a = series(lobi), b = series(lobi === 'home' ? 'away' : 'home'), max = Math.max(1, a.total, b.total);
  const path = s => s.pts.map(([m, v], i) => `${i ? 'L' : 'M'}${sx(m).toFixed(1)},${(H - (v / max) * (H - 8)).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${W} ${H + 12}" role="img" aria-label="xG over the match"><line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#DDE3EE"/><line x1="${sx(45)}" y1="0" x2="${sx(45)}" y2="${H}" stroke="#DDE3EE" stroke-dasharray="2 2"/>
    <path d="${path(a)}" fill="none" stroke="#123A7A" stroke-width="2"/><path d="${path(b)}" fill="none" stroke="#C8102E" stroke-width="2"/><text x="0" y="${H + 10}" font-size="8" fill="#5B6475">0'</text><text x="${sx(45) - 6}" y="${H + 10}" font-size="8" fill="#5B6475">45'</text><text x="${W - 14}" y="${H + 10}" font-size="8" fill="#5B6475">${L}'</text></svg>
    <p class="muted">Cumulative xG: Lobi Stars ${r2(a.total)} (blue) · opponents ${r2(b.total)} (red).</p>`;
}
export async function matchReportHtml(db, id, { includeNotes = true } = {}) {
  const full = await getMatch(db, id);
  if (!full) return null;
  const m = full.match, d = full.derived, a = matchAdvanced(full), lobi = a.lobiSide, opp = lobi === 'home' ? 'away' : 'home';
  const T = d.team, row = (label, h, w) => `<div class="bar"><span>${esc(h)}</span><div><div class="muted" style="text-align:center">${esc(label)}</div><i><b style="width:${(Number(h) + Number(w)) ? (Number(h) / (Number(h) + Number(w))) * 100 : 50}%"></b><b style="flex:1"></b></i></div><span>${esc(w)}</span></div>`;
  const players = d.players.filter(p => p.side === lobi && p.played).sort((x, y) => (y.rating || 0) - (x.rating || 0) || y.goals - x.goals || y.assists - x.assists);
  const goals = full.events.filter(e => e.type === 'goal').map(e => `${e.minute}'${e.stoppage ? `+${e.stoppage}` : ''} ${esc(e.name || '')}${e.detail === 'own_goal' ? ' (own goal)' : e.detail === 'penalty' ? ' (pen)' : ''} · ${esc(e.side === 'home' ? m.home : m.away)}`).join('<br>');
  const body = `${brand('Match report', `${m.competition}${m.matchday ? ` · Matchday ${m.matchday}` : ''} · ${String(m.date).slice(0, 10)}${m.venue ? ` · ${m.venue}` : ''}`)}
    <div class="score"><span>${esc(m.home)}</span><b>${m.homeScore}–${m.awayScore}</b><span>${esc(m.away)}</span></div><p class="sub">${m.htHome !== null && m.htHome !== undefined ? `Half-time ${m.htHome}–${m.htAway}` : ''}${m.attendance ? ` · Attendance ${m.attendance}` : ''}${m.referee ? ` · Referee ${esc(m.referee)}` : ''}</p>
    ${goals ? `<p class="sub">${goals}</p>` : ''}
    <h2>Match numbers</h2>${row('xG', r2(T.home.xg), r2(T.away.xg))}${row('Shots', T.home.shots, T.away.shots)}${row('On target', T.home.shotsOnTarget, T.away.shotsOnTarget)}${row('Corners', T.home.corners, T.away.corners)}${row('Fouls', T.home.fouls, T.away.fouls)}${row('Yellow cards', T.home.yellow, T.away.yellow)}${T.home.passes + T.away.passes ? row('Passes', T.home.passes, T.away.passes) + row('Pass completion %', pct(T.home.passesComplete, T.home.passes) ?? 0, pct(T.away.passesComplete, T.away.passes) ?? 0) : ''}
    <p class="muted">Left: ${esc(m.home)} · right: ${esc(m.away)}${m.possessionHome !== null && m.possessionHome !== undefined ? ` · possession ${m.possessionHome}%–${100 - m.possessionHome}%` : ''}</p>
    <div class="grid"><div><h2>Shot map</h2>${shotMapSvg(full.events, lobi)}</div><div><h2>xG over the match</h2>${xgTimelineSvg(full.events, lobi, m.length || 90)}
      <h2>Expected result</h2><p>From the chances: win ${Math.round(a.expected.win * 100)}%, draw ${Math.round(a.expected.draw * 100)}%, loss ${Math.round(a.expected.loss * 100)}% · expected points <b>${a.expected.xPts}</b> (got ${a.expected.actualPoints}).</p>
      ${a.fieldTilt ? `<p>Field tilt: <b>${a.fieldTilt.lobi}%</b> of play in the attacking thirds was ours.</p>` : ''}${a.ppda ? `<p>Pressing (PPDA): <b>${a.ppda.value}</b>${a.ppda.approximate ? ' (approximate)' : ''}.</p>` : ''}</div></div>
    <h2>Lobi Stars players</h2><table><thead><tr><th>Player</th><th class="n">Min</th><th class="n">G</th><th class="n">A</th><th class="n">Shots</th><th class="n">xG</th>${T[lobi].passes ? '<th class="n">Passes</th>' : ''}<th class="n">Rating</th></tr></thead><tbody>
    ${players.map(p => `<tr><td>${p.number ? `${p.number}. ` : ''}${esc(p.name)}${p.motm ? ' ★' : ''}</td><td class="n">${p.minutes}</td><td class="n">${p.goals || ''}</td><td class="n">${p.assists || ''}</td><td class="n">${p.shots || ''}</td><td class="n">${p.xg ? r2(p.xg) : ''}</td>${T[lobi].passes ? `<td class="n">${p.passes ? `${p.passesComplete}/${p.passes}` : ''}</td>` : ''}<td class="n">${p.rating ?? ''}</td></tr>`).join('')}</tbody></table>
    ${a.keepers.find(k => k.side === lobi)?.shotsOnTargetFaced ? (k => `<h2>Goalkeeper</h2><p>${esc(k.keepers.join(', ') || 'Goalkeeper')}: ${k.saves} saves from ${k.shotsOnTargetFaced} shots on target · goals prevented <b>${k.goalsPrevented > 0 ? '+' : ''}${k.goalsPrevented}</b></p>`)(a.keepers.find(k => k.side === lobi)) : ''}
    ${includeNotes && m.report ? `<h2>Coach's notes</h2><div class="note">${esc(m.report)}</div>` : ''}
    <p class="muted">Recorded under stat definitions version ${esc(m.definitionsVersion ?? 1)}. ${m.status === 'published' ? `Published ${esc(String(m.publishedAt || '').slice(0, 10))}${m.verifiedBy ? ` · verified by ${esc(m.verifiedBy)}` : ''}` : 'Not published yet.'}</p>`;
  void opp;
  return page(`${m.home} ${m.homeScore}–${m.awayScore} ${m.away}: match report`, body);
}
export async function oppositionPackHtml(db, team, scouting) {
  const r = scouting;
  const body = `${brand('Opposition pack', `${team} · from our recorded matches against them`)}
    <h2>Results against them</h2>${r.results.length ? `<table><thead><tr><th>Date</th><th>Competition</th><th>Venue</th><th class="n">Score</th><th>Result</th></tr></thead><tbody>${r.results.map(x => `<tr><td>${esc(String(x.date).slice(0, 10))}</td><td>${esc(x.competition)}</td><td>${x.home ? 'Home' : 'Away'}</td><td class="n">${esc(x.score)}</td><td>${esc(x.result)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No recorded matches against them yet.</p>'}
    <div class="grid"><div><h2>When goals came (every 15 minutes)</h2><table><thead><tr><th>Minutes</th><th class="n">They scored</th><th class="n">They conceded</th></tr></thead><tbody>${r.periods.map(p => `<tr><td>${esc(p.label)}</td><td class="n">${p.scored}</td><td class="n">${p.conceded}</td></tr>`).join('')}</tbody></table></div>
    <div><h2>Their formations</h2>${r.formations.length ? `<table><tbody>${r.formations.map(f => `<tr><td>${esc(f.formation)}</td><td class="n">${f.matches} match(es)</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not recorded.</p>'}
      <h2>Set pieces they used</h2>${r.routinesFaced.length ? `<table><tbody>${r.routinesFaced.map(x => `<tr><td>${esc(x.routine)}</td><td class="n">${x.n}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not recorded.</p>'}</div></div>
    <h2>Their key players</h2>${r.keyPlayers.length ? `<table><thead><tr><th>Player</th><th class="n">Goals</th><th class="n">Shots</th><th class="n">Cards</th></tr></thead><tbody>${r.keyPlayers.map(p => `<tr><td>${esc(p.name)}</td><td class="n">${p.goals}</td><td class="n">${p.shots}</td><td class="n">${p.cards}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No player data yet.</p>'}
    <h2>What worked for us</h2>${r.ourFormations.length ? `<table><thead><tr><th>Our formation</th><th class="n">Played</th><th class="n">Points per game</th><th class="n">For–against</th></tr></thead><tbody>${r.ourFormations.map(o => `<tr><td>${esc(o.formation)}</td><td class="n">${o.p}</td><td class="n">${o.ppg}</td><td class="n">${o.gf}–${o.ga}</td></tr>`).join('')}</tbody></table>` : ''}
    ${r.bestXi ? `<p>Most successful starting XI against them (${r.bestXi.wins} win(s)): ${esc(r.bestXi.players)}</p>` : ''}
    ${r.notes?.length ? `<h2>Scouting notes</h2>${r.notes.map(n => `<div class="note" style="margin-bottom:8px">${esc(n.note)}<div class="muted">${esc(n.created_by || '')} · ${esc(String(n.created_at || '').slice(0, 10))}</div></div>`).join('')}` : ''}`;
  return page(`Opposition pack: ${team}`, body);
}

// Labels used by the pages
export const PRO_LABELS = { AVAIL, SESSION_TYPES, TARGET_METRICS, EVENT_TYPES };
export async function setYellowBan(db, user, n) {
  const v = Math.round(Number(n)); if (!(v >= 2 && v <= 15)) return { error: 'Choose a number from 2 to 15.' };
  await setSxSetting(db, 'yellow_ban', String(v), user.fullName);
  return { ok: true };
}

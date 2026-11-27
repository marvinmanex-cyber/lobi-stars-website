// Statistics Center › Phase 2 analysis (staff only): maps, player pages and comparison, season analytics, scouting
// reports and the monthly season summary. Everything is worked out from the events, line-ups and BST cells of
// recorded matches (status review or published); nothing here is stored except the monthly report.
import { ensureStatsCentreSchema, sxLog, statsActor, newId, sxSettings } from './statsCentre.js';
import { getMatch, teamKey } from './statsCentreData.js';
import { ensurePhase2Schema, setPieceReport, scoutingNotes, keyMoments } from './statsPhase2.js';

const LABELS = { goal: 'Goal', shot: 'Shot', corner: 'Corner', free_kick: 'Free kick', foul_committed: 'Foul', yellow_card: 'Yellow card', red_card: 'Red card', offside: 'Offside', tackle: 'Tackle', interception: 'Interception', gk_save: 'Save', clearance: 'Clearance', block: 'Block', pass_key: 'Key pass', throw_in: 'Throw-in', aerial_duel: 'Aerial duel' };

/** The recorded matches of a season (review or published), fully loaded, oldest first; optional filters. */
export async function loadMatches(db, { season = '', competition = '', venue = '', opponent = '', includeDrafts = false } = {}) {
  await ensurePhase2Schema(db);
  const where = ['is_deleted = 0', includeDrafts ? '1 = 1' : "status IN ('review', 'published')"], args = [];
  if (season) { where.push('season = ?'); args.push(season); }
  if (competition) { where.push('competition = ?'); args.push(competition); }
  if (venue === 'home') where.push('is_lobi_home = 1'); else if (venue === 'away') where.push('is_lobi_home = 0');
  const { results } = await db.prepare(`SELECT id, home_team, away_team, is_lobi_home FROM sx_matches WHERE ${where.join(' AND ')} ORDER BY match_date ASC LIMIT 80`).bind(...args).all();
  const out = [];
  for (const r of results) {
    if (opponent && teamKey(r.is_lobi_home ? r.away_team : r.home_team) !== teamKey(opponent)) continue;
    const full = await getMatch(db, r.id);
    if (full) out.push(full);
  }
  return out;
}
const sideNames = full => ({ lobi: full.match.lobiHome ? 'home' : 'away', opp: full.match.lobiHome ? 'away' : 'home' });
const oppName = full => (full.match.lobiHome ? full.match.away : full.match.home);

// ── Maps ──
/** Events with a position, for shot maps, heat maps and event maps. x, y are 0–100 in the acting team's direction. */
export async function mapEvents(db, { season = '', matchId = '', player = '', period = '', types = '', from = 0, to = 130, team = 'lobi' } = {}) {
  const matches = matchId ? [await getMatch(db, matchId)].filter(Boolean) : await loadMatches(db, { season, includeDrafts: false });
  const want = types ? new Set(String(types).split(',')) : null;
  const out = [];
  for (const full of matches) {
    const { lobi } = sideNames(full);
    for (const e of full.events) {
      if (e.x === null || e.x === undefined) continue;
      const isLobi = e.side === lobi;
      if ((team === 'lobi' && !isLobi) || (team === 'opponent' && isLobi)) continue;
      if (want && !want.has(e.type)) continue;
      if (player && e.slug !== player && e.name !== player) continue;
      if (period && e.period !== period) continue;
      if (e.minute < Number(from) || e.minute > Number(to)) continue;
      out.push({ id: e.id, matchId: full.match.id, opponent: oppName(full), date: full.match.date, type: e.type, label: LABELS[e.type] || e.type, outcome: e.outcome, detail: e.detail, body: e.bodyPart,
        x: e.x, y: e.y, xg: e.xg, minute: e.minute, period: e.period, player: e.name || '', slug: e.slug || null, team: isLobi ? 'lobi' : 'opponent', goal: e.type === 'goal' });
    }
  }
  return out;
}

// ── Players ──
const P90 = (v, min) => (min >= 1 ? Math.round((v * 90 / min) * 100) / 100 : 0);
function playerRows(matches, slug) {
  const rows = [];
  for (const full of matches) {
    const p = full.derived.players.find(x => x.slug === slug);
    if (!p || !(p.played || p.goals || p.assists)) continue;
    const l = full.lineups.find(x => x.slug === slug) || {};
    const ev = full.events.filter(e => e.slug === slug);
    rows.push({ matchId: full.match.id, date: full.match.date, opponent: oppName(full), score: `${full.match.homeScore}–${full.match.awayScore}`, started: p.starter, minutes: p.minutes,
      goals: p.goals, assists: p.assists, shots: p.shots, shotsOnTarget: p.shotsOnTarget, xg: p.xg || 0, xa: p.xa || 0, yellow: p.yellow, red: p.red,
      tackles: ev.filter(e => e.type === 'tackle').length, interceptions: ev.filter(e => e.type === 'interception').length, saves: p.saves, keyPasses: p.keyPasses,
      passes: ev.filter(e => e.type === 'pass').length, rating: l.rating ?? null, ratingNote: l.ratingNote || '', position: p.position || l.position || '' });
  }
  return rows;
}
const sum = (rows, k) => Math.round(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 1000) / 1000;
export async function playerProfile(db, slug, season, roster = []) {
  const matches = await loadMatches(db, { season });
  const rows = playerRows(matches, slug);
  const minutes = sum(rows, 'minutes');
  const keys = ['goals', 'assists', 'shots', 'shotsOnTarget', 'xg', 'xa', 'tackles', 'interceptions', 'saves', 'keyPasses', 'yellow', 'red'];
  const totals = Object.fromEntries(keys.map(k => [k, sum(rows, k)]));
  const rated = rows.filter(r => r.rating !== null);
  const rolling = rows.map((r, i) => { const last = rows.slice(Math.max(0, i - 4), i + 1).filter(x => x.rating !== null); return last.length ? Math.round((last.reduce((a, x) => a + x.rating, 0) / last.length) * 10) / 10 : null; });
  const info = roster.find(p => p.slug === slug) || {};
  return { slug, name: info.name || rows[0]?.name || slug, position: info.position || rows.find(r => r.position)?.position || '', photo: info.photo || null, season,
    apps: rows.length, starts: rows.filter(r => r.started).length, minutes, totals, per90: Object.fromEntries(keys.map(k => [k, P90(totals[k], minutes)])),
    rating: rated.length ? Math.round((rated.reduce((a, r) => a + r.rating, 0) / rated.length) * 10) / 10 : null, rows: rows.map((r, i) => ({ ...r, rolling5: rolling[i] })) };
}
export async function comparePlayers(db, slugs, season, { minMinutes = 90, roster = [] } = {}) {
  const out = [];
  for (const s of slugs.slice(0, 4)) out.push(await playerProfile(db, s, season, roster));
  return { players: out.map(p => ({ slug: p.slug, name: p.name, position: p.position, minutes: p.minutes, apps: p.apps, rating: p.rating, per90: p.per90, totals: p.totals, enough: p.minutes >= minMinutes })), minMinutes };
}

// ── Season analytics ──
export async function seasonAnalytics(db, season, filters = {}) {
  const matches = await loadMatches(db, { season, ...filters });
  const trend = [], periods = Array.from({ length: 6 }, (_, i) => ({ label: `${i * 15 + 1}–${(i + 1) * 15}'`, for: 0, against: 0 }));
  const split = { home: { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }, away: { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 } };
  const formations = {}, state = { leading: { for: 0, against: 0 }, level: { for: 0, against: 0 }, trailing: { for: 0, against: 0 } };
  const scorers = {}, discipline = {}, ratings = {};
  let attacksKnown = false;
  for (const full of matches) {
    const m = full.match, { lobi, opp } = sideNames(full), T = full.derived.team;
    const gf = m.lobiHome ? m.homeScore : m.awayScore, ga = m.lobiHome ? m.awayScore : m.homeScore, r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    let attacks = null;
    try {
      const row = await db.prepare(`SELECT SUM(c.value) AS v FROM sx_bst_cells c JOIN sx_bst_analyses a ON a.id = c.analysis_id WHERE a.match_id = ? AND a.is_deleted = 0 AND c.metric = 'offence_attack' AND c.team_side = 'lobi'`).bind(m.id).first();
      if (row?.v !== null && row?.v !== undefined) { attacks = row.v; attacksKnown = true; }
    } catch { /* no analyses yet */ }
    trend.push({ matchId: m.id, date: m.date, opponent: oppName(full), home: m.lobiHome, result: r, score: `${gf}–${ga}`, goalsFor: gf, goalsAgainst: ga,
      shotsFor: T[lobi].shots, shotsAgainst: T[opp].shots, sotFor: T[lobi].shotsOnTarget, sotAgainst: T[opp].shotsOnTarget, xgFor: T[lobi].xg || 0, xgAgainst: T[opp].xg || 0,
      corners: T[lobi].corners, fouls: T[lobi].fouls, cards: T[lobi].yellow + T[lobi].red, attacks });
    const sp = split[m.lobiHome ? 'home' : 'away']; sp.p++; sp[r === 'W' ? 'w' : r === 'D' ? 'd' : 'l']++; sp.gf += gf; sp.ga += ga;
    const f = (m.lobiHome ? m.formationHome : m.formationAway) || 'not recorded';
    const fr = (formations[f] ||= { formation: f, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }); fr.p++; fr[r === 'W' ? 'w' : r === 'D' ? 'd' : 'l']++; fr.gf += gf; fr.ga += ga;
    for (const e of full.events.filter(x => x.type === 'goal')) {
      const mine = e.side === lobi, i = Math.min(5, Math.floor((Math.min(e.minute, 90) - 1) / 15));
      if (e.period !== 'PEN' && i >= 0) periods[i][mine ? 'for' : 'against']++;
      // the score just before this goal, from Lobi Stars' side
      const before = { h: e.scoreHome - (e.side === 'home' ? 1 : 0), a: e.scoreAway - (e.side === 'away' ? 1 : 0) };
      const lf = m.lobiHome ? before.h : before.a, la = m.lobiHome ? before.a : before.h;
      state[lf > la ? 'leading' : lf < la ? 'trailing' : 'level'][mine ? 'for' : 'against']++;
    }
    for (const p of full.derived.players.filter(x => x.side === lobi && x.slug)) {
      const s = (scorers[p.slug] ||= { slug: p.slug, name: p.name, goals: 0, assists: 0, xg: 0, minutes: 0 }); s.goals += p.goals; s.assists += p.assists; s.xg = Math.round((s.xg + (p.xg || 0)) * 100) / 100; s.minutes += p.minutes;
      if (p.yellow || p.red) { const d = (discipline[p.slug] ||= { name: p.name, yellow: 0, red: 0 }); d.yellow += p.yellow; d.red += p.red; }
    }
    for (const l of full.lineups.filter(x => x.side === lobi && x.slug && x.rating !== null && x.rating !== undefined)) { const rr = (ratings[l.slug] ||= { name: l.name, n: 0, total: 0 }); rr.n++; rr.total += l.rating; }
  }
  // Plain-language trends: the last 5 matches against the 5 before.
  const avg = (rows, k) => (rows.length ? rows.reduce((a, r) => a + r[k], 0) / rows.length : 0);
  const last = trend.slice(-5), prev = trend.slice(-10, -5), notes = [];
  if (prev.length >= 3 && last.length >= 3) {
    const say = (k, label, goodWhenDown = false) => {
      const a = avg(prev, k), b = avg(last, k); if (!a && !b) return;
      const ch = a ? (b - a) / a : 1; if (Math.abs(ch) < 0.15) return;
      const up = ch > 0, good = goodWhenDown ? !up : up;
      notes.push(`${label} has ${up ? 'risen' : 'fallen'} over the last ${last.length} matches (${b.toFixed(k.startsWith('xg') ? 2 : 1)} a match, was ${a.toFixed(k.startsWith('xg') ? 2 : 1)})${good ? ': a good sign' : ': worth a look'}.`);
    };
    say('goalsFor', 'Goals scored'); say('goalsAgainst', 'Goals conceded', true); say('xgFor', 'xG for'); say('xgAgainst', 'xG against', true); say('shotsFor', 'Shots'); say('shotsAgainst', 'Shots conceded', true);
  }
  if (!notes.length) notes.push(trend.length < 6 ? 'Trends appear after 6 recorded matches.' : 'No big changes over the last 5 matches.');
  return {
    season, filters, matches: trend.length, trend, periods, split, formations: Object.values(formations).sort((a, b) => b.p - a.p), state,
    top: { goals: Object.values(scorers).filter(s => s.goals).sort((a, b) => b.goals - a.goals).slice(0, 8), assists: Object.values(scorers).filter(s => s.assists).sort((a, b) => b.assists - a.assists).slice(0, 8),
      xg: Object.values(scorers).filter(s => s.xg).sort((a, b) => b.xg - a.xg).slice(0, 8), ratings: Object.values(ratings).map(r => ({ name: r.name, rating: Math.round((r.total / r.n) * 10) / 10, matches: r.n })).sort((a, b) => b.rating - a.rating).slice(0, 8) },
    discipline: Object.values(discipline).sort((a, b) => b.red - a.red || b.yellow - a.yellow), notes, attacksKnown,
    setPieces: setPieceReport(matches.map(f => ({ match: f.match, events: f.events }))),
  };
}

// ── Opposition scouting ──
export async function opponents(db) {
  await ensureStatsCentreSchema(db);
  const { results } = await db.prepare(`SELECT CASE WHEN is_lobi_home = 1 THEN away_team ELSE home_team END AS opp, COUNT(*) AS n, MAX(match_date) AS last FROM sx_matches WHERE is_deleted = 0 GROUP BY opp ORDER BY last DESC`).all();
  const merged = new Map();
  for (const r of results) { const k = teamKey(r.opp); const m = merged.get(k) || { key: k, name: r.opp, matches: 0, last: r.last }; m.matches += r.n; if (r.last > m.last) m.last = r.last; merged.set(k, m); }
  return [...merged.values()];
}
export async function scoutingReport(db, opponent) {
  const matches = (await loadMatches(db, { includeDrafts: true })).filter(f => teamKey(oppName(f)) === teamKey(opponent));
  const periods = Array.from({ length: 6 }, (_, i) => ({ label: `${i * 15 + 1}–${(i + 1) * 15}'`, scored: 0, conceded: 0 }));
  const forms = {}, ourForms = {}, players = {}, routines = {}, results = [];
  const xis = {};
  for (const full of matches) {
    const m = full.match, { lobi, opp } = sideNames(full);
    const gf = m.lobiHome ? m.homeScore : m.awayScore, ga = m.lobiHome ? m.awayScore : m.homeScore, r = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
    results.push({ matchId: m.id, date: m.date, home: m.lobiHome, competition: m.competition, score: `${m.homeScore}–${m.awayScore}`, result: r, status: m.status });
    for (const e of full.events.filter(x => x.type === 'goal')) { const i = Math.min(5, Math.floor((Math.min(e.minute, 90) - 1) / 15)); if (i >= 0) periods[i][e.side === opp ? 'scored' : 'conceded']++; }
    const of = (m.lobiHome ? m.formationAway : m.formationHome); if (of) forms[of] = (forms[of] || 0) + 1;
    const ours = (m.lobiHome ? m.formationHome : m.formationAway) || 'not recorded';
    const o = (ourForms[ours] ||= { formation: ours, p: 0, pts: 0, gf: 0, ga: 0 }); o.p++; o.pts += r === 'W' ? 3 : r === 'D' ? 1 : 0; o.gf += gf; o.ga += ga;
    for (const e of full.events.filter(x => x.side === opp && x.name)) {
      const k = e.name.toLowerCase(), p = (players[k] ||= { name: e.name, goals: 0, shots: 0, cards: 0, events: 0 });
      p.events++; if (e.type === 'goal' && e.detail !== 'own_goal') p.goals++; if (e.type === 'shot' || e.type === 'goal') p.shots++; if (e.type === 'yellow_card' || e.type === 'red_card') p.cards++;
    }
    for (const e of full.events.filter(x => x.side === opp && ['corner', 'free_kick'].includes(x.type))) routines[e.routine || 'not recorded'] = (routines[e.routine || 'not recorded'] || 0) + 1;
    if (r === 'W') { const xi = full.lineups.filter(l => l.side === lobi && l.starter).map(l => l.name).sort().join(', '); if (xi) xis[xi] = (xis[xi] || 0) + 1; }
  }
  const bestXi = Object.entries(xis).sort((a, b) => b[1] - a[1])[0];
  return {
    opponent, key: teamKey(opponent), played: results.length, results: results.reverse(), periods,
    formations: Object.entries(forms).map(([f, n]) => ({ formation: f, matches: n })).sort((a, b) => b.matches - a.matches),
    keyPlayers: Object.values(players).sort((a, b) => b.goals - a.goals || b.shots - a.shots || b.events - a.events).slice(0, 8),
    routinesFaced: Object.entries(routines).map(([k, n]) => ({ routine: k, n })).sort((a, b) => b.n - a.n),
    ourFormations: Object.values(ourForms).map(o => ({ ...o, ppg: Math.round((o.pts / o.p) * 100) / 100 })).sort((a, b) => b.ppg - a.ppg),
    bestXi: bestXi ? { players: bestXi[0], wins: bestXi[1] } : null,
    notes: await scoutingNotes(db, teamKey(opponent)),
  };
}

// ── The monthly season summary (stored; emailed to the Super Admins when switched on) ──
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function buildMonthlyReport(db, user, season, period, { request = null } = {}) {
  await ensurePhase2Schema(db);
  const a = await seasonAnalytics(db, season);
  const rec = a.trend.reduce((t, r) => { t[r.result]++; t.gf += r.goalsFor; t.ga += r.goalsAgainst; t.xgf += r.xgFor; t.xga += r.xgAgainst; return t; }, { W: 0, D: 0, L: 0, gf: 0, ga: 0, xgf: 0, xga: 0 });
  const month = a.trend.filter(r => String(r.date).slice(0, 7) === period);
  const table = (head, rows) => `<table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>${head.map(h => `<th style="text-align:left;border-bottom:2px solid #1C3F7A;padding:4px">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td style="border-bottom:1px solid #E2E4E9;padding:4px">${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" style="padding:4px;color:#4A505C">None</td></tr>`}</tbody></table>`;
  const html = `<div style="font-family:Arial,sans-serif;color:#16181D;max-width:760px">
    <div style="background:#1C3F7A;border-bottom:4px solid #C8102E;color:#fff;padding:12px 16px"><b style="font-size:18px">Lobi Stars FC · Season summary</b><br>${esc(season)} · up to ${esc(period)}</div>
    <h2 style="color:#1C3F7A">Record</h2><p>${a.matches} recorded matches: ${rec.W} won, ${rec.D} drawn, ${rec.L} lost · goals ${rec.gf}–${rec.ga} · xG ${rec.xgf.toFixed(2)}–${rec.xga.toFixed(2)}</p>
    <h2 style="color:#1C3F7A">This month (${esc(period)})</h2>${table(['Date', 'Opponent', 'Score', 'Shots', 'xG'], month.map(r => [String(r.date).slice(0, 10), `${r.home ? 'v' : 'at'} ${r.opponent}`, r.score, `${r.shotsFor}–${r.shotsAgainst}`, `${r.xgFor.toFixed(2)}–${r.xgAgainst.toFixed(2)}`]))}
    <h2 style="color:#1C3F7A">Trends</h2><ul>${a.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <h2 style="color:#1C3F7A">Top performers</h2>${table(['Goals', '', 'Assists', '', 'xG', ''], Array.from({ length: Math.max(a.top.goals.length, a.top.assists.length, a.top.xg.length, 1) }, (_, i) => [a.top.goals[i]?.name || '', a.top.goals[i]?.goals ?? '', a.top.assists[i]?.name || '', a.top.assists[i]?.assists ?? '', a.top.xg[i]?.name || '', a.top.xg[i]?.xg ?? '']).slice(0, 5))}
    <h2 style="color:#1C3F7A">Goals by 15 minutes</h2>${table(['Period', 'Scored', 'Conceded'], a.periods.map(p => [p.label, p.for, p.against]))}
    <h2 style="color:#1C3F7A">Set pieces</h2><p>${a.setPieces.total} corners and free kicks taken · goals from set pieces ${a.setPieces.goalsFor} for, ${a.setPieces.goalsAgainst} against.</p>
    <h2 style="color:#1C3F7A">Discipline</h2>${table(['Player', 'Yellow', 'Red'], a.discipline.slice(0, 8).map(d => [d.name, d.yellow, d.red]))}
    <p style="color:#4A505C;font-size:12px;border-top:2px solid #1C3F7A;padding-top:8px">Lobi Stars Statistics Center · generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC · staff only</p></div>`;
  const id = newId('rep'), at = new Date().toISOString();
  await db.prepare(`INSERT INTO sx_reports (id, type, period, title, html, generated_by, generated_at) VALUES (?, 'monthly', ?, ?, ?, ?, ?)
    ON CONFLICT (type, period) DO UPDATE SET html = excluded.html, title = excluded.title, generated_by = excluded.generated_by, generated_at = excluded.generated_at`)
    .bind(id, period, `Season summary ${season} · ${period}`, html, user ? user.fullName : 'Automatic', at).run();
  if (user) await sxLog(db, statsActor(user), 'report', { details: `Season summary ${period}`, request });
  return { ok: true, period, html };
}
export async function reportsList(db) {
  await ensurePhase2Schema(db);
  return (await db.prepare(`SELECT id, type, period, title, generated_by, generated_at, emailed_at FROM sx_reports ORDER BY period DESC LIMIT 36`).all()).results;
}
export async function reportHtml(db, id) {
  await ensurePhase2Schema(db);
  return db.prepare(`SELECT title, html FROM sx_reports WHERE id = ?`).bind(String(id)).first();
}
/** Run by the every-minute timer: on the 1st of a month (from 07:00 Lagos time), last month's summary, once; emailed when switched on. */
export async function monthlyReportTick(env, now = Date.now()) {
  const db = env.DB;
  const lagos = new Date(now + 3600e3);
  if (lagos.getUTCDate() !== 1 || lagos.getUTCHours() < 7) return { skipped: true };
  const prev = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth() - 1, 1));
  const period = prev.toISOString().slice(0, 7);
  await ensurePhase2Schema(db);
  if (await db.prepare(`SELECT id FROM sx_reports WHERE type = 'monthly' AND period = ?`).bind(period).first()) return { skipped: true, period };
  const anyMatch = await db.prepare(`SELECT id, season FROM sx_matches WHERE is_deleted = 0 AND status IN ('review', 'published') ORDER BY match_date DESC LIMIT 1`).first();
  if (!anyMatch) return { skipped: true, reason: 'no matches' };
  const r = await buildMonthlyReport(db, null, anyMatch.season, period);
  const s = await sxSettings(db);
  if (s.report_email === '1' && env.RESEND_API_KEY) {
    try {
      const { sendEmail } = await import('./email.js');
      const { superAdminEmails } = await import('./superAdmins.js');
      const to = superAdminEmails(env);
      if (to.length) { await sendEmail(env, { to, subject: `Lobi Stars season summary · ${period}`, html: r.html }); await db.prepare(`UPDATE sx_reports SET emailed_at = ? WHERE type = 'monthly' AND period = ?`).bind(new Date().toISOString(), period).run(); }
    } catch (err) { console.error('[stats report] email', err); }
  }
  return { ok: true, period };
}
export { keyMoments };

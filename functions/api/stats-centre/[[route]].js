// /api/stats-centre/* -- the Lobi Stars Statistics Center (see _lib/statsCentre.js and _lib/statsCentreData.js).
// POST login { loginId, password, code? } (a Super Admin signs in with their email) · POST logout · GET session · POST password { current, password }
// GET dashboard?season= · GET fixtures · GET matches?season=&status=&competition= · POST matches { eventId } | { home, away, date, ... }
// GET match?id= · POST match/setup { id, ...fields } · POST match/lineups { id, home: [], away: [] } · POST match/events { id, ops: [] }
// POST match/clock { id, action, at } · POST match/status { id, status } · POST match/publish { id } · POST match/reopen { id } · POST match/remove { id }
// GET players?season= (or season=career) · GET team?season= · GET activity?item=
// GET export/events.csv?season=|matchId= · GET export/matches.csv?season= · GET settings · POST settings { competitions }
// BST Analysis Form: GET bst · POST bst { matchId } · GET bst/one?id= · POST bst/cell { id, metric, side, period, block, delta|value }
// POST bst/text { id, field, value, baseText } · POST bst/stoppage { id, period, count } · POST bst/final { id } · POST bst/reopen { id } (Super Admins)
// POST bst/presence { id } · GET export/bst.xlsx?id=&opponent=1 · GET export/bst.csv?id=
// Every change needs the session's CSRF token; a temporary password must be changed before anything else.
import { signIn, getStatsSession, signOut, changePassword, csrfProblem, clearStatsCookie, json, IDLE_MS, setSxSetting, activityList, oneLine, sxLog, statsActor } from '../_lib/statsCentre.js';
import {
  loadRoster, siteSettings, startMonthOf, listFixtures, listMatches, seasons, createMatch, getMatch, saveSetup, saveLineups, applyEvents, setClock, setStatus,
  publish, reopen, removeMatch, mediaLineup, opponentPlayers, lastOpponentLineup, recycleBin, restoreItem, removeAnalysis, seasonExport, dashboard, publishedMatches, playerTotals, teamTotals, eventsCsv, matchesCsv, settingsView,
  EVENT_TYPES, LIVE_BUTTONS, PERIODS, OUTCOMES, BODY_PARTS, DETAIL_TYPES, STATUSES,
} from '../_lib/statsCentreData.js';
import { seasonOf } from '../_lib/stats.js';
import { newFinalsFor, markFinalsSeen } from '../_lib/statsBst.js';
import { listAnalyses, createAnalysis, getAnalysis, setCell, setText, setStoppage, finalise, reopenAnalysis, heartbeat, bstSheets, METRICS, BST_FORMATIONS, createShare, listShares, revokeShare, TAGGABLE } from '../_lib/statsBst.js';
import { sendEmail } from '../_lib/email.js';
import { xgParams, saveXgParams, recalcXg, XG_DEFAULTS, ROUTINES, SP_OUTCOMES, saveRatings, addScoutingNote, removeScoutingNote, themes, saveTheme, addTag, removeTag, themeReport, ensurePhase2Schema } from '../_lib/statsPhase2.js';
import { mapEvents, playerProfile, comparePlayers, seasonAnalytics, opponents, scoutingReport, buildMonthlyReport, reportsList, reportHtml, keyMoments } from '../_lib/statsAnalytics.js';
import { getSheet, applyChanges, confirmSheet, reopenSheet, sheetVersion, heartbeat as lineupHeartbeat, takePen, revisions as lineupRevisions, restoreRevision, migrateMediaLineups } from '../_lib/lineupService.js';
import { matchWeather, makeSheetsKey, stopSheetsKey, sheetsCsv, secondCheck, secondCheckProblem } from '../_lib/statsExtras.js';
import { superAdminEmails } from '../_lib/superAdmins.js';
import { policies, retentionState, savePolicy, setRetentionSwitch, previewPolicy, runRetention, retentionRuns, seasonsList, archiveSeason, unarchiveSeason, verifyArchive, noteOffsite, readFile, privacyList, setPrivacy, anonymisePlayer, CLASSIFICATION, isSeasonArchived } from '../_lib/statsRetention.js';
import { listBackups } from '../_lib/autoBackup.js';
import { scoutingReport as scoutingFor } from '../_lib/statsAnalytics.js';
import { ensureProSchema, definitions, newDefinitionsVersion, matchAdvanced, seasonAdvanced, availability, setAvailability, setYellowBan, makeWellnessLink, revokeWellnessLink, wellnessOverview,
  development, saveTarget, updateMilestones, milestones, matchReportHtml, oppositionPackHtml, PRO_LABELS } from '../_lib/statsPro.js';

// Coach accounts view everything and change nothing (only these are allowed for them).
const COACH_POSTS = new Set(['POST logout', 'POST password', 'POST lineup/heartbeat', 'POST bst/presence', 'POST bst/seen']);
const htmlPage = body => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Frame-Options': 'SAMEORIGIN' } });

// Changes refused while the match's season is archived (read only; a Super Admin can still correct it).
const MATCH_WRITES = new Set(['POST match/setup', 'POST match/lineups', 'POST match/events', 'POST match/clock', 'POST match/status', 'POST match/publish', 'POST match/reopen', 'POST match/remove', 'POST lineup/changes', 'POST lineup/confirm', 'POST lineup/reopen', 'POST lineup/restore', 'POST ratings']);
const BST_WRITES = new Set(['POST bst/cell', 'POST bst/text', 'POST bst/stoppage', 'POST bst/final', 'POST bst/reopen']);
import { buildXlsx, buildCsv } from '../_lib/xlsx.js';

const PASSWORD_ONLY = new Set(['GET session', 'POST password', 'POST logout']);

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
  const db = env.DB;
  try {
    if (route === 'login' && method === 'POST') {
      const b = await request.json().catch(() => ({}));
      const r = await signIn(env, request, b);
      if (r.error) return json({ error: r.error, needCode: !!r.needCode }, r.status || 400);
      return json({ ok: true }, 200, { 'Set-Cookie': r.cookie });
    }
    if (route === 'sheet.csv' && method === 'GET') {
      const q0 = new URL(request.url).searchParams;
      const body = await sheetsCsv(db, q0.get('key'), oneLine(q0.get('season') || '', 12) || (await siteSettings(env, request.url)).currentSeason || '');
      if (body === null) return json({ error: 'This link is not valid (a new one was made, or it was switched off).' }, 403);
      return new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    }
    const s = await getStatsSession(request, env, { touch: !(method === 'GET' && route === 'session') });
    if (!s) return json({ error: 'Please sign in to the Statistics Center again.', signedOut: true }, 401, { 'Set-Cookie': clearStatsCookie() });
    if (method !== 'GET' && method !== 'HEAD') {
      const bad = csrfProblem(request, s);
      if (bad) return json({ error: bad }, 403);
    }
    const key = `${method} ${route}`;
    if (s.user.mustChange && !PASSWORD_ONLY.has(key)) return json({ error: 'Please choose your own password first.', mustChange: true }, 403);
    if (s.user.readOnly && method === 'POST' && !COACH_POSTS.has(key)) return json({ error: 'Coach accounts can view everything but cannot change anything.', readOnly: true }, 403);
    const b = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const q = new URL(request.url).searchParams;
    const site = await siteSettings(env, request.url);
    const startMonth = startMonthOf(site);
    const current = site.currentSeason || seasonOf(new Date().toISOString(), startMonth);
    const season = q.has('season') ? oneLine(q.get('season'), 12) : current;
    const opts = { startMonth, request };
    const out = r => (r.error ? json(r, 400) : json(r));
    if (!s.user.admin && (MATCH_WRITES.has(key) || BST_WRITES.has(key)) && b.id) {
      const row = MATCH_WRITES.has(key) ? await db.prepare(`SELECT season FROM sx_matches WHERE id = ?`).bind(String(b.id)).first()
        : await db.prepare(`SELECT m.season FROM sx_bst_analyses a JOIN sx_matches m ON m.id = a.match_id WHERE a.id = ?`).bind(String(b.id)).first().catch(() => null);
      if (row && await isSeasonArchived(db, row.season)) return json({ error: `The ${row.season} season is archived (read only). Ask a Super Admin if something must be corrected.`, archived: true }, 423);
    }
    const csv = (body, name) => new Response(body, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

    switch (key) {
      case 'GET session': return json({
        user: s.user, csrf: s.csrf, idleMinutes: IDLE_MS / 60e3, season: current, seasons: await seasons(db, current),
        eventTypes: EVENT_TYPES, liveButtons: LIVE_BUTTONS, periods: PERIODS, outcomes: OUTCOMES, bodyParts: BODY_PARTS, detailTypes: DETAIL_TYPES, statuses: STATUSES,
        roster: s.user.mustChange ? [] : await loadRoster(env, request.url), settings: await settingsView(db), routines: ROUTINES, spOutcomes: SP_OUTCOMES, pro: { avail: PRO_LABELS.AVAIL, sessions: PRO_LABELS.SESSION_TYPES, targets: PRO_LABELS.TARGET_METRICS },
      });
      case 'POST logout': await signOut(env, request, s); return json({ ok: true }, 200, { 'Set-Cookie': clearStatsCookie() });
      case 'POST password': return out(await changePassword(env, request, s, b));

      case 'GET dashboard': return json(await dashboard(db, season));
      case 'GET fixtures': return json({ fixtures: await listFixtures(db) });
      case 'GET matches': return json({ matches: await listMatches(db, { season: q.get('season') || '', status: q.get('status') || '', competition: q.get('competition') || '' }) });
      case 'POST matches': { const r = await createMatch(db, s.user, b, opts); return r.error ? json(r, r.id ? 409 : 400) : json(r); }
      case 'GET match': { const m = await getMatch(db, q.get('id')); return m ? json(m) : json({ error: 'Match not found.' }, 404); }
      case 'GET opponent/players': return json({ players: await opponentPlayers(db, oneLine(q.get('team') || '', 80)) });
      case 'GET opponent/last-lineup': return json({ lineup: await lastOpponentLineup(db, q.get('id')) });
      case 'GET recycle': return json({ items: await recycleBin(db) });
      case 'POST recycle/restore': return out(await restoreItem(db, s.user, b, opts));
      case 'POST bst/remove': return out(await removeAnalysis(db, s.user, b.id, opts));
      case 'GET bst/shares': return json({ shares: await listShares(db, q.get('id')) });
      case 'POST bst/share': { const r = await createShare(db, s.user, b.id, b, opts); return r.error ? json(r, 400) : json({ ...r, url: `${new URL(request.url).origin}/staff/statistics-center/share/${r.token}/` }); }
      case 'POST bst/share-revoke': return out(await revokeShare(db, s.user, b.shareId, opts));
      case 'GET taggable': return json({ types: [...TAGGABLE] });
      case 'GET export/season.json': {
        await sxLog(db, statsActor(s.user), 'export', { details: `Season export (JSON) ${season}`, request });
        return new Response(JSON.stringify(await seasonExport(db, season, { includeNotes: q.get('notes') === '1' }), null, 1), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="lobi-stars-statistics-${season.replace(/[^\w-]/g, '-')}.json"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      }
      case 'GET match/weather': return out(await matchWeather(db, q.get('id')));
      case 'POST match/second-check': return out(await secondCheck(db, s.user, b.id, opts));
      case 'POST settings/sheets': {
        if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can make this link.' }, 403);
        if (b.stop) return out(await stopSheetsKey(db, s.user, opts));
        const r = await makeSheetsKey(db, s.user, opts);
        const url = `${new URL(request.url).origin}/api/stats-centre/sheet.csv?key=${r.key}`;
        return json({ ok: true, url, formula: `=IMPORTDATA("${url}")` });
      }
      // ── Phase 2 ──
      case 'GET maps': return json({ events: await mapEvents(db, { season: q.get('season') || '', matchId: q.get('matchId') || '', player: q.get('player') || '', period: q.get('period') || '', types: q.get('types') || '', from: q.get('from') || 0, to: q.get('to') || 130, team: q.get('team') || 'lobi' }) });
      case 'GET player': return json(await playerProfile(db, oneLine(q.get('slug') || '', 80), season, await loadRoster(env, request.url)));
      case 'GET compare': return json(await comparePlayers(db, String(q.get('slugs') || '').split(',').map(x => oneLine(x, 80)).filter(Boolean), season, { minMinutes: Math.max(0, Math.min(900, Number(q.get('min')) || 90)), roster: await loadRoster(env, request.url) }));
      case 'GET analytics': return json(await seasonAnalytics(db, season, { competition: q.get('competition') || '', venue: q.get('venue') || '', opponent: q.get('opponent') || '' }));
      case 'GET opponents': return json({ opponents: await opponents(db) });
      case 'GET scouting': return json(await scoutingReport(db, oneLine(q.get('team') || '', 80)));
      case 'POST scouting/note': return out(await addScoutingNote(db, s.user, b, opts));
      case 'POST scouting/note-remove': return out(await removeScoutingNote(db, s.user, b.id, opts));
      case 'GET themes': return json({ themes: await themes(db) });
      case 'POST themes': return out(await saveTheme(db, s.user, b, opts));
      case 'POST tags': return out(await addTag(db, s.user, b, opts));
      case 'POST tags/remove': return out(await removeTag(db, s.user, b.id, opts));
      case 'GET theme-report': return json(await themeReport(db, q.get('id')));
      case 'GET match/tags': { await ensurePhase2Schema(db); return json({ tags: (await db.prepare(`SELECT g.id, g.theme_id, g.event_id, g.note, t.name FROM sx_training_tags g JOIN sx_training_themes t ON t.id = g.theme_id WHERE g.match_id = ? AND g.is_deleted = 0`).bind(q.get('id')).all()).results }); }
      case 'GET reports': return json({ reports: await reportsList(db) });
      case 'POST reports/generate': {
        if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can make a report.' }, 403);
        const period = /^\d{4}-\d{2}$/.test(b.period || '') ? b.period : new Date(Date.now() + 3600e3).toISOString().slice(0, 7);
        return out(await buildMonthlyReport(db, s.user, season, period, opts));
      }
      case 'GET report': { const r = await reportHtml(db, q.get('id')); return r ? json(r) : json({ error: 'Report not found.' }, 404); }
      case 'GET xg': return json({ params: await xgParams(db), defaults: XG_DEFAULTS });
      case 'POST xg': { if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can change the model.' }, 403); return out(await saveXgParams(db, s.user, b, opts)); }
      case 'POST xg/recalc': { if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can recalculate.' }, 403); return out(await recalcXg(db, s.user, { matchId: b.matchId || '', season: b.matchId ? '' : (b.season || season) }, opts)); }
      case 'POST ratings': return out(await saveRatings(db, s.user, b.id, b.rows, opts));
      case 'GET match/key-moments': { const full = await getMatch(db, q.get('id')); return full ? json({ moments: keyMoments(full), video: !!full.match.videoUrl }) : json({ error: 'Match not found.' }, 404); }
      // ── The shared line-up (one owner: lineupService.js) ──
      case 'GET lineup': case 'POST lineup/changes': case 'POST lineup/confirm': case 'POST lineup/reopen': case 'GET lineup/version': case 'POST lineup/heartbeat': case 'POST lineup/pen': case 'GET lineup/revisions': case 'POST lineup/restore': {
        const roster = await loadRoster(env, request.url);
        await migrateMediaLineups(db, roster);
        const mid = String(b.id || q.get('id') || ''), side = (b.side || q.get('side')) === 'away' ? 'away' : 'home';
        const actor = { kind: s.user.admin ? 'admin' : 'stats', id: s.user.id, fullName: s.user.fullName, loginId: s.user.loginId };
        const send = r => (r.conflict || r.status === 409 ? json(r, 409) : r.status === 423 ? json(r, 423) : r.error ? json(r, 400) : json(r));
        if (key === 'GET lineup') return json(await getSheet(db, mid, side, actor));
        if (key === 'GET lineup/version') return json(await sheetVersion(db, mid, side));
        if (key === 'GET lineup/revisions') return json({ revisions: await lineupRevisions(db, mid, side) });
        if (key === 'POST lineup/changes') return send(await applyChanges(db, actor, mid, side, b.baseVersion, b.changes, roster, { reason: oneLine(b.reason || '', 200), request }));
        if (key === 'POST lineup/confirm') return send(await confirmSheet(db, actor, mid, side, opts));
        if (key === 'POST lineup/reopen') return send(await reopenSheet(db, actor, mid, side, opts));
        if (key === 'POST lineup/heartbeat') return json(await lineupHeartbeat(db, actor, mid, side, b.page || 'match-setup'));
        if (key === 'POST lineup/pen') return send(await takePen(db, actor, mid, side, { release: !!b.release, override: !!b.override }));
        return send(await restoreRevision(db, actor, mid, side, b.revisionId, roster, { reason: oneLine(b.reason || '', 200), request }));
      }
      case 'GET match/media-lineup': return json({ lineup: await mediaLineup(db, q.get('id')) });
      case 'POST match/setup': return out(await saveSetup(db, s.user, b.id, b, opts));
      case 'POST match/lineups': return out(await saveLineups(db, s.user, b.id, b, await loadRoster(env, request.url), opts));
      case 'POST match/events': {
        const r = await applyEvents(db, s.user, b.id, b.ops, await loadRoster(env, request.url), opts);
        if (r.error) return json(r, 400);
        const m = await getMatch(db, b.id);
        return json({ ...r, match: m.match, events: m.events, derived: m.derived });
      }
      case 'POST match/clock': return out(await setClock(db, s.user, b.id, b, opts));
      case 'POST match/status': return out(await setStatus(db, s.user, b.id, b.status, opts));
      case 'POST match/publish': {
        const sc = await secondCheckProblem(db, s.user, b.id); if (sc) return json({ error: sc }, 400);
        const r = await publish(db, s.user, b.id, opts);
        if (r.error) return json(r, r.check ? 422 : 400);
        let fresh = []; try { fresh = await updateMilestones(db); } catch (err) { console.error('[stats-centre] milestones', err); }
        return json({ ...r, milestones: fresh });
      }
      case 'POST match/reopen': return out(await reopen(db, s.user, b.id, opts));
      case 'POST match/remove': return out(await removeMatch(db, s.user, b.id, opts));

      case 'GET players': {
        const snaps = await publishedMatches(db, season === 'career' ? '' : season);
        return json({ season, players: playerTotals(snaps) });
      }
      case 'GET team': return json({ season, team: teamTotals(await publishedMatches(db, season)) });
      case 'GET activity': return json({ activity: await activityList(db, { item: oneLine(q.get('item') || '', 60), limit: 300 }) });

      case 'GET export/events.csv': {
        const matchId = oneLine(q.get('matchId') || '', 60);
        await sxLog(db, statsActor(s.user), 'export', { details: `Events CSV (${matchId || `season ${season}`})`, request });
        return csv(await eventsCsv(db, { ...(matchId ? { matchId } : { season }), includeNotes: q.get('notes') === '1' }), `lobi-stars-events-${(matchId || season).replace(/[^\w-]/g, '-')}.csv`);
      }
      case 'GET export/matches.csv': {
        await sxLog(db, statsActor(s.user), 'export', { details: `Matches CSV (season ${season})`, request });
        return csv(await matchesCsv(db, { season }), `lobi-stars-matches-${season.replace(/[^\w-]/g, '-')}.csv`);
      }
      case 'GET bst': return json({ ...(await listAnalyses(db)), metrics: METRICS, formations: BST_FORMATIONS });
      case 'POST bst': { const r = await createAnalysis(db, s.user, b.matchId, opts); return r.error ? json(r, r.id ? 409 : 400) : json(r); }
      case 'GET bst/one': { const d = await getAnalysis(db, q.get('id'), s.user); return d ? json({ ...d, metrics: METRICS, formations: BST_FORMATIONS }) : json({ error: 'Analysis not found.' }, 404); }
      case 'POST bst/cell': return out(await setCell(db, s.user, b.id, b, opts));
      case 'POST bst/text': { const r = await setText(db, s.user, b.id, b, opts); return r.conflict ? json(r, 409) : out(r); }
      case 'POST bst/stoppage': return out(await setStoppage(db, s.user, b.id, b, opts));
      case 'POST bst/final': {
        const r = await finalise(db, s.user, b.id, opts);
        if (r.error) return json(r, r.checks ? 422 : 400);
        // Tell the Super Admins (email, when the site can send it; the admin Statistics Center page lists it too).
        try {
          const d = await getAnalysis(db, b.id);
          const to = superAdminEmails(env);
          if (d && to.length && env.RESEND_API_KEY) {
            const link = `${new URL(request.url).origin}/staff/statistics-center/bst-analysis/${b.id}/`;
            const title = `${d.match.home} ${d.match.homeScore}–${d.match.awayScore} ${d.match.away}`;
            const e = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
            await sendEmail(env, { to, subject: `Match analysis Final: ${title}`, html: `<p>${e(s.user.fullName)} marked the match analysis <b>${e(title)}</b> as Final.</p><p><a href="${link}">Open it in the Statistics Center</a> (sign in with your Super Admin email).</p>` });
          }
        } catch (err) { console.error('[stats-centre] final email', err); }
        return json(r);
      }
      case 'POST bst/reopen': { const r = await reopenAnalysis(db, s.user, b.id, opts); return r.error ? json(r, 403) : json(r); }
      case 'POST bst/presence': return json(await heartbeat(db, s.user, b.id, b.side));
      case 'GET bst/new-finals': return json(s.user.readOnly ? await newFinalsFor(db, s.user) : { count: 0, ids: [] });
      case 'POST bst/seen': return json(await markFinalsSeen(db, s.user));
      case 'GET export/bst.xlsx': case 'GET export/bst.csv': {
        const d = await getAnalysis(db, q.get('id'));
        if (!d) return json({ error: 'Analysis not found.' }, 404);
        const sheets = bstSheets(d, { includeOpponent: q.get('opponent') === '1' });
        const base = `lobi-stars-analysis-${String(d.match.date).slice(0, 10)}-${(d.match.lobiHome ? d.match.away : d.match.home).toLowerCase().replace(/[^a-z0-9]+/g, '-')}${d.analysis.status === 'final' ? '' : '-DRAFT'}`;
        await sxLog(db, statsActor(s.user), 'export', { itemType: 'bst', itemId: d.analysis.id, details: `Analysis Form ${route.endsWith('xlsx') ? 'Excel' : 'CSV'}`, request });
        if (route.endsWith('csv')) return csv(buildCsv(sheets[0].columns, sheets[0].rows), `${base}.csv`);
        return new Response(buildXlsx(sheets), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${base}.xlsx"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
      }
      case 'GET settings': return json(await settingsView(db));
      case 'POST settings': {
        if (!s.user.canPublish) return json({ error: 'Only a senior statistician or a Super Admin can change the settings.' }, 403);
        if (b.reportEmail !== undefined) { await setSxSetting(db, 'report_email', b.reportEmail ? '1' : '0', s.user.fullName); await sxLog(db, statsActor(s.user), 'settings', { after: { reportEmail: !!b.reportEmail }, request }); return json({ ok: true, ...(await settingsView(db)) }); }
        if (b.secondCheck !== undefined) { await setSxSetting(db, 'second_check', b.secondCheck ? '1' : '0', s.user.fullName); await sxLog(db, statsActor(s.user), 'settings', { after: { secondCheck: !!b.secondCheck }, request }); return json({ ok: true, ...(await settingsView(db)) }); }
        const comps = [...new Set((Array.isArray(b.competitions) ? b.competitions : []).map(c => oneLine(c, 60)).filter(Boolean))].slice(0, 30);
        if (!comps.length) return json({ error: 'Keep at least one competition.' }, 400);
        await setSxSetting(db, 'competitions', JSON.stringify(comps), s.user.fullName);
        await sxLog(db, statsActor(s.user), 'settings', { after: { competitions: comps }, request });
        return json({ ok: true, ...(await settingsView(db)) });
      }
      // ── Data retention, archiving and privacy (Super Admins change; statisticians can look) ──
      case 'GET retention': {
        const backups = await listBackups(env).catch(() => []);
        const last = backups[0] || null;
        return json({ canEdit: !!s.user.admin, policies: await policies(db), state: await retentionState(db), runs: await retentionRuns(db), seasons: await seasonsList(db, startMonth),
          privacy: await privacyList(db), backups: { count: backups.length, last, stale: !last || Date.now() - Date.parse(last.at || last.day) > 36 * 3600e3, storage: !!env.BACKUP_BUCKET } });
      }
      case 'GET retention/preview': return out(await previewPolicy(db, oneLine(q.get('key') || '', 40), q.get('days') ?? undefined));
      case 'GET inventory': return json({ classification: CLASSIFICATION, policies: await policies(db) });
      case 'POST retention/policy': return s.user.admin ? out(await savePolicy(db, s.user, oneLine(b.key || '', 40), b, opts)) : json({ error: 'Only a Super Admin can change retention.' }, 403);
      case 'POST retention/switch': return s.user.admin ? out(await setRetentionSwitch(db, s.user, b, opts)) : json({ error: 'Only a Super Admin can change this.' }, 403);
      case 'POST retention/run': {
        if (!s.user.admin) return json({ error: 'Only a Super Admin can run the clean-up.' }, 403);
        if (String(b.confirm || '').trim().toUpperCase() !== 'RUN') return json({ error: 'Type RUN to confirm.' }, 400);
        return out(await runRetention(db, s.user, { force: true, request }));
      }
      case 'POST season/archive': {
        if (!s.user.admin) return json({ error: 'Only a Super Admin can archive a season.' }, 403);
        if (String(b.confirm || '').trim() !== String(b.season || '')) return json({ error: 'Type the season (for example 2025/26) to confirm.' }, 400);
        return out(await archiveSeason(env, s.user, oneLine(b.season || '', 12), opts));
      }
      case 'POST season/unarchive': return s.user.admin ? out(await unarchiveSeason(db, s.user, oneLine(b.season || '', 12), { reason: b.reason, request })) : json({ error: 'Only a Super Admin can do this.' }, 403);
      case 'POST season/offsite': return out(await noteOffsite(db, s.user, oneLine(b.season || '', 12), opts));
      case 'POST archive/verify': return out(await verifyArchive(env, s.user, b.id, opts));
      case 'GET archive/file': {
        const e = await db.prepare(`SELECT * FROM sx_archive_exports WHERE id = ?`).bind(String(q.get('id') || '')).first();
        if (!e) return json({ error: 'Archive file not found.' }, 404);
        const body = await readFile(env, e.file_path);
        if (body === null) return json({ error: 'The archive file is missing from storage.' }, 404);
        await sxLog(db, statsActor(s.user), 'export', { itemType: 'archive', itemId: e.id, details: `Archive download ${e.file_path}`, request });
        const name = e.file_path.replace(/^archives\//, 'lobi-stars-').replace(/\//g, '-');
        return new Response(body, { headers: { 'Content-Type': e.file_path.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Checksum-SHA256': e.checksum } });
      }
      case 'POST privacy/player': return out(await setPrivacy(db, s.user, oneLine(b.slug || '', 80), b, opts));
      case 'POST privacy/anonymise': {
        if (!s.user.admin) return json({ error: 'Only a Super Admin can anonymise a player.' }, 403);
        if (String(b.confirm || '').trim().toUpperCase() !== 'ANONYMISE') return json({ error: 'Type ANONYMISE to confirm (this cannot be undone).' }, 400);
        return out(await anonymisePlayer(db, s.user, oneLine(b.slug || '', 80), { reason: b.reason, full: !!b.full }, opts));
      }
      // ── Professional add-ons ──
      case 'GET definitions': return json(await definitions(db));
      case 'POST definitions': return out(await newDefinitionsVersion(db, s.user, b, opts));
      case 'GET match/advanced': { const full = await getMatch(db, q.get('id')); return full ? json({ match: full.match, lineups: full.lineups, advanced: matchAdvanced(full), derived: full.derived }) : json({ error: 'Match not found.' }, 404); }
      case 'GET season-advanced': return json(await seasonAdvanced(db, season));
      case 'GET availability': return json(await availability(db, season));
      case 'POST availability': return out(await setAvailability(db, s.user, b, opts));
      case 'POST availability/yellow-ban': return s.user.canPublish ? out(await setYellowBan(db, s.user, b.n)) : json({ error: 'Only a senior statistician or a Super Admin can change this.' }, 403);
      case 'GET wellness': return json({ players: await wellnessOverview(db) });
      case 'POST wellness/link': { const r = await makeWellnessLink(db, s.user, oneLine(b.slug || '', 80), opts); return r.error ? json(r, 400) : json({ ok: true, url: `${new URL(request.url).origin}/staff/statistics-center/wellness/${r.token}/` }); }
      case 'POST wellness/revoke': return out(await revokeWellnessLink(db, s.user, oneLine(b.slug || '', 80), opts));
      case 'GET development': return json(await development(db, oneLine(q.get('slug') || '', 80), season, await loadRoster(env, request.url)));
      case 'POST targets': return out(await saveTarget(db, s.user, b, opts));
      case 'GET milestones': return json({ milestones: await milestones(db) });
      case 'POST milestones/refresh': return json({ ok: true, fresh: await updateMilestones(db), milestones: await milestones(db) });
      case 'GET report/match.html': { const h = await matchReportHtml(db, q.get('id'), { includeNotes: q.get('notes') !== '0' }); if (!h) return json({ error: 'Match not found.' }, 404); await sxLog(db, statsActor(s.user), 'export', { itemType: 'match', itemId: q.get('id'), details: 'Match report (PDF page)', request }); return htmlPage(h); }
      case 'GET report/opposition.html': { const team = oneLine(q.get('team') || '', 80); if (!team) return json({ error: 'Choose a club.' }, 400); await ensureProSchema(db); return htmlPage(await oppositionPackHtml(db, team, await scoutingFor(db, team))); }
      default: return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[stats-centre]', err);
    return json({ error: 'Something went wrong; nothing was saved. Please try again.' }, 500);
  }
}

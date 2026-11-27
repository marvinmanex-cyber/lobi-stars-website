// /api/media-centre/lineup/* -- the Matchday Desk's line-up, kept in the SHARED line-up (lineupService.js) that the
// Statistics Center uses too: the same rules, versions and conflict checks on both pages.
// GET ?eventId=&side= · POST changes { eventId, side, baseVersion, changes, itemId } · POST confirm · POST reopen · GET version
// POST heartbeat · POST pen { release, override } · GET revisions · POST restore { revisionId }
// After a change the Media Centre item (the approval and publishing record) gets a copy of the line-up for its preview;
// publishing reads the shared line-up itself.
import { getSheet, applyChanges, confirmSheet, reopenSheet, sheetVersion, heartbeat, takePen, revisions, restoreRevision, migrateMediaLineups, matchForEvent } from '../../_lib/lineupService.js';
import { getMatchRow, loadRoster } from '../../_lib/statsCentreData.js';
import { json, oneLine } from '../../_lib/mediaCentre.js';

export async function onRequest({ request, env, params, data }) {
  const route = [].concat(params.route || []).join('/'), method = request.method, db = env.DB, key = `${method} ${route}`;
  try {
    const u = data.mc?.user;
    if (!u) return json({ error: 'Please sign in again.' }, 401);
    const actor = { kind: u.admin ? 'admin' : 'media', id: u.id, fullName: u.fullName, loginId: u.loginId };
    const q = new URL(request.url).searchParams, b = method === 'POST' ? await request.json().catch(() => ({})) : {};
    const eventId = String(b.eventId || q.get('eventId') || '');
    if (!eventId) return json({ error: 'Choose the match.' }, 400);
    const roster = await loadRoster(env, request.url);
    await migrateMediaLineups(db, roster);
    const matchId = await matchForEvent(db, actor, eventId);
    const m = await getMatchRow(db, matchId);
    const side = (b.side || q.get('side')) === 'opponent' ? (m.is_lobi_home ? 'away' : 'home') : (b.side || q.get('side')) === 'away' ? 'away' : (b.side || q.get('side')) === 'home' ? 'home' : (m.is_lobi_home ? 'home' : 'away');
    const send = r => (r.conflict || r.status === 409 ? json(r, 409) : r.status === 423 ? json(r, 423) : r.error ? json(r, 400) : json(r));
    const copyToItem = async () => {
      if (!b.itemId) return;
      const sh = await getSheet(db, matchId, side);
      const pick = role => sh.rows.filter(r => r.role === role && r.slug).map(r => ({ slug: r.slug, name: r.name, number: r.number, position: r.position }));
      const it = await db.prepare(`SELECT id, data_json, status FROM mc_items WHERE id = ? AND kind = 'lineup'`).bind(String(b.itemId)).first();
      if (!it || !['draft', 'returned', 'submitted', 'scheduled'].includes(it.status)) return;
      let d = {}; try { d = JSON.parse(it.data_json || '{}'); } catch { /* empty */ }
      await db.prepare(`UPDATE mc_items SET data_json = ?, updated_at = ?, updated_by_name = ? WHERE id = ?`).bind(JSON.stringify({ ...d, eventId, starting: pick('starter'), subs: pick('sub'), formation: sh.formation, source: 'shared line-up' }), new Date().toISOString(), u.fullName, it.id).run();
    };
    switch (key) {
      case 'GET ': return json({ ...(await getSheet(db, matchId, side, actor)), lobiSide: m.is_lobi_home ? 'home' : 'away', home: m.home_team, away: m.away_team });
      case 'GET version': return json(await sheetVersion(db, matchId, side));
      case 'GET revisions': return json({ revisions: await revisions(db, matchId, side) });
      case 'POST changes': { const r = await applyChanges(db, actor, matchId, side, b.baseVersion, b.changes, roster, { reason: oneLine(b.reason || '', 200), request }); if (r.ok) await copyToItem(); return send(r); }
      case 'POST confirm': return send(await confirmSheet(db, actor, matchId, side, { request }));
      case 'POST reopen': return send(await reopenSheet(db, actor, matchId, side, { request }));
      case 'POST heartbeat': return json(await heartbeat(db, actor, matchId, side, 'media-matchday'));
      case 'POST pen': return send(await takePen(db, actor, matchId, side, { release: !!b.release, override: !!b.override }));
      case 'POST restore': { const r = await restoreRevision(db, actor, matchId, side, b.revisionId, roster, { request }); if (r.ok) await copyToItem(); return send(r); }
      default: return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[media lineup]', err);
    return json({ error: 'Something went wrong; nothing was saved. Please try again.' }, 500);
  }
}

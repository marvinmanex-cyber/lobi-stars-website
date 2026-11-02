import { ensureAccreditationSchema, eventById, matchLabel, matchDay } from '../../_lib/mediaAccreditation.js';
import { matchSettings, saveMatchSettings, THEMES, sendApprovalTo } from '../../_lib/accreditationCards.js';
import { json, mcLog, mediaActor } from '../../_lib/mediaCentre.js';
import { isHomeGame } from '../../_lib/matchCentre.js';
import { matchSlug } from '../../_lib/matchSlug.js';

// Media Centre › Accreditation: home matches and their card settings.
// GET                     -- every home match this season (upcoming and played) with counts and status.
// GET ?event=<id>         -- one match's card settings (design, opponent, approving officer...).
// POST { action: 'settings', eventId, ... }  -- save the card settings.
// POST { action: 'send_emails', eventId }    -- email every approved applicant not emailed yet (once each).
export async function onRequestGet({ request, env }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const q = new URL(request.url).searchParams;
  if (q.get('event')) {
    const e = await eventById(db, q.get('event'));
    if (!e) return json({ error: 'Match not found.' }, 404);
    return json({ match: { id: e.id, label: matchLabel(e), day: matchDay(e.event_date), date: e.event_date }, settings: await matchSettings(db, e), themes: THEMES });
  }
  const since = new Date(Date.now() - 200 * 86400e3).toISOString();
  const { results } = await db.prepare(`SELECT * FROM events WHERE active = 1 AND event_date > ? ORDER BY event_date`).bind(since).all();
  const counts = (await db.prepare(`SELECT event_id, status, COUNT(*) AS n, SUM(CASE WHEN status = 'approved' AND email_sent_at IS NULL THEN 1 ELSE 0 END) AS waiting FROM mc_accreditations GROUP BY event_id, status`).all()).results;
  const out = [];
  for (const e of results.filter(isHomeGame)) {
    const ms = await matchSettings(db, e);
    const c = s => counts.filter(x => x.event_id === e.id && x.status === s).reduce((t, x) => t + x.n, 0);
    const waiting = counts.filter(x => x.event_id === e.id).reduce((t, x) => t + (x.waiting || 0), 0);
    const played = Date.parse(e.event_date) < Date.now();
    out.push({ id: e.id, slug: matchSlug(e), date: e.event_date, day: matchDay(e.event_date), opponent: ms.opponent, competition: ms.competition, matchday: ms.matchday,
      colours: ms.colours, theme: THEMES[ms.theme].name, pending: c('pending') + c('info'), approved: c('approved'), waiting,
      status: played ? 'Match played' : ms.accept ? 'Open' : 'Closed', approverSet: !!(ms.approverName && ms.approverSignatureId) });
  }
  return json({ matches: out, themes: THEMES });
}
export async function onRequestPost({ request, env, data }) {
  const db = env.DB;
  await ensureAccreditationSchema(db);
  const b = await request.json().catch(() => ({}));
  const e = await eventById(db, String(b.eventId || ''));
  if (!e || !isHomeGame(e)) return json({ error: 'Choose a Lobi Stars home match.' }, 400);
  if (b.action === 'settings') { const r = await saveMatchSettings(db, data.mc.user, e, b, request); return json({ ...r, settings: await matchSettings(db, e) }); }
  if (b.action === 'send_emails') {
    const ms = await matchSettings(db, e);
    if (!ms.approverName || !ms.approverSignatureId) return json({ error: 'Add the approving officer and signature in Match settings first.' }, 400);
    const { results } = await db.prepare(`SELECT * FROM mc_accreditations WHERE event_id = ? AND status = 'approved' AND email_sent_at IS NULL ORDER BY seq`).bind(e.id).all();
    let sent = 0, failed = 0;
    for (const r of results) {
      // Claim it first so two clicks at once never email the same person twice.
      const claim = await db.prepare(`UPDATE mc_accreditations SET email_sent_at = 'sending' WHERE id = ? AND email_sent_at IS NULL`).bind(r.id).run();
      if (!claim.meta?.changes) continue;
      let ok = false;
      try { ok = await sendApprovalTo(env, r, e, ms); } catch (err) { console.error('[accreditation] approval email', err); }
      if (ok) sent++; else { failed++; await db.prepare(`UPDATE mc_accreditations SET email_sent_at = NULL WHERE id = ?`).bind(r.id).run(); }
    }
    await mcLog(db, mediaActor(data.mc.user), 'approval_emails', { section: 'accreditation', itemType: 'match', itemId: e.id, itemTitle: `Lobi Stars FC vs ${ms.opponent}`, details: `${sent} sent${failed ? `, ${failed} failed` : ''}`, request });
    return json({ ok: true, sent, failed });
  }
  return json({ error: 'Unknown action.' }, 400);
}

// POST /internal/ticketing/callback -- the ticketing engine tells this site about an order
// (docs/INTEGRATION_CONTRACT.md C4): order.paid | order.failed | order.expired |
// order.refunded | ticket.voided | ticket.reissued.
// Checked: signature (two secrets during a rotation), timestamp (300 s), nonce (10 min),
// size (256 KB), rate (per address). event_id is the idempotency key: a repeat answers 200
// without doing anything again. Replies 200 once stored; 5xx only when it must be retried.
// The ticket email is sent after the reply (waitUntil).
import { verifySigned } from '../../api/_lib/ticketing/engineClient.js';
import { ensureEngineSchema, nonceSeen, logTicketing } from '../../api/_lib/ticketing/engineStore.js';
import { applyEngineOrder } from '../../api/_lib/ticketing/engineOrders.js';
import { rateLimit, clientIp, ensureFanSchema } from '../../api/_lib/fans.js';

const PATH = '/internal/ticketing/callback';
const MAX_BYTES = 256 * 1024;
const TYPES = ['order.paid', 'order.failed', 'order.expired', 'order.refunded', 'ticket.voided', 'ticket.reissued'];
const err = (status, code, message) => Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function onRequestPost({ request, env, waitUntil }) {
  const db = env.DB;
  try {
    await ensureEngineSchema(db);
    await ensureFanSchema(db);
    if (!(await rateLimit(db, `ticketing-callback:${clientIp(request)}`, 600, 60))) return err(429, 'rate_limited', 'Too many requests.');
    const len = Number(request.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return err(413, 'too_large', 'Request too large.');
    const raw = await request.text();
    if (raw.length > MAX_BYTES) return err(413, 'too_large', 'Request too large.');
    const url = new URL(request.url);
    const v = await verifySigned({
      secrets: [env.TICKETING_CALLBACK_SECRET, env.TICKETING_CALLBACK_SECRET_PREVIOUS],
      expectedKey: env.TICKETING_CALLBACK_KEY || null,
      method: 'POST', pathWithQuery: url.pathname + url.search, rawBody: raw, headers: request.headers,
      nonceSeen: n => nonceSeen(db, n),
    });
    if (!v.ok) {
      await logTicketing(env, 'error', 'callback_signature_failed', { why: v.why || v.code, ip: clientIp(request).replace(/\.\d+$/, '.x') });
      return v.code === 'not_configured' ? err(503, 'not_configured', 'Not available.') : err(401, 'invalid_signature', 'Invalid signature.');
    }
    let body;
    try { body = JSON.parse(raw); } catch { return err(400, 'invalid_json', 'Invalid JSON.'); }
    const eventId = String(body?.event_id || '').slice(0, 100);
    if (!eventId || !TYPES.includes(body.type) || !body.order) return err(400, 'invalid_request', 'Missing event_id, type or order.');

    // Idempotency: a callback already handled is not handled again.
    const ins = await db.prepare(`INSERT OR IGNORE INTO ticketing_callbacks (event_id, type, order_ref, received_at) VALUES (?, ?, ?, ?)`)
      .bind(eventId, body.type, String(body.order.client_reference || body.order.order_id || '').slice(0, 80), new Date().toISOString()).run();
    if (!ins.meta.changes) {
      const prev = await db.prepare(`SELECT processed_at FROM ticketing_callbacks WHERE event_id = ?`).bind(eventId).first();
      if (prev?.processed_at) return Response.json({ ok: true, duplicate: true });
      // Received before but not finished (an error last time): handled again below.
    }
    const r = await applyEngineOrder(env, body.order, Array.isArray(body.tickets) ? body.tickets : (body.order.tickets || []), { waitUntil });
    await db.prepare(`UPDATE ticketing_callbacks SET processed_at = ?, result = ? WHERE event_id = ?`).bind(new Date().toISOString(), r.unmatched ? 'unmatched' : 'ok', eventId).run();
    return Response.json({ ok: true, ...(r.unmatched ? { unmatched: true } : {}) });
  } catch (e) {
    await logTicketing(env, 'error', 'callback_failed', { message: String(e?.message || e).slice(0, 160) });
    return err(500, 'server_error', 'Please retry.'); // the engine retries with backoff
  }
}


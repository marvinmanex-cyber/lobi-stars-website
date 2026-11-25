// A stand-in for the ticketing engine (Partner API) for tests: a real local HTTP server that
// follows docs/INTEGRATION_CONTRACT.md. It checks every request's signature (C2), honours
// Idempotency-Key, prices orders from its own list, issues base32 tokens, scans once
// (earliest scanned_at wins in a batch) and can be told to fail or to change a price.
import http from 'node:http';
import crypto from 'node:crypto';
import { verifySigned, signRequest } from '../../functions/api/_lib/ticketing/engineClient.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const token = () => Array.from(crypto.randomBytes(26), b => B32[b % 32]).join('');

export async function startMockEngine({ key = 'club-key', secret = 'engine-secret', events = [] } = {}) {
  const state = {
    events, orders: new Map(), byRef: new Map(), idem: new Map(), nonces: new Set(), tickets: new Map(), scans: new Map(),
    calls: [], failNext: null, down: false, priceBump: 0, lookupDelayMs: 0,
  };
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const issue = o => {
    o.status = 'paid'; o.paid_at = new Date().toISOString();
    o.tickets = [];
    for (const l of o.lines) for (let i = 0; i < l.quantity; i++) {
      const ev = state.events.find(e => e.event_id === l.event_id), st = ev.stands.find(s => s.stand_id === l.stand_id);
      const t = { ticket_id: `t_${crypto.randomUUID()}`, token: token(), order_id: o.order_id, event_id: l.event_id, event_name: ev.name, kickoff_at: ev.kickoff_at, venue: ev.venue, stand_id: l.stand_id, stand_name: st.name, status: 'valid' };
      o.tickets.push(t); state.tickets.set(t.token, t);
    }
    return o;
  };
  const view = o => ({ order_id: o.order_id, client_reference: o.client_reference, status: o.status, amount_total_kobo: o.amount_total_kobo, paid_at: o.paid_at || null, ...(o.status === 'paid' ? { tickets: o.tickets } : {}) });
  const scanOne = s => {
    const t = state.tickets.get(String(s.token));
    if (!t) return { scan_id: s.scan_id, result: 'invalid' };
    if (t.status === 'void') return { scan_id: s.scan_id, result: 'void', ticket: t };
    if (t.wrong) return { scan_id: s.scan_id, result: 'wrong_match', ticket: t };
    if (state.scans.has(s.scan_id)) return state.scans.get(s.scan_id); // same scan again: same answer
    let r;
    if (t.status === 'scanned') r = { scan_id: s.scan_id, result: 'already_scanned', first_scanned_at: t.first, ticket: t };
    else { t.status = 'scanned'; t.first = s.scanned_at; r = { scan_id: s.scan_id, result: 'admitted', first_scanned_at: t.first, ticket: t }; }
    state.scans.set(s.scan_id, r);
    return r;
  };

  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://x');
    state.calls.push({ method: req.method, path: url.pathname + url.search, idem: req.headers['idempotency-key'] || null });
    if (state.down) { req.socket.destroy(); return; }
    if (state.failNext) { const f = state.failNext; state.failNext = f.times > 1 ? { ...f, times: f.times - 1 } : null; return send(res, f.status, { error: { code: f.code || 'server_error', message: 'Failure for the test.' } }); }
    const v = await verifySigned({ secrets: [secret], expectedKey: key, method: req.method, pathWithQuery: url.pathname + url.search, rawBody: raw, headers: req.headers,
      nonceSeen: async n => { if (state.nonces.has(n)) return true; state.nonces.add(n); return false; } });
    if (!v.ok) return send(res, 401, { error: { code: 'invalid_signature', message: 'Invalid signature.' } });
    if (req.method === 'POST' && !req.headers['idempotency-key']) return send(res, 400, { error: { code: 'idempotency_key_required', message: 'Missing Idempotency-Key.' } });
    const idem = req.method === 'POST' ? `${url.pathname}|${req.headers['idempotency-key']}` : null;
    if (idem && state.idem.has(idem)) { const p = state.idem.get(idem); return send(res, p.status, p.body); }
    const reply = (status, body) => { if (idem) state.idem.set(idem, { status, body }); send(res, status, body); };
    const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname.replace(/^\/api\/partner\/v1/, '');

    if (req.method === 'GET' && p === '/events') return reply(200, { events: state.events });
    if (req.method === 'POST' && p === '/orders') {
      const lines = [];
      for (const it of body.items || []) {
        const ev = state.events.find(e => e.event_id === it.event_id), st = ev?.stands.find(s => s.stand_id === it.stand_id);
        if (!st) return reply(404, { error: { code: 'not_available', message: 'Not available.' } });
        if (st.available < it.quantity) return reply(409, { error: { code: 'sold_out', message: 'Sold out.' } });
        const unit = st.price_kobo + state.priceBump;
        lines.push({ event_id: it.event_id, stand_id: it.stand_id, quantity: it.quantity, unit_price_kobo: unit, line_total_kobo: unit * it.quantity });
      }
      const total = lines.reduce((s, l) => s + l.line_total_kobo, 0);
      const o = { order_id: `ord_${crypto.randomUUID()}`, client_reference: body.client_reference, status: 'pending_payment', amount_total_kobo: total, currency: 'NGN', lines, buyer: body.buyer,
        payment: { provider: 'paystack', reference: `PSK-${crypto.randomUUID()}`, access_code: 'ac_test', authorization_url: 'https://checkout.paystack.com/test123' }, expires_at: new Date(Date.now() + 15 * 60e3).toISOString() };
      if (total === 0) issue(o);
      state.orders.set(o.order_id, o); state.byRef.set(o.client_reference, o);
      return reply(201, { ...o, ...(o.status === 'paid' ? { tickets: o.tickets } : {}) });
    }
    if (req.method === 'GET' && p === '/orders') { const o = state.byRef.get(url.searchParams.get('client_reference')); return o ? reply(200, view(o)) : reply(404, { error: { code: 'not_found', message: 'Not found.' } }); }
    if (req.method === 'GET' && p.startsWith('/orders/')) { const o = state.orders.get(decodeURIComponent(p.slice(8))); return o ? reply(200, view(o)) : reply(404, { error: { code: 'not_found', message: 'Not found.' } }); }
    if (req.method === 'POST' && p === '/tickets/lookup') {
      await new Promise(r => setTimeout(r, state.lookupDelayMs));
      const o = [...state.orders.values()].find(x => x.client_reference === body.order_reference && x.buyer?.email === body.email && x.status === 'paid');
      return reply(200, { tickets: o ? o.tickets : [] });
    }
    if (req.method === 'POST' && p === '/tickets/validate') {
      const t = state.tickets.get(String(body.token));
      if (!t) return reply(200, { valid: false, reason: 'unknown_ticket' });
      return reply(200, { valid: t.status === 'valid' && !t.wrong, ticket: t, reason: t.status === 'void' ? 'void' : t.status === 'scanned' ? 'already_scanned' : t.wrong ? 'wrong_match' : 'ok' });
    }
    if (req.method === 'POST' && p === '/tickets/scan') return reply(200, scanOne(body));
    if (req.method === 'POST' && p === '/tickets/scan/batch') {
      const list = [...(body.scans || [])].sort((a, b) => Date.parse(a.scanned_at) - Date.parse(b.scanned_at)); // earliest wins
      const results = list.map(scanOne);
      return reply(200, { results });
    }
    return reply(404, { error: { code: 'not_found', message: 'Not found.' } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, state, key, secret,
    pay: ref => { const o = state.byRef.get(ref); return issue(o); },
    close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }),
  };
}

/** A signed callback request to the club site (C4), as the engine would send it. */
export async function signedCallback({ url = 'https://lobistarsfc.com/internal/ticketing/callback', secret, key = 'engine', body, timestamp, nonce }) {
  const raw = JSON.stringify(body);
  const u = new URL(url);
  const headers = { 'Content-Type': 'application/json', ...(await signRequest({ key, secret, method: 'POST', pathWithQuery: u.pathname + u.search, body: raw, timestamp, nonce })) };
  return new Request(url, { method: 'POST', headers, body: raw });
}

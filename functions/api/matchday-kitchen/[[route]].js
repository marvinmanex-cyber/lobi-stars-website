// /api/matchday-kitchen/<route>: every MatchDay Kitchen action (the session is
// checked by _middleware.js; data.mk = { id, csrf, user }).
//   POST login {loginCode} (staff) or {login, password} (Super Admins)   POST logout {idle?}   GET session
//   POST open {page}                       GET kitchen   GET board   GET alerts
//   GET orders?q&status&day&page           GET order?id   POST order {id, to}
//   GET menu   POST menu {id, action: soldout|back|price|rename|add|delete|all_on|all_off, price, name, item}
//   GET analytics?day   GET shift   POST shift {action: start|end}
//   GET notes   POST notes {action: add|pin|unpin|delete, id, text}
//   GET activity?staff&day&page[&format=csv]   GET staff   POST staff {action: add|edit|settings, …}
//   GET ordering   POST ordering {mode: open|closed|auto} (supervisors, Super Admins): food ordering for fans
//   GET delivery (ready orders by stand)   GET report-settings   POST report-settings {emails}
//   GET report (preview, HTML)   POST report (send now)   (report: supervisors, Super Admins)
//   POST payment {id, method, amount, proof, fileName, note, allowDuplicate}   GET payment-proof?id   (order handlers, supervisors, Super Admins)
//   POST push {action: on|off|test, subscription, deviceName, endpoint}   order alerts on this device
//   GET check (Super Admins: the data check)
import { signIn, signOut, json, kitchenSettings, permissions, mkLog, shiftState, startShift, endShift, listNotes, noteAction,
  activityPage, listStaff, createStaff, updateStaff, saveSettings, ROLES, oneLine, clearKitchenCookie } from '../_lib/matchdayKitchen.js';
import * as K from '../_lib/kitchenData.js';
import { foodSettings, saveFoodSetting } from '../_lib/foodOrders.js';
import { buildReport, sendReport, reportEmails, saveReportEmails } from '../_lib/kitchenReport.js';
import { recordPayment, canRecord, proofInfo, proofResponse, PAY_METHODS } from '../_lib/foodPaymentProof.js';
import { ensureMenuSchema, orderingState } from '../_lib/foodMenuDb.js';
import { saveAppDevice, removeAppDevice, removeStaffDevices, testAppDevice } from '../_lib/kitchenNotify.js';

// The pages (and their names in the activity log).
const PAGES = {
  kitchen: 'Kitchen screen', live: 'Live order board', alerts: 'Kitchen alerts', orders: 'Food orders', menu: 'Menu and prices',
  analytics: 'Food analytics', shift: 'My shift', handover: 'Handover notes', activity: 'Activity log', staff: 'Staff accounts',
  whatsapp: 'Kitchen WhatsApp', telegram: 'Telegram updates', delivery: 'Delivery by stand',
};
const denied = () => json({ error: "Your role can't do this. Ask a kitchen supervisor or a super admin.", denied: true }, 403);
const staffName = u => `${u.name} (${u.code}) – MatchDay Kitchen`;
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const db = env.DB;
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
  // The biggest thing sent here is a payment receipt (1.5 MB, about 2 MB once encoded).
  if (method === 'POST' && Number(request.headers.get('content-length') || 0) > 2.5e6) return json({ error: 'That file is too big (the most is 1.5 MB). Send a screenshot instead.' }, 413);
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  const q = new URL(request.url).searchParams;
  try {
    if (route === 'login' && method === 'POST') {
      const r = await signIn(env, request, body);
      if (!r.ok) return json({ error: r.error, needCode: r.needCode || undefined }, r.status || 400);
      return json({ ok: true }, 200, { 'Set-Cookie': r.cookie });
    }
    const S = data.mk;
    if (!S) return json({ error: 'Please sign in to MatchDay Kitchen again.', signedOut: true }, 401);
    const user = S.user;
    const settings = await kitchenSettings(db);
    const perms = permissions(user, settings);
    const late = settings.lateMinutes;

    switch (`${method} ${route}`) {
      case 'POST logout':
        await signOut(db, S, request, !!body.idle);
        // Signing out with the button stops the alerts; the 20-minute idle sign-out keeps them, so a resting tablet still rings.
        if (!body.idle) await removeStaffDevices(db, user.id).catch(() => {});
        return json({ ok: true }, 200, { 'Set-Cookie': clearKitchenCookie() });
      case 'GET session':
        return json({ csrf: S.csrf, user: { name: user.name, firstName: user.firstName, code: user.code, role: user.role, roleLabel: user.roleLabel, kind: user.kind },
          perms, settings: { telegramUrl: settings.telegramUrl, lateMinutes: late }, shift: await shiftState(db, user), pushKey: env.VAPID_PUBLIC_KEY || '' });
      case 'POST open': {
        const name = PAGES[body.page];
        if (!name) return json({ error: 'Unknown page.' }, 400);
        await mkLog(db, user, body.page === 'whatsapp' || body.page === 'telegram' ? `Went to ${name}` : `Opened ${name}`, { kind: 'open', request });
        return json({ ok: true });
      }
      case 'GET delivery': return json({ groups: await K.deliveryByStand(db, late), lateMinutes: late });
      case 'GET kitchen': return json({ tickets: await K.kitchenTickets(db, late), lateMinutes: late });
      // The alarm check (every 10 seconds from each open app): new orders to accept, late orders.
      case 'GET pulse': return json(await K.pulse(db, late));
      case 'GET board': return json({ columns: await K.boardColumns(db, late), unpaid: await K.unpaidOrders(db), lateMinutes: late });
      case 'GET alerts': return json({ ...(await K.alerts(db, late)), lateMinutes: late });
      case 'GET orders': return json(await K.searchOrders(db, { q: q.get('q') || '', status: q.get('status') || '', day: q.get('day') || '', page: q.get('page') || 1 }, late));
      case 'GET order': {
        const o = await K.getOrder(db, q.get('id') || '');
        if (!o) return json({ error: 'That order no longer exists.' }, 404);
        // A WhatsApp order becomes paid through Record payment (with evidence), not a plain status button.
        const moves = K.movesFor(o).filter(m => (!m.cancel || perms.cancel) && !(m.to === 'PAID' && o.channel === 'whatsapp' && o.payment_status !== 'paid'));
        return json({ order: K.ticket(o, late), moves, canRecordPayment: canRecord(o) && perms.payment, needsPaymentRole: canRecord(o) && !perms.payment, payment: perms.payment ? await proofInfo(db, o.id) : null, methods: PAY_METHODS });
      }
      case 'POST order': {
        const to = String(body.to || '');
        if (K.DATA.cancelled.includes(to) && !perms.cancel) return denied();
        if (to === 'PAID') {
          const was = await K.getOrder(db, body.id);
          if (was && was.channel === 'whatsapp' && was.payment_status !== 'paid') return json({ error: 'Use Record payment, with the evidence from the fan.', recordPayment: true }, 400);
        }
        const r = await K.setStatus(db, body.id, to, staffName(user), env);
        if (r.error) return json({ error: r.error }, 409);
        await mkLog(db, user, `Order ${r.ref}: ${K.statusLabel(r.from)} to ${K.statusLabel(r.to)}`, { kind: 'order', request });
        // Delivered: the receipt goes to the buyer's email; the app offers the WhatsApp receipt.
        if (r.to === 'DELIVERED') {
          const receipt = await K.receiptAfterDelivery(env, body.id, staffName(user));
          if (receipt.emailed) await mkLog(db, user, `Order ${r.ref}: receipt emailed`, { kind: 'order', request });
          return json({ ok: true, receipt });
        }
        return json({ ok: true });
      }
      case 'GET receipt-data': {
        const r = await K.receiptData(env, q.get('id') || '');
        if (!r) return json({ error: 'That order no longer exists.' }, 404);
        if (r.error) return json({ error: r.error }, 409);
        return json(r);
      }
      case 'POST receipt': {
        // The WhatsApp receipt for an order (opened by staff), or the email again.
        const o = await K.getOrder(db, body.id || '');
        if (!o) return json({ error: 'That order no longer exists.' }, 404);
        const receipt = await K.receiptAfterDelivery(env, o.id, staffName(user));
        if (body.via === 'whatsapp') {
          if (!receipt.whatsappUrl) return json({ error: 'This order has no phone number for WhatsApp.' }, 400);
          await K.markWhatsappReceipt(db, o.id, staffName(user));
          await mkLog(db, user, `Order ${o.ref}: receipt sent on WhatsApp`, { kind: 'order', request });
        }
        return json({ ok: true, receipt });
      }
      case 'GET menu': return json({ groups: await K.menu(db), canPrice: perms.price, canAll: perms.ordering, canMenu: perms.menu, categories: perms.menu ? await K.menuCategories(db) : [] });
      case 'POST menu': {
        if (body.action === 'soldout' || body.action === 'back') {
          const r = await K.setSoldOut(db, body.id, body.action === 'soldout', staffName(user));
          if (r.error) return json({ error: r.error }, 404);
          if (r.changed) await mkLog(db, user, body.action === 'soldout' ? `Turned ${r.name} off (not ready)` : `Turned ${r.name} on (ready)`, { kind: 'menu', request });
          return json({ ok: true });
        }
        // Every dish at once: supervisors and Super Admins.
        if (body.action === 'all_on' || body.action === 'all_off') {
          if (!perms.ordering) return denied();
          const r = await K.setAllReady(db, body.action === 'all_on', staffName(user));
          if (r.changed) await mkLog(db, user, `Turned ${r.changed} dish${r.changed === 1 ? '' : 'es'} ${body.action === 'all_on' ? 'on (ready)' : 'off (not ready)'}`, { kind: 'menu', request });
          return json({ ok: true, changed: r.changed });
        }
        // Adding and deleting dishes: supervisors and Super Admins only.
        if (body.action === 'add') {
          if (!perms.menu) return denied();
          const r = await K.addDish(db, body.item || {}, staffName(user));
          if (r.error) return json({ error: r.error }, 400);
          await mkLog(db, user, `Added ${r.name} to the menu at ${r.price}`, { kind: 'menu', request });
          return json(r);
        }
        if (body.action === 'rename') {
          if (!perms.menu) return denied();
          const r = await K.renameDish(db, body.id, body.name, staffName(user));
          if (r.error) return json({ error: r.error }, r.status);
          if (!r.unchanged) await mkLog(db, user, `Renamed ${r.old} to ${r.name}`, { kind: 'menu', request });
          return json(r);
        }
        if (body.action === 'delete') {
          if (!perms.menu) return denied();
          const r = await K.deleteDish(db, body.id, staffName(user));
          if (r.error) return json({ error: r.error }, 404);
          await mkLog(db, user, `Deleted ${r.name} from the menu`, { kind: 'menu', request });
          return json(r);
        }
        if (body.action === 'price') {
          if (!perms.price) return denied();
          const r = await K.setPrice(db, body.id, body.price, staffName(user));
          if (r.error) return json({ error: r.error }, 400);
          if (!r.unchanged) await mkLog(db, user, `Changed the price of ${r.name} from ${r.old} to ${r.new}`, { kind: 'price', request });
          return json({ ok: true, price: r.new });
        }
        return json({ error: 'Unknown action.' }, 400);
      }
      case 'GET analytics': return json(await K.analytics(db, q.get('day') || ''));
      case 'GET shift': return json(await shiftState(db, user));
      case 'POST shift': {
        const r = body.action === 'end' ? await endShift(db, user, request) : await startShift(db, user, request);
        if (r.error) return json({ error: r.error }, 409);
        return json({ ok: true, shift: await shiftState(db, user) });
      }
      case 'GET notes': return json({ notes: (await listNotes(db)).map(n => ({ id: n.id, author: n.author_name, code: n.author_code, text: n.text, pinned: !!n.pinned, at: n.created_at, mine: n.user_id === user.id })), canManage: perms.notes });
      case 'POST notes': {
        const r = await noteAction(db, user, perms, request, body);
        if (r.error) return json({ error: r.error }, r.status || 400);
        return json({ ok: true });
      }
      case 'GET activity': {
        const userId = perms.activityAll ? (q.get('staff') || '') : user.id;
        const csv = q.get('format') === 'csv';
        if (csv && !perms.activityAll) return denied();
        const r = await activityPage(db, { userId, day: q.get('day') || '', page: q.get('page') || 1, all: csv });
        if (csv) {
          const lines = [['Time (UTC)', 'Who', 'Staff ID / email', 'What happened', 'Details', 'IP address'].join(',')]
            .concat(r.rows.map(a => [a.at, a.actor_name, a.actor_code, a.action, a.details, a.ip].map(csvCell).join(',')));
          await mkLog(db, user, 'Downloaded the activity log (CSV)', { kind: 'open', request });
          return new Response(`﻿${lines.join('\r\n')}\r\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="matchday-kitchen-activity-${q.get('day') || 'all'}.csv"`, 'Cache-Control': 'no-store' } });
        }
        return json({ ...r, rows: r.rows.map(a => ({ at: a.at, who: a.actor_name, code: a.actor_code, action: a.action, details: a.details })), all: perms.activityAll,
          staff: perms.activityAll ? (await listStaff(db)).map(s => ({ id: s.id, name: `${s.name} (${s.staffId})` })) : [] });
      }
      case 'GET staff':
        if (!perms.staff) return denied();
        // Supervisors add and manage cooks and pass staff; only a Super Admin handles supervisors.
        return json({ staff: await listStaff(db), roles: ROLES, addRoles: perms.superAdmin ? ROLES : Object.fromEntries(Object.entries(ROLES).filter(([k]) => k !== 'supervisor')), settings });
      case 'POST staff': {
        if (!perms.staff) return denied();
        if (body.action === 'add') { const r = await createStaff(env, user, request, body); return r.error ? json({ error: r.error }, r.status || 400) : json(r); }
        if (body.action === 'edit') { const r = await updateStaff(env, user, request, body.id, body); return r.error ? json({ error: r.error }, r.status || 400) : json(r); }
        if (body.action === 'settings') {
          const r = await saveSettings(db, user.code, body);
          if (r.error) return json({ error: r.error }, 400);
          await mkLog(db, user, 'Changed MatchDay Kitchen settings', { kind: 'settings', details: `Telegram: ${oneLine(body.telegramUrl, 120) || 'none'}; cancel: ${(body.cancelRoles || []).join(', ') || 'super admins only'}; late after ${body.lateMinutes} min`, request });
          return json({ ok: true });
        }
        return json({ error: 'Unknown action.' }, 400);
      }
      // Food ordering for fans: everyone sees whether it is open; supervisors and Super Admins change it.
      case 'GET ordering': {
        await ensureMenuSchema(db);
        const fs = await foodSettings(db);
        return json({ ...(await orderingState(env, fs)), mode: fs.orderingMode, autoOpenMinutes: fs.autoOpenMinutes, canChange: perms.ordering });
      }
      case 'POST ordering': {
        if (!perms.ordering) return denied();
        if (!['open', 'closed', 'auto'].includes(body.mode)) return json({ error: 'Choose open, closed or automatic.' }, 400);
        await ensureMenuSchema(db);
        await saveFoodSetting(db, 'orderingMode', body.mode, user.name);
        await mkLog(db, user, body.mode === 'open' ? 'Opened food ordering' : body.mode === 'closed' ? 'Closed food ordering' : 'Set food ordering to automatic', { kind: 'settings', request });
        const fs = await foodSettings(db);
        return json({ ...(await orderingState(env, fs)), mode: fs.orderingMode, autoOpenMinutes: fs.autoOpenMinutes, canChange: true });
      }
      case 'POST payment': {
        if (!perms.payment) return denied();
        const o = await K.getOrder(db, body.id);
        const r = await recordPayment(env, o, body, user, { canOverride: perms.paymentOverride, origin: new URL(request.url).origin, waitUntil: p => context.waitUntil(p) });
        if (r.error) return json({ error: r.error, duplicate: r.duplicate, canOverride: r.canOverride }, r.status || 400);
        await mkLog(db, user, `Order ${r.ref}: recorded payment of ${r.amount} (${r.method}), evidence saved${r.late ? ', after the order had expired' : ''}${r.duplicateOf ? `, the same receipt as order ${r.duplicateOf} (allowed)` : ''}`, { kind: 'order', details: oneLine(body.note, 200) || null, request });
        return json(r);
      }
      case 'GET payment-proof':
        if (!perms.payment) return denied();
        return proofResponse(db, q.get('id') || '');
      case 'POST push': {
        if (body.action === 'on') {
          const problem = await saveAppDevice(db, user, body.subscription, body.deviceName);
          return problem ? json({ error: problem }, 400) : json({ ok: true });
        }
        if (body.action === 'off') { await removeAppDevice(db, body.endpoint); return json({ ok: true }); }
        if (body.action === 'test') return json({ ok: await testAppDevice(env, body.endpoint) });
        return json({ error: 'Unknown action.' }, 400);
      }
      case 'GET report-settings':
        if (!perms.staff) return denied();
        return json({ emails: await reportEmails(env) });
      case 'POST report-settings': {
        if (!perms.staff) return denied();
        const r = await saveReportEmails(db, user.code, body.emails);
        if (r.error) return json({ error: r.error }, 400);
        await mkLog(db, user, 'Changed who gets the match-day food report', { kind: 'settings', details: r.emails.join(', '), request });
        return json(r);
      }
      case 'GET report': {
        if (!perms.staff) return denied();
        const { html } = await buildReport(env);
        return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Match-day food report</title><body style="margin:0;padding:16px;background:#f3f4f6">${html}</body>`,
          { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' } });
      }
      case 'POST report': {
        if (!perms.staff) return denied();
        const r = await sendReport(env, { by: user.name, actor: user, request });
        return r.error ? json({ error: r.error }, 400) : json(r);
      }
      case 'GET check':
        if (!perms.superAdmin) return denied();
        return json({ steps: await K.checkData(db) });
      default:
        return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[matchday kitchen]', route, err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

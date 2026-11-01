// /api/matchday-kitchen/<route>: every MatchDay Kitchen action (the session is
// checked by _middleware.js; data.mk = { id, csrf, user }).
//   POST login {login, password, code?}   POST logout {idle?}   GET session
//   POST open {page}                       GET kitchen   GET board   GET alerts
//   GET orders?q&status&day&page           GET order?id   POST order {id, to}
//   GET menu   POST menu {id, action: soldout|back|price, price}
//   GET analytics?day   GET shift   POST shift {action: start|end}
//   GET notes   POST notes {action: add|pin|unpin|delete, id, text}
//   GET activity?staff&day&page[&format=csv]   GET staff   POST staff {action: add|edit|settings, …}
//   GET check (Super Admins: the data check)
import { signIn, signOut, json, kitchenSettings, permissions, mkLog, shiftState, startShift, endShift, listNotes, noteAction,
  activityPage, listStaff, createStaff, updateStaff, saveSettings, ROLES, oneLine, clearKitchenCookie } from '../_lib/matchdayKitchen.js';
import * as K from '../_lib/kitchenData.js';

// The pages (and their names in the activity log).
const PAGES = {
  kitchen: 'Kitchen screen', live: 'Live order board', alerts: 'Kitchen alerts', orders: 'Food orders', menu: 'Menu and prices',
  analytics: 'Food analytics', shift: 'My shift', handover: 'Handover notes', activity: 'Activity log', staff: 'Staff accounts',
  whatsapp: 'Kitchen WhatsApp', telegram: 'Telegram updates',
};
const denied = () => json({ error: "Your role can't do this. Ask a kitchen supervisor or a super admin.", denied: true }, 403);
const staffName = u => `${u.name} (${u.code}) – MatchDay Kitchen`;
const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };

export async function onRequest(context) {
  const { request, env, params, data } = context;
  const db = env.DB;
  const route = [].concat(params.route || []).join('/');
  const method = request.method;
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
        return json({ ok: true }, 200, { 'Set-Cookie': clearKitchenCookie() });
      case 'GET session':
        return json({ csrf: S.csrf, user: { name: user.name, firstName: user.firstName, code: user.code, role: user.role, roleLabel: user.roleLabel, kind: user.kind },
          perms, settings: { telegramUrl: settings.telegramUrl, lateMinutes: late }, shift: await shiftState(db, user) });
      case 'POST open': {
        const name = PAGES[body.page];
        if (!name) return json({ error: 'Unknown page.' }, 400);
        await mkLog(db, user, body.page === 'whatsapp' || body.page === 'telegram' ? `Went to ${name}` : `Opened ${name}`, { kind: 'open', request });
        return json({ ok: true });
      }
      case 'GET kitchen': return json({ tickets: await K.kitchenTickets(db, late), lateMinutes: late });
      case 'GET board': return json({ columns: await K.boardColumns(db, late), lateMinutes: late });
      case 'GET alerts': return json({ ...(await K.alerts(db, late)), lateMinutes: late });
      case 'GET orders': return json(await K.searchOrders(db, { q: q.get('q') || '', status: q.get('status') || '', day: q.get('day') || '', page: q.get('page') || 1 }, late));
      case 'GET order': {
        const o = await K.getOrder(db, q.get('id') || '');
        if (!o) return json({ error: 'That order no longer exists.' }, 404);
        const moves = K.movesFor(o).filter(m => !m.cancel || perms.cancel);
        return json({ order: K.ticket(o, late), moves });
      }
      case 'POST order': {
        const to = String(body.to || '');
        if (K.DATA.cancelled.includes(to) && !perms.cancel) return denied();
        const r = await K.setStatus(db, body.id, to, staffName(user));
        if (r.error) return json({ error: r.error }, 409);
        await mkLog(db, user, `Order ${r.ref}: ${K.statusLabel(r.from)} to ${K.statusLabel(r.to)}`, { kind: 'order', request });
        return json({ ok: true });
      }
      case 'GET menu': return json({ groups: await K.menu(db), canPrice: perms.price });
      case 'POST menu': {
        if (body.action === 'soldout' || body.action === 'back') {
          const r = await K.setSoldOut(db, body.id, body.action === 'soldout', staffName(user));
          if (r.error) return json({ error: r.error }, 404);
          if (r.changed) await mkLog(db, user, body.action === 'soldout' ? `Marked ${r.name} as sold out` : `Put ${r.name} back on`, { kind: 'menu', request });
          return json({ ok: true });
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
        return json({ staff: await listStaff(db), roles: ROLES, settings });
      case 'POST staff': {
        if (!perms.staff) return denied();
        if (body.action === 'add') { const r = await createStaff(env, user, request, body); return r.error ? json({ error: r.error }, 400) : json({ ok: true }); }
        if (body.action === 'edit') { const r = await updateStaff(env, user, request, body.id, body); return r.error ? json({ error: r.error }, 400) : json({ ok: true }); }
        if (body.action === 'settings') {
          const r = await saveSettings(db, user.code, body);
          if (r.error) return json({ error: r.error }, 400);
          await mkLog(db, user, 'Changed MatchDay Kitchen settings', { kind: 'settings', details: `Telegram: ${oneLine(body.telegramUrl, 120) || 'none'}; cancel: ${(body.cancelRoles || []).join(', ') || 'super admins only'}; prices: ${(body.priceRoles || []).join(', ') || 'super admins only'}; late after ${body.lateMinutes} min`, request });
          return json({ ok: true });
        }
        return json({ error: 'Unknown action.' }, 400);
      }
      case 'GET check':
        if (!perms.staff) return denied();
        return json({ steps: await K.checkData(db) });
      default:
        return json({ error: 'Not found.' }, 404);
    }
  } catch (err) {
    console.error('[matchday kitchen]', route, err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

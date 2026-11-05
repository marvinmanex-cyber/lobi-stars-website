// MatchDay Kitchen inner pages, drawn for the address:
//   kitchen, live, alerts, orders, orders/<id>, menu, analytics, shift,
//   handover, activity, staff, not-available.
// Inside a tab: Home returns to the home screen (tabs stay open), taps count as
// activity for the idle sign-out, and a signed-out answer sends the whole
// tablet to the sign-in page. Live pages refresh every 15 seconds, but never
// while someone is tapping or typing.
import { $, esc, api, session, loadSession, setSignedOutHandler, ApiError, pageTitle, iconFor, hm, dayTime, dayOnly, todayLagos, mins } from './common';
import { sendReceiptWhatsApp } from './receipt';

const shell: any = (() => { try { return window.parent !== window ? (window.parent as any).mkShell : null; } catch { return null; } })();
const page = decodeURIComponent(location.pathname.replace(/^\/matchday-kitchen\//, '').replace(/\/$/, '')) || 'kitchen';
const main = $('pMain') as HTMLElement;
let lastTouch = 0;

// ── Frame plumbing ──
$('pHome').addEventListener('click', () => { if (shell) shell.home(); else location.href = '/matchday-kitchen/'; });
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastTouch = Date.now(); shell?.activity(); }, { passive: true }));
setSignedOutHandler(() => { if (shell) shell.signedOut(); else location.href = '/matchday-kitchen/login/'; });
const openPage = (p: string) => { if (shell) shell.open(p); else location.href = `/matchday-kitchen/${p}/`; };

let toastT = 0;
function toast(t: string) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => { el.hidden = true; }, 5000); }
function confirmBox(title: string, text: string, yes = 'Yes', danger = false): Promise<boolean> {
  const d = $('pDialog') as HTMLDialogElement;
  $('dTitle').textContent = title; $('dBody').textContent = text; $('dYes').textContent = yes;
  $('dYes').className = `mk-btn ${danger ? 'danger' : 'go'}`;
  d.returnValue = '';
  d.showModal();
  return new Promise(res => d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }));
}
const busy = () => Date.now() - lastTouch < 5000 || ($('pDialog') as HTMLDialogElement).open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
function every15(f: () => Promise<void>) {
  window.setInterval(() => { if (!document.hidden && !busy()) f().catch(() => {}); }, 15000);
}
const stamp = () => { $('pUpd').textContent = `Updated ${hm(new Date().toISOString())}`; };
function notAvailable() {
  document.title = 'Not available | MatchDay Kitchen | Lobi Stars FC';
  $('pTitle').textContent = 'Not available';
  main.innerHTML = `<div class="mk-empty"><p>Your role can't open this. Ask a kitchen supervisor or a super admin.</p><button type="button" class="mk-btn go big" id="naHome">Back to Home</button></div>`;
  $('naHome').addEventListener('click', () => $('pHome').click());
}
async function act(btn: HTMLButtonElement | null, f: () => Promise<void>) {
  if (btn) btn.disabled = true;
  try { await f(); } catch (e) { if ((e as ApiError).data?.denied) notAvailable(); else toast((e as Error).message); } finally { if (btn) btn.disabled = false; }
}

// ── Order tickets (kitchen screen, alerts) ──
function ticketHtml(t: any) {
  return `<article class="mk-ord ${esc(t.status)}${t.late ? ' late' : ''}">
    <div class="mk-ord-top"><span class="mk-ord-no">#${esc(String(t.ref).split('-').pop())}</span><span class="mk-mins">${esc(mins(t.minutes))}</span></div>
    <div class="mk-status" style="margin-top:-6px">${esc(t.ref)}</div>
    ${t.late ? '<div><span class="mk-late">LATE</span></div>' : ''}
    ${t.deliverWhen && t.deliverWhen !== 'now' ? `<div class="mk-due">⏱ ${t.deliverWhen === 'half-time' ? 'HALF-TIME' : 'KICK-OFF'}${t.deliverAt ? ` · due ${esc(new Date(t.deliverAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }))}` : ''}</div>` : ''}
    ${t.customer || t.where ? `<div class="mk-who2">${esc([t.customer, t.where].filter(Boolean).join(' · '))}</div>` : ''}
    <ul class="mk-items">${t.items.map((i: any) => `<li>${esc(i.qty)} × ${esc(i.name)}${i.note ? `<em>${esc(i.note)}</em>` : ''}</li>`).join('')}</ul>
    ${t.note ? `<div class="mk-onote">Note: ${esc(t.note)}</div>` : ''}
    <div class="mk-status">${esc(t.statusLabel)}</div>
    ${t.next ? `<button type="button" class="mk-btn go big wide" data-move="${esc(t.id)}" data-to="${esc(t.next.to)}">${esc(t.next.label)}</button>` : ''}
  </article>`;
}
/** After a status change: the alarms re-check at once; after "Mark delivered", the receipt. */
async function afterMove(id: string, r: any) {
  try { (window.parent as any).mkShell?.alarmsNow?.(); } catch { /* */ }
  if (!r?.receipt) { toast('Done.'); return; }
  const rc = r.receipt;
  const said = rc.emailed ? `The receipt was emailed to ${rc.email}.` : rc.email ? 'The receipt email could not be sent (email may not be set up yet).' : 'This order has no email address.';
  toast(`Delivered. ${said}`);
  // The receipt picture for WhatsApp (open the fan's chat, then share the picture).
  if (rc.whatsappUrl) await sendReceiptWhatsApp(id, toast);
}
async function moveFrom(e: Event, reload: () => Promise<void>) {
  const b = (e.target as HTMLElement).closest('[data-move]') as HTMLButtonElement | null;
  if (!b) return;
  await act(b, async () => { const r = await api('order', { method: 'POST', body: { id: b.dataset.move, to: b.dataset.to } }); await reload(); await afterMove(b.dataset.move!, r); });
}

// ── Pages ──
const PAGES: Record<string, () => Promise<void>> = {
  async kitchen() {
    const draw = async (quiet = false) => {
      const d = await api('kitchen', { quiet });
      main.innerHTML = d.tickets.length ? `<div class="mk-ord-grid">${d.tickets.map(ticketHtml).join('')}</div>` : '<p class="mk-empty">No orders waiting. New orders appear here on their own.</p>';
      stamp();
    };
    main.addEventListener('click', e => moveFrom(e, () => draw()));
    await draw(); every15(() => draw(true));
  },

  async live() {
    const draw = async (quiet = false) => {
      const d = await api('board', { quiet });
      const up = d.unpaid || [], waiting = up.filter((o: any) => !o.failed), failed = up.filter((o: any) => o.failed);
      const unpaidCard = (o: any) => `<article class="mk-unpaid${o.failed ? ' failed' : ''}"><div class="mk-unpaid-top"><b>${esc(o.ref)}</b><span>${esc(o.statusLabel)}</span><span class="r">${esc(mins(o.minutes))} ago</span></div>
        <div>${esc([o.customer, o.where].filter(Boolean).join(' · '))}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
        <div class="mk-status">${esc(o.items.map((i: any) => `${i.qty} × ${i.name}`).join(', '))} · <b>${esc(o.total)}</b>${o.channel === 'whatsapp' ? ' · WhatsApp order' : ''}</div>
        ${o.chatUrl ? `<a class="mk-btn" href="${esc(o.chatUrl)}" target="mdk-whatsapp" rel="noopener">Chat on WhatsApp</a>` : ''}</article>`;
      const unpaidHtml = `<section class="mk-unpaid-box" aria-label="Awaiting payment"><h2>Awaiting payment <span class="mk-badge">${waiting.length}</span> <small>Not paid yet: do not cook. A paid order moves to New by itself.</small></h2>
        ${waiting.length ? `<div class="mk-unpaid-grid">${waiting.map(unpaidCard).join('')}</div>` : '<p class="mk-status" style="margin:4px 6px">Nobody is waiting to pay.</p>'}
        ${failed.length ? `<h3>Did not pay <span class="mk-badge red">${failed.length}</span> <small>Payment failed or ran out of time (last 12 hours). Ask them what went wrong.</small></h3><div class="mk-unpaid-grid">${failed.map(unpaidCard).join('')}</div>` : ''}</section>`;
      main.innerHTML = unpaidHtml + `<div class="mk-board">${Object.values(d.columns).map((c: any) => `<section class="mk-col"><h2>${esc(c.label)} <span class="mk-badge">${c.orders.length}</span></h2>${c.orders.length ? c.orders.map((o: any) => `
        <button type="button" class="mk-mini${o.late ? ' late' : ''}${o.status === 'PAID' ? ' is-new' : ''}" data-order="${esc(o.id)}"><b>${esc(o.ref)}</b><span class="r">${esc(mins(o.minutes))}</span>
        <span>${o.itemCount} item${o.itemCount === 1 ? '' : 's'}${o.customer ? ` · ${esc(o.customer)}` : ''}</span></button>`).join('') : '<p class="mk-status" style="margin:8px 6px">None</p>'}</section>`).join('')}</div>`;
      stamp();
    };
    main.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('[data-order]') as HTMLElement | null; if (b) openPage(`orders/${b.dataset.order}`); });
    await draw(); every15(() => draw(true));
  },

  async alerts() {
    const draw = async (quiet = false) => {
      const d = await api('alerts', { quiet });
      main.innerHTML = `
        <section class="mk-section"><h2>Late orders <span class="mk-badge${d.late.length ? ' red' : ''}">${d.late.length}</span></h2>
          ${d.late.length ? `<div class="mk-ord-grid">${d.late.map(ticketHtml).join('')}</div>` : `<p class="mk-empty">No late orders. Orders count as late after ${d.lateMinutes} minutes.</p>`}</section>
        <section class="mk-section"><h2>Sold out <span class="mk-badge${d.soldOut.length ? ' red' : ''}">${d.soldOut.length}</span></h2>
          ${d.soldOut.length ? `<div class="mk-box"><ul style="margin:0 0 12px;padding-left:22px;font-size:19px">${d.soldOut.map((s: any) => `<li>${esc(s.name)}${s.category ? ` <span class="mk-status">${esc(s.category)}</span>` : ''}</li>`).join('')}</ul></div>` : '<p class="mk-empty">Nothing is sold out.</p>'}
          <div class="mk-actions"><button type="button" class="mk-btn" data-goto="menu">Open Menu and prices</button></div></section>
        <section class="mk-section"><h2>Cancelled today <span class="mk-badge">${d.cancelled.length}</span></h2>
          ${d.cancelled.length ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>When</th></tr></thead><tbody>${d.cancelled.map((o: any) => `<tr class="click" data-order="${esc(o.id)}"><td><b>${esc(o.ref)}</b></td><td>${esc(o.customer)}</td><td>${esc(o.total)}</td><td>${esc(hm(o.statusAt || o.placedAt))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mk-empty">No cancelled orders today.</p>'}</section>`;
      stamp();
    };
    main.addEventListener('click', e => {
      const el = e.target as HTMLElement;
      const g = el.closest('[data-goto]') as HTMLElement | null; if (g) { openPage(g.dataset.goto!); return; }
      const o = el.closest('[data-order]') as HTMLElement | null; if (o) { openPage(`orders/${o.dataset.order}`); return; }
      moveFrom(e, () => draw());
    });
    await draw(); every15(() => draw(true));
  },

  async orders() {
    const f = { q: '', status: '', day: todayLagos(), page: 1 };
    main.innerHTML = `<form class="mk-filters" id="oF">
      <div class="mk-field"><label for="oQ">Order number or name</label><input id="oQ" type="search" placeholder="e.g. FD-20261108-0012 or Derek" /></div>
      <div class="mk-field"><label for="oS">Status</label><select id="oS"><option value="">All</option><option value="new">New</option><option value="preparing">Preparing</option><option value="ready">On the way</option>
        <option value="DELIVERED">Delivered</option><option value="AWAITING_WHATSAPP">WhatsApp – to confirm</option><option value="CONFIRMED">Confirmed – awaiting payment</option><option value="AWAITING_PAYMENT">Awaiting payment</option><option value="cancelled">Cancelled</option><option value="EXPIRED">Expired</option></select></div>
      <div class="mk-field"><label for="oD">Date</label><input id="oD" type="date" value="${f.day}" /></div>
      <button class="mk-btn go" type="submit">Search</button></form><div id="oList"></div>`;
    const draw = async () => {
      const d = await api(`orders?${new URLSearchParams({ q: f.q, status: f.status, day: f.day, page: String(f.page) })}`);
      $('oList').innerHTML = d.orders.length ? `<p class="mk-status">${d.total} order${d.total === 1 ? '' : 's'} on ${esc(dayOnly(`${d.day}T12:00:00Z`))}</p>
        <div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>Order</th><th>Time</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>${d.orders.map((o: any) => `
          <tr class="click" data-order="${esc(o.id)}" tabindex="0"><td><b>${esc(o.ref)}</b></td><td>${esc(hm(o.placedAt))}</td><td>${esc(o.customer)}</td><td>${esc(o.items.map((i: any) => `${i.qty} × ${i.name}`).join(', '))}</td><td>${esc(o.total)}</td><td><span class="mk-pill ${o.stage ? 'go' : /Cancel|Refund/.test(o.statusLabel) ? 'red' : ''}">${esc(o.statusLabel)}</span></td></tr>`).join('')}</tbody></table></div>
        ${d.pages > 1 ? `<div class="mk-pager"><button type="button" class="mk-btn" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${d.page} of ${d.pages}</span><button type="button" class="mk-btn" data-pg="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Next</button></div>` : ''}`
        : '<p class="mk-empty">No orders match. Try another day or clear the search.</p>';
    };
    $('oF').addEventListener('submit', (e: Event) => { e.preventDefault(); f.q = $('oQ').value.trim(); f.status = $('oS').value; f.day = $('oD').value || todayLagos(); f.page = 1; act(null, draw); });
    $('oList').addEventListener('click', (e: Event) => {
      const el = e.target as HTMLElement;
      const pg = el.closest('[data-pg]') as HTMLElement | null; if (pg) { f.page = Number(pg.dataset.pg); act(null, draw); return; }
      const o = el.closest('[data-order]') as HTMLElement | null; if (o) openPage(`orders/${o.dataset.order}`);
    });
    $('oList').addEventListener('keydown', (e: KeyboardEvent) => { const o = (e.target as HTMLElement).closest('[data-order]') as HTMLElement | null; if (o && e.key === 'Enter') openPage(`orders/${o.dataset.order}`); });
    await draw();
  },

  async order() {
    const id = page.slice(7);
    const draw = async () => {
      const d = await api(`order?id=${encodeURIComponent(id)}`);
      const o = d.order;
      $('pTitle').textContent = `Order ${o.ref}`;
      main.innerHTML = `<div class="mk-box"><dl class="mk-dl">
          <dt>Status</dt><dd><span class="mk-pill ${o.stage ? 'go' : ''}">${esc(o.statusLabel)}</span>${o.late ? ' <span class="mk-late">LATE</span>' : ''}</dd>
          <dt>Customer</dt><dd>${esc(o.customer || '—')}</dd>
          ${o.where ? `<dt>Seat / pickup</dt><dd>${esc(o.where)}</dd>` : ''}
          ${o.phone ? `<dt>Phone</dt><dd>${esc(o.phone)}</dd>` : ''}
          <dt>Placed</dt><dd>${esc(dayTime(o.placedAt))}</dd>
          ${o.paidAt ? `<dt>Paid</dt><dd>${esc(dayTime(o.paidAt))}</dd>` : ''}
          <dt>Waiting</dt><dd>${esc(mins(o.minutes))}</dd>
          <dt>How</dt><dd>${o.channel === 'whatsapp' ? 'WhatsApp order' : 'Paid online'}</dd>
          ${o.statusBy ? `<dt>Last change</dt><dd>${esc(o.statusBy)}${o.statusAt ? `, ${esc(dayTime(o.statusAt))}` : ''}</dd>` : ''}
        </dl></div>
        <div class="mk-box"><ul class="mk-items" style="border-top:0">${o.items.map((i: any) => `<li>${esc(i.qty)} × ${esc(i.name)}${i.note ? `<em>${esc(i.note)}</em>` : ''}</li>`).join('')}</ul>
          ${o.note ? `<div class="mk-onote" style="margin-top:10px">Note: ${esc(o.note)}</div>` : ''}
          <p style="margin:10px 0 0;font-size:20px"><b>Total ${esc(o.total)}</b></p></div>
        <h2 style="font-size:22px;margin:0 0 6px">Change status</h2>
        ${d.moves.length ? `<div class="mk-actions">${d.moves.map((m: any) => `<button type="button" class="mk-btn ${m.next ? 'go big' : m.cancel ? 'danger' : ''}" data-to="${esc(m.to)}" data-label="${esc(m.label)}" data-cancel="${m.cancel ? 1 : 0}">${m.next ? esc(o.next?.label || m.label) : esc(m.label)}</button>`).join('')}</div>` : '<p class="mk-empty">No more changes for this order.</p>'}
        ${o.status === 'DELIVERED' ? `<h2 style="font-size:22px;margin:14px 0 6px">Receipt</h2><div class="mk-actions"><button type="button" class="mk-btn go" id="rcWa">Send receipt on WhatsApp</button><button type="button" class="mk-btn" id="rcEmail">Email receipt</button></div>` : ''}
        <div class="mk-actions"><button type="button" class="mk-btn" id="allOrders">All orders</button></div>`;
      $('allOrders').addEventListener('click', () => openPage('orders'));
      $('rcWa')?.addEventListener('click', async () => {
        await sendReceiptWhatsApp(id, toast);
      });
      $('rcEmail')?.addEventListener('click', async () => {
        try { const r = await api('receipt', { method: 'POST', body: { id, via: 'email' } }); toast(r.receipt.emailed ? `Receipt emailed to ${r.receipt.email}.` : r.receipt.email ? 'The email could not be sent. Try WhatsApp.' : 'This order has no email address. Use WhatsApp.'); } catch (err: any) { toast(err.message); }
      });
    };
    main.addEventListener('click', async (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-to]') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.cancel === '1' && !(await confirmBox('Cancel this order?', 'The order will be cancelled and the customer will see it as cancelled. This is recorded under your name.', 'Cancel order', true))) return;
      await act(b, async () => { const r = await api('order', { method: 'POST', body: { id, to: b.dataset.to } }); await draw(); if (r.receipt) await afterMove(id, r); else { toast(`Order moved to ${b.dataset.label}.`); try { (window.parent as any).mkShell?.alarmsNow?.(); } catch { /* */ } } });
    });
    await draw();
  },

  async menu() {
    const draw = async () => {
      const d = await api('menu');
      main.innerHTML = d.groups.length ? d.groups.map((g: any) => `<section class="mk-section"><h2>${esc(g.name)}</h2>${g.dishes.map((m: any) => `
        <div class="mk-dish${m.soldOut ? ' out' : ''}"><div class="n">${esc(m.emoji)} ${esc(m.name)}<small>${m.soldOut ? 'Sold out' : m.available ? 'On the menu' : 'Hidden from the menu (admin)'}${d.canPrice ? '' : ` · ${esc(m.priceText)}`}</small></div>
        <div class="ctl">${d.canPrice ? `<form class="price" data-price="${esc(m.id)}"><label class="mk-sr" for="p_${esc(m.id)}">Price of ${esc(m.name)} in naira</label>₦<input class="mk-input" id="p_${esc(m.id)}" inputmode="decimal" value="${esc(m.price)}" /><button class="mk-btn" type="submit">Save price</button></form>` : ''}
          ${m.soldOut ? `<button type="button" class="mk-btn go" data-dish="${esc(m.id)}" data-act="back">Back on</button>` : `<button type="button" class="mk-btn danger" data-dish="${esc(m.id)}" data-act="soldout">Mark sold out</button>`}</div></div>`).join('')}</section>`).join('')
        : '<p class="mk-empty">The menu is empty. Dishes are added in the website admin (Menu & Prices).</p>';
    };
    main.addEventListener('click', (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-dish]') as HTMLButtonElement | null;
      if (b) act(b, async () => { await api('menu', { method: 'POST', body: { id: b.dataset.dish, action: b.dataset.act } }); toast(b.dataset.act === 'soldout' ? 'Marked sold out. Fans can no longer order it.' : 'Back on the menu.'); await draw(); });
    });
    main.addEventListener('submit', (e: Event) => {
      const f = (e.target as HTMLElement).closest('[data-price]') as HTMLFormElement | null;
      if (!f) return;
      e.preventDefault();
      const v = (f.querySelector('input') as HTMLInputElement).value.trim();
      if (v === '' || !/^\d+(\.\d{1,2})?$/.test(v.replace(/[,\s₦]/g, ''))) { toast('Enter the price as a number, e.g. 2500.'); return; }
      act(f.querySelector('button'), async () => { const r = await api('menu', { method: 'POST', body: { id: f.dataset.price, action: 'price', price: v } }); toast(`Price saved: ${r.price}.`); await draw(); });
    });
    await draw();
  },

  async analytics() {
    main.innerHTML = `<form class="mk-filters" id="aF"><div class="mk-field"><label for="aD">Day</label><input id="aD" type="date" value="${todayLagos()}" /></div><button class="mk-btn go" type="submit">Show</button></form><div id="aOut"></div>`;
    const draw = async () => {
      const d = await api(`analytics?day=${encodeURIComponent($('aD').value || todayLagos())}`);
      const maxD = Math.max(1, ...d.topDishes.map((x: any) => x.qty)), maxH = Math.max(1, ...d.byHour.map((x: any) => x.orders));
      $('aOut').innerHTML = `<div class="mk-stats">
          <div class="mk-stat"><b>${d.orders}</b><span>Orders</span></div><div class="mk-stat"><b>${esc(d.sales)}</b><span>Sales</span></div>
          <div class="mk-stat"><b>${esc(d.average)}</b><span>Average per order</span></div><div class="mk-stat"><b>${d.cancelled}</b><span>Cancelled</span></div></div>
        <section class="mk-section mk-box"><h2>Top 10 dishes</h2>${d.topDishes.length ? `<div class="mk-bars">${d.topDishes.map((x: any) => `<div class="mk-bar"><span>${esc(x.name)}</span><i style="width:${Math.round((x.qty / maxD) * 100)}%"></i><b>${x.qty}</b></div>`).join('')}</div>` : '<p class="mk-status">No paid orders on this day.</p>'}</section>
        <section class="mk-section mk-box"><h2>Orders by hour</h2><div class="mk-hours" role="img" aria-label="Orders by hour">${d.byHour.map((h: any) => `<div class="mk-hour"><b>${h.orders || ''}</b><i style="height:${Math.round((h.orders / maxH) * 150)}px"></i><span>${String(h.hour).padStart(2, '0')}</span></div>`).join('')}</div>
          <p class="mk-status" style="margin-top:8px">Paid orders only. Cancelled orders are left out of sales and dish counts.</p></section>`;
    };
    $('aF').addEventListener('submit', (e: Event) => { e.preventDefault(); act(null, draw); });
    await draw();
  },

  async shift() {
    const draw = async () => {
      const d = await api('shift');
      main.innerHTML = `<div class="mk-box" style="text-align:center">
          <p style="font-size:20px;margin:0 0 12px">${d.onShift ? `You have been on shift since <b>${esc(hm(d.since))}</b>.` : "You're not on shift."}</p>
          <button type="button" class="mk-btn big ${d.onShift ? 'danger' : 'go'}" id="shBtn" style="min-width:260px">${d.onShift ? 'End shift' : 'Start shift'}</button></div>
        <section class="mk-section"><h2>In the kitchen now</h2>${d.onNow.length ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>Name</th><th>Role</th><th>Since</th></tr></thead><tbody>${d.onNow.map((p: any) => `<tr><td><b>${esc(p.name)}</b> <span class="mk-status">${esc(p.code)}</span></td><td>${esc(p.role)}</td><td>${esc(hm(p.since))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="mk-empty">Nobody is on shift.</p>'}</section>
        <section class="mk-section"><h2>Your last 10 shifts</h2>${d.last.length ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>Date</th><th>Start</th><th>End</th><th>Length</th></tr></thead><tbody>${d.last.map((s: any) => {
          const m = s.ended_at ? Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000) : null;
          return `<tr><td>${esc(dayOnly(s.started_at))}</td><td>${esc(hm(s.started_at))}</td><td>${s.ended_at ? esc(hm(s.ended_at)) : '<span class="mk-pill go">On shift</span>'}</td><td>${m === null ? '—' : `${Math.floor(m / 60)} h ${m % 60} min`}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="mk-empty">No shifts yet.</p>'}</section>`;
      $('shBtn').addEventListener('click', async () => {
        if (d.onShift && !(await confirmBox('End your shift?', 'Your shift end time is recorded under your name.', 'End shift', true))) return;
        await act($('shBtn'), async () => { await api('shift', { method: 'POST', body: { action: d.onShift ? 'end' : 'start' } }); toast(d.onShift ? 'Shift ended. Thank you.' : 'Shift started.'); shell?.shiftChanged(); await draw(); });
      });
    };
    await draw(); every15(async () => { /* keep "in the kitchen now" fresh */ if (!busy()) await draw(); });
  },

  async handover() {
    main.innerHTML = `<form class="mk-box" id="nF"><div class="mk-field"><label for="nT">New note for the next shift</label><textarea id="nT" maxlength="1000" placeholder="e.g. Jollof rice running low, about 20 portions left."></textarea></div><button class="mk-btn go big" type="submit">Post note</button></form><div id="nList"></div>`;
    const draw = async (quiet = false) => {
      const d = await api('notes', { quiet });
      $('nList').innerHTML = d.notes.length ? `<div class="mk-notes">${d.notes.map((n: any) => `<article class="mk-notecard${n.pinned ? ' pin' : ''}"><p>${n.pinned ? '📌 ' : ''}${esc(n.text)}</p>
        <div class="meta"><span>${esc(n.author)} (${esc(n.code || '')}) · ${esc(dayTime(n.at))}</span><span>
          ${d.canManage ? `<button type="button" class="mk-btn" data-note="${esc(n.id)}" data-act="${n.pinned ? 'unpin' : 'pin'}">${n.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
          ${d.canManage || n.mine ? `<button type="button" class="mk-btn danger" data-note="${esc(n.id)}" data-act="delete">Delete</button>` : ''}</span></div></article>`).join('')}</div>` : '<p class="mk-empty">No handover notes yet.</p>';
    };
    $('nF').addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const t = $('nT').value.trim();
      if (t.length < 2) { toast('Write the note first.'); return; }
      act(($('nF') as HTMLFormElement).querySelector('button'), async () => { await api('notes', { method: 'POST', body: { action: 'add', text: t } }); $('nT').value = ''; toast('Note posted.'); await draw(); });
    });
    $('nList').addEventListener('click', async (e: Event) => {
      const b = (e.target as HTMLElement).closest('[data-note]') as HTMLButtonElement | null;
      if (!b) return;
      if (b.dataset.act === 'delete' && !(await confirmBox('Delete this note?', 'It will be removed for everyone.', 'Delete', true))) return;
      act(b, async () => { await api('notes', { method: 'POST', body: { action: b.dataset.act, id: b.dataset.note } }); await draw(); });
    });
    await draw(); every15(() => draw(true));
  },

  async activity() {
    const f = { staff: '', day: '', page: 1 };
    const first = await api('activity?page=1');
    main.innerHTML = `${first.all ? `<form class="mk-filters" id="acF">
        <div class="mk-field"><label for="acS">Staff member</label><select id="acS"><option value="">Everyone</option>${first.staff.map((s: any) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="mk-field"><label for="acD">Date</label><input id="acD" type="date" /></div>
        <button class="mk-btn go" type="submit">Show</button><a class="mk-btn" id="acCsv" href="/api/matchday-kitchen/activity?format=csv" download>Download CSV</a></form>` : '<p class="mk-status">Everything you have done here.</p>'}<div id="acList"></div>`;
    const drawRows = (d: any) => {
      $('acList').innerHTML = d.rows.length ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>When</th>${d.all ? '<th>Who</th>' : ''}<th>What happened</th></tr></thead><tbody>${d.rows.map((a: any) => `<tr><td style="white-space:nowrap">${esc(dayTime(a.at))}</td>${d.all ? `<td>${esc(a.who || '')}<br><span class="mk-status">${esc(a.code || '')}</span></td>` : ''}<td>${esc(a.action)}${a.details ? `<br><span class="mk-status" style="text-transform:none;letter-spacing:0">${esc(a.details)}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
        ${d.pages > 1 ? `<div class="mk-pager"><button type="button" class="mk-btn" data-pg="${d.page - 1}" ${d.page <= 1 ? 'disabled' : ''}>Newer</button><span>Page ${d.page} of ${d.pages}</span><button type="button" class="mk-btn" data-pg="${d.page + 1}" ${d.page >= d.pages ? 'disabled' : ''}>Older</button></div>` : ''}`
        : '<p class="mk-empty">Nothing recorded yet.</p>';
    };
    const draw = async () => drawRows(await api(`activity?${new URLSearchParams({ staff: f.staff, day: f.day, page: String(f.page) })}`));
    drawRows(first);
    if (first.all) {
      const csvHref = () => { $('acCsv').href = `/api/matchday-kitchen/activity?${new URLSearchParams({ staff: f.staff, day: f.day, format: 'csv' })}`; };
      $('acF').addEventListener('submit', (e: Event) => { e.preventDefault(); f.staff = $('acS').value; f.day = $('acD').value; f.page = 1; csvHref(); act(null, draw); });
    }
    $('acList').addEventListener('click', (e: Event) => { const pg = (e.target as HTMLElement).closest('[data-pg]') as HTMLElement | null; if (pg) { f.page = Number(pg.dataset.pg); act(null, draw); } });
  },

  async staff() {
    if (!session.perms.staff) { notAvailable(); return; }
    // A new login code shows once, at the top of the page, ready to send.
    let codeShown: { name: string; staffId: string; loginCode: string } | null = null;
    const codeMsg = (c: { name: string; loginCode: string }) => `MatchDay Kitchen login for ${c.name}\n1. Open https://lobistarsfc.com/matchday-kitchen\n2. Enter this login code: ${c.loginCode}\nIt is personal to you: please keep it private.`;
    const draw = async () => {
      const d = await api('staff');
      const sa = !!session.perms.superAdmin;
      const canEdit = (s: any) => sa || s.role !== 'supervisor';
      const roleOpts = (sel = '') => Object.entries(d.addRoles).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');
      const roleChecks = (name: string, on: string[]) => Object.entries(d.roles).map(([k, v]) => `<label style="display:flex;gap:8px;align-items:center;min-height:44px"><input type="checkbox" name="${name}" value="${k}" ${on.includes(k) ? 'checked' : ''} style="width:24px;height:24px" /> ${esc(v)}</label>`).join('');
      main.innerHTML = `
        ${codeShown ? `<section class="mk-section"><div class="mk-box mk-codebox" role="status"><p style="margin:0">Login code for <b>${esc(codeShown.name)}</b> (${esc(codeShown.staffId)})</p>
          <div class="mk-codeshow">${esc(codeShown.loginCode)}</div>
          <p style="margin:0 0 10px">It is shown <b>only now</b>. Send it to them privately. They open lobistarsfc.com/matchday-kitchen and type it to sign in.</p>
          <div class="mk-actions" style="justify-content:flex-start"><a class="mk-btn go" href="https://wa.me/?text=${encodeURIComponent(codeMsg(codeShown))}" target="_blank" rel="noopener">Send on WhatsApp</a><button type="button" class="mk-btn" id="codeCopy">Copy</button><button type="button" class="mk-btn" id="codeDone">Done</button></div></div></section>` : ''}
        <section class="mk-section"><h2>Kitchen staff <span class="mk-badge">${d.staff.length}</span></h2>
          ${d.staff.length ? `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th>Name</th><th>Staff ID</th><th>Role</th><th>Can sign in</th><th>Last sign-in</th><th></th></tr></thead><tbody>${d.staff.map((s: any) => `
            <tr><td><b>${esc(s.name)}</b></td><td>${esc(s.staffId)}</td><td>${esc(s.roleLabel)}</td><td>${s.active ? (s.hasCode ? '<span class="mk-pill go">Yes</span>' : '<span class="mk-pill red">Needs a login code</span>') : '<span class="mk-pill red">Switched off</span>'}</td><td>${s.lastLogin ? esc(dayTime(s.lastLogin)) : 'Never'}</td>
            <td>${canEdit(s) ? `<button type="button" class="mk-btn" data-edit="${esc(s.id)}">Edit</button>` : ''}</td></tr>
            ${canEdit(s) ? `<tr id="ed_${esc(s.id)}" hidden><td colspan="6"><form class="mk-box" data-editform="${esc(s.id)}" style="margin:0">
              <div class="mk-filters"><div class="mk-field"><label>Full name</label><input name="name" value="${esc(s.name)}" maxlength="80" /></div>
              <div class="mk-field"><label>Role</label><select name="role">${roleOpts(s.role)}</select></div>
              </div>
              <label style="display:flex;gap:10px;align-items:center;min-height:48px;font-size:18px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} style="width:26px;height:26px" /> Can sign in</label>
              <p class="mk-status" style="text-transform:none;letter-spacing:0">A new login code or switching someone off signs them out on every tablet straight away.</p>
              <div class="mk-actions" style="justify-content:flex-start"><button class="mk-btn go" type="submit">Save changes</button><button type="button" class="mk-btn" data-newcode="${esc(s.id)}" data-name="${esc(s.name)}">Give a new login code</button></div></form></td></tr>` : ''}`).join('')}</tbody></table></div>` : '<p class="mk-empty">No kitchen staff yet. Add the first person below.</p>'}
        </section>
        <section class="mk-section"><h2>Add staff</h2><form class="mk-box" id="addF">
          <div class="mk-filters"><div class="mk-field"><label for="aName">Full name</label><input id="aName" maxlength="80" /></div>
          <div class="mk-field"><label for="aRole">Role</label><select id="aRole">${roleOpts('cook')}</select></div>
          </div>
          <p class="mk-status" style="text-transform:none;letter-spacing:0">No email or password: the website gives this person a Staff ID and an 8-number login code.${sa ? '' : ' Only a Super Admin can add a kitchen supervisor.'}</p>
          <button class="mk-btn go big" type="submit">Add staff and make login code</button></form></section>
        <section class="mk-section"><h2>Settings</h2><form class="mk-box" id="setF">
          <div class="mk-field"><label for="sTg">Telegram channel link (shows the Telegram updates button)</label><input id="sTg" placeholder="https://t.me/yourchannel" value="${esc(d.settings.telegramUrl)}" /></div>
          <div class="mk-filters" style="align-items:flex-start"><fieldset class="mk-field" style="border:0;padding:0"><legend class="mk-label">Who can cancel orders</legend>${roleChecks('cancel', d.settings.cancelRoles)}</fieldset>
          <fieldset class="mk-field" style="border:0;padding:0"><legend class="mk-label">Who can change prices</legend>${roleChecks('price', d.settings.priceRoles)}</fieldset>
          <div class="mk-field"><label for="sLate">Orders are late after (minutes)</label><input id="sLate" type="number" min="1" max="120" value="${d.settings.lateMinutes}" /></div></div>
          <p class="mk-status" style="text-transform:none;letter-spacing:0">Super admins can always cancel orders and change prices.</p>
          <button class="mk-btn go" type="submit">Save settings</button></form></section>
        ${sa ? `<section class="mk-section"><h2>Data check</h2><div class="mk-box"><p style="margin:0 0 10px">Checks that MatchDay Kitchen can read the website's orders and menu.</p><button type="button" class="mk-btn" id="chk">Run the data check</button><div id="chkOut" style="margin-top:10px"></div></div></section>` : ''}`;
      window.scrollTo(0, 0);
    };
    main.addEventListener('click', (e: Event) => {
      const el = e.target as HTMLElement;
      const ed = el.closest('[data-edit]') as HTMLElement | null;
      if (ed) { const row = $(`ed_${ed.dataset.edit}`); row.hidden = !row.hidden; return; }
      const nc = el.closest('[data-newcode]') as HTMLButtonElement | null;
      if (nc) {
        if (!confirm(`Give ${nc.dataset.name} a new login code? Their old code stops working and they are signed out straight away.`)) return;
        act(nc, async () => { const r = await api('staff', { method: 'POST', body: { action: 'edit', id: nc.dataset.newcode, newCode: true } }); codeShown = r; await draw(); });
        return;
      }
      if (el.id === 'codeDone') { codeShown = null; act(null, draw); return; }
      if (el.id === 'codeCopy' && codeShown) { navigator.clipboard?.writeText(codeMsg(codeShown)).then(() => toast('Copied.'), () => toast('Copy failed: write the code down instead.')); return; }
      if (el.id === 'chk') act(el as HTMLButtonElement, async () => {
        const d = await api('check');
        $('chkOut').innerHTML = d.steps.map((s: any) => `<p class="${s.ok ? 'mk-ok' : 'mk-err'}" style="margin:0 0 6px"><b>${s.ok ? 'OK' : 'PROBLEM'}</b> · ${esc(s.name)}: ${esc(s.detail)}</p>`).join('');
      });
    });
    main.addEventListener('submit', (e: Event) => {
      e.preventDefault();
      const form = e.target as HTMLFormElement;
      if (form.id === 'addF') {
        act(form.querySelector('button'), async () => { const r = await api('staff', { method: 'POST', body: { action: 'add', name: $('aName').value, role: $('aRole').value } }); codeShown = r; toast('Staff account added.'); await draw(); });
      } else if (form.id === 'setF') {
        const vals = (n: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${n}"]:checked`)].map(i => i.value);
        act(form.querySelector('button'), async () => { await api('staff', { method: 'POST', body: { action: 'settings', telegramUrl: $('sTg').value.trim(), cancelRoles: vals('cancel'), priceRoles: vals('price'), lateMinutes: $('sLate').value } }); toast('Settings saved.'); shell?.shiftChanged(); await draw(); });
      } else if (form.dataset.editform) {
        const g = (n: string) => form.querySelector(`[name="${n}"]`) as HTMLInputElement;
        act(form.querySelector('button'), async () => { await api('staff', { method: 'POST', body: { action: 'edit', id: form.dataset.editform, name: g('name').value, role: g('role').value, active: g('active').checked } }); toast('Changes saved.'); await draw(); });
      }
    });
    await draw();
  },

  async 'not-available'() { notAvailable(); },
};

(async () => {
  try { await loadSession(); } catch (e) { if ((e as ApiError).status === 401) return; main.innerHTML = `<p class="mk-err">${esc((e as Error).message)}</p>`; return; }
  const key = page.startsWith('orders/') ? 'order' : page;
  const run = PAGES[key];
  document.title = `${pageTitle(page)} | MatchDay Kitchen | Lobi Stars FC`;
  $('pTitle').textContent = pageTitle(page);
  if (iconFor(page)) $('pTitle').insertAdjacentHTML('beforebegin', `<span class="mk-ico" style="margin:0">${iconFor(page)}</span>`);
  if (!run) { notAvailable(); return; }
  try { await run(); }
  catch (e) {
    if ((e as ApiError).data?.denied || (e as ApiError).status === 403) notAvailable();
    else if ((e as ApiError).status !== 401) main.innerHTML = `<p class="mk-err">${esc((e as Error).message)}</p><div class="mk-actions"><button type="button" class="mk-btn go" id="retry">Try again</button></div>`;
    $('retry')?.addEventListener('click', () => location.reload());
  }
})();

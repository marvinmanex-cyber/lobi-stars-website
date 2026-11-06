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
const busy = () => Date.now() - lastTouch < 5000 || ($('pDialog') as HTMLDialogElement).open || ($('payDlg') as HTMLDialogElement).open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
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

// ── Record a WhatsApp payment: the evidence, then the order goes on as if paid online ──
let payOrder: { id: string; ref: string; total: string; totalNaira: number } | null = null, payProof = '', payFileName = '', payDone: (() => void) | null = null;
/** A photo becomes a small JPEG (phone photos are several MB); a PDF goes as it is. */
async function readProof(file: File): Promise<{ data: string; preview: boolean }> {
  const asDataUrl = (b: Blob) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('That file could not be read.')); r.readAsDataURL(b); });
  if (file.type.startsWith('image/')) {
    try {
      const img = await createImageBitmap(file);
      // Smaller and smaller until it fits (about 1.4 MB, the limit is 1.5). White behind see-through screenshots.
      for (const [side, q] of [[1500, 0.75], [1500, 0.55], [1100, 0.55], [800, 0.5], [600, 0.45]] as const) {
        const k = Math.min(1, side / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/jpeg', q);
        if (data.length * 0.75 < 1400 * 1024) return { data, preview: true };
      }
    } catch { /* this browser can't draw it: send it as it is */ }
  }
  if (file.size > 1500 * 1024) throw new Error('That file is too big (the most is 1.5 MB). Send a screenshot instead.');
  return { data: await asDataUrl(file), preview: false };
}
function openPay(o: { id: string; ref: string; total: string; totalNaira: number }, done: () => void) {
  payOrder = o; payProof = ''; payFileName = ''; payDone = done;
  $('payF').hidden = false; $('payDone').hidden = true;
  $('paySum').textContent = `Order ${o.ref} · Total ${o.total}. Only do this once you have seen the fan's receipt. The order then goes to the kitchen as if it was paid online.`;
  ($('payF') as HTMLFormElement).reset();
  $('payAmt').value = String(o.totalNaira);
  $('payPrev').hidden = true; $('payPrev').removeAttribute('src'); $('payName').hidden = true; $('payErr').hidden = true;
  $('payPick').textContent = 'Tap to add the receipt: photo, screenshot or PDF';
  ($('payDlg') as HTMLDialogElement).showModal();
}
$('payFile').addEventListener('change', async () => {
  const f = ($('payFile') as HTMLInputElement).files?.[0];
  if (!f) return;
  $('payErr').hidden = true;
  try {
    const r = await readProof(f);
    payProof = r.data; payFileName = f.name;
    $('payPick').textContent = 'Change the receipt';
    if (r.preview) { $('payPrev').src = r.data; $('payPrev').hidden = false; $('payName').hidden = true; }
    else { $('payPrev').hidden = true; $('payName').textContent = `Added: ${f.name}`; $('payName').hidden = false; }
  } catch (e) { payProof = ''; $('payErr').textContent = (e as Error).message; $('payErr').hidden = false; }
});
async function sendPayment(allowDuplicate = false) {
  if (!payOrder) return;
  const err = $('payErr'), btn = $('paySave') as HTMLButtonElement;
  err.hidden = true;
  if (!payProof) { err.textContent = 'Add the payment evidence first: a photo or screenshot of the receipt, or its PDF.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await api('payment', { method: 'POST', body: { id: payOrder.id, method: $('payHow').value, amount: $('payAmt').value, note: $('payNote').value, proof: payProof, fileName: payFileName, allowDuplicate } });
    $('payF').hidden = true; $('payDone').hidden = false;
    $('payDoneT').textContent = `Order ${r.ref} is paid (${r.amount}, ${r.method}) and has gone to the kitchen, which is told to start cooking. The evidence is saved with the order.`;
    const tell = $('payTell') as HTMLAnchorElement;
    tell.hidden = !r.chatUrl; if (r.chatUrl) tell.href = r.chatUrl;
    if (!r.chatUrl) $('payDoneT').textContent += ' The fan is told from the official MatchDay Kitchen WhatsApp device.';
    shell?.alarmsNow?.();
    payDone?.();
  } catch (e: any) {
    if (e.data?.duplicate && e.data?.canOverride && confirm(`${e.message}\n\nIs this really a new payment? Press OK only if you have checked. Your name is recorded.`)) { btn.disabled = false; btn.textContent = 'Mark order paid'; return sendPayment(true); }
    err.textContent = e.message; err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Mark order paid'; }
}
$('payF').addEventListener('submit', (e: Event) => { e.preventDefault(); sendPayment(); });
$('payNo').addEventListener('click', () => ($('payDlg') as HTMLDialogElement).close());
$('payClose').addEventListener('click', () => ($('payDlg') as HTMLDialogElement).close());

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
    ${t.status === 'PAID' && !session.perms.confirm ? '<div class="mk-status">Waiting for a supervisor to confirm it</div>'
      : t.next ? `<button type="button" class="mk-btn go big wide" data-move="${esc(t.id)}" data-to="${esc(t.next.to)}">${esc(t.next.label)}</button>` : ''}
    ${t.status === 'PAID' && session.perms.confirm ? `<button type="button" class="mk-btn danger wide" data-move="${esc(t.id)}" data-to="CANCELLED">Reject order</button>` : ''}
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
  if (b.dataset.to === 'CANCELLED' && !confirm('Reject this order? The fan sees it as cancelled. This order is already paid, so the money has to be refunded. Your name is recorded.')) return;
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
      const unpaidCard = (o: any) => `<article class="mk-unpaid${o.failed ? ' failed' : ''}${o.status === 'AWAITING_WHATSAPP' ? ' confirm-me' : ''}"><div class="mk-unpaid-top"><b>${esc(o.ref)}</b><span>${esc(o.statusLabel)}</span><span class="r">${esc(mins(o.minutes))}${o.minutes >= 1 ? ' ago' : ''}</span></div>
        <div>${esc([o.customer, o.where].filter(Boolean).join(' · '))}${o.phone ? ` · ${esc(o.phone)}` : ''}</div>
        <div class="mk-status">${esc(o.items.map((i: any) => `${i.qty} × ${i.name}`).join(', '))} · <b>${esc(o.total)}</b>${o.channel === 'whatsapp' ? ' · WhatsApp order' : ''}</div>
        <div class="mk-actions" style="justify-content:flex-start;margin:6px 0 0">${o.chatUrl ? `<a class="mk-btn" href="${esc(o.chatUrl)}" target="mdk-whatsapp" rel="noopener">Reply on WhatsApp</a>` : ''}${o.status === 'AWAITING_WHATSAPP' && session.perms.confirm ? `<button type="button" class="mk-btn go" data-confirm="${esc(o.id)}">Confirm order</button>` : ''}${o.canPay && session.perms.payment ? `<button type="button" class="mk-btn go" data-pay="${esc(o.id)}">Record payment</button>` : ''}${['AWAITING_WHATSAPP', 'CONFIRMED'].includes(o.status) && session.perms.confirm ? `<button type="button" class="mk-btn danger" data-reject="${esc(o.id)}">Reject order</button>` : ''}${o.status === 'AWAITING_WHATSAPP' && !session.perms.confirm ? '<span class="mk-status">Waiting for a supervisor</span>' : ''}</div></article>`;
      const unpaidHtml = `<section class="mk-unpaid-box" aria-label="Awaiting payment"><h2>Awaiting payment <span class="mk-badge">${waiting.length}</span> <small>Not paid yet: do not cook. A paid order moves to New by itself.</small></h2>
        ${waiting.length ? `<div class="mk-unpaid-grid">${waiting.map(unpaidCard).join('')}</div>` : '<p class="mk-status" style="margin:4px 6px">Nobody is waiting to pay.</p>'}
        ${failed.length ? `<h3>Did not pay <span class="mk-badge red">${failed.length}</span> <small>Payment failed or ran out of time (last 12 hours). Ask them what went wrong.</small></h3><div class="mk-unpaid-grid">${failed.map(unpaidCard).join('')}</div>` : ''}</section>`;
      (main as any)._unpaid = up;
      main.innerHTML = unpaidHtml + `<div class="mk-board">${Object.values(d.columns).map((c: any) => `<section class="mk-col"><h2>${esc(c.label)} <span class="mk-badge">${c.orders.length}</span></h2>${c.orders.length ? c.orders.map((o: any) => `
        <button type="button" class="mk-mini${o.late ? ' late' : ''}${o.status === 'PAID' ? ' is-new' : ''}" data-order="${esc(o.id)}"><b>${esc(o.ref)}</b><span class="r">${esc(mins(o.minutes))}</span>
        <span>${o.itemCount} item${o.itemCount === 1 ? '' : 's'}${o.customer ? ` · ${esc(o.customer)}` : ''}</span></button>`).join('') : '<p class="mk-status" style="margin:8px 6px">None</p>'}</section>`).join('')}</div>`;
      stamp();
    };
    main.addEventListener('click', e => {
      const c = (e.target as HTMLElement).closest('[data-confirm]') as HTMLButtonElement | null;
      if (c) {
        // WhatsApp opens at once (browsers block it after a wait), with the payment message ready: staff press send.
        const url = (main as any)._unpaid.find((x: any) => x.id === c.dataset.confirm)?.chatUrl;
        if (url) window.open(url, 'mdk-whatsapp');
        act(c, async () => { await api('order', { method: 'POST', body: { id: c.dataset.confirm, to: 'CONFIRMED' } }); toast(url ? 'Confirmed. Press send in WhatsApp to give the fan the payment details.' : 'Confirmed. Replies go from the official MatchDay Kitchen WhatsApp device.'); shell?.alarmsNow?.(); await draw(); });
        return;
      }
      const rj = (e.target as HTMLElement).closest('[data-reject]') as HTMLButtonElement | null;
      if (rj) {
        if (!confirm('Reject this order? The fan sees it as cancelled. Your name is recorded.')) return;
        act(rj, async () => { await api('order', { method: 'POST', body: { id: rj.dataset.reject, to: 'CANCELLED' } }); toast('Order rejected.'); shell?.alarmsNow?.(); await draw(); });
        return;
      }
      const p = (e.target as HTMLElement).closest('[data-pay]') as HTMLElement | null;
      if (p) { const o = (main as any)._unpaid.find((x: any) => x.id === p.dataset.pay); if (o) openPay(o, () => { draw(); }); return; }
      const b = (e.target as HTMLElement).closest('[data-order]') as HTMLElement | null; if (b) openPage(`orders/${b.dataset.order}`);
    });
    await draw(); every15(() => draw(true));
  },

  async delivery() {
    const draw = async (quiet = false) => {
      const d = await api('delivery', { quiet });
      main.innerHTML = d.groups.length ? d.groups.map((g: any, i: number) => `<section class="mk-section mk-stand"><h2>${esc(g.name)} <span class="mk-badge${g.ready.length ? ' red' : ''}">${g.ready.length}</span>${g.cooking ? ` <small>${g.cooking} still cooking</small>` : ''}</h2>
        ${g.ready.length ? `${g.ready.length > 1 ? `<button type="button" class="mk-btn" data-all="${i}">Mark all ${g.ready.length} delivered</button>` : ''}${g.ready.map((o: any) => `<article class="mk-runner${o.late ? ' late' : ''}"><div class="mk-runner-seat">${esc(o.seat || (g.pickup ? 'Pickup' : '—'))}</div>
          <div class="mk-runner-main"><b>${esc(o.ref)}${o.customer ? ` · ${esc(o.customer)}` : ''}</b><span>${esc(o.items.map((x: any) => `${x.qty} × ${x.name}`).join(', '))}</span>${o.note ? `<span class="mk-status">Note: ${esc(o.note)}</span>` : ''}${o.late ? `<span class="mk-pill red">Late: ${esc(mins(o.minutes))}</span>` : ''}</div>
          <button type="button" class="mk-btn go" data-done="${esc(o.id)}">${g.pickup ? 'Collected' : 'Delivered'}</button></article>`).join('')}` : '<p class="mk-status" style="margin:4px 6px">Nothing on the way to this stand yet.</p>'}</section>`).join('')
        : '<p class="mk-empty">Nothing to deliver. Orders appear here when the kitchen presses "Food on the way".</p>';
      (main as any)._groups = d.groups;
      stamp();
    };
    main.addEventListener('click', e => {
      const el = e.target as HTMLElement;
      const one = el.closest('[data-done]') as HTMLButtonElement | null;
      if (one) { act(one, async () => { await api('order', { method: 'POST', body: { id: one.dataset.done, to: 'DELIVERED' } }); toast('Marked delivered. The receipt email has gone if the fan gave an address.'); await draw(); }); return; }
      const all = el.closest('[data-all]') as HTMLButtonElement | null;
      if (all) {
        const g = (main as any)._groups[Number(all.dataset.all)];
        if (!g || !confirm(`Mark all ${g.ready.length} orders for ${g.name} as delivered?`)) return;
        act(all, async () => { let n = 0; for (const o of g.ready) { try { await api('order', { method: 'POST', body: { id: o.id, to: 'DELIVERED' } }); n++; } catch { /* already moved on another tablet */ } } toast(`${n} order${n === 1 ? '' : 's'} marked delivered.`); await draw(); });
      }
    });
    await draw(); every15(() => draw(true));
  },

  async alerts() {
    const draw = async (quiet = false) => {
      const d = await api('alerts', { quiet });
      main.innerHTML = `
        <section class="mk-section"><h2>Late orders <span class="mk-badge${d.late.length ? ' red' : ''}">${d.late.length}</span></h2>
          ${d.late.length ? `<div class="mk-ord-grid">${d.late.map(ticketHtml).join('')}</div>` : `<p class="mk-empty">No late orders. Orders count as late after ${d.lateMinutes} minutes.</p>`}</section>
        <section class="mk-section"><h2>Dishes turned off <span class="mk-badge${d.soldOut.length ? ' red' : ''}">${d.soldOut.length}</span></h2>
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
          <dt>How</dt><dd>${o.channel === 'whatsapp' ? (o.paid ? 'WhatsApp order, paid' : 'WhatsApp order, not paid yet') : 'Paid online'}</dd>
          ${d.payment ? `<dt>Payment</dt><dd>${esc(d.payment.amount)}, ${esc(d.payment.method)}${d.payment.note ? `<br />${esc(d.payment.note)}` : ''}<br /><small>Recorded by ${esc(d.payment.by)}${d.payment.code ? ` (${esc(d.payment.code)})` : ''}, ${esc(dayTime(d.payment.at))}</small>${d.payment.duplicateOf ? `<br /><span class="mk-pill red">Same receipt as ${esc(d.payment.duplicateOf)} (allowed)</span>` : ''}</dd>` : ''}
          ${o.statusBy ? `<dt>Last change</dt><dd>${esc(o.statusBy)}${o.statusAt ? `, ${esc(dayTime(o.statusAt))}` : ''}</dd>` : ''}
        </dl></div>
        <div class="mk-box"><ul class="mk-items" style="border-top:0">${o.items.map((i: any) => `<li>${esc(i.qty)} × ${esc(i.name)}${i.note ? `<em>${esc(i.note)}</em>` : ''}</li>`).join('')}</ul>
          ${o.note ? `<div class="mk-onote" style="margin-top:10px">Note: ${esc(o.note)}</div>` : ''}
          <p style="margin:10px 0 0;font-size:20px"><b>Total ${esc(o.total)}</b></p></div>
        ${d.canRecordPayment ? `<div class="mk-box mk-paybox"><b>Has the fan sent a receipt on WhatsApp?</b><p style="margin:4px 0 10px">Add it here and mark the order paid. It goes to the kitchen as if it was paid online.</p><button type="button" class="mk-btn go big" id="recPay">Record payment</button></div>` : d.needsPaymentRole ? '<p class="mk-status" style="text-transform:none;letter-spacing:0">Waiting for payment. A supervisor or Super Admin records it when the fan sends the receipt.</p>' : ''}
        ${d.payment ? `<div class="mk-box"><h2 style="font-size:20px;margin:0 0 8px">Payment evidence</h2>${d.payment.isPdf ? '' : `<a href="/api/matchday-kitchen/payment-proof?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener"><img class="mk-proofimg" src="/api/matchday-kitchen/payment-proof?id=${encodeURIComponent(o.id)}" alt="The payment evidence for this order" loading="lazy" /></a>`}<a class="mk-btn" href="/api/matchday-kitchen/payment-proof?id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener">${d.payment.isPdf ? 'Download the PDF receipt' : 'Open it full size'}</a></div>` : ''}
        ${d.chat ? `<div class="mk-actions" style="justify-content:flex-start"><a class="mk-btn go" href="${esc(d.chat.url)}" target="mdk-whatsapp" rel="noopener">${esc(d.chat.label)} on WhatsApp</a></div>` : d.waDevice ? '' : '<p class="mk-status" style="text-transform:none;letter-spacing:0">Replies to fans go only from the official MatchDay Kitchen WhatsApp, 0708 009 4985, on its own device.</p>'}
        <h2 style="font-size:22px;margin:0 0 6px">Change status</h2>
        ${d.moves.length ? `<div class="mk-actions">${d.moves.map((m: any) => `<button type="button" class="mk-btn ${m.next ? 'go big' : m.cancel ? 'danger' : ''}" data-to="${esc(m.to)}" data-label="${esc(m.label)}" data-cancel="${m.cancel ? 1 : 0}">${m.next ? esc(o.next?.label || m.label) : esc(m.label)}</button>`).join('')}</div>` : d.needsSupervisor ? '<p class="mk-empty">A supervisor or Super Admin confirms or rejects this order.</p>' : '<p class="mk-empty">No more changes for this order.</p>'}
        ${o.status === 'DELIVERED' ? `<h2 style="font-size:22px;margin:14px 0 6px">Receipt</h2><div class="mk-actions">${d.waDevice ? '<button type="button" class="mk-btn go" id="rcWa">Send receipt on WhatsApp</button>' : ''}<button type="button" class="mk-btn" id="rcEmail">Email receipt</button></div>` : ''}
        <div class="mk-actions"><button type="button" class="mk-btn" id="allOrders">All orders</button></div>`;
      $('allOrders').addEventListener('click', () => openPage('orders'));
      $('recPay')?.addEventListener('click', () => openPay(o, () => { draw(); }));
      $('rcWa')?.addEventListener('click', async () => {
        await sendReceiptWhatsApp(id, toast);
      });
      $('rcEmail')?.addEventListener('click', async () => {
        try { const r = await api('receipt', { method: 'POST', body: { id, via: 'email' } }); toast(r.receipt.emailed ? `Receipt emailed to ${r.receipt.email}.` : r.receipt.email ? 'The email could not be sent. Send it from the official WhatsApp device.' : 'This order has no email address. Send it from the official WhatsApp device.'); } catch (err: any) { toast(err.message); }
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
      const all = d.groups.flatMap((g: any) => g.dishes), on = all.filter((m: any) => !m.soldOut).length;
      main.innerHTML = (all.length ? `<section class="mk-section"><div class="mk-box mk-allbox"><div><b>${on} of ${all.length} dishes are ON</b><span>Fans can order only dishes that are ON. Changes show on the fans' menu within a minute.</span></div>
          ${d.canAll ? `<div class="mk-actions" style="justify-content:flex-start;margin:0"><button type="button" class="mk-btn go" data-all="all_on">Turn all ON</button><button type="button" class="mk-btn danger" data-all="all_off">Turn all OFF</button></div>` : ''}</div></section>` : '')
        + (d.canMenu ? `<section class="mk-section"><h2>Add a dish</h2><form class="mk-box" id="dishF"><div class="mk-filters">
            <div class="mk-field"><label for="dName">Name</label><input id="dName" maxlength="60" /></div>
            <div class="mk-field"><label for="dCat">Category</label><select id="dCat">${d.categories.map((x: any) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
            <div class="mk-field"><label for="dPrice">Price (₦)</label><input id="dPrice" inputmode="numeric" maxlength="9" /></div>
            <div class="mk-field"><label for="dDesc">Description (optional)</label><input id="dDesc" maxlength="160" /></div></div>
            <button class="mk-btn go" type="submit">Add to the menu</button></form></section>` : '')
        + (d.groups.length ? d.groups.map((g: any) => `<section class="mk-section"><h2>${esc(g.name)}</h2>${g.dishes.map((m: any) => `
        <div class="mk-dish${m.soldOut ? ' out' : ''}"><div class="n">${esc(m.emoji)} ${esc(m.name)}<small>${m.soldOut ? 'Not ready: fans cannot order it' : m.available ? 'Ready: fans can order it' : 'Hidden from the menu (admin)'}${d.canPrice ? '' : ` · ${esc(m.priceText)}`}</small></div>
        <div class="ctl">${d.canMenu ? `<form class="price rename" data-rename="${esc(m.id)}"><label class="mk-sr" for="n_${esc(m.id)}">New name for ${esc(m.name)}</label><input class="mk-input" id="n_${esc(m.id)}" maxlength="60" value="${esc(m.name)}" /><button class="mk-btn" type="submit">Save name</button></form>` : ''}${d.canPrice ? `<form class="price" data-price="${esc(m.id)}"><label class="mk-sr" for="p_${esc(m.id)}">Price of ${esc(m.name)} in naira</label>₦<input class="mk-input" id="p_${esc(m.id)}" inputmode="decimal" value="${esc(m.price)}" /><button class="mk-btn" type="submit">Save price</button></form>` : ''}
          <button type="button" class="mk-switch${m.soldOut ? '' : ' on'}" role="switch" aria-checked="${m.soldOut ? 'false' : 'true'}" aria-label="${esc(m.name)}: ready for fans" data-dish="${esc(m.id)}" data-name="${esc(m.name)}" data-act="${m.soldOut ? 'back' : 'soldout'}"><i aria-hidden="true"></i><span>${m.soldOut ? 'OFF' : 'ON'}</span></button>${d.canMenu ? `<button type="button" class="mk-btn danger" data-del="${esc(m.id)}" data-name="${esc(m.name)}">Delete</button>` : ''}</div></div>`).join('')}</section>`).join('')
        : '<p class="mk-empty">The menu is empty. Dishes are added in the website admin (Menu & Prices).</p>');
    };
    main.addEventListener('click', (e: Event) => {
      const del = (e.target as HTMLElement).closest('[data-del]') as HTMLButtonElement | null;
      if (del) {
        if (!confirm(`Delete ${del.dataset.name} from the menu? Fans will no longer see it. Past orders stay in the reports.`)) return;
        act(del, async () => { await api('menu', { method: 'POST', body: { action: 'delete', id: del.dataset.del } }); toast(`${del.dataset.name} deleted from the menu.`); await draw(); });
        return;
      }
      const all = (e.target as HTMLElement).closest('[data-all]') as HTMLButtonElement | null;
      if (all) {
        const turnOn = all.dataset.all === 'all_on';
        if (!confirm(turnOn ? 'Turn ALL dishes ON? Fans can order every dish straight away. Dishes that have run out of stock stay off.' : 'Turn ALL dishes OFF? Fans cannot order anything until dishes are turned back on.')) return;
        act(all, async () => { const r = await api('menu', { method: 'POST', body: { action: all.dataset.all } }); toast(`${r.changed} dish${r.changed === 1 ? '' : 'es'} turned ${turnOn ? 'on' : 'off'}.`); await draw(); });
        return;
      }
      const b = (e.target as HTMLElement).closest('[data-dish]') as HTMLButtonElement | null;
      if (b) act(b, async () => { await api('menu', { method: 'POST', body: { id: b.dataset.dish, action: b.dataset.act } }); toast(b.dataset.act === 'soldout' ? `${b.dataset.name} is OFF. Fans see "Not ready".` : `${b.dataset.name} is ON. Fans can order it.`); await draw(); });
    });
    main.addEventListener('submit', (e: Event) => {
      if ((e.target as HTMLElement).id === 'dishF') {
        e.preventDefault();
        act((e.target as HTMLElement).querySelector('button'), async () => { const r = await api('menu', { method: 'POST', body: { action: 'add', item: { name: $('dName').value, category: $('dCat').value, price: $('dPrice').value, description: $('dDesc').value } } }); toast(`${r.name} added at ${r.price}. Fans can order it now.`); await draw(); });
        return;
      }
      const rn = (e.target as HTMLElement).closest('[data-rename]') as HTMLFormElement | null;
      if (rn) {
        e.preventDefault();
        act(rn.querySelector('button'), async () => { const r = await api('menu', { method: 'POST', body: { action: 'rename', id: rn.dataset.rename, name: (rn.querySelector('input') as HTMLInputElement).value } }); toast(r.unchanged ? 'The name is the same.' : `Renamed to ${r.name}. Fans see the new name.`); await draw(); });
        return;
      }
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
      const [d, rep, wad] = await Promise.all([api('staff'), api('report-settings'), session.perms.superAdmin ? api('whatsapp-devices') : null]);
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
        ${wad ? `<section class="mk-section"><h2>Official WhatsApp device</h2><div class="mk-box"><p style="margin:0 0 10px">Orders and replies use only <b>0708 009 4985</b>. Only a device on this list gets the reply buttons and fans' numbers; everyone else sees the orders only. Do this on the kitchen's phone or computer where WhatsApp is signed in to that number, then sign out of your own account there. It stays approved until you remove it.</p>
          ${wad.devices.length ? `<ul style="margin:0 0 12px;padding:0;list-style:none">${wad.devices.map((x: any) => `<li style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid #d9dde2"><span><b>${esc(x.name)}</b>${x.thisOne ? ' <span class="mk-pill go">This device</span>' : ''}<br /><small>Added by ${esc(x.addedBy || '')}, ${esc(dayTime(x.addedAt))}</small></span><button type="button" class="mk-btn danger" data-waremove="${esc(x.id)}" data-name="${esc(x.name)}">Remove</button></li>`).join('')}</ul>` : '<p class="mk-status" style="text-transform:none;letter-spacing:0">No device yet, so nobody can reply from here.</p>'}
          ${wad.thisDevice ? '' : '<button type="button" class="mk-btn go" id="waThis">Make this device the official WhatsApp device</button>'}</div></section>` : ''}
        <section class="mk-section"><h2>Settings</h2><form class="mk-box" id="setF">
          <div class="mk-field"><label for="sTg">Telegram channel link (shows the Telegram updates button)</label><input id="sTg" placeholder="https://t.me/yourchannel" value="${esc(d.settings.telegramUrl)}" /></div>
          <div class="mk-filters" style="align-items:flex-start"><fieldset class="mk-field" style="border:0;padding:0"><legend class="mk-label">Who can cancel orders</legend>${roleChecks('cancel', d.settings.cancelRoles)}</fieldset>
          <div class="mk-field"><label for="sLate">Orders are late after (minutes)</label><input id="sLate" type="number" min="1" max="120" value="${d.settings.lateMinutes}" /></div></div>
          <p class="mk-status" style="text-transform:none;letter-spacing:0">Super Admins can always cancel orders. Only supervisors and Super Admins change prices, add dishes and delete dishes.</p>
          <button class="mk-btn go" type="submit">Save settings</button></form></section>
        <section class="mk-section"><h2>Match-day food report</h2><form class="mk-box" id="repF">
          <p style="margin:0 0 10px">Emailed once, 4 hours after kick-off of each home match: sales, top dishes, hour by hour, late orders and each stand. It has no customer details.</p>
          <div class="mk-field"><label for="repE">Send to (one email per line)</label><textarea id="repE" rows="3">${esc(rep.emails.join('\n'))}</textarea></div>
          <div class="mk-actions" style="justify-content:flex-start"><button class="mk-btn go" type="submit">Save</button><a class="mk-btn" href="/api/matchday-kitchen/report" target="_blank" rel="noopener">Preview today</a><button type="button" class="mk-btn" id="repSend">Send now</button></div></form></section>
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
      if (el.id === 'repSend') {
        if (!confirm('Email the food report now, with the figures so far?')) return;
        act(el as HTMLButtonElement, async () => { const r = await api('report', { method: 'POST', body: {} }); toast(`Report sent to ${r.to.length} ${r.to.length === 1 ? 'person' : 'people'}.`); });
        return;
      }
      if (el.id === 'waThis') {
        if (!confirm('Is WhatsApp on this device signed in to 0708 009 4985? Only say yes on the kitchen\'s own phone or computer, never a personal one.')) return;
        const name = prompt('Name this device, e.g. Kitchen phone', 'Kitchen phone');
        if (name === null) return;
        act(el as HTMLButtonElement, async () => { await api('whatsapp-device', { method: 'POST', body: { action: 'this', name } }); toast('This is now an official WhatsApp device.'); await shell?.shiftChanged?.(); await draw(); });
        return;
      }
      const wr = el.closest('[data-waremove]') as HTMLButtonElement | null;
      if (wr) {
        if (!confirm(`Remove ${wr.dataset.name}? It can no longer reply to fans from MatchDay Kitchen.`)) return;
        act(wr, async () => { await api('whatsapp-device', { method: 'POST', body: { action: 'remove', id: wr.dataset.waremove } }); toast('Device removed.'); await shell?.shiftChanged?.(); await draw(); });
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
      if (form.id === 'repF') {
        act(form.querySelector('button'), async () => { const r = await api('report-settings', { method: 'POST', body: { emails: $('repE').value } }); toast(`Saved: ${r.emails.length} address${r.emails.length === 1 ? '' : 'es'}.`); });
      } else if (form.id === 'addF') {
        act(form.querySelector('button'), async () => { const r = await api('staff', { method: 'POST', body: { action: 'add', name: $('aName').value, role: $('aRole').value } }); codeShown = r; toast('Staff account added.'); await draw(); });
      } else if (form.id === 'setF') {
        const vals = (n: string) => [...form.querySelectorAll<HTMLInputElement>(`input[name="${n}"]:checked`)].map(i => i.value);
        act(form.querySelector('button'), async () => { await api('staff', { method: 'POST', body: { action: 'settings', telegramUrl: $('sTg').value.trim(), cancelRoles: vals('cancel'), lateMinutes: $('sLate').value } }); toast('Settings saved.'); shell?.shiftChanged(); await draw(); });
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

// MatchDay Kitchen (/kitchen/): the menu, cart, seat, checkout and order
// status. Uses the existing in-seat food backend only:
//   GET  /api/food/menu             menu, open/closed, opening and closing time, stands, WhatsApp
//   POST /api/food-checkout         Pay Online (Paystack); prices are worked out on the server
//   POST /api/food/whatsapp-order   Order via WhatsApp (same message format as the food page)
//   GET  /api/food/order?ref=&t=    order status (Received, Preparing, On the way, Delivered)
// Vanilla TypeScript, no libraries. The cart and seat are kept on the phone.
import { upcomingMatches } from '../../functions/api/_lib/tickets/rules.js';

type Item = { id: string; name: string; description: string; priceKobo: number; photo: string | null; soldOut: boolean; maxPerOrder: number; adult: boolean; spice?: number; badge?: string | null };
type Cat = { id: string; name: string; items: Item[] };
type Menu = { open: boolean; reason: string; match: string | null; opensAt: string | null; closesAt: string | null; categories: Cat[]; stands: string[]; minOrderKobo: number; paymentExpiryMinutes: number; whatsapp: { number: string; display: string } | null };

const CART = 'ls_kitchen_cart', SEAT = 'ls_kitchen_seat', PENDING = 'ls_kitchen_pending';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const naira = (k: number) => '₦' + Math.round(k / 100).toLocaleString('en-NG');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const store = {
  get<T>(k: string, maxAgeMs: number): T | null { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v && Date.now() - v.at < maxAgeMs ? v.data : null; } catch { return null; } },
  set(k: string, data: unknown) { try { localStorage.setItem(k, JSON.stringify({ data, at: Date.now() })); } catch { /* private mode */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const SPICE = ['Not spicy', 'Mild', 'Medium', 'Hot'];
const BADGE: Record<string, string> = { 'best-seller': 'Best Seller', spicy: 'Spicy', new: 'New' };
const isPhone = (v: string) => /^(\+?234|0)?[789][01]\d{8}$/.test(v.replace(/[\s-]/g, ''));
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

let menu: Menu | null = null;
let items: Item[] = [];
let qty: Record<string, number> = store.get(CART, 6 * 3600e3) || {};
let seatTimer: number | undefined;

function saveCart() { store.set(CART, qty); }
function count() { return Object.values(qty).reduce((a, b) => a + b, 0); }
function total() { return items.reduce((s, f) => s + (qty[f.id] || 0) * f.priceKobo, 0); }
// Lobi Stars Rewards: "Use my Star Points" and food vouchers (CheckoutRewards component; shown once Rewards is live).
type RewardsBox = { refresh(): void; values(): { usePoints: number; voucherCode: string } };
let rewardsBox: RewardsBox | null = null;
function mountRewards() {
  const lsr = (window as unknown as { LSRewards?: { mount(el: HTMLElement, o: unknown): RewardsBox } }).LSRewards;
  const el = document.getElementById('kxRewards');
  if (!lsr || !el || rewardsBox) return;
  rewardsBox = lsr.mount(el, { kind: 'food', subtotal: total, onChange: ({ offKobo }: { offKobo: number }) => { const b = document.getElementById('kxPayBtn'); if (b) b.textContent = offKobo ? `Pay ${naira(total() - offKobo)} online` : 'Pay online'; } });
}

// ── Seat (URL ?section=&row=&seat= for QR codes on seats, else remembered) ──
function seat() {
  const sec = ($('kxSection') as HTMLInputElement | HTMLSelectElement).value.trim();
  return { section: sec, row: ($('kxRow') as HTMLInputElement).value.trim(), seat: ($('kxSeat') as HTMLInputElement).value.trim() };
}
function seatText(s = seat()) { return s.section && s.row && s.seat ? `${s.section}, Row ${s.row}, Seat ${s.seat}` : ''; }
function saveSeat() { store.set(SEAT, seat()); $('kxSeatSum').textContent = seatText() || 'Seat not set: add it in "Your seat" at the top'; }
function initSeat() {
  const q = new URLSearchParams(location.search);
  const saved = store.get<{ section: string; row: string; seat: string }>(SEAT, 12 * 3600e3) || { section: '', row: '', seat: '' };
  const v = { section: q.get('section') || saved.section, row: q.get('row') || saved.row, seat: q.get('seat') || saved.seat };
  ($('kxSection') as HTMLInputElement).value = v.section.slice(0, 60);
  ($('kxRow') as HTMLInputElement).value = v.row.slice(0, 4);
  ($('kxSeat') as HTMLInputElement).value = v.seat.slice(0, 5);
  ['kxRow', 'kxSeat'].forEach(id => $(id).addEventListener('input', () => { $(id).classList.remove('kx-bad'); window.clearTimeout(seatTimer); seatTimer = window.setTimeout(saveSeat, 300); }));
  saveSeat();
}
/** The stands list from Admin › Food (Ordering): a drop-down instead of free text. */
function useStands(stands: string[]) {
  const cur = $('kxSection') as HTMLInputElement | HTMLSelectElement;
  if (!stands.length || cur.tagName === 'SELECT') return;
  const want = cur.value.toLowerCase();
  const sel = document.createElement('select');
  sel.id = 'kxSection';
  sel.innerHTML = '<option value="">Choose</option>' + stands.map(s => `<option${s.toLowerCase() === want ? ' selected' : ''}>${esc(s)}</option>`).join('');
  cur.replaceWith(sel);
  sel.addEventListener('change', () => { sel.classList.remove('kx-bad'); saveSeat(); });
  saveSeat();
}

// ── Menu ──
function card(f: Item) {
  const q = qty[f.id] || 0, closed = !menu?.open;
  const spice = f.spice ? `<span class="kx-spice" aria-label="Spice level: ${SPICE[f.spice]}" title="${SPICE[f.spice]}">${[1, 2, 3].map(n => `<i class="${n <= (f.spice || 0) ? 'on' : ''}"></i>`).join('')}</span>` : '';
  const ctrl = f.soldOut ? '<button type="button" class="kx-add" disabled>Sold out</button>'
    : q ? `<div class="kx-step" role="group" aria-label="${esc(f.name)} quantity"><button type="button" data-id="${esc(f.id)}" data-d="-1" aria-label="Remove one ${esc(f.name)}">−</button><output aria-live="polite">${q}</output><button type="button" data-id="${esc(f.id)}" data-d="1" aria-label="Add one more ${esc(f.name)}"${q >= f.maxPerOrder || closed ? ' disabled' : ''}>+</button></div>`
      : `<button type="button" class="kx-add" data-id="${esc(f.id)}" data-d="1"${closed ? ' disabled' : ''} aria-label="Add ${esc(f.name)}, ${naira(f.priceKobo)}">${closed ? 'Kitchen closed' : 'Add'}</button>`;
  return `<li class="kx-card${q ? ' is-picked' : ''}">
<div class="kx-photo">${f.photo ? `<img src="${esc(f.photo)}" alt="" loading="lazy" decoding="async" width="400" height="300">` : `<div class="kx-ph" aria-hidden="true">${esc(f.name.split(/\s+/).slice(0, 2).map(w => w[0]).join(''))}</div>`}
${f.badge && BADGE[f.badge] ? `<span class="kx-badge kx-badge--${esc(f.badge)}">${BADGE[f.badge]}</span>` : ''}${f.soldOut ? '<span class="kx-soldtag">Sold out</span>' : ''}</div>
<div class="kx-body"><span class="kx-name">${esc(f.name)}</span>${f.description ? `<p class="kx-desc">${esc(f.description)}</p>` : ''}
${f.adult ? '<span class="kx-age">18+ | Drink Responsibly</span>' : ''}
<div class="kx-meta"><span class="kx-price">${naira(f.priceKobo)}</span>${spice}</div>${ctrl}</div></li>`;
}
function sortedCats() {
  // "Match Day Combos" (any category with "combo" in its name) comes first.
  return [...(menu?.categories || [])].sort((a, b) => Number(/combo/i.test(b.name)) - Number(/combo/i.test(a.name)));
}
function renderMenu() {
  const cats = sortedCats();
  if (!cats.length) { $('kxMenu').innerHTML = '<p class="kx-empty">The menu will be ready on match day.</p>'; $('kxTabs').innerHTML = ''; return; }
  $('kxTabs').innerHTML = cats.map((c, i) => `<a class="kx-tab" href="#cat-${esc(c.id)}" data-cat="${esc(c.id)}"${i === 0 ? ' aria-current="true"' : ''}>${esc(c.name)}</a>`).join('');
  $('kxMenu').innerHTML = cats.map(c => `<section class="kx-cat${/combo/i.test(c.name) ? ' kx-cat--combo' : ''}" id="cat-${esc(c.id)}" aria-labelledby="h-${esc(c.id)}"><h2 id="h-${esc(c.id)}">${esc(c.name)}</h2><ul class="kx-grid">${c.items.map(card).join('')}</ul></section>`).join('');
  spy();
}
function renderCart() {
  const n = count(), t = total();
  const c = $('kxCount');
  if (c.textContent !== String(n)) { c.textContent = String(n); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
  c.setAttribute('aria-label', `${n} item${n === 1 ? '' : 's'}`);
  $('kxBar').classList.toggle('show', n > 0 && $('kxDone').hidden);
  $('kxBarText').textContent = `View cart · ${n} item${n === 1 ? '' : 's'}`;
  $('kxBarTotal').textContent = naira(t);
  const picked = items.filter(f => qty[f.id]);
  $('kxLines').innerHTML = picked.length ? picked.map(f => `<li class="kx-line"><div><b>${esc(f.name)}</b><small>${naira(f.priceKobo * qty[f.id])}</small></div>
<div class="kx-step" role="group" aria-label="${esc(f.name)} quantity"><button type="button" data-id="${esc(f.id)}" data-d="-1" aria-label="Remove one ${esc(f.name)}">−</button><output>${qty[f.id]}</output><button type="button" data-id="${esc(f.id)}" data-d="1" aria-label="Add one more ${esc(f.name)}"${qty[f.id] >= f.maxPerOrder ? ' disabled' : ''}>+</button></div></li>`).join('')
    : '<li class="kx-small">Your cart is empty. Add something from the menu.</li>';
  $('kxTotal').textContent = naira(t);
  mountRewards(); rewardsBox?.refresh();
  const min = menu?.minOrderKobo || 0;
  $('kxMin').hidden = !(min && t && t < min);
  $('kxMin').textContent = `The minimum order is ${naira(min)}.`;
  $('kxAdultWrap').hidden = !picked.some(f => f.adult);
}
function change(id: string, d: number) {
  const f = items.find(x => x.id === id);
  if (!f || f.soldOut) return;
  if (d > 0 && !menu?.open) return;
  qty[id] = Math.max(0, Math.min(f.maxPerOrder, (qty[id] || 0) + d));
  if (!qty[id]) delete qty[id];
  saveCart(); renderMenu(); renderCart();
}
function onStep(root: HTMLElement) {
  root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-id]');
    if (!b || b.disabled) return;
    const id = b.dataset.id!, d = Number(b.dataset.d);
    change(id, d);
    // Keep the keyboard where it was.
    const again = root.querySelector<HTMLButtonElement>(`button[data-id="${CSS.escape(id)}"][data-d="${d}"]`) || root.querySelector<HTMLButtonElement>(`button[data-id="${CSS.escape(id)}"]`);
    again?.focus();
  });
}

// Category tabs follow the scroll.
let spyObs: IntersectionObserver | undefined;
function spy() {
  spyObs?.disconnect();
  spyObs = new IntersectionObserver(entries => {
    const vis = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!vis) return;
    const id = vis.target.id.replace(/^cat-/, '');
    document.querySelectorAll<HTMLElement>('.kx-tab').forEach(t => {
      const on = t.dataset.cat === id;
      t.setAttribute('aria-current', on ? 'true' : 'false');
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, { rootMargin: '-35% 0px -60% 0px' });
  document.querySelectorAll('.kx-cat').forEach(s => spyObs!.observe(s));
}

// ── Match strip: next home fixture, open/closed, countdown ──
function untilText(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, `${mm}m`].filter(Boolean).join(' ');
}
function renderState() {
  if (!menu) return;
  const pill = $('kxPill');
  pill.className = `kx-pill kx-pill--${menu.open ? 'open' : 'closed'}`;
  pill.innerHTML = `<span class="kx-dot" aria-hidden="true"></span>${menu.open ? 'Kitchen open' : 'Kitchen closed'}`;
  const now = Date.now();
  $('kxCd').textContent = menu.open && menu.closesAt ? `Orders close in ${untilText(Date.parse(menu.closesAt) - now)}`
    : !menu.open && menu.opensAt ? `Opens in ${untilText(Date.parse(menu.opensAt) - now)}` : '';
  $('kxClosed').hidden = menu.open;
  $('kxClosed').classList.remove('kx-pending');
  $('kxClosedText').textContent = menu.opensAt
    ? `Ordering opens ${new Date(menu.opensAt).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' })}${menu.match ? ` for ${menu.match}` : ''}. You can look at the menu now.`
    : 'Ordering opens on Lobi Stars home match days. You can look at the menu now.';
  ($('kxPayBtn') as HTMLButtonElement).disabled = !menu.open;
  ($('kxWaBtn') as HTMLButtonElement).disabled = !menu.open;
}
async function loadFixture() {
  try {
    const d = await (await fetch('/api/matches')).json();
    const home = upcomingMatches((d.matches || []).filter((m: { home_team: string; is_home?: boolean }) => (m.is_home ?? /lobi stars/i.test(m.home_team))), Date.now())
      .find((m: { status: string }) => m.status !== 'postponed');
    if (!home) return;
    const when = new Date(home.event_date);
    const date = when.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
    const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
    $('kxFix').innerHTML = `${esc(home.home_team)} vs ${esc(home.away_team)}<small>${esc(date)} · ${esc(time)} · McCarthy Stadium</small>`;
  } catch { /* keep the default text */ }
}

async function loadMenu() {
  try {
    const r = await fetch('/api/food/menu', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    menu = await r.json() as Menu;
    items = menu.categories.flatMap(c => c.items);
    for (const id of Object.keys(qty)) { const f = items.find(x => x.id === id); if (!f || f.soldOut) delete qty[id]; }
    saveCart();
    useStands(menu.stands || []);
    $('kxWaBox').hidden = !menu.whatsapp;
    $('kxSmall').textContent = `Pay online with card, bank transfer or USSD (Paystack). Your order goes to the kitchen once payment is confirmed; unpaid orders are cancelled after ${menu.paymentExpiryMinutes} minutes.${menu.whatsapp ? ' Or order via WhatsApp and pay the staff.' : ''}`;
    renderState(); renderMenu(); renderCart();
  } catch {
    if (!menu) $('kxMenu').innerHTML = '<p class="kx-empty">The menu could not be loaded. Check your connection and try again.</p>';
    if (!menu) $('kxClosed').hidden = true;
  }
}

// ── Checkout ──
function fail(msg: string, focusId?: string) {
  const e = $('kxErr'); e.textContent = msg; e.hidden = false;
  if (focusId) { $(focusId).classList.add('kx-bad'); $(focusId).focus(); } else e.scrollIntoView({ block: 'nearest' });
  return null;
}
function collect(viaWhatsApp: boolean) {
  $('kxErr').hidden = true;
  if (!navigator.onLine) return fail('You seem to be offline. Check your connection and try again.');
  if (!menu?.open) return fail('The kitchen is closed at the moment.');
  const picked = items.filter(f => qty[f.id]);
  if (!picked.length) return fail('Your cart is empty.');
  const s = seat();
  if (!s.section || !s.row || !s.seat) {
    ($('kxDrawer') as HTMLDialogElement).close();
    const missing = !s.section ? 'kxSection' : !s.row ? 'kxRow' : 'kxSeat';
    $(missing).classList.add('kx-bad'); $(missing).focus();
    $('kxSeatBar').scrollIntoView({ block: 'nearest' });
    return null;
  }
  const v = (id: string) => ($(id) as HTMLInputElement).value.trim();
  if (v('kxName').length < 2) return fail('Please enter your name.', 'kxName');
  if (!isPhone(v('kxPhone'))) return fail('Please enter a valid Nigerian mobile number, e.g. 0803 123 4567.', 'kxPhone');
  if (!viaWhatsApp && !isEmail(v('kxEmail'))) return fail('Pay Online needs your email address for the payment receipt.', 'kxEmail');
  if (viaWhatsApp && v('kxEmail') && !isEmail(v('kxEmail'))) return fail('Please check your email address (or leave it empty).', 'kxEmail');
  if (!$('kxAdultWrap').hidden && !($('kxAdult') as HTMLInputElement).checked) return fail('Please confirm you are 18 or older to order alcoholic drinks.', 'kxAdult');
  const min = menu.minOrderKobo || 0;
  if (min && total() < min) return fail(`The minimum order is ${naira(min)}.`);
  const when = (document.querySelector('input[name="when"]:checked') as HTMLInputElement)?.value;
  const note = [when === 'half-time' ? 'Deliver at half-time.' : '', v('kxNote')].filter(Boolean).join(' ').slice(0, 200);
  return {
    name: v('kxName'), phone: v('kxPhone'), email: v('kxEmail'), notes: note,
    fulfilment: 'seat', stand: s.section, seat: `Row ${s.row}, Seat ${s.seat}`.slice(0, 20),
    adultConfirmed: ($('kxAdult') as HTMLInputElement).checked, website: ($('kxTrap') as HTMLInputElement).value,
    items: picked.map(f => ({ id: f.id, qty: qty[f.id] })),
  };
}
async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, d };
}
function remember() { ['kxName', 'kxPhone', 'kxEmail'].forEach(id => { try { localStorage.setItem(`ls_kitchen_${id}`, ($(id) as HTMLInputElement).value.trim()); } catch { /* ignore */ } }); }
function recall() { ['kxName', 'kxPhone', 'kxEmail'].forEach(id => { try { const v = localStorage.getItem(`ls_kitchen_${id}`); if (v) ($(id) as HTMLInputElement).value = v; } catch { /* ignore */ } }); }

async function payOnline(e: Event) {
  e.preventDefault();
  const body = collect(false); if (!body) return;
  const btn = $('kxPayBtn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Opening payment…';
  try {
    const { ok, status, d } = await post('/api/food-checkout', { ...body, ...(rewardsBox?.values() || {}), returnTo: 'kitchen' });
    if (!ok || !d.authorizationUrl) { if (status === 409) loadMenu(); throw new Error(d.error || 'Payment could not be started. Please try again.'); }
    remember();
    store.set(PENDING, { ref: d.ref });
    location.href = d.authorizationUrl; // the cart is cleared once the payment is confirmed
  } catch (err) {
    fail((err as Error).message || 'Payment could not be started. Please try again.');
    btn.disabled = false; btn.textContent = 'Pay online';
  }
}

let waMessage = '';
async function orderWhatsApp() {
  const body = collect(true); if (!body) return;
  const btn = $('kxWaBtn') as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Preparing your order…';
  try {
    const token = (document.querySelector('#kxWaBox [name="cf-turnstile-response"]') as HTMLInputElement | null)?.value || '';
    const { ok, status, d } = await post('/api/food/whatsapp-order', { ...body, turnstileToken: token });
    if (!ok || !d.whatsappUrl) {
      if (status === 409 || d.code === 'stock') loadMenu();
      (window as unknown as { turnstile?: { reset?: () => void } }).turnstile?.reset?.();
      throw new Error(d.error || 'Your order could not be saved. Please try again.');
    }
    remember();
    waMessage = d.message;
    qty = {}; saveCart();
    ($('kxDrawer') as HTMLDialogElement).close();
    const t = new URL(d.trackUrl, location.origin);
    showDone({ ref: d.ref, token: t.searchParams.get('t') || '', whatsappUrl: d.whatsappUrl });
    window.setTimeout(() => { location.href = d.whatsappUrl; }, 900);
  } catch (err) {
    fail((err as Error).message || 'Your order could not be saved. Please try again.');
  } finally { btn.disabled = !menu?.open; btn.textContent = 'Order via WhatsApp'; }
}

// ── Confirmation and status ──
type Order = { ref: string; status: string; statusLabel: string; seat: string; stand: string; items: { name: string; qty: number; priceKobo: number }[]; totalKobo: number; channel: string; notes: string };
const STEP: Record<string, number> = { PAID: 1, ACCEPTED: 1, PREPARING: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4 };
let statusTimer: number | undefined;
function showDone(o: { ref: string; token: string; whatsappUrl?: string }) {
  $('kxMenu').hidden = true; $('kxSeatBar').hidden = true; document.querySelector<HTMLElement>('.kx-tabs')!.hidden = true;
  $('kxDone').hidden = false; renderCart();
  $('kxRef').textContent = o.ref;
  const wa = $('kxWaOpen') as HTMLAnchorElement;
  wa.hidden = !o.whatsappUrl; if (o.whatsappUrl) wa.href = o.whatsappUrl;
  $('kxWaCopy').hidden = !o.whatsappUrl || !waMessage;
  $('kxDone').focus();
  const poll = async () => {
    try {
      const r = await fetch(`/api/food/order?ref=${encodeURIComponent(o.ref)}&t=${encodeURIComponent(o.token)}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok || !d.order) { $('kxStatus').textContent = d.error || 'We could not load your order just now.'; return; }
      renderStatus(d.order as Order);
    } catch { $('kxStatus').textContent = 'Checking your order… (no connection right now)'; }
  };
  poll();
  window.clearInterval(statusTimer);
  statusTimer = window.setInterval(poll, 15000);
}
function renderStatus(o: Order) {
  const step = STEP[o.status] || 0;
  document.querySelectorAll<HTMLElement>('#kxSteps li').forEach(li => {
    const n = Number(li.dataset.step);
    li.classList.toggle('done', n <= step); li.classList.toggle('now', n === step + 1 && step > 0 && step < 4);
  });
  const msg: Record<string, string> = {
    AWAITING_PAYMENT: 'Waiting for your payment to be confirmed. This usually takes a few seconds.',
    AWAITING_WHATSAPP: 'Send the order message on WhatsApp so the kitchen can confirm it. Staff will tell you how to pay.',
    PAID: 'Paid. The kitchen has your order.', ACCEPTED: 'The kitchen has your order.',
    PREPARING: 'Your food is being prepared.', OUT_FOR_DELIVERY: 'Your order is on the way to your seat.',
    DELIVERED: 'Delivered. Enjoy the match!', PAYMENT_FAILED: 'The payment did not go through. Your cart is still saved: please try again.',
    EXPIRED: 'This order was cancelled because it was not paid in time. Your cart is still saved: please order again.',
    CANCELLED: 'This order was cancelled. Please contact a steward or order again.',
  };
  $('kxStatus').textContent = msg[o.status] || o.statusLabel;
  $('kxDoneH').textContent = ['PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'].includes(o.status) ? 'Order not completed' : step ? 'Order received' : 'We have your order';
  $('kxSum').innerHTML = `${o.items.map(i => `${esc(i.qty)} × ${esc(i.name)}: ${naira(i.qty * i.priceKobo)}`).join('<br>')}<br><b>Total ${naira(o.totalKobo)}</b><br>${esc([o.stand, o.seat].filter(Boolean).join(', '))}${o.notes ? `<br>Note: ${esc(o.notes)}` : ''}`;
  // A confirmed payment empties the cart; a failed one keeps it.
  if (step) { const p = store.get<{ ref: string }>(PENDING, 24 * 3600e3); if (p?.ref === o.ref) { qty = {}; saveCart(); store.del(PENDING); renderCart(); } }
  if (['DELIVERED', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED'].includes(o.status)) window.clearInterval(statusTimer);
}

export function startKitchen() {
  const drawer = $('kxDrawer') as HTMLDialogElement;
  const open = () => { renderCart(); saveSeat(); drawer.showModal(); $('kxClose').focus(); };
  $('kxCartBtn').addEventListener('click', open);
  $('kxBarBtn').addEventListener('click', open);
  $('kxClose').addEventListener('click', () => drawer.close());
  drawer.addEventListener('click', e => { if (e.target === drawer) drawer.close(); }); // tap outside
  $('kxSeatEdit').addEventListener('click', () => { drawer.close(); $('kxSeatBar').scrollIntoView({ block: 'nearest' }); $('kxRow').focus(); });
  onStep($('kxMenu')); onStep($('kxLines'));
  $('kxForm').addEventListener('submit', payOnline);
  $('kxWaBtn').addEventListener('click', orderWhatsApp);
  ['kxName', 'kxPhone', 'kxEmail', 'kxAdult'].forEach(id => $(id).addEventListener('input', () => $(id).classList.remove('kx-bad')));
  $('kxWaCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(waMessage); $('kxWaCopy').textContent = 'Copied'; } catch { $('kxWaCopy').textContent = 'Copy failed: use the WhatsApp button'; }
    window.setTimeout(() => { $('kxWaCopy').textContent = 'Copy order message'; }, 2500);
  });
  $('kxAgain').addEventListener('click', () => {
    window.clearInterval(statusTimer);
    history.replaceState(null, '', '/kitchen/');
    $('kxDone').hidden = true; $('kxMenu').hidden = false; $('kxSeatBar').hidden = false; document.querySelector<HTMLElement>('.kx-tabs')!.hidden = false;
    renderCart(); $('kxMenu').scrollIntoView({ block: 'start' });
  });
  // Sticky offsets: the category tabs sit under the seat bar.
  const setH = () => $('kx').style.setProperty('--kx-seat-h', `${$('kxSeatBar').offsetHeight}px`);
  setH(); addEventListener('resize', setH);
  // Offline / online.
  const net = () => { $('kxOffline').hidden = navigator.onLine; };
  addEventListener('online', () => { net(); loadMenu(); }); addEventListener('offline', net); net();

  initSeat(); recall();
  const q = new URLSearchParams(location.search);
  if (q.get('ref') && q.get('t')) showDone({ ref: q.get('ref')!, token: q.get('t')! });
  loadMenu(); loadFixture();
  window.setInterval(() => { if (document.visibilityState === 'visible') loadMenu(); }, 60000);
  window.setInterval(renderState, 30000);
}

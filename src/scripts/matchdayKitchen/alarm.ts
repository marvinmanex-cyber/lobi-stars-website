// MatchDay Kitchen alarms (run by the home screen, whatever page is open):
//   NEW ORDER: a loud triple beep every 3 seconds, a flashing red bar, vibration and the
//   tab title, until someone taps "Accept order" (the order moves from New to Received).
//   WHATSAPP: a new WhatsApp order (not paid yet, not to cook): a different ring every 5 seconds,
//   until a supervisor or Super Admin confirms it, rejects it or records the payment.
//   COOK: confirmed and paid, cooking not started: a ring every 10 seconds until Start cooking.
//   All of them blink red, in the bar and on the button or tab of the page they come from.
//   LATE: an order not delivered within the target (5 minutes by default) of payment
//   gets an amber bar and a lower double beep once a minute until it is delivered.
// Checks /api/matchday-kitchen/pulse every 10 seconds (marked as not activity, so the
// "Still there?" sign-out still works). Browsers only allow sound after a tap: until the
// first tap, a "Tap to turn on order sounds" button shows.
import { $, esc, api, session } from './common';
import { syncPush } from './push';

type P = { id: string; ref: string; no: string; status: string; minutes: number; where: string };
let ctx: AudioContext | null = null, timer = 0, newBeep = 0, lateBeep = 0, waBeep = 0, cookBeep = 0, running = false, openFn: (p: string) => void = () => {};
let last: { newOrders: P[]; whatsapp: P[]; cook: P[]; late: P[] } = { newOrders: [], whatsapp: [], cook: [], late: [] };
const seen = new Set<string>();
const TITLE = 'MatchDay Kitchen | Lobi Stars FC';

function audio() {
  if (!ctx) { const C = (window as any).AudioContext || (window as any).webkitAudioContext; if (C) ctx = new C(); }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  const on = !!ctx && ctx.state === 'running';
  const b = $('soundOn'); if (b) b.hidden = on || !running;
  return on;
}
function tone(freq: number, start: number, dur: number, vol = 0.9) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + start); o.stop(ctx.currentTime + start + dur + 0.05);
}
function beepNew() { if (audio()) { tone(1046, 0, 0.18); tone(1046, 0.25, 0.18); tone(1318, 0.5, 0.3); } try { navigator.vibrate?.([300, 120, 300, 120, 500]); } catch { /* */ } }
function beepWa() { if (audio()) { tone(880, 0, 0.16); tone(1175, 0.2, 0.28); tone(880, 0.6, 0.16); tone(1175, 0.8, 0.28); } try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ } }
function beepCook() { if (audio()) { tone(660, 0, 0.2); tone(660, 0.3, 0.2); tone(990, 0.6, 0.35); } try { navigator.vibrate?.([400, 150, 400]); } catch { /* */ } }
function beepLate() { if (audio()) { tone(523, 0, 0.35, 0.7); tone(392, 0.45, 0.5, 0.7); } try { navigator.vibrate?.([600]); } catch { /* */ } }

function notify(p: P, whatsapp = false) {
  const key = `${whatsapp ? 'wa' : 'new'}:${p.id}`;
  if (seen.has(key)) return; seen.add(key);
  if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
  // The same tag as the alert from the server, so a device with both shows one.
  try { new Notification(whatsapp ? `New WhatsApp order #${p.no}` : `New order #${p.no}`, { body: `${p.where || 'MatchDay Kitchen'} · waiting to be confirmed`, tag: `kitchen-${p.ref}`, requireInteraction: true }); } catch { /* */ }
}

/** The page each alert comes from blinks too: its button on Home and its tab. */
export function markSources() {
  const hot = new Set<string>();
  if (last.newOrders.length) { hot.add('kitchen'); hot.add('live'); }
  if (last.whatsapp.length) hot.add('live');
  if (last.cook.length) hot.add('kitchen');
  if (last.late.length) hot.add('alerts');
  document.querySelectorAll<HTMLElement>('[data-open], .mk-tab [data-tab]').forEach(el => el.classList.toggle('mk-blink', hot.has(el.dataset.open || el.dataset.tab || '')));
}
function draw() {
  const bar = $('alarm'); if (!bar) return;
  const n = last.newOrders, w = last.whatsapp, c = last.cook, l = last.late;
  const hint = session.perms?.confirm ? 'Tap to confirm or reject' : 'Waiting for a supervisor';
  const lines: string[] = [];
  if (n.length) lines.push(`<div class="mk-alarm-new"><b>🔔 ${n.length === 1 ? 'NEW ORDER' : `${n.length} NEW ORDERS`}</b> ${n.slice(0, 4).map(p => `#${esc(p.no)}${p.where ? ` <small>${esc(p.where)}</small>` : ''}`).join(' · ')}<span class="mk-alarm-hint">${hint}</span></div>`);
  if (w.length) lines.push(`<div class="mk-alarm-wa"><b>💬 ${w.length === 1 ? 'NEW WHATSAPP ORDER' : `${w.length} NEW WHATSAPP ORDERS`}</b> ${w.slice(0, 4).map(p => `#${esc(p.no)}${p.where ? ` <small>${esc(p.where)}</small>` : ''}`).join(' · ')}<span class="mk-alarm-hint">Not paid yet. ${hint}</span></div>`);
  if (c.length) lines.push(`<div class="mk-alarm-cook"><b>🍳 START COOKING</b> ${c.slice(0, 4).map(p => `#${esc(p.no)}${p.where ? ` <small>${esc(p.where)}</small>` : ''}`).join(' · ')}<span class="mk-alarm-hint">Tap, then Start cooking</span></div>`);
  if (l.length) lines.push(`<div class="mk-alarm-late"><b>⏰ ${l.length === 1 ? 'LATE ORDER' : `${l.length} LATE ORDERS`}</b> ${l.slice(0, 4).map(p => `#${esc(p.no)} <small>${esc(p.status)}, ${p.minutes} min</small>`).join(' · ')}<span class="mk-alarm-hint">Not delivered yet</span></div>`);
  bar.innerHTML = lines.join('');
  bar.hidden = !lines.length;
  bar.classList.toggle('flash', !!lines.length);
  markSources();
  document.title = n.length ? `🔔 (${n.length}) New order | MatchDay Kitchen` : w.length ? `💬 (${w.length}) New WhatsApp order | MatchDay Kitchen` : c.length ? `🍳 (${c.length}) Start cooking | MatchDay Kitchen` : l.length ? `⏰ Late order | MatchDay Kitchen` : TITLE;
  // New orders: beep every 3 seconds until accepted.
  if (n.length && !newBeep) { beepNew(); newBeep = window.setInterval(beepNew, 3000); }
  if (!n.length && newBeep) { clearInterval(newBeep); newBeep = 0; }
  // New WhatsApp orders: a different ring every 5 seconds until they are confirmed, rejected or paid.
  if (w.length && !waBeep) { if (!n.length) beepWa(); waBeep = window.setInterval(() => { if (!last.newOrders.length) beepWa(); }, 5000); }
  if (!w.length && waBeep) { clearInterval(waBeep); waBeep = 0; }
  // Cooking pending: a ring every 10 seconds until someone presses Start cooking.
  if (c.length && !cookBeep) { if (!n.length && !w.length) beepCook(); cookBeep = window.setInterval(() => { if (!last.newOrders.length && !last.whatsapp.length) beepCook(); }, 10000); }
  if (!c.length && cookBeep) { clearInterval(cookBeep); cookBeep = 0; }
  // Late orders: a beep once a minute until delivered.
  if (l.length && !lateBeep) { beepLate(); lateBeep = window.setInterval(beepLate, 60000); }
  if (!l.length && lateBeep) { clearInterval(lateBeep); lateBeep = 0; }
}

async function check() {
  try {
    const d = await api('pulse', { quiet: true });
    last = { newOrders: d.newOrders || [], whatsapp: d.whatsapp || [], cook: d.cook || [], late: d.late || [] };
    for (const p of last.newOrders) notify(p);
    for (const p of last.whatsapp) notify(p, true);
    draw();
  } catch { /* offline: try again next time */ }
}

/** Starts the alarms (after sign-in). open(page) opens a kitchen page as a tab. */
export function startAlarms(open: (p: string) => void) {
  openFn = open;
  if (running) return;
  running = true;
  audio();
  check(); timer = window.setInterval(check, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running) check(); });
}
export function stopAlarms() {
  running = false; clearInterval(timer); clearInterval(newBeep); clearInterval(lateBeep); clearInterval(waBeep); clearInterval(cookBeep); timer = newBeep = lateBeep = waBeep = cookBeep = 0;
  last = { newOrders: [], whatsapp: [], cook: [], late: [] }; markSources(); const bar = $('alarm'); if (bar) bar.hidden = true; document.title = TITLE;
  const b = $('soundOn'); if (b) b.hidden = true;
}
/** Re-check straight away (after a status change in a page). */
export function alarmsNow() { if (running) check(); }

// Any tap unlocks sound (browsers' rule) and, once, asks to allow notifications when the app is in the background.
let asked = false;
document.addEventListener('pointerdown', () => {
  audio();
  if (!asked && running && 'Notification' in window && Notification.permission === 'default') { asked = true; Notification.requestPermission().then(() => syncPush()).catch(() => {}); }
}, { capture: true });
$('alarm')?.addEventListener('click', () => openFn(last.newOrders.length || (last.cook.length && !last.whatsapp.length) ? 'kitchen' : last.whatsapp.length ? 'live' : 'alerts'));
// Tapped a phone alert while the app was already open.
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data?.type === 'mk-open' && running) { check(); if (e.data.page) openFn(e.data.page); } });
$('soundOn')?.addEventListener('click', () => { audio(); beepNew(); });

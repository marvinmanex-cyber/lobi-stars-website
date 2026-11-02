// MatchDay Kitchen alarms (run by the home screen, whatever page is open):
//   NEW ORDER: a loud triple beep every 3 seconds, a flashing red bar, vibration and the
//   tab title, until someone taps "Accept order" (the order moves from New to Received).
//   LATE: an order not delivered within the target (5 minutes by default) of payment
//   gets an amber bar and a lower double beep once a minute until it is delivered.
// Checks /api/matchday-kitchen/pulse every 10 seconds (marked as not activity, so the
// "Still there?" sign-out still works). Browsers only allow sound after a tap: until the
// first tap, a "Tap to turn on order sounds" button shows.
import { $, esc, api } from './common';

type P = { id: string; ref: string; no: string; status: string; minutes: number; where: string };
let ctx: AudioContext | null = null, timer = 0, newBeep = 0, lateBeep = 0, running = false, openFn: (p: string) => void = () => {};
let last: { newOrders: P[]; late: P[] } = { newOrders: [], late: [] };
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
function beepLate() { if (audio()) { tone(523, 0, 0.35, 0.7); tone(392, 0.45, 0.5, 0.7); } try { navigator.vibrate?.([600]); } catch { /* */ } }

function notify(p: P) {
  if (seen.has(p.id)) return; seen.add(p.id);
  if (document.visibilityState === 'visible' || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(`New order #${p.no}`, { body: `${p.where || 'MatchDay Kitchen'} · tap Accept order`, tag: `mk-${p.id}`, requireInteraction: true }); } catch { /* */ }
}

function draw() {
  const bar = $('alarm'); if (!bar) return;
  const n = last.newOrders, l = last.late;
  const lines: string[] = [];
  if (n.length) lines.push(`<div class="mk-alarm-new"><b>🔔 ${n.length === 1 ? 'NEW ORDER' : `${n.length} NEW ORDERS`}</b> ${n.slice(0, 4).map(p => `#${esc(p.no)}${p.where ? ` <small>${esc(p.where)}</small>` : ''}`).join(' · ')}<span class="mk-alarm-hint">Tap to accept</span></div>`);
  if (l.length) lines.push(`<div class="mk-alarm-late"><b>⏰ ${l.length === 1 ? 'LATE ORDER' : `${l.length} LATE ORDERS`}</b> ${l.slice(0, 4).map(p => `#${esc(p.no)} <small>${esc(p.status)}, ${p.minutes} min</small>`).join(' · ')}<span class="mk-alarm-hint">Not delivered yet</span></div>`);
  bar.innerHTML = lines.join('');
  bar.hidden = !lines.length;
  bar.classList.toggle('flash', !!n.length);
  document.title = n.length ? `🔔 (${n.length}) New order | MatchDay Kitchen` : l.length ? `⏰ Late order | MatchDay Kitchen` : TITLE;
  // New orders: beep every 3 seconds until accepted.
  if (n.length && !newBeep) { beepNew(); newBeep = window.setInterval(beepNew, 3000); }
  if (!n.length && newBeep) { clearInterval(newBeep); newBeep = 0; }
  // Late orders: a beep once a minute until delivered.
  if (l.length && !lateBeep) { beepLate(); lateBeep = window.setInterval(beepLate, 60000); }
  if (!l.length && lateBeep) { clearInterval(lateBeep); lateBeep = 0; }
}

async function check() {
  try {
    const d = await api('pulse', { quiet: true });
    last = { newOrders: d.newOrders || [], late: d.late || [] };
    for (const p of last.newOrders) notify(p);
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
  running = false; clearInterval(timer); clearInterval(newBeep); clearInterval(lateBeep); timer = newBeep = lateBeep = 0;
  last = { newOrders: [], late: [] }; const bar = $('alarm'); if (bar) bar.hidden = true; document.title = TITLE;
  const b = $('soundOn'); if (b) b.hidden = true;
}
/** Re-check straight away (after a status change in a page). */
export function alarmsNow() { if (running) check(); }

// Any tap unlocks sound (browsers' rule) and, once, asks to allow notifications when the app is in the background.
let asked = false;
document.addEventListener('pointerdown', () => {
  audio();
  if (!asked && running && 'Notification' in window && Notification.permission === 'default') { asked = true; Notification.requestPermission().catch(() => {}); }
}, { capture: true });
$('alarm')?.addEventListener('click', () => openFn(last.newOrders.length ? 'kitchen' : 'live'));
$('soundOn')?.addEventListener('click', () => { audio(); beepNew(); });

// MatchDay Kitchen: order alerts on this device, even when the app is closed or the phone is
// locked (Web Push through the kitchen app's service worker). Each person turns them on once per
// device; they stay on until that person signs out with the button or turns them off. A sign-out
// after 20 idle minutes keeps them on, so a resting tablet still rings.
import { $, api, session } from './common';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iosNotInstalled = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !(navigator as any).standalone;
const device = () => { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android device' : 'Computer'; };
const keyBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
let say: (t: string) => void = () => {};
let wired = false;

async function worker() {
  await navigator.serviceWorker.register('/matchday-kitchen/sw.js', { scope: '/matchday-kitchen/' });
  return navigator.serviceWorker.ready;
}
/** Tells the server this device wants alerts (the browser's permission must already be given). */
async function subscribe() {
  const r = await worker();
  const sub = await r.pushManager.getSubscription() || await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(session.pushKey) });
  await api('push', { method: 'POST', quiet: true, body: { action: 'on', subscription: sub.toJSON(), deviceName: device() } });
  return sub;
}
async function current() { try { return await (await worker()).pushManager.getSubscription(); } catch { return null; } }

async function draw() {
  const box = $('pushBox'); if (!box) return;
  const line = $('pushText'), on = $('pushOn'), test = $('pushTest'), off = $('pushOff');
  box.hidden = false;
  box.classList.remove('on');
  on.hidden = test.hidden = off.hidden = true;
  if (!session.pushKey) { box.hidden = true; return; }
  if (iosNotInstalled()) { line.textContent = 'On iPhone and iPad: install this app first (Share, then Add to Home Screen), open it from there, then turn on order alerts.'; return; }
  if (!supported()) { line.textContent = "This browser can't show order alerts when the app is closed. Keep the app open, or use Chrome."; return; }
  if (Notification.permission === 'denied') { line.textContent = 'Order alerts are blocked on this device. Allow notifications for this site in the browser settings, then reload.'; return; }
  if (Notification.permission === 'granted' && await current()) {
    box.classList.add('on');
    line.textContent = 'Order alerts are ON for this device, even when the app is closed.';
    test.hidden = off.hidden = false;
    return;
  }
  line.textContent = 'Get an alert on this device for every new order, even when the app is closed or the phone is locked.';
  on.hidden = false;
}

/** After the browser's permission is given (button, or the first-tap question): register straight away. */
export async function syncPush() {
  if (!session.pushKey || !supported() || Notification.permission !== 'granted') { await draw().catch(() => {}); return; }
  try { await subscribe(); } catch { /* the button stays, and shows the reason when pressed */ }
  await draw().catch(() => {});
}

export function initPush(toast: (t: string) => void) {
  say = toast;
  if (!wired) {
    wired = true;
    $('pushOn').addEventListener('click', async () => {
      const b = $('pushOn') as HTMLButtonElement; b.disabled = true;
      try {
        if (await Notification.requestPermission() !== 'granted') { say('Alerts were not allowed on this device.'); return; }
        await subscribe();
        say('Order alerts are on for this device.');
      } catch (e) { say(`Alerts could not be turned on: ${(e as Error).message}`); }
      finally { b.disabled = false; await draw(); }
    });
    $('pushTest').addEventListener('click', async () => {
      const b = $('pushTest') as HTMLButtonElement; b.disabled = true;
      try {
        const sub = await subscribe();
        const r = await api('push', { method: 'POST', body: { action: 'test', endpoint: sub.endpoint } });
        say(r.ok ? 'Test alert sent. It should appear in a few seconds.' : 'The test alert could not be delivered. Turn alerts off and on again.');
      } catch (e) { say((e as Error).message); } finally { b.disabled = false; }
    });
    $('pushOff').addEventListener('click', async () => {
      const b = $('pushOff') as HTMLButtonElement; b.disabled = true;
      try {
        const sub = await current();
        if (sub) { await api('push', { method: 'POST', body: { action: 'off', endpoint: sub.endpoint } }); await sub.unsubscribe(); }
        say('Order alerts are off for this device.');
      } catch (e) { say((e as Error).message); } finally { b.disabled = false; await draw(); }
    });
  }
  syncPush();
}

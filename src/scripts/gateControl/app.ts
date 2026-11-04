// Gate Control (/gate-control): sign-in, gate choice, the ticket scanner (phone
// camera or typed number), the result screen, today's check-ins, the activity
// log and (Super Admins) the stewards and gates. Talks only to /api/gate-control/*.
const $ = (id: string) => document.getElementById(id) as any;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const TZ = 'Africa/Lagos';
const hm = (iso?: string | null) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '';
const dayTime = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: TZ }) : '—';
const dayOnly = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '';
const naira = (k?: number | null) => k == null ? '—' : `₦${Math.round(k / 100).toLocaleString('en-NG')}`;
const todayLagos = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10);

const S: { csrf: string; user: any; perms: any; gates: string[]; incidentTypes: Record<string, string> } = { csrf: '', user: null, perms: {}, gates: [], incidentTypes: {} };
// Small saved values on this phone (the offline list, unsent check-ins, the last session).
const LS = { get: (k: string, d: any) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* blocked */ } } };
let netDown = false;

class ApiError extends Error { status: number; data: any; constructor(m: string, status: number, data: any) { super(m); this.status = status; this.data = data; } }
async function api(path: string, { method = 'GET', body, quiet = false }: { method?: string; body?: any; quiet?: boolean } = {}) {
  const headers: Record<string, string> = { 'X-CSRF-Token': S.csrf };
  if (quiet) headers['X-Activity'] = '0';
  if (body) headers['Content-Type'] = 'application/json';
  let r: Response;
  try { r = await fetch(`/api/gate-control/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', credentials: 'same-origin' }); }
  catch { netDown = true; setNet(); throw new ApiError('No connection. Check the phone’s data or Wi-Fi and try again.', 0, {}); }
  if (netDown) { netDown = false; setNet(); }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.signedOut) { const was = !!S.csrf; S.csrf = ''; LS.del('gc_sess'); LS.del('gc_pack'); LS.del('gc_used'); showSignIn(was ? 'This scanner has been switched off by the club. Ask for a new passcode.' : ''); throw new ApiError(d.error || 'Signed out', 401, d); }
  if (!r.ok) throw new ApiError(d.error || 'Something went wrong. Please try again.', r.status, d);
  return d;
}
function toast(msg: string) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout((toast as any).t); (toast as any).t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ── Screens ──
function only(id: 'signin' | 'gatePick' | 'app') { for (const x of ['signin', 'gatePick', 'app']) $(x).hidden = x !== id; }
function showSignIn(msg = '') {
  stopCamera(); stopToday();
  only('signin');
  const e = $('signinErr'); e.textContent = msg; e.hidden = !msg;
  setTimeout(() => $('passcode').focus(), 50);
}
async function boot() {
  try {
    const d = await api('session', { quiet: true });
    Object.assign(S, d);
    LS.set('gc_sess', { csrf: d.csrf, user: d.user, perms: d.perms, gates: d.gates, incidentTypes: d.incidentTypes });
    if (!S.user.gate) showGatePick(false); else showApp();
  } catch (e: any) {
    // No signal when the app opens: carry on with the last session on this phone (offline list).
    const saved = LS.get('gc_sess', null);
    if (e.status === 0 && saved?.user?.gate) { Object.assign(S, saved); showApp(); toast('No signal: working offline'); setTimeout(retryImages, 800); return; }
    if (e.status !== 401) showSignIn(e.message);
  }
}
// The passcode box: numbers only, shown as 1234-5678.
$('passcode').addEventListener('input', () => { const d = $('passcode').value.replace(/\D/g, '').slice(0, 8); $('passcode').value = d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d; });
$('signinForm').addEventListener('submit', async (ev: Event) => {
  ev.preventDefault();
  const err = $('signinErr'), btn = $('signinBtn');
  err.hidden = true;
  const passcode = $('passcode').value.replace(/\D/g, '');
  if (passcode.length !== 8) { err.textContent = 'Enter the 8-number passcode from the club, e.g. 1234-5678.'; err.hidden = false; return; }
  btn.disabled = true; btn.textContent = 'Switching on…';
  try {
    await api('login', { method: 'POST', body: { passcode } });
    $('passcode').value = '';
    await boot();
  } catch (e: any) { err.textContent = e.message; err.hidden = false; }
  finally { btn.disabled = false; btn.textContent = 'Switch on this scanner'; }
});

function showGatePick(canCancel: boolean) {
  stopCamera();
  only('gatePick');
  $('gateHello').textContent = `Hello ${S.user.firstName} · ${S.user.roleLabel}`;
  $('gateErr').hidden = true;
  $('gateCancel').hidden = !canCancel;
  $('gateList').innerHTML = S.gates.map(g => `<button type="button" class="gc-btn gc-gate${g === S.user.gate ? ' on' : ''}" data-gate="${esc(g)}">${esc(g)}</button>`).join('');
}
$('gateList').addEventListener('click', async (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-gate]') as HTMLElement | null;
  if (!b) return;
  try {
    const r = await api('gate', { method: 'POST', body: { gate: b.dataset.gate } });
    S.user.gate = r.gate;
    showApp();
    toast(`You are at ${r.gate}`);
  } catch (e: any) { $('gateErr').textContent = e.message; $('gateErr').hidden = false; }
});
$('gateCancel').addEventListener('click', () => showApp());
$('gateChip').addEventListener('click', () => { if (!S.user.allGates && !S.user.gateLocked) showGatePick(true); });
// (No sign-out button: a scanner stays on until the club revokes it in the admin.)

// The three counters on the scan screen (me, my gate, everyone today), from the server so
// they are right on every phone; refreshed after each scan and every 20 seconds.
let countsTimer: any = 0, lastOpenInc = -1, gatesNow: any = LS.get('gc_gates', null);
async function loadCounts() {
  try {
    const c = await api('counts', { quiet: true });
    $('cMe').textContent = String(c.me); $('cGate').textContent = String(c.gate.admitted); $('cAll').textContent = String(c.total);
    $('cGateL').textContent = c.gate.name || 'This gate';
    $('myRefused').textContent = c.meRefused ? `You refused ${c.meRefused} today` : '';
    renderMsgs(c.messages || []);
    $('incBadge').hidden = !c.openIncidents; $('incBadge').textContent = String(c.openIncidents || '');
    // A new incident (e.g. a banned fan at a gate): supervisors hear it straight away.
    if (S.perms.supervise && c.openIncidents > lastOpenInc && lastOpenInc >= 0) { feedback('bad'); toast('New incident: open the Incidents tab'); }
    lastOpenInc = c.openIncidents || 0;
    if (c.gates) { gatesNow = c.gates; LS.set('gc_gates', c.gates); }
    renderGates();
    renderCapacity(c.capacity || []);
  } catch { /* keep the last numbers */ }
}
// Gates open / closed: a banner on the scan screen (from the server, or the offline list).
function gatesOpenNow(): { open: boolean; text: string } {
  const g = gatesNow || pack?.gates;
  if (!g) return { open: true, text: '' };
  if (g.mode === 'closed') return { open: false, text: 'The gates are CLOSED. Do not check anyone in.' };
  if (g.mode === 'open') return { open: true, text: '' };
  if (g.opensAt && Date.now() < Date.parse(g.opensAt)) return { open: false, text: `Gates not open yet: they open at ${hm(g.opensAt)}. You can practise or look tickets up.` };
  return { open: true, text: '' };
}
function renderGates() {
  const g = gatesOpenNow();
  $('gatesBanner').hidden = g.open || practice;
  $('gatesBanner').textContent = g.text;
}
function renderCapacity(list: any[]) {
  const hot = list.filter(x => x.state === 'near' || x.state === 'full');
  $('capChips').innerHTML = hot.map(x => `<span class="gc-cap ${x.state}">${esc(x.label)}: ${x.state === 'full' ? 'FULL' : `${x.pct}% full`}</span>`).join('');
}
function startCounts() { clearInterval(countsTimer); loadCounts(); countsTimer = setInterval(() => { if (!document.hidden) loadCounts(); }, 20000); }

// ── Supervisor messages on every steward's screen ──
const seenMsg = new Set<number>(LS.get('gc_msg_seen', []));
function renderMsgs(list: any[]) {
  const gone = new Set<number>(LS.get('gc_msg_dismissed', []));
  const show = list.filter(m => !gone.has(m.id));
  $('msgs').innerHTML = show.map(m => `<div class="gc-msg${m.personal ? ' me' : ''}" role="alert"><div><b>${esc(m.text)}</b><small>${esc(m.from || 'Supervisor')} · ${hm(m.at)} · ${m.personal ? 'to you only' : m.gate ? esc(m.gate) : 'all gates'}</small></div><button type="button" data-dismiss="${m.id}">OK</button></div>`).join('');
  const fresh = show.filter(m => !seenMsg.has(m.id));
  if (fresh.length) { feedback('info'); navigator.vibrate?.([200, 100, 200]); fresh.forEach(m => seenMsg.add(m.id)); LS.set('gc_msg_seen', [...seenMsg].slice(-100)); }
}
$('msgs').addEventListener('click', (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-dismiss]') as HTMLElement | null;
  if (!b) return;
  const gone = new Set<number>(LS.get('gc_msg_dismissed', [])); gone.add(Number(b.dataset.dismiss)); LS.set('gc_msg_dismissed', [...gone].slice(-100));
  b.closest('.gc-msg')?.remove();
});

// ── Offline: today's ticket list kept on this phone ──
// Stadium mobile data often fails when the crowd arrives. Each phone keeps today's tickets
// (number, stand, child, first name, already in) and checks them itself when there is no
// signal; offline check-ins are sent when the signal returns (anyone let in twice is flagged).
type Row = [string, string, number, string, number];
const STAND: Record<string, string> = { VIP: 'VIP Sitting', Premium: 'Grand Stand', Regular: 'Popular Stand' };
let pack: any = null, packMap = new Map<string, Row>(), usedLocal = new Set<string>(LS.get('gc_used', [])), queue: any[] = LS.get('gc_queue', []);
function usePack(p: any) { pack = p; packMap = new Map((p?.tickets || []).map((r: Row) => [r[0], r])); }
usePack(LS.get('gc_pack', null));
const packToday = () => !!(pack?.match && new Date(Date.parse(pack.at) + 3600e3).toISOString().slice(0, 10) === todayLagos());
async function refreshPack() {
  try {
    const p = await api('offline', { quiet: true });
    usePack(p); LS.set('gc_pack', p);
    usedLocal = new Set(queue.map((q: any) => q.ticket)); LS.set('gc_used', [...usedLocal]);
    if (p.gates) { gatesNow = p.gates; LS.set('gc_gates', p.gates); }
    sendStatus();
  } catch { /* keep the saved list */ }
  showOfflineInfo(); renderGates();
}
function showOfflineInfo() {
  $('offlineInfo').textContent = packToday() ? `Offline list ready: ${pack.tickets.length.toLocaleString('en-GB')} tickets for ${pack.match.name} (updated ${hm(pack.at)}). Scanning carries on if the signal drops.`
    : pack && !pack.match ? 'No Lobi Stars home match today, so there is no offline list.' : '';
}
function setNet() {
  const chip = $('netChip'); if (!chip) return;
  const off = netDown || !navigator.onLine;
  chip.hidden = !off && !queue.length;
  chip.classList.toggle('off', off);
  chip.textContent = off ? `Offline${queue.length ? ` · ${queue.length}` : ''}` : `${queue.length} to send`;
  chip.title = off ? `No signal: working from the offline list${queue.length ? `; ${queue.length} check-in${queue.length === 1 ? '' : 's'} to send` : ''}` : `${queue.length} offline check-in${queue.length === 1 ? '' : 's'} to send`;
}
function localCheck(text: string, how: string, override = false): any {
  const up = text.toUpperCase().replace(/\s+/g, '');
  // Media Centre card (its QR link) and staff passes: from the offline list of passes.
  const md = /\/MEDIA\/(?:ACCREDITATION\/)?VERIFY\/([A-Z0-9_-]{8,80})/.exec(up);
  if (md) {
    const tok = /\/media\/(?:accreditation\/)?verify\/([A-Za-z0-9_-]{8,80})/i.exec(text)?.[1] || '';
    const ps = (pack?.passes || []).find((x: any) => x[0] === `MEDIA:${tok}`);
    return ps ? { code: 'pass_ok', title: 'VALID MEDIA CARD', reason: `Allowed in: ${ps[3] || 'see the card'}. Check the photo on the card matches the person.`, ticket: { kind: 'pass', id: 'Media card', buyer: ps[1], stand: ps[2], type: 'Pass', zones: String(ps[3] || '').split(', ').filter(Boolean) }, offline: true }
      : { code: 'not_listed', title: 'MEDIA CARD NOT ON THE LIST', reason: "This media card is not on today's list on this phone. Do not let the person in until it is checked with a signal.", offline: true };
  }
  const m = /LS-?(TIX|SZN|ACC)-?([A-HJ-NP-Z2-9]{12})(?![A-Z0-9])/.exec(up) || (/^[A-HJ-NP-Z2-9]{12}$/.test(up) ? [up, 'TIX', up] : null);
  if (m && m[1] === 'ACC') {
    const id = `LS-ACC-${m[2]}`, ps = (pack?.passes || []).find((x: any) => x[0] === id);
    return ps ? { code: 'pass_ok', title: 'VALID PASS', reason: `Allowed in: ${ps[3]}. Check the person matches the name.`, ticket: { kind: 'pass', id, buyer: ps[1], stand: ps[2], type: 'Pass', zones: String(ps[3] || '').split(', ').filter(Boolean) }, offline: true }
      : { code: 'pass_bad', title: 'PASS NOT ON THE LIST', reason: "This pass is not valid today (or not on this phone's list). Do not let the person in until it is checked with a signal.", offline: true };
  }
  if (m && PRACTICE_IDS[`LS-TIX-${m[2]}`]) return practice ? practiceLocal(`LS-TIX-${m[2]}`) : { code: 'practice_ticket', title: 'PRACTICE TICKET', reason: 'This is a practice ticket, not a real one. Do not admit.', offline: true };
  if (!m) return /^HTTPS?:/.test(up) && !/LOBISTARSFC/.test(up) ? { code: 'not_lobi', fake: true, title: 'NOT A LOBI STARS TICKET', reason: 'This QR code is not a Lobi Stars FC ticket.', offline: true }
    : { code: 'bad_number', title: 'CHECK THE NUMBER', reason: 'This is not a complete ticket number. Check it and try again.', offline: true };
  const id = `LS-${m[1]}-${m[2]}`, row = packMap.get(id);
  if (!row) return { code: 'not_listed', title: "NOT ON TODAY'S LIST", reason: `${id} is not on today's ticket list on this phone: it may be fake, cancelled or for another match. Do not admit. Check it again when the signal returns.`, offline: true };
  const ticket = { kind: m[1] === 'SZN' ? 'season' : 'match', id, stand: STAND[row[1]] || row[1], type: row[2] ? 'Child' : 'Adult', buyer: row[3] || 'No name', status: 'valid' };
  if ((pack?.banned || []).includes(id)) return { code: 'banned', title: 'DO NOT ADMIT', reason: "This fan is on the club's banned list. Do not admit; call a supervisor.", ticket, offline: true };
  if (row[4] || usedLocal.has(id)) return { code: 'used', title: 'ALREADY USED', reason: 'Already checked in (offline list). Do not admit again.', ticket, offline: true };
  if (mode === 'lookup') return { code: 'valid', title: 'VALID TICKET', reason: "On today's list and not used yet (offline). Not checked in.", ticket, offline: true };
  const only = pack.stands?.[S.user.gate];
  if (!override && only?.length && !only.includes(row[1])) {
    const goTo = S.gates.filter(g => !pack.stands?.[g]?.length || pack.stands[g].includes(row[1]));
    return { code: 'wrong_gate', title: 'WRONG GATE', canOverride: true, reason: `This ticket is for the ${ticket.stand}. Send the fan to ${goTo.join(' or ') || 'the right gate'}. Not checked in.`, ticket, offline: true };
  }
  if (practice) return { code: 'admitted', title: row[2] ? 'ADMIT CHILD' : 'ADMIT', reason: 'Practice: not checked in.', ticket, offline: true, practice: true };
  const g = gatesOpenNow();
  if (!g.open && !override) return { code: 'gates_closed', title: 'GATES NOT OPEN', reason: g.text, ticket, offline: true };
  usedLocal.add(id); LS.set('gc_used', [...usedLocal]);
  queue.push({ ticket: id, at: new Date().toISOString(), how }); LS.set('gc_queue', queue); setNet();
  return { code: 'admitted', title: row[2] ? 'ADMIT CHILD' : 'ADMIT', reason: 'Checked in on this phone (offline). It is sent to the other gates when the signal returns.', ticket: { ...ticket, status: 'used' }, offline: true };
}
let syncing = false;
async function syncQueue() {
  if (syncing || !queue.length) return;
  syncing = true;
  const batch = queue.slice(0, 200);
  try {
    const r = await api('sync', { method: 'POST', body: { scans: batch } });
    queue = queue.slice(batch.length); LS.set('gc_queue', queue);
    toast(`${r.sent} offline check-in${r.sent === 1 ? '' : 's'} sent`);
    if (r.doubles?.length) { feedback('bad'); alert(`Double entry: ${r.doubles.join(', ')} had already been checked in at another gate before you let ${r.doubles.length === 1 ? 'it' : 'them'} in offline. Tell your supervisor.`); }
    loadCounts();
  } catch { /* try again later */ } finally { syncing = false; setNet(); }
}
setInterval(() => { if (queue.length && navigator.onLine) syncQueue(); }, 15000);
setInterval(() => { if (S.user && navigator.onLine && !document.hidden) refreshPack(); }, 5 * 60e3);
// Pictures that missed the saved copy while the app opened offline: try once more.
function retryImages() { document.querySelectorAll('img').forEach(i => { if (i.complete && !i.naturalWidth) i.src = `${i.getAttribute('src')!.split('?')[0]}?r=${Date.now()}`; }); }
window.addEventListener('online', () => { setNet(); syncQueue(); refreshPack(); retryImages(); });
window.addEventListener('offline', setNet);

// ── Practice mode: practice tickets show each answer; nothing is checked in or counted ──
const PRACTICE_IDS: Record<string, string> = {
  'LS-TIX-TEST2ADULT22': 'admitted', 'LS-TIX-TEST3CHLD333': 'admitted_child', 'LS-TIX-TEST4USED444': 'used', 'LS-TIX-TEST5FAKE555': 'fake',
  'LS-TIX-TEST6MATCH66': 'wrong_match', 'LS-TIX-TEST7STAND77': 'wrong_gate', 'LS-TIX-TEST8BANNED8': 'banned',
};
function practiceLocal(id: string): any {
  const k = PRACTICE_IDS[id];
  const t = { kind: 'match', id, stand: k === 'wrong_gate' ? 'VIP Sitting' : 'Popular Stand', type: k === 'admitted_child' ? 'Child' : 'Adult', buyer: 'Practice Fan' };
  const R: Record<string, any> = {
    admitted: { code: 'admitted', title: 'ADMIT', reason: 'Genuine ticket, checked in now.' }, admitted_child: { code: 'admitted', title: 'ADMIT CHILD', reason: 'Child ticket: check the age if unsure.' },
    used: { code: 'used', title: 'ALREADY USED', reason: 'Already checked in earlier. Do not admit again.' }, fake: { code: 'fake', title: 'FAKE TICKET', reason: 'No Lobi Stars ticket has this number. Do not admit.' },
    wrong_match: { code: 'wrong_match', title: 'WRONG MATCH', reason: 'Genuine ticket, but for another match.' }, wrong_gate: { code: 'wrong_gate', title: 'WRONG GATE', reason: 'This ticket is for the VIP Sitting. Send the fan to VIP Gate.', canOverride: true },
    banned: { code: 'banned', title: 'DO NOT ADMIT', reason: "This fan is on the club's banned list. Do not admit; call a supervisor." },
  };
  return { ...R[k], ticket: k === 'fake' ? null : t, practice: true, offline: true };
}
let practice = false, practiceCount = Number(LS.get('gc_practice_n', 0)) || 0;
function setPractice(on: boolean) {
  practice = on;
  $('practiceBtn').setAttribute('aria-pressed', String(on));
  $('practiceBar').hidden = !on;
  document.body.classList.toggle('gc-practising', on);
  $('result').innerHTML = '';
  renderGates();
  if (on) $('practiceList').innerHTML = Object.keys(PRACTICE_IDS).map(id => `<li><span class="gc-mono">${id.slice(7)}</span><small>${({ admitted: 'Adult: ADMIT', admitted_child: 'Child: ADMIT CHILD', used: 'Already used', fake: 'Fake', wrong_match: 'Another match', wrong_gate: 'Wrong gate', banned: 'Banned fan' } as Record<string, string>)[PRACTICE_IDS[id]]}</small></li>`).join('');
  toast(on ? 'Practice mode: nothing is checked in or counted' : 'Practice mode off: real check-ins');
}
$('practiceBtn').addEventListener('click', () => setPractice(!practice));
$('practiceOff').addEventListener('click', () => setPractice(false));

// ── Keep the screen awake while Lobi Gate Control is open (no unlocking with a queue waiting) ──
let wakeLock: any = null, wakeOk: boolean | null = null;
async function keepAwake() {
  const wl = (navigator as any).wakeLock;
  if (!wl) { wakeOk = null; return; }
  if (wakeLock && !wakeLock.released) return;
  try { wakeLock = await wl.request('screen'); wakeOk = true; wakeLock.addEventListener?.('release', () => { wakeOk = document.hidden ? wakeOk : false; }); }
  catch { wakeOk = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) { keepAwake(); sendStatus(); } });
document.addEventListener('pointerdown', () => { if (S.user && (!wakeLock || wakeLock.released)) keepAwake(); });

// ── Readiness: this phone tells the club it is ready (camera, offline list, battery, screen awake) ──
let camState: string = LS.get('gc_cam', 'untested'), scannerUsed = !!LS.get('gc_scanner', false), battery: any = null, statusTimer: any = 0;
async function initBattery() {
  try { const b = await (navigator as any).getBattery?.(); if (b) { battery = b; b.addEventListener('levelchange', sendStatus); b.addEventListener('chargingchange', sendStatus); } } catch { battery = null; }
}
async function cameraPermission() {
  try { const q = await (navigator as any).permissions?.query({ name: 'camera' }); if (q?.state === 'denied') camState = 'blocked'; else if (q?.state === 'granted' && camState !== 'ok') camState = LS.get('gc_cam', 'untested'); } catch { /* not supported */ }
}
async function sendStatus() {
  if (!S.user || !navigator.onLine) return;
  await cameraPermission();
  const body = {
    camera: camState, scanner: scannerUsed, wake: wakeOk, online: navigator.onLine, queue: queue.length, practice: practiceCount,
    installed: matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true,
    pack: pack ? { n: pack.tickets?.length || 0, at: pack.at, match: pack.match?.id || '' } : null,
    battery: battery ? { level: battery.level, charging: battery.charging } : null,
  };
  try { await api('status', { method: 'POST', body, quiet: true }); } catch { /* next time */ }
  renderReady();
}
function renderReady() {
  const issues: string[] = [];
  if (camState === 'blocked') issues.push('The camera is blocked: allow it for lobistarsfc.com in the phone settings.');
  else if (camState !== 'ok' && !scannerUsed) issues.push('Test the camera: press Scan ticket once.');
  if (gatesNow?.kickOff && !packToday()) issues.push('No offline ticket list yet: keep the app open with a signal for a minute.');
  if (battery && !battery.charging && battery.level < 0.3) issues.push(`Battery ${Math.round(battery.level * 100)}%: charge the phone now.`);
  if (wakeOk === false) issues.push('The screen may switch off: turn off battery saver.');
  $('readyBox').hidden = !issues.length;
  $('readyList').innerHTML = issues.map(i => `<li>${esc(i)}</li>`).join('');
}
function startStatus() { clearInterval(statusTimer); sendStatus(); statusTimer = setInterval(() => { if (!document.hidden) sendStatus(); }, 60000); }
initBattery();

// ── My last scans (this phone) ──
const recent: any[] = [];
function pushRecent(r: any) {
  recent.unshift({ at: new Date().toISOString(), title: r.title, code: r.code, ticket: r.ticket?.id || '', name: r.ticket?.buyer || '', offline: !!r.offline });
  recent.length = Math.min(recent.length, 6);
  $('recentBox').hidden = false;
  $('recentList').innerHTML = recent.map(x => `<li><span class="gc-dot ${({ ok: 'ok', info: 'info', warn: 'warn' } as Record<string, string>)[KIND[x.code]] || 'bad'}"></span><div class="gc-li-main"><b>${esc(x.title)}</b> <span class="gc-mono">${esc(x.ticket)}</span><small>${esc(x.name)}${x.offline ? ' · offline' : ''}</small></div><span class="gc-li-time">${hm(x.at)}</span></li>`).join('');
}

let view = 'scan';
function showApp() {
  only('app');
  $('who').textContent = `${S.user.code ? S.user.code + ' · ' : ''}${S.user.name} · ${S.user.roleLabel}`;
  $('gateName').textContent = S.user.gate;
  // Supervisors work at all gates; a steward given a gate by the club stays at it.
  const fixed = S.user.allGates || S.user.gateLocked;
  ($('gateChip') as HTMLButtonElement).disabled = !!fixed;
  // Supervisors: "this gate" is every gate, so show just You today and All gates.
  ($('cGate').parentElement as HTMLElement).hidden = !!S.user.allGates;
  $('cGate').closest('.gc-tally')!.classList.toggle('two', !!S.user.allGates);
  $('gateChip').setAttribute('aria-label', fixed ? `Gate: ${S.user.gate}` : 'Change gate');
  $('staffTab').hidden = !S.perms.staff;
  $('supBox').hidden = !S.perms.supervise;
  if (S.csrf) LS.set('gc_sess', { csrf: S.csrf, user: S.user, perms: S.perms, gates: S.gates, incidentTypes: S.incidentTypes });
  $('incCat').innerHTML = Object.entries(S.incidentTypes || {}).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  $('msgGate').innerHTML = '<option value="">All gates</option>' + S.gates.map(g => `<option>${esc(g)}</option>`).join('');
  go(view);
  startCounts();
  setNet(); showOfflineInfo(); refreshPack(); syncQueue();
  keepAwake(); startStatus(); renderGates();
}
function go(v: string) {
  view = v;
  for (const t of document.querySelectorAll<HTMLElement>('.gc-tab')) { if (t.dataset.view === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); }
  for (const x of ['scan', 'today', 'incidents', 'activity', 'staff']) $(`v-${x}`).hidden = x !== v;
  if (v !== 'scan') stopCamera();
  if (v === 'today') startToday(); else stopToday();
  if (v === 'activity') loadActivity(1);
  if (v === 'staff') loadStaff();
  if (v === 'incidents') loadIncidents();
  if (v === 'scan') loadCounts();
  window.scrollTo(0, 0);
}
document.querySelector('.gc-tally')!.addEventListener('click', () => go('today'));
document.querySelector('.gc-tabs')!.addEventListener('click', ev => {
  const b = (ev.target as HTMLElement).closest('[data-view]') as HTMLElement | null;
  if (b) go(b.dataset.view!);
});

// ── Sounds and vibration (so the steward needn't read the screen every time) ──
let audio: AudioContext | null = null;
function tone(freq: number, ms: number, at = 0, type: OscillatorType = 'sine') {
  try {
    audio = audio || new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at / 1000;
    o.type = type; o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    o.start(t); o.stop(t + ms / 1000 + 0.05);
  } catch { /* no sound */ }
}
function feedback(kind: string) {
  if (kind === 'ok') { tone(880, 120); tone(1320, 160, 140); navigator.vibrate?.(80); }
  else if (kind === 'info') { tone(990, 140); navigator.vibrate?.(40); }
  else if (kind === 'warn') { tone(520, 220, 0, 'triangle'); tone(520, 220, 280, 'triangle'); navigator.vibrate?.([120, 80, 120]); }
  else { tone(220, 520, 0, 'square'); navigator.vibrate?.([300, 100, 300]); }
}

// ── Check in / look up ──
let mode: 'admit' | 'lookup' = 'admit';
function setMode(m: 'admit' | 'lookup') {
  mode = m;
  $('modeAdmit').setAttribute('aria-pressed', String(m === 'admit'));
  $('modeLook').setAttribute('aria-pressed', String(m === 'lookup'));
  $('camLbl').textContent = camOn ? 'Stop camera' : m === 'admit' ? 'Scan ticket' : 'Scan to look up';
}
$('modeAdmit').addEventListener('click', () => setMode('admit'));
$('modeLook').addEventListener('click', () => setMode('lookup'));

const KIND: Record<string, string> = { admitted: 'ok', readmitted: 'ok', valid: 'info', used: 'bad', void: 'bad', unpaid: 'bad', fake: 'fake', not_lobi: 'fake', wrong_match: 'warn', wrong_gate: 'warn', bad_number: 'warn', not_listed: 'bad',
  banned: 'bad', gates_closed: 'warn', stand_full: 'bad', pass_ok: 'pass', pass_bad: 'bad', practice_ticket: 'fake' };
const ICON: Record<string, string> = {
  ok: '<path d="M20 6 9 17l-5-5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  bad: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>', pass: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>', fake: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/>',
  warn: '<path d="M12 3 2 21h20L12 3z"/><path d="M12 10v5M12 18v.5"/>', wait: '<circle cx="12" cy="12" r="9" stroke-dasharray="40 20"/>',
};
const ico = (k: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ICON.info}</svg>`;
let busy = false, lastText = '', lastTime = 0, autoNext: any = 0, lastTicket = '';

function renderResult(r: any) {
  const k = KIND[r.code] || 'bad';
  const t = r.ticket;
  const det = (label: string, value: unknown, full = false) => value && value !== '—' ? `<div${full ? ' class="full"' : ''}><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '';
  const where = t?.where ? [t.where.source, t.where.device, t.where.place].filter(Boolean).join(' · ') : '';
  const checked = t?.status === 'used' && t.usedAt ? `${dayTime(t.usedAt)}${t.usedGate ? ` · ${t.usedGate}` : ''}${t.usedByName ? ` · ${t.usedByName}` : ''}` : '';
  const autoMs = k === 'ok' && (camOn || lastHow === 'scanner') ? 2500 : 0;
  if (r.practice) { practiceCount++; LS.set('gc_practice_n', practiceCount); }
  const passHtml = t?.kind === 'pass' ? `<div class="gc-r-who"><b>${esc(t.buyer || '')}</b><span>${esc(t.stand || '')}${t.organisation ? ` · ${esc(t.organisation)}` : ''}</span></div>
      ${t.zones?.length ? `<div class="gc-zones">${t.zones.map((z: string) => `<span>${esc(z)}</span>`).join('')}</div>` : ''}
      <dl class="gc-details">${det('Pass number', t.id)}${det('Valid', t.from ? (t.from === t.to ? t.from : `${t.from} to ${t.to}`) : '')}${det('Last scanned', t.lastScan ? dayTime(t.lastScan) : '')}</dl>` : '';
  $('result').innerHTML = `
    <div class="gc-result ${k}${r.practice ? ' practice' : ''}" role="alert">
      ${r.practice ? '<div class="gc-practice-tag">PRACTICE: not checked in</div>' : ''}
      <div class="gc-r-top"><span class="gc-r-ic">${ico(k)}</span><div class="gc-r-title">${esc(r.title || '')}</div></div>
      <p class="gc-r-reason">${esc(r.reason || '')}${r.offline ? ' <span class="gc-tag">Offline</span>' : ''}</p>
      ${passHtml}${t && t.kind !== 'pass' ? `<div class="gc-r-who"><b>${esc(t.buyer || 'No name')}</b><span>${esc(t.stand)} · ${esc(t.type)} ticket</span></div>
      <dl class="gc-details">
        ${det('Match', t.match ? `${t.match}${t.matchDate ? ` · ${dayOnly(t.matchDate)}` : ''}` : '', true)}
        ${det('Ticket number', t.id)}
        ${det('Price paid', t.pricePaidKobo === 0 ? 'Free ticket' : naira(t.pricePaidKobo))}
        ${det('Bought on', dayTime(t.boughtAt))}
        ${det('Bought where', where || t.channel)}
        ${det('Order', t.ticketsInOrder ? `${t.ticketsInOrder} ticket${t.ticketsInOrder === 1 ? '' : 's'} · ${naira(t.orderTotalKobo)} total` : '')}
        ${det('Payment', t.payment)}
        ${det('Phone', t.phone)}
        ${det('Email', t.email)}
        ${det('Checked in', checked, true)}
      </dl>` : ''}
      <div class="gc-r-actions">
        ${r.canOverride ? '<button type="button" class="gc-btn ghost" data-act="override">Admit here anyway</button>' : ''}
        ${r.canForce ? '<button type="button" class="gc-btn ghost" data-act="force">Let in (supervisor)</button>' : ''}
        ${r.code === 'used' && S.perms.readmit && t?.kind === 'match' && !r.offline ? '<button type="button" class="gc-btn ghost" data-act="readmit">Re-admit (supervisor)</button>' : ''}
        <button type="button" class="gc-btn" data-act="next">${camOn ? 'Scan next ticket' : 'Next ticket'}</button>
      </div>
      ${autoMs ? `<div class="gc-auto" aria-hidden="true"><i style="--t:${autoMs}ms"></i></div>` : ''}
    </div>`;
  feedback(k === 'fake' ? 'bad' : k === 'pass' ? 'info' : k);
  clearTimeout(autoNext);
  if (autoMs) autoNext = setTimeout(nextTicket, autoMs);
  $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function nextTicket() {
  clearTimeout(autoNext);
  $('result').innerHTML = '';
  lastText = '';
  if (camOn) resumeCamera(); else $('ticketNo').focus();
}
$('result').addEventListener('click', (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
  if (!b) return;
  if (b.dataset.act === 'next') nextTicket();
  if (b.dataset.act === 'override') check(lastTicket, (lastHow || 'typed') as any, true);
  if (b.dataset.act === 'force') { if (confirm('Let this fan in although the gates are closed or the stand is full? Your name is recorded.')) check(lastTicket, (lastHow || 'typed') as any, lastOverride, true); }
  if (b.dataset.act === 'readmit') { clearTimeout(autoNext); $('readmitErr').hidden = true; $('readmitWhy').value = ''; $('readmitDlg').showModal(); }
});

let lastHow = '';
function bumpCounts() {
  $('cMe').textContent = String(Number($('cMe').textContent) + 1);
  $('cGate').textContent = String(Number($('cGate').textContent) + 1);
  $('cAll').textContent = String(Number($('cAll').textContent) + 1);
  $('lastAt').textContent = `Last check-in at ${hm(new Date().toISOString())}`;
}
function offlineResult(text: string, how: string, override: boolean) {
  const r = localCheck(text, how, override);
  if (r.code === 'admitted' && !r.practice) bumpCounts();
  renderResult(r); pushRecent(r);
}
let lastOverride = false;
async function check(text: string, how: 'camera' | 'typed' | 'scanner', override = false, force = false) {
  if (busy) return;
  busy = true; lastTicket = text; lastHow = how; lastOverride = override;
  clearTimeout(autoNext);
  // No signal at all: straight to the offline list (no waiting for the network to fail).
  if (!navigator.onLine && packToday()) { offlineResult(text, how, override); busy = false; return; }
  $('result').innerHTML = `<div class="gc-result wait"><div class="gc-r-top"><span class="gc-r-ic">${ico('wait')}</span><div class="gc-r-title">Checking…</div></div></div>`;
  try {
    const r = await api('check', { method: 'POST', body: { ticket: text, mode, how, override, force, practice } });
    pushRecent(r);
    if (queue.length) syncQueue();
    if (r.code === 'admitted' && !r.practice) {
      $('cMe').textContent = String(Number($('cMe').textContent) + 1);
      $('cGate').textContent = String(Number($('cGate').textContent) + 1);
      $('cAll').textContent = String(Number($('cAll').textContent) + 1);
      $('lastAt').textContent = `Last check-in at ${hm(new Date().toISOString())}`;
    }
    renderResult(r);
    loadCounts();
  } catch (e: any) {
    if (e.data?.needGate) { showGatePick(false); return; }
    if (e.status === 401) return;
    if (e.status === 0 && packToday()) { offlineResult(text, how, override); return; }
    $('result').innerHTML = `<div class="gc-result warn" role="alert"><div class="gc-r-top"><span class="gc-r-ic">${ico('warn')}</span><div class="gc-r-title">Not checked</div></div>
      <p class="gc-r-reason">${esc(e.message)}</p><div class="gc-r-actions"><button type="button" class="gc-btn" data-act="retry">Try again</button><button type="button" class="gc-btn ghost" data-act="next">Cancel</button></div></div>`;
    feedback('warn');
  } finally { busy = false; }
}
$('result').addEventListener('click', (ev: Event) => {
  if ((ev.target as HTMLElement).closest('[data-act="retry"]')) check(lastTicket, 'typed');
});
$('typeForm').addEventListener('submit', (ev: Event) => {
  ev.preventDefault();
  const v = $('ticketNo').value.trim();
  if (!v) { $('ticketNo').focus(); return; }
  if (camOn) pauseCamera();
  $('ticketNo').value = '';
  // A scanner that "types" into the box is much faster than a person.
  check(v, keys.fast && v.length >= 8 ? 'scanner' : 'typed');
  if (keys.fast && v.length >= 8) scannerSeen();
});

// ── Wireless / USB barcode scanners (on a laptop or tablet) ──
// They act like a keyboard: the ticket's code (or its whole QR link) is "typed" in a few
// milliseconds and ends with Enter (some send Tab). Caught anywhere on the scan screen, so
// the steward never has to tap the box; a person typing is far slower and goes to the box.
const keys = { buf: '', last: 0, gaps: [] as number[], fast: false };
function scannerSeen() {
  if (!scannerUsed) { scannerUsed = true; LS.set('gc_scanner', true); renderReady(); }
  const h = $('scannerHint'); h.classList.add('on'); h.classList.remove('away');
  $('scannerText').innerHTML = '<b>Scanner connected.</b> Scan the next ticket; the result shows here.';
}
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if ($('app').hidden || view !== 'scan' || document.querySelector('dialog[open]')) return;
  const now = performance.now(), gap = now - keys.last;
  keys.last = now;
  if (gap > 120) { keys.buf = ''; keys.gaps = []; }
  else keys.gaps.push(gap);
  keys.fast = keys.gaps.length >= 6 && keys.gaps.reduce((a, b) => a + b, 0) / keys.gaps.length < 45;
  const t = e.target as HTMLElement;
  if (t && t.id === 'ticketNo') return;             // the box handles its own Enter (and notices the speed)
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if ((e.key === 'Enter' || e.key === 'Tab') && keys.buf.length >= 8 && keys.fast) {
    e.preventDefault(); e.stopPropagation();
    const code = keys.buf.trim(); keys.buf = ''; keys.gaps = [];
    if (camOn) pauseCamera();
    scannerSeen();
    check(code, 'scanner');
    return;
  }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    keys.buf += e.key;
    // While a scanner is typing, keep its characters (e.g. a space) from pressing buttons.
    if (keys.buf.length > 3 && keys.fast) e.preventDefault();
  }
}, true);
window.addEventListener('blur', () => { if ($('scannerHint').classList.contains('on')) { $('scannerHint').classList.add('away'); $('scannerText').innerHTML = '<b>Click this page</b> so the scanner can type into it.'; } });
window.addEventListener('focus', () => { if ($('scannerHint').classList.contains('away')) scannerSeen(); });

// Re-admit (supervisors)
$('readmitCancel').addEventListener('click', () => $('readmitDlg').close());
$('readmitForm').addEventListener('submit', async (ev: Event) => {
  ev.preventDefault();
  try {
    const r = await api('readmit', { method: 'POST', body: { ticket: lastTicket, reason: $('readmitWhy').value } });
    $('readmitDlg').close();
    renderResult(r);
  } catch (e: any) { $('readmitErr').textContent = e.message; $('readmitErr').hidden = false; }
});

// ── Camera: the phone's own camera feed (works on iPhone and Android) ──
// A <video playsinline muted> shows the back camera; about 8 times a second the square in
// the middle is read for a QR code: with the phone's built-in reader (BarcodeDetector, e.g.
// Android Chrome) or else jsQR (kept on this website: /vendor), which works everywhere.
let stream: MediaStream | null = null, camOn = false, camPaused = false, loopTimer: any = 0, detector: any = null;
let cams: MediaDeviceInfo[] = [], camIndex = -1, track: MediaStreamTrack | null = null;
const grab = document.createElement('canvas');
const grabCtx = grab.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D;
function loadJsQR(): Promise<void> {
  if ((window as any).jsQR) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/jsqr-1.4.0.min.js';
    sc.onload = () => ok(); sc.onerror = () => fail(new Error('The scanner could not load. Check the connection and try again, or type the ticket number below.'));
    document.head.appendChild(sc);
  });
}
async function startCamera() {
  $('camErr').hidden = true;
  $('camBtn').disabled = true; $('camLbl').textContent = 'Starting camera…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(location.protocol !== 'https:' ? 'The camera only works on https://lobistarsfc.com.' : 'This browser cannot use the camera. Open Gate Control in Chrome (Android) or Safari (iPhone), or type the ticket number below.');
    const dev = camIndex >= 0 && cams[camIndex] ? cams[camIndex].deviceId : '';
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: dev ? { deviceId: { exact: dev } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const v = $('camVideo') as HTMLVideoElement;
    v.muted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
    v.srcObject = stream;
    $('cam').hidden = false;
    await v.play().catch(() => { /* some phones start it themselves */ });
    camOn = true; camPaused = false;
    camState = 'ok'; LS.set('gc_cam', 'ok'); renderReady();
    // The phone's own QR reader when it has one; jsQR otherwise.
    detector = null;
    const BD = (window as any).BarcodeDetector;
    if (BD) { try { const f = await BD.getSupportedFormats(); if (f.includes('qr_code')) detector = new BD({ formats: ['qr_code'] }); } catch { detector = null; } }
    if (!detector) await loadJsQR();
    // Torch (dark entrances, night matches) and switching cameras, where the phone allows.
    track = stream.getVideoTracks()[0] || null;
    const caps: any = (track as any)?.getCapabilities ? (track as any).getCapabilities() : {};
    $('torchBtn').hidden = !caps.torch; $('torchBtn').setAttribute('aria-pressed', 'false');
    try { cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); $('flipBtn').hidden = cams.length < 2; } catch { $('flipBtn').hidden = true; }
    scanLoop();
  } catch (e: any) {
    await stopCamera();
    const why = String(e?.name || '') + ' ' + String(e?.message || e || '');
    if (/NotAllowed|Permission|denied/i.test(why)) { camState = 'blocked'; LS.set('gc_cam', 'blocked'); renderReady(); }
    const msg = /NotAllowed|Permission|denied/i.test(why) ? 'The camera is blocked. Allow the camera for lobistarsfc.com (iPhone: Settings › Safari › Camera › Allow; Android: tap the lock next to the address › Permissions › Camera), then press Scan ticket again. Or type the ticket number below.'
      : /NotFound|Overconstrained|no camera|device not found/i.test(why) ? 'No camera was found on this device. Type the ticket number below.'
      : /NotReadable|in use|Could not start/i.test(why) ? 'Another app is using the camera. Close it and press Scan ticket again.'
      : (e?.message || 'The camera could not start. Type the ticket number below.');
    $('camErr').textContent = msg; $('camErr').hidden = false;
  } finally {
    $('camBtn').disabled = false; setMode(mode);
  }
}
/** Reads the square in the middle of the picture (what the steward sees inside the frame). */
async function readFrame(): Promise<string | null> {
  const v = $('camVideo') as HTMLVideoElement;
  const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h || v.readyState < 2) return null;
  if (detector) {
    try { const r = await detector.detect(v); return r && r[0] ? r[0].rawValue || null : null; }
    catch { detector = null; await loadJsQR().catch(() => {}); }
  }
  const jsQR = (window as any).jsQR;
  if (!jsQR) return null;
  const side = Math.min(w, h), size = Math.min(640, side);
  grab.width = size; grab.height = size;
  grabCtx.drawImage(v, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  const img = grabCtx.getImageData(0, 0, size, size);
  const code = jsQR(img.data, size, size, { inversionAttempts: 'attemptBoth' });
  return code && code.data ? code.data : null;
}
function scanLoop() {
  clearTimeout(loopTimer);
  if (!camOn) return;
  loopTimer = setTimeout(async () => {
    if (camOn && !camPaused) { try { const text = await readFrame(); if (text) onScan(text.trim()); } catch { /* next frame */ } }
    scanLoop();
  }, 120);
}
$('torchBtn').addEventListener('click', async () => {
  const on = $('torchBtn').getAttribute('aria-pressed') !== 'true';
  try { await (track as any)?.applyConstraints({ advanced: [{ torch: on }] }); $('torchBtn').setAttribute('aria-pressed', String(on)); } catch { toast('The torch is not available on this phone.'); }
});
$('flipBtn').addEventListener('click', async () => {
  if (!cams.length) return;
  camIndex = (camIndex + 1) % cams.length;
  await stopCamera(); await startCamera();
});
function pauseCamera() { camPaused = true; }
function resumeCamera() { camPaused = false; }
async function stopCamera() {
  const was = camOn || !!stream;
  camOn = false; camPaused = false; clearTimeout(loopTimer);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  track = null;
  const v = $('camVideo') as HTMLVideoElement | null;
  if (v) v.srcObject = null;
  $('cam').hidden = true;
  if (was) setMode(mode);
}
function onScan(text: string) {
  const now = Date.now();
  if (busy || (text === lastText && now - lastTime < 4000)) return;
  lastText = text; lastTime = now;
  pauseCamera();
  check(text, 'camera');
}
// Phones only play sound after a tap: the first tap on the scan button switches it on.
function unlockAudio() { try { audio = audio || new (window.AudioContext || (window as any).webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch { /* no sound */ } }
document.addEventListener('pointerdown', unlockAudio, { once: true });
$('camBtn').addEventListener('click', () => { unlockAudio(); camOn ? stopCamera() : startCamera(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

// ── Today ──
let todayTimer: any = 0;
const RESULT_LABEL: Record<string, [string, string]> = {
  admitted: ['Checked in', 'ok'], readmitted: ['Re-admitted', 'ok'], lookup: ['Looked up', 'info'], used: ['Refused: already used', 'bad'], fake: ['FAKE ticket', 'bad'],
  not_lobi: ['Not a Lobi Stars ticket', 'bad'], wrong_match: ['Wrong match', 'warn'], void: ['Cancelled ticket', 'bad'], unpaid: ['Not paid', 'bad'], bad_number: ['Number mistyped', 'warn'],
  wrong_gate: ['Sent to another gate', 'warn'], banned: ['BANNED fan refused', 'bad'], gates_closed: ['Gates not open', 'warn'], stand_full: ['Stand full', 'bad'], pass_ok: ['Pass allowed', 'info'], pass_bad: ['Pass refused', 'bad'],
};
// Bars: one row per person or gate, longest = the top count. Number at the end of the bar.
const bars = (rows: { label: string; sub?: string; n: number; me?: boolean }[]) => {
  const max = Math.max(1, ...rows.map(r => r.n));
  return `<ul class="gc-rank">${rows.map((r, i) => `<li class="${r.me ? 'me' : ''}"><span class="gc-rank-no">${i + 1}</span><div class="gc-rank-main"><div class="gc-rank-h"><b>${esc(r.label)}${r.me ? ' <em>You</em>' : ''}</b><strong>${r.n}</strong></div>
    <div class="gc-rank-t" role="img" aria-label="${esc(r.label)}: ${r.n}"><i style="width:${Math.max(r.n ? 3 : 0, Math.round((r.n / max) * 100))}%"></i></div>${r.sub ? `<small>${esc(r.sub)}</small>` : ''}</div></li>`).join('')}</ul>`;
};
// Check-ins through the day: one column per 15 minutes, an hour label under every 4th.
function timeChart(points: { at: string; n: number }[]) {
  if (!points.length) return '<p class="gc-empty">No check-ins yet.</p>';
  const W = 640, H = 170, pad = 22, max = Math.max(1, ...points.map(p => p.n)), bw = (W - 8) / points.length;
  const cols = points.map((p, i) => {
    const h = Math.round((p.n / max) * (H - pad - 18)), x = 4 + i * bw;
    return `<rect x="${x + 1}" y="${H - pad - h}" width="${Math.max(2, bw - 2)}" height="${h}" rx="2"><title>${hm(p.at)}: ${p.n}</title></rect>${p.n === max ? `<text x="${x + bw / 2}" y="${H - pad - h - 5}" text-anchor="middle" class="v">${p.n}</text>` : ''}`
      + (new Date(p.at).getUTCMinutes() === 0 || i === 0 ? `<text x="${x + 1}" y="${H - 6}" class="t">${hm(p.at)}</text>` : '');
  }).join('');
  const peak = points.reduce((a, b) => (b.n > a.n ? b : a));
  return `<svg class="gc-time" viewBox="0 0 ${W} ${H}" role="img" aria-label="Check-ins every 15 minutes; busiest ${hm(peak.at)} with ${peak.n}"><line x1="0" y1="${H - pad}" x2="${W}" y2="${H - pad}" />${cols}</svg>
    <p class="gc-hint">Busiest 15 minutes: <b>${hm(peak.at)}</b> with <b>${peak.n}</b> fans.</p>`;
}
// Watch list: bursts of fake tickets at a gate, double entries, tickets tried more than once.
function watchHtml(w: any) {
  if (!w || (!w.bursts.length && !w.doubles.length && !w.repeats.length && !(w.banned || []).length)) return '';
  const li = (k: string, title: string, sub: string, at?: string) => `<li><span class="gc-dot ${k}"></span><div class="gc-li-main"><b>${title}</b><small>${sub}</small></div>${at ? `<span class="gc-li-time">${hm(at)}</span>` : ''}</li>`;
  return `<div class="gc-panel gc-watch"><p class="gc-caps" style="margin:0 0 4px;color:#ffb3b5">Watch list</p><ul class="gc-list">
    ${w.bursts.map((b: any) => li('bad', `${b.n} fake tickets at ${esc(b.gate)} in the last 30 minutes`, 'Look out for a tout selling fake tickets nearby; tell the police or security.')).join('')}
    ${w.doubles.map((x: any) => li('bad', `Double entry: <span class="gc-mono">${esc(x.ticket)}</span>`, `Let in offline at ${esc(x.gate || '')} by ${esc(x.by || '')}, but it had already been checked in.`, x.at)).join('')}
    ${(w.banned || []).map((x: any) => li('bad', `BANNED fan refused: <span class="gc-mono">${esc(x.ticket)}</span>`, `${esc(x.gate || '')} · ${esc(x.by || '')}${x.reason ? ` · ${esc(x.reason)}` : ''}`, x.at)).join('')}
    ${w.repeats.map((x: any) => li(x.fake ? 'bad' : 'warn', `<span class="gc-mono">${esc(x.ticket)}</span> tried ${x.tries} times`, `${x.fake ? 'Fake number' : 'Already used'} · ${esc(x.gates)}`, x.last)).join('')}
  </ul></div>`;
}
async function loadToday() {
  try {
    const d = await api('today', { quiet: true });
    $('todayAt').textContent = `Updated ${hm(new Date().toISOString())}`;
    if (S.perms.supervise) $('supMsgs').innerHTML = (d.messages || []).map((m: any) => `<li><span class="gc-dot ${m.live ? 'warn' : ''}"></span><div class="gc-li-main"><b>${esc(m.text)}</b><small>${esc(m.from || '')} · ${m.gate ? esc(m.gate) : 'all gates'}${m.live ? ' · showing now' : ' · ended'}</small>${m.live ? `<div class="gc-row-btns"><button type="button" class="gc-btn ghost" data-clear="${m.id}">Take down</button></div>` : ''}</div><span class="gc-li-time">${hm(m.at)}</span></li>`).join('');
    const stands = d.stands.length ? d.stands.map((s: any) => `<div class="gc-bar"><div class="gc-bar-h"><span>${esc(s.label)}</span><span>${s.in} in / ${s.sold} sold</span></div>
      <div class="gc-bar-t"><i style="width:${s.sold ? Math.min(100, Math.round((s.in / s.sold) * 100)) : 0}%"></i></div></div>`).join('') : '';
    $('todayBody').innerHTML = `
      <div class="gc-match">${d.match ? `<p class="gc-caps" style="color:#ffd9da">Today's home match</p><h3>${esc(d.match.name)}</h3><p style="margin:6px 0 0">${esc(dayTime(d.match.date))} · ${esc(d.match.venue || '')}</p>` : '<p class="gc-caps" style="color:#ffd9da">No Lobi Stars home match today</p><h3>Practice and look-ups only</h3>'}</div>
      ${watchHtml(d.watch)}
      <div class="gc-together"><span class="gc-caps">Together today</span><b>${d.totals.admitted.toLocaleString('en-GB')}</b><span>fans checked in at all gates${d.totals.readmitted ? ` · ${d.totals.readmitted} re-admitted` : ''}</span></div>
      <div class="gc-panel"><p class="gc-caps" style="margin:0 0 8px">Fans checked in by each steward</p>${d.byStaff.length ? bars(d.byStaff.map((s: any) => ({ label: s.name, me: s.me, n: s.admitted,
        sub: [s.code, s.gate, s.refused ? `${s.refused} refused` : '', s.readmitted ? `${s.readmitted} re-admitted` : '', s.last ? `last ${hm(s.last)}` : ''].filter(Boolean).join(' · ') }))) : '<p class="gc-empty">No check-ins yet.</p>'}</div>
      <div class="gc-panel"><p class="gc-caps" style="margin:0 0 8px">Fans checked in at each gate</p>${d.byGate.length ? bars(d.byGate.map((g: any) => ({ label: g.gate, n: g.n, me: g.gate === S.user.gate }))) : '<p class="gc-empty">No check-ins yet.</p>'}</div>
      <div class="gc-panel"><p class="gc-caps" style="margin:0 0 8px">Check-ins through the day</p>${timeChart(d.timeline)}</div>
      <div class="gc-stats">
        <div class="gc-stat g"><b>${d.totals.admitted}</b><span class="gc-caps">Checked in</span></div>
        <div class="gc-stat r"><b>${d.totals.refused}</b><span class="gc-caps">Refused</span></div>
        <div class="gc-stat y"><b>${d.totals.fake}</b><span class="gc-caps">Fake tickets</span></div>
      </div>
      ${stands ? `<div class="gc-panel"><p class="gc-caps" style="margin:0">By stand</p>${stands}</div>` : ''}
      ${(d.capacity || []).some((c: any) => c.capacity) ? `<div class="gc-panel"><p class="gc-caps" style="margin:0">How full each stand is</p>${d.capacity.filter((c: any) => c.capacity).map((c: any) => `<div class="gc-bar ${c.state}"><div class="gc-bar-h"><span>${esc(c.label)}</span><span>${c.inside.toLocaleString('en-GB')} / ${c.capacity.toLocaleString('en-GB')} · ${c.state === 'full' ? 'FULL' : `${c.pct}%`}</span></div><div class="gc-bar-t"><i style="width:${Math.min(100, c.pct)}%"></i></div></div>`).join('')}</div>` : ''}
      ${S.perms.supervise && (d.queue || []).length ? `<div class="gc-panel"><p class="gc-caps" style="margin:0 0 4px">Queue speed (last few minutes)</p><ul class="gc-list">${d.queue.map((q: any) => `<li><span class="gc-dot ${q.state === 'slow' ? 'bad' : q.state === 'ok' ? 'ok' : ''}"></span><div class="gc-li-main"><b>${esc(q.gate)}</b><small>${q.perMinute} fans a minute${q.avgSeconds ? ` · ${q.avgSeconds} s per fan` : ''} · ${q.scanners} scanner${q.scanners === 1 ? '' : 's'}${q.state === 'slow' ? ' · SLOW: send help' : ''}</small></div></li>`).join('')}</ul></div>` : ''}
      <div class="gc-panel"><p class="gc-caps" style="margin:0 0 4px">On duty now</p>${d.onDuty.length ? `<ul class="gc-list">${d.onDuty.map((p: any) => `<li><span class="gc-dot info"></span><div class="gc-li-main"><b>${esc(p.name)}</b><small>${esc(p.role)} · ${esc(p.code)}</small></div><span class="gc-li-time">${esc(p.gate)}</span></li>`).join('')}</ul>` : '<p class="gc-empty">Nobody signed in.</p>'}</div>
      <div class="gc-panel"><p class="gc-caps" style="margin:0 0 4px">Latest scans (all gates)</p>${d.latest.length ? `<ul class="gc-list">${d.latest.map((s: any) => {
        const [label, k] = RESULT_LABEL[s.result] || [s.result, 'info'];
        return `<li><span class="gc-dot ${k}"></span><div class="gc-li-main"><b>${esc(label)}</b>${s.ticket ? ` <span class="gc-mono">${esc(s.ticket)}</span>` : ''}<small>${esc([s.stand, s.gate, s.by, s.how === 'typed' ? 'typed' : s.how === 'scanner' ? 'scanner' : ''].filter(Boolean).join(' · '))}${s.note ? ` · ${esc(s.note)}` : ''}</small></div><span class="gc-li-time">${hm(s.at)}</span></li>`;
      }).join('')}</ul>` : '<p class="gc-empty">No scans yet today.</p>'}</div>`;
  } catch (e: any) { if (e.status !== 401) $('todayAt').textContent = 'Could not refresh'; }
}
function startToday() { stopToday(); loadToday(); todayTimer = setInterval(() => { if (!document.hidden) loadToday(); }, 10000); }
function stopToday() { clearInterval(todayTimer); }

// ── Activity ──
let actPage = 1;
async function loadActivity(page: number) {
  actPage = page;
  const day = $('actDay').value || '', staff = $('actStaff').value || '';
  try {
    const d = await api(`activity?page=${page}&day=${encodeURIComponent(day)}&staff=${encodeURIComponent(staff)}`);
    $('actStaffWrap').hidden = !d.all;
    $('actCsv').hidden = !d.all;
    $('actCsv').href = `/api/gate-control/activity?format=csv&day=${encodeURIComponent(day)}&staff=${encodeURIComponent(staff)}`;
    if (d.all && $('actStaff').options.length <= 1) for (const s of d.staff) $('actStaff').add(new Option(s.name, s.id));
    $('actList').innerHTML = d.rows.length ? d.rows.map((a: any) => `<li><span class="gc-dot ${/Refused|FAKE|fake/.test(a.action) ? 'bad' : /Checked in|Re-admitted/.test(a.action) ? 'ok' : 'info'}"></span>
      <div class="gc-li-main"><b>${esc(a.action)}</b><small>${esc([a.who, a.code, a.gate].filter(Boolean).join(' · '))}${a.details ? ` · ${esc(a.details)}` : ''}</small></div><span class="gc-li-time">${esc(dayTime(a.at))}</span></li>`).join('')
      : '<li class="gc-empty">Nothing recorded for this choice.</li>';
    $('actPage').textContent = `Page ${d.page} of ${d.pages}`;
    $('actPrev').disabled = d.page <= 1; $('actNext').disabled = d.page >= d.pages;
  } catch (e: any) { if (e.status !== 401) $('actList').innerHTML = `<li class="gc-empty">${esc(e.message)}</li>`; }
}
$('actDay').value = todayLagos();
$('actDay').addEventListener('change', () => loadActivity(1));
$('actStaff').addEventListener('change', () => loadActivity(1));
$('actPrev').addEventListener('click', () => loadActivity(actPage - 1));
$('actNext').addEventListener('click', () => loadActivity(actPage + 1));

// ── Staff and gates (Super Admins) ──
let staff: any[] = [], editing: any = null;
async function loadStaff() {
  try {
    const d = await api('staff');
    staff = d.staff;
    $('gatesText').value = d.gates.join('\n');
    $('standsGrid').innerHTML = d.gates.map((g: string) => `<fieldset><legend>${esc(g)}</legend>${['VIP', 'Premium', 'Regular'].map(t => `<label><input type="checkbox" data-g="${esc(g)}" data-t="${t}"${(d.stands?.[g] || []).includes(t) ? ' checked' : ''} /> ${STAND[t]}</label>`).join('')}</fieldset>`).join('');
    $('staffList').innerHTML = staff.length ? staff.map(s => `<div class="gc-person"><div class="gc-li-main"><b>${esc(s.name)}</b>
      <small><span class="gc-mono">${esc(s.staffId)}</span> · <span class="gc-tag${s.role === 'supervisor' ? ' sup' : ''}">${esc(s.roleLabel)}</span>${s.active ? '' : ' <span class="gc-tag off">Switched off</span>'}${s.locked ? ' <span class="gc-tag off">Locked</span>' : ''}
      · last sign-in ${s.lastLogin ? esc(dayTime(s.lastLogin)) : 'never'}</small></div><button type="button" class="gc-btn ghost" data-edit="${esc(s.id)}">Edit</button></div>`).join('')
      : '<p class="gc-empty">No stewards yet. Add the first one.</p>';
  } catch (e: any) { if (e.status !== 401) $('staffList').innerHTML = `<p class="gc-err">${esc(e.message)}</p>`; }
}
function openStaff(s: any) {
  editing = s;
  $('staffDlgT').textContent = s ? `Edit ${s.name}` : 'Add a steward';
  $('sfId').value = s ? s.staffId : ''; $('sfId').disabled = !!s;
  $('sfName').value = s ? s.name : ''; $('sfRole').value = s ? s.role : 'steward';
  $('sfPw').value = ''; $('sfPwL').textContent = s ? 'New password (leave empty to keep the current one)' : 'Password (at least 8 characters)';
  $('sfActiveWrap').hidden = !s; $('sfActive').checked = s ? s.active : true;
  $('staffErr').hidden = true;
  $('staffDlg').showModal();
}
$('addStaff').addEventListener('click', () => openStaff(null));
$('staffList').addEventListener('click', (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-edit]') as HTMLElement | null;
  if (b) openStaff(staff.find(s => s.id === b.dataset.edit));
});
$('sfCancel').addEventListener('click', () => $('staffDlg').close());
$('staffForm').addEventListener('submit', async (ev: Event) => {
  ev.preventDefault();
  const body: any = editing
    ? { action: 'edit', id: editing.id, name: $('sfName').value, role: $('sfRole').value, active: $('sfActive').checked, password: $('sfPw').value }
    : { action: 'add', staffId: $('sfId').value, name: $('sfName').value, role: $('sfRole').value, password: $('sfPw').value };
  try {
    await api('staff', { method: 'POST', body });
    $('staffDlg').close();
    toast(editing ? 'Saved.' : 'Steward added. Give them their Staff ID and password.');
    loadStaff();
  } catch (e: any) { $('staffErr').textContent = e.message; $('staffErr').hidden = false; }
});
$('gatesSave').addEventListener('click', async () => {
  $('gatesOk').hidden = true; $('gatesErr').hidden = true;
  try {
    const r = await api('staff', { method: 'POST', body: { action: 'gates', gates: $('gatesText').value.split('\n') } });
    S.gates = r.gates; $('gatesText').value = r.gates.join('\n'); $('gatesOk').hidden = false;
  } catch (e: any) { $('gatesErr').textContent = e.message; $('gatesErr').hidden = false; }
});

$('standsSave').addEventListener('click', async () => {
  $('standsOk').hidden = true; $('standsErr').hidden = true;
  const map: Record<string, string[]> = {};
  for (const c of document.querySelectorAll<HTMLInputElement>('#standsGrid input')) { (map[c.dataset.g!] ||= []); if (c.checked) map[c.dataset.g!].push(c.dataset.t!); }
  try { await api('staff', { method: 'POST', body: { action: 'stands', stands: map } }); $('standsOk').hidden = false; refreshPack(); }
  catch (e: any) { $('standsErr').textContent = e.message; $('standsErr').hidden = false; }
});

// ── Supervisor messages (Today) ──
$('msgForm').addEventListener('submit', async (ev: Event) => {
  ev.preventDefault();
  $('msgErr').hidden = true;
  try {
    await api('message', { method: 'POST', body: { action: 'send', text: $('msgText').value, gate: $('msgGate').value, hours: Number($('msgHours').value) } });
    $('msgText').value = ''; toast('Message sent'); loadToday(); loadCounts();
  } catch (e: any) { $('msgErr').textContent = e.message; $('msgErr').hidden = false; }
});
$('supMsgs').addEventListener('click', async (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-clear]') as HTMLElement | null;
  if (!b) return;
  try { await api('message', { method: 'POST', body: { action: 'clear', id: Number(b.dataset.clear) } }); loadToday(); } catch (e: any) { toast(e.message); }
});

// ── Incidents ──
async function loadIncidents() {
  try {
    const d = await api('incidents');
    $('incListT').textContent = d.canClose ? "Today's reports (all gates)" : 'Your reports today';
    const open = d.incidents.filter((i: any) => i.open).length;
    $('incCount').textContent = open ? `${open} open` : '';
    $('incList').innerHTML = d.incidents.length ? d.incidents.map((i: any) => `<li><span class="gc-dot ${i.open ? 'bad' : 'ok'}"></span><div class="gc-li-main"><b>${esc(i.label)}</b>${i.open ? ' <span class="gc-inc-open">· open</span>' : ' · closed'}
      <small>${esc(i.details)}</small><small>${esc([i.gate, i.by, i.ticket].filter(Boolean).join(' · '))}${i.closedBy ? ` · closed by ${esc(i.closedBy)}${i.closeNote ? `: ${esc(i.closeNote)}` : ''}` : ''}</small>
      ${d.canClose && i.open ? `<div class="gc-row-btns"><button type="button" class="gc-btn ghost" data-close="${i.id}">Close</button></div>` : ''}</div><span class="gc-li-time">${hm(i.at)}</span></li>`).join('')
      : '<li class="gc-empty">No incidents reported today.</li>';
  } catch (e: any) { if (e.status !== 401) $('incList').innerHTML = `<li class="gc-empty">${esc(e.message)}</li>`; }
}
$('incForm').addEventListener('submit', async (ev: Event) => {
  ev.preventDefault();
  $('incErr').hidden = true;
  try {
    await api('incident', { method: 'POST', body: { action: 'add', category: $('incCat').value, details: $('incText').value, ticket: $('incTicket').value } });
    $('incText').value = ''; $('incTicket').value = '';
    toast('Incident reported'); loadIncidents(); loadCounts();
  } catch (e: any) { $('incErr').textContent = e.message; $('incErr').hidden = false; }
});
$('incList').addEventListener('click', async (ev: Event) => {
  const b = (ev.target as HTMLElement).closest('[data-close]') as HTMLElement | null;
  if (!b) return;
  const note = prompt('How was it resolved? (optional)') ?? null;
  if (note === null) return;
  try { await api('incident', { method: 'POST', body: { action: 'close', id: Number(b.dataset.close), note } }); loadIncidents(); loadCounts(); } catch (e: any) { toast(e.message); }
});

// The Gate Control app: works from the home screen and opens without a signal.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/gate-control/sw.js', { scope: '/gate-control/' }).catch(() => {});

boot();

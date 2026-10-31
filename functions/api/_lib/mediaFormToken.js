// Public Media forms (accreditation, interview requests): a signed form token.
// The page gets one when it loads (GET) and sends it back with the form; the
// server checks the signature (SESSION_SECRET), that it is less than 4 hours
// old, and that the form was not sent within 3 seconds of loading (bots).
const enc = new TextEncoder();
async function sign(env, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(env.SESSION_SECRET || 'lobi-media-forms')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
  return [...mac.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function formToken(env, form) {
  const ts = Date.now().toString(36), rnd = [...crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ts}.${rnd}.${await sign(env, `${form}.${ts}.${rnd}`)}`;
}
/** null when fine, otherwise the reason. */
export async function formTokenProblem(env, form, token, { minMs = 3000, maxMs = 4 * 3600e3 } = {}) {
  const [ts, rnd, mac] = String(token || '').split('.');
  if (!ts || !rnd || !mac) return 'The form is out of date. Please reload the page and try again.';
  if (mac !== await sign(env, `${form}.${ts}.${rnd}`)) return 'The form is out of date. Please reload the page and try again.';
  const age = Date.now() - parseInt(ts, 36);
  if (!(age >= 0) || age > maxMs) return 'The form has expired. Please reload the page and try again.';
  if (age < minMs) return 'That was very quick. Please check the form and send it again.';
  return null;
}

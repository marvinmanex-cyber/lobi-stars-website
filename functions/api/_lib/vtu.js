// Airtime and data top-ups (Lobi Stars Rewards) through a Nigerian VTU
// provider. One adapter so the provider can change without touching the
// Rewards code. Keys live in environment variables only:
//   VTU_PROVIDER=vtpass, VTPASS_API_KEY, VTPASS_SECRET_KEY, VTPASS_BASE_URL
//   (sandbox https://sandbox.vtpass.com/api; live https://vtpass.com/api).
// TODO (club): choose the provider, get sandbox keys, and confirm the service
// IDs and data bundle codes below against the provider's documentation.
// VTU_FAKE=1|fail (LOCAL TESTS ONLY, never in production) simulates it (numbers ending 0000 fail).
// Not configured -> { configured: false }: the request goes to the manual queue.

export const NETWORKS = { mtn: 'MTN', airtel: 'Airtel', glo: 'Glo', '9mobile': '9mobile' };
// VTpass service IDs (airtime / data). 9mobile is "etisalat" at VTpass.
const AIRTIME_SERVICE = { mtn: 'mtn', airtel: 'airtel', glo: 'glo', '9mobile': 'etisalat' };
const DATA_SERVICE = { mtn: 'mtn-data', airtel: 'airtel-data', glo: 'glo-data', '9mobile': 'etisalat-data' };

export function vtuConfigured(env) {
  if (env.VTU_FAKE) return true;
  return env.VTU_PROVIDER === 'vtpass' && !!env.VTPASS_API_KEY && !!env.VTPASS_SECRET_KEY;
}

/**
 * Sends airtime or data. kind 'airtime' | 'data'; amountKobo; dataCode = the
 * provider's bundle code for that network (from the catalogue item).
 * Returns { configured, ok, providerRef, error }. Never throws.
 */
export async function vtuSend(env, { kind, network, phone, amountKobo, dataCode, requestId }) {
  if (!vtuConfigured(env)) return { configured: false, ok: false };
  // Fake mode (tests): 'fail' always fails; otherwise numbers ending in 0000 fail and the rest succeed.
  if (env.VTU_FAKE) return env.VTU_FAKE !== 'fail' && !/0000$/.test(String(phone)) ? { configured: true, ok: true, providerRef: `FAKE-${requestId}` } : { configured: true, ok: false, error: 'simulated failure' };
  try {
    const local = String(phone).replace(/^\+234/, '0');
    const body = { request_id: requestId, serviceID: (kind === 'data' ? DATA_SERVICE : AIRTIME_SERVICE)[network], amount: Math.round(amountKobo / 100), phone: local };
    if (kind === 'data') { body.billersCode = local; body.variation_code = dataCode; }
    const r = await fetch(`${env.VTPASS_BASE_URL || 'https://sandbox.vtpass.com/api'}/pay`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': env.VTPASS_API_KEY, 'secret-key': env.VTPASS_SECRET_KEY }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    const status = d?.content?.transactions?.status;
    if (d.code === '000' && (status === 'delivered' || status === 'pending' || status === 'initiated')) return { configured: true, ok: true, providerRef: d?.content?.transactions?.transactionId || requestId };
    return { configured: true, ok: false, error: String(d.response_description || d.code || `HTTP ${r.status}`).slice(0, 200) };
  } catch (err) {
    return { configured: true, ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

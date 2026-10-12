import { getFan } from '../_lib/fanCode.js';

// GET /api/fan/me -> { signedIn, firstName, email, needsProfile }. Never errors.
export async function onRequestGet({ request, env }) {
  const fan = await getFan(request, env);
  const body = fan
    ? { signedIn: true, firstName: fan.first_name || '', email: fan.email, needsProfile: !String(fan.first_name || '').trim() }
    : { signedIn: false };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}

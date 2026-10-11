import { getAdmin } from '../_lib/adminSession.js';
import { allowedPath } from '../_lib/adminRoles.js';

// Role check for every admin API (the endpoints themselves check the login).
// A signed-in staff member calling an API outside their role gets 403.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  const admin = await getAdmin(request, env);
  if (admin && !allowedPath(admin, url.pathname, request.method)) {
    return Response.json({ error: 'Your role does not have access to this.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return next();
}

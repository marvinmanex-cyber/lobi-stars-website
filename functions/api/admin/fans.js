import { requireAdminUser } from '../_lib/adminEvents.js';
import { getSources } from '../_lib/contacts.js';
import { queryContacts, maskEmail, maskPhone } from '../_lib/fanQuery.js';

// GET /api/admin/fans?q=&source=&consent=Y|N&state=&from=&to=&sort=&dir=&page=
// One page (25) of the fan database. Staff without the export permission
// see emails and phone numbers partly hidden.
export async function onRequestGet({ request, env }) {
  const { admin, denied } = await requireAdminUser(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  const page = Number.parseInt(url.searchParams.get('page') || '1', 10) || 1;
  const defs = await getSources(env.DB);
  const { total, pageSize, rows } = await queryContacts(env.DB, { params: url.searchParams, page, pageSize: 25 });
  const { results: states } = await env.DB.prepare(
    `SELECT state, COUNT(*) AS n FROM contacts WHERE state IS NOT NULL AND state != '' GROUP BY LOWER(state) ORDER BY n DESC LIMIT 60`
  ).all();
  return Response.json({
    total, page, pageSize, canExport: admin.canExport,
    sources: Object.fromEntries(defs.map(s => [s.key, s.label])), sourceColors: Object.fromEntries(defs.map(s => [s.key, s.color])),
    states: states.map(s => s.state),
    rows: rows.map(r => ({
      id: r.id, firstName: r.first_name || '', surname: r.surname || '',
      // Lists are always masked; the full details are on the fan's own page.
      email: maskEmail(r.email),
      phone: maskPhone(r.phone),
      state: r.state || '', sources: r.sources, firstSource: r.first_source, firstSeen: r.first_seen, lastSeen: r.last_seen,
      interactions: r.interactions, emailVerified: !!r.email_verified, member: !!r.member,
      marketingConsent: !!r.marketing_consent, unsubscribed: !!r.unsubscribed_at,
      matchesPredicted: r.matches_predicted, motmVotes: r.motm_votes, prizeWins: r.prize_wins,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

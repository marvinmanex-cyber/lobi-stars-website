import { getPartners } from '../../lib/partners';

// Published partner list so the admin analytics can name partners in reports.
export async function GET() {
  const list = (await getPartners()).map(p => ({ slug: p.id, name: p.data.name, tier: p.data.tier, officialTitle: p.data.officialTitle }));
  return new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } });
}

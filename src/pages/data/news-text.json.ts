import { getSortedNews } from '../../lib/news';

// Published stories' text (plain, first 4,000 characters) with their tags, for
// the squad mention scan: player and staff names found in a story that isn't
// tagged with them become tag suggestions (Admin › Squad: Tag suggestions), and
// tagged stories feed the AI fact suggestions. Not linked anywhere; never indexed.
const plain = (s: string) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[#*_>`[\]()!|-]+/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
export async function GET() {
  const items = (await getSortedNews()).map(a => ({
    slug: a.id, title: a.data.title, summary: a.data.summary, text: plain(a.body || '').slice(0, 4000),
    players: a.data.players || [], staff: a.data.staff || [], publishedAt: a.data.publishedAt.toISOString(), mcId: a.data.mcId || null,
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' } });
}

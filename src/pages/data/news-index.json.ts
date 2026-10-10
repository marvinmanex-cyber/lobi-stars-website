import { getSortedNews } from '../../lib/news';
import { getPlayers } from '../../lib/players';

// Published news (no drafts) for the Match Centre "Squad availability" box
// and the admin matchday content checklist.
export async function GET() {
  const [news, squad] = await Promise.all([getSortedNews(), getPlayers()]);
  const name = (slug?: string | null) => squad.find(p => p.id === slug)?.data.name;
  const watDate = (d?: Date | null) => (d ? new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10) : null);
  const items = news.map(a => ({
    slug: a.id,
    title: a.data.title,
    category: a.data.category,
    contentType: a.data.contentType || (a.data.category === 'Team News' ? 'Team News' : null),
    // CMS dates are plain dates, so the stored value is already the match day.
    matchDate: a.data.matchDate ? a.data.matchDate.toISOString().slice(0, 10) : null,
    publishedAt: a.data.publishedAt.toISOString(),
    publishedDay: watDate(a.data.publishedAt),
    isVideo: a.data.isVideo,
    membersOnly: a.data.membersOnly,
    teamNews: (a.data.teamNews || []).map(r => ({
      name: r.name || name(r.player) || '', player: r.player && name(r.player) ? r.player : null,
      status: r.status, reason: r.reason || '', expectedReturn: r.expectedReturn || '',
    })).filter(r => r.name),
  }));
  return new Response(JSON.stringify(items), { headers: { 'Content-Type': 'application/json' } });
}

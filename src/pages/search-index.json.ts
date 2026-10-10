import { getPlayers } from '../lib/players';
import { getSortedNews } from '../lib/news';
import { MAIN_NAV, EXTRA_PAGES } from '../lib/nav';

// Static search index for /search: news, players and site pages.
export async function GET() {
  const news = (await getSortedNews()).map(a => ({
    type: 'News',
    title: a.data.title,
    text: `${a.data.summary} ${a.data.category}`,
    url: `/news/${a.id}/`,
    date: a.data.publishedAt.toISOString().slice(0, 10),
  }));
  const players = (await getPlayers()).map(p => ({
    type: 'Player',
    title: p.data.name,
    text: `${p.data.position} #${p.data.number} ${p.data.nationality}`,
    url: `/squad/${p.id}/`,
  }));
  const pages = [...MAIN_NAV.flatMap(i => [i, ...(i.children ?? [])]), ...EXTRA_PAGES]
    .filter((p, i, all) => all.findIndex(q => q.href === p.href && q.label === p.label) === i)
    .map(p => ({ type: 'Page', title: p.label, text: p.description ?? '', url: p.href }));

  return new Response(JSON.stringify([...pages, ...players, ...news]), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// Club pages that are only shown once the club has confirmed their content:
// trophy cabinet counters, values, community and transparency. Anything not
// confirmed ("verified" / "published" off in the CMS) stays hidden.
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import honours from '../data/honours.json';
import values from '../data/values.json';
import community from '../data/community.json';
import transparency from '../data/transparency.json';
import { getSortedNews, type Article } from './news';

export type Honour = { competition: string; type?: string; years: string[]; verified: boolean };
export type Counter = { key: string; icon: string; value: string; label: string; years: string[] };

/** Honours the club has confirmed, with at least one year. */
export const verifiedHonours: Honour[] = (honours.honours as Honour[]).filter(h => h.verified && h.years?.length);

/**
 * "Club at a Glance" counters: league titles, cups, CAF appearances, year
 * founded. A counter only appears when its data is confirmed.
 */
export function glanceCounters(): Counter[] {
  const out: Counter[] = [];
  const years = (type: string) => verifiedHonours.filter(h => (h.type || 'other') === type).flatMap(h => h.years);
  const league = years('league');
  if (league.length) out.push({ key: 'league', icon: '🏆', value: String(league.length), label: league.length === 1 ? 'League title' : 'League titles', years: league });
  const cups = years('cup');
  if (cups.length) out.push({ key: 'cup', icon: '🥇', value: String(cups.length), label: cups.length === 1 ? 'Cup win' : 'Cup wins', years: cups });
  const caf = honours.caf;
  if (caf?.verified && caf.years?.length) out.push({ key: 'caf', icon: '🌍', value: String(caf.years.length), label: caf.label || 'CAF appearances', years: caf.years });
  if (honours.founded?.verified && /^\d{4}$/.test(String(honours.founded.year))) out.push({ key: 'founded', icon: '⭐', value: String(honours.founded.year), label: 'Founded', years: [] });
  return out;
}

// ── Values ──
export type ClubValue = { title: string; text: string };
export const clubValues = {
  ready: !!values.published && !!(values.mission?.trim() || values.values?.length),
  mission: values.mission || '',
  values: (values.values || []).filter((v: ClubValue) => v.title?.trim()) as ClubValue[],
};

// ── Community ──
export type Project = { title: string; text?: string; image?: string; date?: string };
/** Published Club news tagged "Community", newest first. */
export async function communityNews(): Promise<Article[]> {
  return (await getSortedNews()).filter(a => a.data.category === 'Club' && (a.data.tags || []).some(t => t.trim().toLowerCase() === 'community'));
}
export async function communityContent() {
  const published = !!community.published;
  const projects = published ? ((community.projects || []) as Project[]).filter(p => p.title?.trim()) : [];
  const intro = published ? community.intro || '' : '';
  const news = await communityNews();
  return { intro, projects, news, ready: !!(intro.trim() || projects.length || news.length) };
}

// ── Transparency ──
export type ClubDocument = { title: string; type: string; date?: string; file: string; summary?: string; size?: string };
const fileSize = (url: string) => {
  const p = path.join(process.cwd(), 'public', ...decodeURI(url).replace(/^\//, '').split('/'));
  if (!url.startsWith('/') || !existsSync(p)) return '';
  const b = statSync(p).size;
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
};
/** Annual reports and official statements, newest first. */
export const clubDocuments: ClubDocument[] = ((transparency.documents || []) as ClubDocument[])
  .filter(d => d.title?.trim() && d.file?.trim())
  .map(d => ({ ...d, type: d.type || 'Official statement', size: fileSize(d.file) }))
  .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
export const transparencyIntro: string = transparency.intro || '';

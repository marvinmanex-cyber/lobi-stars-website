// /i18n/<code>.json -- one complete translation (English text -> translation).
import { PUBLISHED, dictionary } from '../../lib/i18n';

export function getStaticPaths() {
  return PUBLISHED.map(f => ({ params: { lang: f._meta.code } }));
}
export function GET({ params }: { params: { lang: string } }) {
  return new Response(JSON.stringify(dictionary(params.lang)), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

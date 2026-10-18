// /admin/health-content.json -- built with the site; read by Website Health
// (server side, through the site's own files) to find shop products without a
// price or buy link and partners without a logo. The admin login protects /admin.
import { getCollection } from 'astro:content';
import shop from '../../data/shop.json';

export async function GET() {
  const products = ((shop as any).products || []).map((p: any) => ({
    id: p.id, name: p.name,
    noPrice: !(Number(p.price) > 0),
    noBuyLink: !p.jumiaUrl && !p.personalisable,
    inStock: p.inStock !== false,
  }));
  const partners = (await getCollection('partners')).filter(p => p.data.active !== false).map(p => ({
    slug: p.id, name: p.data.name, noLogo: !p.data.logo,
  }));
  return new Response(JSON.stringify({ builtAt: new Date().toISOString(), products, partners }), { headers: { 'Content-Type': 'application/json' } });
}

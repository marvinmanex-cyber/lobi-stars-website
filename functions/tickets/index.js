import { renderPage } from '../api/_lib/ssr.js';
import { onSaleEvents } from '../api/_lib/onSale.js';

// "/tickets" -- the matches on sale are embedded so the page doesn't show "Loading…".
export async function onRequestGet({ request, env }) {
  let events = [];
  try { events = await onSaleEvents(env.DB); } catch {}
  return renderPage(request, env, '/tickets/', [], { 'ssr-events': { events } });
}

// The admin bell for score verification (Website & Data Officer, Super Admins):
// score messages and reports waiting for a person.
import { reviewCount } from './extract.js';

export async function scoreBellItems(env) {
  const items = [];
  const r = await reviewCount(env);
  if (r.total) items.push({ icon: '📨', title: `${r.total} score report${r.total === 1 ? '' : 's'} need${r.total === 1 ? 's' : ''} checking`, sub: 'Messages the website could not accept by itself', href: '/admin/scores/messages/' });
  return items;
}

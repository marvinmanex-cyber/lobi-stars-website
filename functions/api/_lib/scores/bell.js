// The admin bell for score verification (Website & Data Officer, Super Admins):
// score messages and reports waiting for a person, conflicts, missing results.
import { reviewCount } from './extract.js';
import { consensusCounts } from './consensus.js';

export async function scoreBellItems(env) {
  const items = [];
  const c = await consensusCounts(env);
  if (c.conflicts) items.push({ icon: '🔴', title: `${c.conflicts} score conflict${c.conflicts === 1 ? '' : 's'}`, sub: 'Sources disagree: accept one score or enter the correct one', href: '/admin/scores/?conflicts=1' });
  if (c.missing) items.push({ icon: '⏱️', title: `${c.missing} match${c.missing === 1 ? '' : 'es'} without a confirmed result`, sub: 'Kick-off was long ago and there is no confirmed full-time score', href: '/admin/scores/' });
  const r = await reviewCount(env);
  if (r.total) items.push({ icon: '📨', title: `${r.total} score report${r.total === 1 ? '' : 's'} need${r.total === 1 ? 's' : ''} checking`, sub: 'Messages the website could not accept by itself', href: '/admin/scores/messages/' });
  return items;
}

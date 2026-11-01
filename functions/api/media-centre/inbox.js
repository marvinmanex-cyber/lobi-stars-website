import { json, mcLog, mediaActor } from '../_lib/mediaCentre.js';
import { unreadCount, listThreads, getThread, reply, compose, MEDIA_EMAIL } from '../_lib/mediaInbox.js';

// Media Centre › Media Inbox (media@lobistarsfc.com).
// GET ?count=1  -- unread emails (every Media Centre user: the notification).
// GET           -- the conversations;   GET ?id=  -- one conversation (marked read).   (media desk code)
// POST { action: 'reply', id, text } | { action: 'compose', to, name?, subject, text }   (media desk code)
export async function onRequestGet({ request, env, data }) {
  const q = new URL(request.url).searchParams;
  if (q.get('count')) return json({ unread: await unreadCount(env.DB), unlocked: !!data.mc.user.desk });
  if (!data.mc.user.desk) return json({ error: 'Enter the media desk code to read the media emails.', locked: true, unread: await unreadCount(env.DB) }, 403);
  if (q.get('id')) {
    const t = await getThread(env.DB, q.get('id'));
    if (!t) return json({ error: 'That email conversation no longer exists.' }, 404);
    await mcLog(env.DB, mediaActor(data.mc.user), 'inbox_read', { section: 'inbox', itemType: 'email', itemId: t.id, itemTitle: `${t.ref}: ${t.subject}` });
    return json({ thread: t, mailbox: MEDIA_EMAIL });
  }
  return json({ threads: await listThreads(env.DB), mailbox: MEDIA_EMAIL });
}
export async function onRequestPost({ request, env, data }) {
  if (!data.mc.user.desk) return json({ error: 'Enter the media desk code first.', locked: true }, 403);
  const b = await request.json().catch(() => ({}));
  const r = b.action === 'reply' ? await reply(env, data.mc.user, b.id, b.text)
    : b.action === 'compose' ? await compose(env, data.mc.user, b)
    : { error: 'Unknown action.' };
  if (r.error) return json({ error: r.error }, r.status || 400);
  await mcLog(env.DB, mediaActor(data.mc.user), b.action === 'reply' ? 'inbox_reply' : 'inbox_compose', { section: 'inbox', itemType: 'email', itemId: r.id || b.id, itemTitle: `${r.ref} to ${r.to}`, details: r.emailed ? 'Sent from media@lobistarsfc.com' : 'Saved, not emailed (email service not set up)', request });
  return json(r);
}

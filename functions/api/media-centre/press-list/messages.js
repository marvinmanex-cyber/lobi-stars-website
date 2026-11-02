import { listMessages, messageDetail } from '../../_lib/pressList.js';
import { json } from '../../_lib/mediaCentre.js';

// Media Centre › Press List › Sent messages. GET -- past sends; GET ?id= -- one send with its recipients.
export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ messages: await listMessages(env.DB) });
  const m = await messageDetail(env, id);
  return m ? json({ message: m }) : json({ error: 'Not found.' }, 404);
}

import { libraryImages } from '../_lib/mediaLibrary.js';
import { json } from '../_lib/mediaCentre.js';

// GET /api/media-centre/library?q= -- uploaded pictures for "From library" (news, newsletters, albums).
export async function onRequestGet({ request, env }) {
  return json({ images: await libraryImages(env.DB, { q: new URL(request.url).searchParams.get('q') || '' }) });
}

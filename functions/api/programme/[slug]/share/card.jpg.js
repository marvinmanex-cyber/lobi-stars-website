import { serveShareCard } from '../../../_lib/shareCard.js';

// GET /api/programme/:slug/share/card.jpg -- same image as /m/<slug>/card.jpg
// (which is the one used in link previews, because robots.txt blocks /api/).
export const onRequestGet = ({ env, params }) => serveShareCard(env, params.slug);

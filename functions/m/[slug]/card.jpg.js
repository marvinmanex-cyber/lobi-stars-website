import { serveShareCard } from '../../api/_lib/shareCard.js';

// GET /m/<slug>/card.jpg?v=<n> -- the 1200x630 link-card image (public). It is
// outside /api/ on purpose: robots.txt keeps crawlers out of /api/, and X's
// crawler respects that, so the card must live here for previews to show.
export const onRequestGet = ({ env, params }) => serveShareCard(env, params.slug);

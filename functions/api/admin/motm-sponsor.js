// Man of the Match Sponsor (Super Admins only): the settings record "motm_sponsor".
// Same as /api/admin/game-sponsor?game=motm (one sponsor system for the Matchday Live games).
import { sponsorGet, sponsorPost } from './game-sponsor.js';

export const onRequestGet = ctx => sponsorGet(ctx, 'motm');
export const onRequestPost = ctx => sponsorPost(ctx, 'motm');

import { renderVerify } from '../../verify/[token].js';

// The earlier verification address (cards printed before 1 Nov 2026): the same page as /media/verify/<token>.
export const onRequestGet = ({ env, request, params }) => renderVerify(env, request, params.token);

// Predict & Win settings. Used by the server (which enforces them) and by
// the website pages (which display them), so change them only here.

/** Prize per Lobi Stars home game, in naira. */
export const PRIZE_AMOUNT = 10000;

/** Predictions open this many hours before the scheduled kick-off. */
export const PREDICTION_OPENS_HOURS_BEFORE = 24;

/**
 * When predictions close.
 * "kickoff" (recommended): closes at the scheduled kick-off, or earlier if
 *   staff press Start Match early. This stops anyone predicting after seeing
 *   goals go in.
 * "fulltime": would keep predictions open during the match. It exists only
 *   for completeness and is NOT recommended, because fans could predict the
 *   score after watching most of the game.
 */
export const PREDICTION_CLOSES_AT = 'kickoff';

/** Highest score a fan can predict for either team. */
export const MAX_GOALS = 20;

/**
 * Shown to the winner (email and website). TODO (club): replace with the
 * real claim process and contact, e.g. who to call and what ID to bring.
 */
export const CLAIM_INSTRUCTIONS =
  'The club will contact you to arrange your prize. You can also reach us through the Contact page on lobistarsfc.com. ' +
  'We will never ask for your password or card PIN, and we never collect bank details through the website.';

export const formatNaira = n => `₦${Number(n).toLocaleString('en-NG')}`;

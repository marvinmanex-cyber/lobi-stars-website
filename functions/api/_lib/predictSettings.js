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

/** Season Prediction League points: exact score, and correct result without the exact score. */
export const POINTS_EXACT = 3;
export const POINTS_RESULT = 1;

/** Highest score a fan can predict for either team. */
export const MAX_GOALS = 20;

/**
 * Shown to the winner (email and website). Confirmed by the club: winners
 * are called on their registered phone number and emailed, then come to the
 * club to collect the prize.
 */
export const CLAIM_INSTRUCTIONS =
  'The club will call you on your registered phone number and email you to arrange collecting your prize from the club. ' +
  'We will never ask for your password or card PIN, and we never collect bank details through the website.';

/**
 * Confirmed by the club: if nobody predicts the exact score there is no
 * winner and the prize is not given out (it does not roll over).
 */
export const NO_WINNER_TEXT = 'Nobody predicted the exact score, so nobody has won and the prize is not given out for this match.';

export const formatNaira = n => `₦${Number(n).toLocaleString('en-NG')}`;

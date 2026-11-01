/**
 * Shared VCR presentation maths.
 *
 * These were previously duplicated in app/api/rankings/route.ts and
 * scripts/build-historical-ranking.mjs with *different* constants (confidence
 * floor 35 vs 25), so the live ranking and the historical archives did not
 * agree. One definition now, imported by every caller.
 */

/** Half-life in days for down-weighting older results. */
export const RECENCY_HALF_LIFE_DAYS = 75;

/** Weight in (0,1] for a result, decaying as it ages relative to `now`. */
export function recencyWeight(date, now) {
  const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / 86400000);
  return 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS);
}

/** Rating uncertainty: shrinks as a team accumulates matches, floored at 35. */
export function confidenceFor(matches) {
  return Math.max(35, Math.round(120 / Math.sqrt(Math.max(1, matches / 4))));
}

/**
 * The published rating: 1500 plus each result's change, decayed by age.
 *
 * This is the single source of truth for "what number does a team have". Both
 * the ranking list and the per-event graph must go through it, or the graph's
 * final point will not equal the rating shown in the table - which is exactly
 * the defect this was written to fix.
 */
export function decayedRating(history, now) {
  return 1500 + history.reduce(
    (sum, row) => sum + Number(row.rawChange ?? row.change) * recencyWeight(row.eventDate, now),
    0,
  );
}

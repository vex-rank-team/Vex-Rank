/**
 * The VEX IQ rating as the site serves it.
 *
 * The model is VIQCR 1.1 (lib/viqcr.mjs, from the partner's specification,
 * output/pdf/vex_iq_competitive_rating_full_algorithm.pdf). A season replay
 * needs every completed event's matches and skills - about 500 official
 * requests - so it is built by scripts/build-iq-ratings.mjs and published to
 * archive-assets/, the way past V5 seasons and the team directories are. The
 * Worker serves those files; nothing here replays a season inside a request.
 *
 * Never call the V5 model (lib/vcr3.mjs) for IQ: IQ matches have no opponent.
 */

export const IQ_RATING_READY = true;

/** What the API says when a season has no published IQ ratings yet. */
export const IQ_RATING_PENDING = 'pending';

/**
 * The calibration window (VIQCR "State, units and season normalization"): the
 * season's first `days` of results, widened a week at a time until there are
 * at least `teamwork` team/session teamwork observations and `skills` per
 * skills mode. A project choice the specification leaves open; those sessions
 * fit the profile and are not replayed as rated evidence.
 */
export const CALIBRATION = Object.freeze({ days: 28, teamwork: 300, skills: 100 });

import { PROGRAMS } from './programs.mjs';

/** "2026-27" for season 203, from its label "2026–27 Level Up". */
export function iqArchiveSlug(seasonId) {
  const label = PROGRAMS.VIQRC.seasons[String(seasonId)]?.label;
  const years = label && /^(\d{4})\D(\d{2})/.exec(label);
  if (!years) throw new Error(`No VEX IQ season ${seasonId}`);
  return `${years[1]}-${years[2]}`;
}
export const iqRankingsPath = seasonId => `/viqcr-${iqArchiveSlug(seasonId)}.json`;
/** The replay behind it, which the live route continues with events finished since. */
export const iqStatePath = seasonId => `/viqcr-state-${iqArchiveSlug(seasonId)}.json`;

/**
 * Histories are split by team id into this many files. One file for a whole
 * season is several MB, and parsing that inside a free-plan Worker request
 * can run past its CPU limit; a shard is a small fraction of it.
 */
export const IQ_HISTORY_SHARDS = 64;
export const iqHistoryShard = teamId => Number(teamId) % IQ_HISTORY_SHARDS;
export const iqHistoryPath = (seasonId, shard) => `/viqcr-history-${iqArchiveSlug(seasonId)}-${shard}.json`;

/**
 * Where a team's published rating history comes from. The Worker reads its
 * archive files; the browser, which builds profiles itself when it has an
 * events.vex token, asks the Worker. A source returns the team's points ([]
 * when the season is published but the team is not rated) or null when the
 * season has no published ratings.
 */
/**
 * Where the published replay comes from (the Worker reads it from its assets):
 * the parsed state file for a season, or null when none is published.
 */
let stateSource = null;
export function useIqStateSource(source) { stateSource = source; }
export async function iqState(seasonId) {
  if (!stateSource) return null;
  try { return await stateSource(Number(seasonId)); } catch { return null; }
}

/**
 * Where the live route leaves the history points it added since the weekly
 * build (the Worker keeps them in D1), so profiles can show them.
 */
let liveHistorySink = null;
export function useIqLiveHistorySink(sink) { liveHistorySink = sink; }
export async function saveIqLiveHistory(seasonId, history) {
  if (!liveHistorySink) return;
  try { await liveHistorySink(Number(seasonId), history); } catch { /* history catches up at the weekly build */ }
}

let historySource = null;
export function useIqHistorySource(source) { historySource = source; }

export async function iqRatingHistory(teamId, seasonId) {
  if (!historySource) return null;
  try { return await historySource(Number(teamId), Number(seasonId)); } catch { return null; }
}

/** Played teamwork matches from one division's raw upstream matches. */
export function teamworkMatchesForRating(eventId, divisionId, rawMatches) {
  return (rawMatches ?? []).flatMap(match => {
    const teams = (match.alliances ?? []).flatMap(alliance => (alliance.teams ?? []).map(entry => Number(entry.team?.id)).filter(Number.isFinite));
    const scores = (match.alliances ?? []).map(alliance => Number(alliance.score)).filter(Number.isFinite);
    const score = scores.length ? Math.max(...scores) : -1;
    if (!teams.length || score <= 0) return [];
    return [{ eventId: Number(eventId), divisionId: Number(divisionId), matchId: Number(match.id), round: Number(match.round), scheduled: match.scheduled ?? match.started ?? null, score, teams }];
  });
}

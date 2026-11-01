/**
 * Official events.vex records -> the normalized event/session VIQCR replays
 * (lib/viqcr.mjs, "Import and replay contract").
 *
 * The importer is where the official data's quirks are settled, so the engine
 * never has to guess:
 *
 * - A teamwork match arrives as two one-team "stations", each carrying the one
 *   shared score. Both stations must agree; anything else is ambiguous and
 *   fails the import rather than picking the maximum or summing.
 * - Rounds: 1 practice, 2 qualification, 15 teamwork finals. Verified against
 *   2026-27 Level Up results on November 1, 2026. Any other round fails the
 *   import, because guessing a stage would put evidence in the wrong budget.
 * - `scored` is false on played matches, so a match counts as played when it
 *   started or carries a score.
 * - Skills come as one row per team and mode with the best score and an
 *   attempt count: the specification's best-only case.
 */
import { iqStationTeamIds } from './viqcr.mjs';

const STAGES = { 1: 'practice', 2: 'qualification', 15: 'finals' };
const MODES = { driver: 'driving', programming: 'coding' };

export class IQImportError extends Error {}

/**
 * The single shared score of a teamwork match, or an IQImportError.
 *
 * One station at zero beside a scoring partner is a team-specific zero: a
 * qualification disqualification or no-show takes the penalized team's
 * awarded score while its partner keeps the points. The record does not say
 * which, so the match is flagged (`zeroed`) and the engine leaves it out of
 * the fit. Two different non-zero scores are ambiguous and fail the import.
 */
export function sharedStationScore(match) {
  const stations = (match.alliances ?? []).filter(alliance => (alliance.teams ?? []).length);
  const scores = stations.map(alliance => Number(alliance.score));
  if (!scores.length || scores.some(score => !Number.isFinite(score) || score < 0)) throw new IQImportError(`match ${match.id}: no valid station score.`);
  if (new Set(scores).size === 1) return { score: scores[0], zeroed: [] };
  const zero = stations.filter(alliance => Number(alliance.score) === 0);
  if (stations.length === 2 && zero.length === 1) {
    return { score: Math.max(...scores), zeroed: zero.map(alliance => String(alliance.teams[0].team?.id)) };
  }
  throw new IQImportError(`match ${match.id}: stations disagree on the shared score (${scores.join(' vs ')}).`);
}

function teamworkRows(division, rawMatches, skipped) {
  const rows = new Map();
  for (const match of rawMatches ?? []) {
    // A record listing no team in either station credits no one. It is left
    // out and noted, not treated as an ambiguity that sinks the whole event.
    if (!(match.alliances ?? []).some(alliance => (alliance.teams ?? []).length)) { skipped.push({ match: match.id, reason: 'no teams listed' }); continue; }
    const stage = STAGES[match.round];
    if (!stage) throw new IQImportError(`division ${division.id}: unrecognised round ${match.round}.`);
    let teamIds;
    try { teamIds = iqStationTeamIds(match); } catch (error) { throw new IQImportError(error.message); }
    const { score, zeroed } = sharedStationScore(match);
    const played = Boolean(match.started) || score > 0;
    const id = `${division.id}/${stage}/${match.round}-${match.instance ?? 0}-${match.matchnum ?? match.id}`;
    // A replay of the same fixture supersedes the earlier record.
    if (rows.has(id)) rows.set(`${id}#superseded-${match.id}`, { ...rows.get(id), id: `${id}#superseded-${match.id}`, status: 'superseded' });
    rows.set(id, {
      id, teamIds, stage,
      status: played ? 'scored' : 'unplayed',
      score: played ? score : 0,
      time: match.started ?? match.scheduled ?? null,
      noShowIds: [], dqIds: [], zeroedIds: zeroed, reliability: 1,
    });
  }
  return [...rows.values()];
}

function skillsRows(rawSkills) {
  const best = new Map();
  for (const row of rawSkills ?? []) {
    const mode = MODES[row.type];
    if (!mode) continue;
    const attempts = Number(row.attempts ?? 0);
    const score = Number(row.score);
    // No attempt is not a zero: nothing was played.
    if (!(attempts > 0) || !Number.isFinite(score) || score < 0) continue;
    const teamId = String(row.team?.id ?? '');
    if (!teamId) continue;
    const key = `${mode}/${teamId}`;
    const current = best.get(key);
    if (!current || score > current.score) best.set(key, { id: `skills/${key}`, teamId, mode, status: 'scored', score, detail: 'best-only', attempts, disqualified: false });
  }
  return [...best.values()];
}

/**
 * One completed event as a session. `divisions` is every division with every
 * match page already fetched; `skills` is the event's complete skills list.
 * Throws IQImportError when the teamwork records cannot be read safely; the
 * caller decides whether to keep the event's skills alone.
 */
export function normalizeIQSession({ event, seasonId, divisions, skills, identities = new Map(), teamworkError = null }) {
  let teamwork = [];
  let teamworkCoverage = true;
  let importIssue = teamworkError;
  const skipped = [];
  if (!importIssue) {
    try { teamwork = divisions.flatMap(division => teamworkRows(division, division.matches, skipped)); }
    catch (error) { if (!(error instanceof IQImportError)) throw error; importIssue = error.message; }
  }
  if (importIssue) { teamwork = []; teamworkCoverage = false; }
  const skillRows = skillsRows(skills);
  const ids = new Set([...teamwork.flatMap(row => row.teamIds), ...skillRows.map(row => row.teamId)]);
  return {
    id: String(event.id),
    sessionId: 'main',
    name: event.name,
    program: 'VIQRC',
    seasonId: String(seasonId),
    format: teamwork.length ? 'tournament' : 'skills-only',
    start: event.start,
    end: event.end,
    completed: true,
    coverage: { teamwork: teamworkCoverage, skills: true },
    teams: [...ids].map(id => ({ id, ...(identities.get(id) ?? {}) })),
    teamwork,
    skills: skillRows,
    official: { level: event.level ?? null, sku: event.sku ?? null, importIssue, skipped },
  };
}

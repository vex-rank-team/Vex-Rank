/**
 * Loading a team profile one season at a time.
 *
 * `/api/teams/:number` without a season fetches the team's whole career from
 * the official API; uncached, a veteran took 3 to 14 seconds. Scoped to one
 * season it answered in about 0.45 seconds. The page shows one season at a
 * time, so it asks for that season and fetches others when they are picked.
 *
 * A scoped response still lists every event, so the season picker is complete
 * from the first one; rankings, awards, skills and the rating history arrive a
 * season at a time, and `loadedSeasonIds` says which. The iOS app does the
 * same (VEXRankKit/ProfileSeasons.swift).
 */

/** The season a profile opens on when nothing more specific is known. */
export const CURRENT_SEASON_ID = 204;

const SEASON_BY_NAME = { '2026–27 Override': 204, '2025–26 Push Back': 197 };

/** The season a VEX IQ profile opens on: 2026–27 Level Up. */
export const IQ_CURRENT_SEASON_ID = 203;

/** Which season to ask for first when opening `team`. */
export function initialSeason(team, program = 'V5RC') {
  return Number(team?.seasonId) || SEASON_BY_NAME[team?.season] || (program === 'VIQRC' ? IQ_CURRENT_SEASON_ID : CURRENT_SEASON_ID);
}

/** Whether `profile` carries the rows for `season`. Unscoped responses carry all. */
export function hasLoadedSeason(profile, season) {
  if (!profile) return false;
  if (!Array.isArray(profile.loadedSeasonIds)) return true;
  return profile.loadedSeasonIds.map(Number).includes(Number(season));
}

/**
 * `current` with `incoming`'s seasons folded in: rows for the seasons incoming
 * loaded come from incoming, rows for every other season are kept.
 *
 * Events need the same care as the rows. Every response lists every event, but
 * an event's elimination result is worked out from scoped matches, so an event
 * outside the loaded season arrives reading "No elimination result" whatever
 * happened. Each event is taken from the response that loaded its season.
 */
export function mergeProfiles(current, incoming) {
  if (!current) return incoming;
  const loaded = new Set((incoming.loadedSeasonIds ?? []).map(Number));
  const keep = seasonId => seasonId == null || !loaded.has(Number(seasonId));
  const rows = key => [...(current[key] ?? []).filter(row => keep(row.seasonId)), ...(incoming[key] ?? [])];
  const mine = new Map((current.events ?? []).map(event => [event.id, event]));
  const grades = { ...(current.seasonGrades ?? {}) };
  for (const [season, grade] of Object.entries(incoming.seasonGrades ?? {})) {
    if (loaded.has(Number(season)) || grades[season] == null) grades[season] = grade;
  }
  return {
    ...current,
    ...incoming,
    events: incoming.events ? incoming.events.map(event => (keep(event.seasonId) ? mine.get(event.id) ?? event : event)) : current.events,
    rankings: rows('rankings'),
    awards: rows('awards'),
    skills: rows('skills'),
    ratingHistory: rows('ratingHistory'),
    seasonGrades: grades,
    loadedSeasonIds: [...new Set([...(current.loadedSeasonIds ?? []), ...loaded].map(Number))].sort((a, b) => a - b),
  };
}

/**
 * VIQCR replay -> what the site serves: ranking rows and per-team history
 * points. Shared by the weekly build (scripts/build-iq-ratings.mjs) and the
 * live route, which continues the published replay with events finished since
 * (app/api/rankings/route.ts), so both produce the same rows.
 */
import { rankIQTeams } from './viqcr.mjs';

const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** Every rated team, confirmed and provisional, in model order. `identities`: id -> official team. */
export function iqRankingRows(replay, { asOf, identities, seasonId, season }) {
  let confirmed = 0;
  const rows = rankIQTeams(replay, { asOf, includeProvisional: true }).map((row, index) => {
    const team = replay.teams.get(row.teamId);
    const info = identities.get(row.teamId) ?? {};
    const last = team.history.at(-1), previous = team.history.at(-2);
    return {
      rank: index + 1,
      confirmedRank: row.provisional ? null : ++confirmed,
      id: Number(row.teamId),
      number: info.number ?? row.number ?? row.teamId,
      name: info.name || info.organization || info.number || row.number || row.teamId,
      organization: info.organization ?? '',
      region: [info.region, info.country].filter(value => value && value !== 'Unassigned').join(', ') || 'Unassigned',
      eventRegion: info.region || info.country || 'Unassigned',
      country: info.country || 'Unassigned',
      grade: row.grade,
      rating: Math.round(row.viqcr),
      // Public units (x1.25) of the summed weighted deviation: shown as "±".
      confidence: Math.round(1.25 * row.rd),
      viqcr: round(row.viqcr),
      mu: round(row.mu),
      rd: round(row.rd),
      change: last ? Math.round(last.viqcr - (previous ? previous.viqcr : 312.5)) : 0,
      provisional: row.provisional,
      provisionalReasons: row.provisionalReasons,
      signal: row.consistency.signal,
      components: Object.fromEntries(Object.entries(row.components).map(([name, value]) => [name, { points: Math.round(value.points), sd: round(200 * value.sd, 0) }])),
      matches: row.evidence.teamworkMatches,
      events: row.evidence.events,
      partners: row.evidence.partners,
      seasonId: Number(seasonId),
      season: season.label,
    };
  });
  return { rows, confirmed };
}

/** One team's VIQCR after each rated event, as profiles draw it. */
export function iqHistoryPoints(team, seasonId) {
  return team.history.map(entry => ({
    eventId: Number(entry.eventId), event: entry.event, eventDate: entry.date, seasonId: Number(seasonId),
    rating: Math.round(entry.viqcr), change: Math.round(entry.internalChange), matches: entry.matches, signal: entry.signal,
  }));
}

/**
 * The replay as the live route needs it, compactly: consistency rows as arrays
 * and only those that can still enter a window (the 24 most recent per team -
 * new rows are always newer), and only the last two history points per team
 * (all a ranking row reads; full histories are published separately).
 */
export function packIQState(replay) {
  const teams = [...replay.teams.entries()].map(([id, team]) => {
    const rows = [...team.consistencyRows]
      .sort((a, b) => Date.parse(b.time) - Date.parse(a.time) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
      .slice(0, 24)
      .map(row => [row.key, Date.parse(row.time), row.partnerId, row.partnerMean, row.partnerVariance, row.contribution, row.weight]);
    // A row reads only the last two points' VIQCR.
    return [id, { ...team, consistencyRows: rows, history: team.history.slice(-2).map(entry => ({ eventId: entry.eventId, viqcr: entry.viqcr })) }];
  });
  return { ...replay, teams };
}

// A fresh copy of everything the engine changes in place (see restoreV5Replay
// for why: the parsed snapshot is reused across refreshes).
export function unpackIQState(packed) {
  return {
    ...packed,
    processed: [...packed.processed],
    lastOrder: packed.lastOrder ? [...packed.lastOrder] : null,
    teams: new Map(packed.teams.map(([id, team]) => [id, {
      ...team,
      components: Object.fromEntries(Object.entries(team.components).map(([name, value]) => [name, { ...value }])),
      skillsSessions: { ...team.skillsSessions },
      partners: [...team.partners],
      history: [...team.history],
      consistencyRows: team.consistencyRows.map(([key, time, partnerId, partnerMean, partnerVariance, contribution, weight]) => ({ key, time, partnerId, partnerMean, partnerVariance, contribution, weight })),
    }])),
  };
}

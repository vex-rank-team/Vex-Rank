/**
 * VEX IQ results, read from the same event detail payload V5 uses.
 *
 * The payload looks like V5 and means something else. A teamwork match arrives
 * as two "alliances", coloured red and blue, each holding one team, and both
 * carrying the same score - the two teams scored it together. Read with the V5
 * helpers in team-event.mjs, every IQ match is a tie between opponents. These
 * functions read it as what it is: a pair of teams and one shared score. They
 * never report a winner, a loser, a tie or an alliance colour.
 *
 * Pure functions over the payload, mirrored by VEXRankKit's IQResults.swift.
 */
import { allianceNumbers, isPlayed, isQualification, percentile, place } from './team-event.mjs';

const upper = value => String(value ?? '').toUpperCase();

/**
 * One teamwork match as a pair and a score. The score is the highest posted on
 * either side: they are equal when the event is working, and taking the higher
 * keeps a half-entered result from reading lower than it is.
 */
export function teamworkPair(match, division = null) {
  const alliances = match?.alliances ?? [];
  const teams = alliances.flatMap(allianceNumbers);
  const played = isPlayed(match);
  const scores = alliances.map(alliance => Number(alliance.score)).filter(Number.isFinite);
  return {
    id: match.id,
    name: match.name ?? 'Match',
    round: Number(match.round),
    field: match.field ?? null,
    scheduled: match.scheduled ?? null,
    division: division?.name ?? null,
    qualification: isQualification(match),
    teams,
    score: played && scores.length ? Math.max(...scores) : null,
    played,
  };
}

/** Every teamwork match at an event, in play order. */
export function teamworkPairs(detail) {
  return (detail?.divisions ?? []).flatMap(division => (division.matches ?? []).map(match => teamworkPair(match, division)));
}

const byPlayOrder = (a, b) => {
  const time = value => (value ? Date.parse(value) : NaN);
  const x = time(a.scheduled), y = time(b.scheduled);
  if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return x - y;
  if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
  return Number(a.id) - Number(b.id);
};

/** Every match `number` is in at this event, from their side, in play order. */
export function iqTeamMatches(detail, number) {
  const wanted = upper(number);
  return teamworkPairs(detail)
    .filter(pair => pair.teams.some(team => upper(team) === wanted))
    .map(pair => ({ ...pair, partners: pair.teams.filter(team => upper(team) !== wanted) }))
    .sort(byPlayOrder);
}

/** Played qualification scores per team number in one division. */
function qualificationScores(division) {
  const scores = new Map();
  for (const match of division?.matches ?? []) {
    const pair = teamworkPair(match, division);
    if (!pair.qualification || !pair.played) continue;
    for (const team of pair.teams) {
      const key = upper(team);
      if (!scores.has(key)) scores.set(key, []);
      scores.get(key).push(pair.score);
    }
  }
  return scores;
}

const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

/**
 * A division's standings as IQ ranks them. Rank and high score come from the
 * event. The average is the event's own when it serves one (`averagePoints`)
 * and otherwise the plain mean of the team's played qualification scores - a
 * measured figure, not an estimate. `averageFromEvent` says which it is.
 */
export function iqDivisionStandings(division) {
  const scores = qualificationScores(division);
  return (division?.rankings ?? [])
    .map(row => {
      const number = row.team?.name ?? row.team?.number ?? '';
      const own = scores.get(upper(number)) ?? [];
      const served = row.averagePoints ?? row.average_points;
      return {
        rank: Number(row.rank),
        team: row.team,
        number,
        average: served != null ? Number(served) : mean(own),
        averageFromEvent: served != null,
        highScore: row.highScore ?? row.high_score ?? (own.length ? Math.max(...own) : null),
        played: own.length,
      };
    })
    .sort((a, b) => a.rank - b.rank);
}

/** The team's standing in whichever division it is seeded in, or null. */
export function iqStanding(detail, number) {
  const wanted = upper(number);
  for (const division of detail?.divisions ?? []) {
    const row = iqDivisionStandings(division).find(entry => upper(entry.number) === wanted);
    if (row) return { ...row, division: division.name, divisionId: division.id };
  }
  return null;
}

/** The shared score of each played match, for the tournament chart. */
export function iqScoreSeries(matches) {
  return matches.filter(match => match.played && match.score != null)
    .map((match, index) => ({ match: index + 1, name: match.name, score: match.score, partners: match.partners ?? [] }));
}

/** Best driver and best autonomous coding score per team number at the event. */
export function iqSkillBests(skills) {
  const driver = new Map(), coding = new Map();
  for (const run of skills ?? []) {
    const number = upper(run.team?.name ?? run.team?.number);
    if (!number || run.score == null) continue;
    const type = String(run.type ?? '').toLowerCase();
    const target = type.includes('driver') ? driver : type.includes('program') || type.includes('auto') ? coding : null;
    if (target) target.set(number, Math.max(target.get(number) ?? 0, Number(run.score)));
  }
  return { driver, coding };
}

/**
 * The strength axes for IQ. Every one is a measured result, so the hexagon
 * shows how a team's numbers compare with its division - it is not a rating.
 */
export const IQ_STRENGTH_AXES = [
  { key: 'average', label: 'Avg score', title: 'Average teamwork score in qualification', better: 'higher' },
  { key: 'high', label: 'High', title: 'Highest teamwork score at this event', better: 'higher' },
  { key: 'driver', label: 'Driver', title: 'Best driver skills score at this event', better: 'higher' },
  { key: 'coding', label: 'Coding', title: 'Best autonomous coding skills score at this event', better: 'higher' },
  { key: 'skills', label: 'Skills', title: 'Best driver + autonomous coding at this event', better: 'higher' },
];

/** Same shape as strengthProfile(), so the hexagon component draws either. */
export function iqStrengthProfile(detail, number) {
  const wanted = upper(number);
  const division = (detail?.divisions ?? []).find(d => (d.rankings ?? []).some(r => upper(r.team?.name ?? r.team?.number) === wanted));
  if (!division) return null;
  const rows = iqDivisionStandings(division);
  const { driver, coding } = iqSkillBests(detail.skills);
  const anyDriver = rows.some(row => driver.has(upper(row.number)));
  const anyCoding = rows.some(row => coding.has(upper(row.number)));
  const valueOf = (row, key) => {
    const team = upper(row.number);
    switch (key) {
      case 'average': return row.played || row.averageFromEvent ? row.average : null;
      case 'high': return row.played || row.highScore ? row.highScore : null;
      case 'driver': return anyDriver ? driver.get(team) ?? 0 : null;
      case 'coding': return anyCoding ? coding.get(team) ?? 0 : null;
      case 'skills': return anyDriver || anyCoding ? (driver.get(team) ?? 0) + (coding.get(team) ?? 0) : null;
      default: return null;
    }
  };
  const me = rows.find(row => upper(row.number) === wanted);
  const axes = IQ_STRENGTH_AXES.map(axis => {
    const field = rows.map(row => valueOf(row, axis.key));
    const value = valueOf(me, axis.key);
    const score = percentile(value, field, axis.better);
    const display = value == null ? '—' : axis.key === 'average' ? value.toFixed(1) : String(value);
    return { ...axis, value, score, display, place: score == null ? null : place(value, field, axis.better), of: field.filter(v => v != null).length };
  });
  const scored = axes.filter(axis => axis.score != null);
  return {
    division: division.name,
    teams: rows.length,
    axes,
    overall: scored.length ? scored.reduce((sum, axis) => sum + axis.score, 0) / scored.length : null,
    // Placed against measured results, so there is nothing to firm up.
    provisional: false,
  };
}

/** A season's grade for an IQ team, from event and division names. */
export function iqGradeFromContext(value) {
  const text = String(value ?? '').toLowerCase().replace(/[_/-]+/g, ' ');
  const elementary = /\belementary( school)?\b|\bviqrc es\b|\bes\b/.test(text);
  const middle = /\bmiddle school\b|\bviqrc ms\b|\bms\b/.test(text);
  return elementary && !middle ? 'Elementary School' : middle && !elementary ? 'Middle School' : null;
}

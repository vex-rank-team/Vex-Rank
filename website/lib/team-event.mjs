/**
 * One team at one event, read from the event detail payload.
 *
 * The same rules as the iOS app (VEXRankKit: UpcomingMatches, PowerRatings,
 * Momentum, StrengthProfile) so the two never disagree about a team's record
 * or ratings. Pure functions, no fetching: the event page has already loaded
 * everything this needs.
 */

const upper = value => String(value ?? '').toUpperCase();

/** Team numbers on an alliance. The API puts the number in `team.name`. */
export function allianceNumbers(alliance) {
  return (alliance?.teams ?? []).map(entry => entry.team?.name ?? entry.team?.number ?? entry.name ?? entry.number).filter(Boolean);
}

const side = (match, colour) => (match.alliances ?? []).find(alliance => alliance.color === colour);

/**
 * Whether a match has been played. Not the API's `scored` flag, which reads
 * false on completed matches; a posted score is the honest signal, and 0-0 is
 * what an unplayed fixture carries.
 */
export function isPlayed(match) {
  const alliances = match?.alliances ?? [];
  return alliances.some(a => Number(a.score ?? -1) >= 0) && alliances.some(a => Number(a.score ?? 0) > 0);
}

export function isQualification(match) {
  return Number(match.round) === 2 || /qual/i.test(match.name ?? '');
}

/** Every match `number` is in at this event, from their side, in play order. */
export function teamMatches(detail, number) {
  const wanted = upper(number);
  const found = [];
  for (const division of detail?.divisions ?? []) {
    for (const match of division.matches ?? []) {
      const red = allianceNumbers(side(match, 'red'));
      const blue = allianceNumbers(side(match, 'blue'));
      const onRed = red.some(n => upper(n) === wanted);
      const onBlue = blue.some(n => upper(n) === wanted);
      if (!onRed && !onBlue) continue;
      const played = isPlayed(match);
      const mine = onRed ? side(match, 'red') : side(match, 'blue');
      const theirs = onRed ? side(match, 'blue') : side(match, 'red');
      const scoreFor = played ? Number(mine?.score) : null;
      const scoreAgainst = played ? Number(theirs?.score) : null;
      found.push({
        id: match.id,
        name: match.name ?? 'Match',
        field: match.field ?? null,
        scheduled: match.scheduled ?? null,
        division: division.name,
        qualification: isQualification(match),
        colour: onRed ? 'red' : 'blue',
        partners: (onRed ? red : blue).filter(n => upper(n) !== wanted),
        opponents: onRed ? blue : red,
        scoreFor,
        scoreAgainst,
        played,
        outcome: !played ? 'scheduled' : scoreFor > scoreAgainst ? 'won' : scoreFor < scoreAgainst ? 'lost' : 'tied',
      });
    }
  }
  const time = value => (value ? Date.parse(value) : NaN);
  return found.sort((a, b) => {
    const x = time(a.scheduled), y = time(b.scheduled);
    if (!Number.isNaN(x) && !Number.isNaN(y) && x !== y) return x - y;
    if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
    return Number(a.id) - Number(b.id);
  });
}

/** Wins, losses and ties as the scores read, plus what is left to play. */
export function scoredRecord(matches) {
  const count = outcome => matches.filter(m => m.outcome === outcome).length;
  return { wins: count('won'), losses: count('lost'), ties: count('tied'), remaining: matches.filter(m => !m.played).length };
}

/**
 * Whether the event's standings agree with what the scores add up to. A team
 * can lose on points and be credited the win when the other alliance is
 * disqualified; nothing in the match payload says so, so the per-match labels
 * are the thing shown as unconfirmed.
 */
export function recordCheck(standing, matches) {
  // Only qualification matches count toward the standings.
  const scored = scoredRecord(matches.filter(m => m.qualification));
  const agrees = standing.wins === scored.wins && standing.losses === scored.losses && standing.ties === scored.ties;
  return { agrees, unexplainedWins: Math.max(0, standing.wins - scored.wins), officialSummary: `${standing.wins}–${standing.losses}–${standing.ties}` };
}

/** Running sum of scoring margins across the team's played matches. */
export function momentum(matches) {
  let running = 0;
  return matches.filter(m => m.played && m.scoreFor != null && m.scoreAgainst != null).map((m, index) => {
    const margin = m.scoreFor - m.scoreAgainst;
    running += margin;
    return { match: index + 1, name: m.name, margin, cumulative: running, outcome: m.outcome };
  });
}

/**
 * OPR, DPR and CCWM fitted from a division's played qualification matches by
 * least squares, with a ridge that shrinks toward zero while teams have fewer
 * than four appearances each (see PowerRatings.swift for the measurements
 * behind that choice).
 */
export function powerRatings(division) {
  const played = (division?.matches ?? []).filter(m => isQualification(m) && isPlayed(m));
  const empty = appearances => ({ stats: new Map(), appearances, provisional: true });
  if (played.length < 3) return empty(0);
  const sides = [];
  for (const match of played) {
    const red = side(match, 'red'), blue = side(match, 'blue');
    if (!red || !blue || red.score == null || blue.score == null) continue;
    const redTeams = allianceNumbers(red).map(upper), blueTeams = allianceNumbers(blue).map(upper);
    if (!redTeams.length || !blueTeams.length) continue;
    sides.push({ teams: redTeams, scored: Number(red.score), conceded: Number(blue.score) });
    sides.push({ teams: blueTeams, scored: Number(blue.score), conceded: Number(red.score) });
  }
  if (!sides.length) return empty(0);
  const teams = [...new Set(sides.flatMap(s => s.teams))].sort((x, y) => x.localeCompare(y));
  const n = teams.length;
  const appearances = (4 * played.length) / n;
  const index = new Map(teams.map((team, i) => [team, i]));
  const a = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  const offence = Array.from({ length: n }, () => 0), defence = Array.from({ length: n }, () => 0);
  for (const s of sides) {
    const rows = s.teams.map(t => index.get(t));
    for (const i of rows) {
      offence[i] += s.scored;
      defence[i] += s.conceded;
      for (const j of rows) a[i][j] += 1;
    }
  }
  const ridge = appearances >= 4 ? 1e-6 : Math.max(1e-6, 4 - appearances);
  for (let i = 0; i < n; i++) a[i][i] += ridge;
  const opr = solve(a, offence), dpr = solve(a, defence);
  if (!opr || !dpr) return empty(appearances);
  return {
    stats: new Map(teams.map((team, i) => [team, { opr: opr[i], dpr: dpr[i], ccwm: opr[i] - dpr[i] }])),
    appearances,
    provisional: appearances < 4,
  };
}

/** Gaussian elimination with partial pivoting; null when singular. */
export function solve(matrix, vector) {
  const n = vector.length;
  if (!n || matrix.length !== n) return null;
  const a = matrix.map(row => row.slice()), b = vector.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) <= 1e-9) return null;
    [a[pivot], a[col]] = [a[col], a[pivot]];
    [b[pivot], b[col]] = [b[col], b[pivot]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (!factor) continue;
      for (let k = col; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = Array.from({ length: n }, () => 0);
  for (let row = n - 1; row >= 0; row--) {
    let total = b[row];
    for (let k = row + 1; k < n; k++) total -= a[row][k] * x[k];
    x[row] = total / a[row][row];
  }
  return x;
}

/** The team's standing in whichever division it is seeded in, or null. */
export function teamStanding(detail, number) {
  const wanted = upper(number);
  for (const division of detail?.divisions ?? []) {
    const row = (division.rankings ?? []).find(r => upper(r.team?.name ?? r.team?.number) === wanted);
    if (!row) continue;
    const ratings = powerRatings(division);
    return {
      division: division.name,
      divisionId: division.id,
      rank: row.rank,
      wins: row.wins, losses: row.losses, ties: row.ties,
      wp: row.wp ?? null, ap: row.ap ?? null, sp: row.sp ?? null, highScore: row.highScore ?? null,
      stats: ratings.stats.get(wanted) ?? null,
      statsAreProvisional: ratings.provisional,
    };
  }
  return null;
}

/**
 * Autonomous win points earned. The standings do not list them, but every
 * V5RC win is worth 2 WP, a tie 1, and an AWP 1 more, so what is left of WP
 * after wins and ties is the AWP count. Null when WP was not served.
 */
export function awpCount(row) {
  if (row?.wp == null) return null;
  return Math.max(0, Number(row.wp) - 2 * Number(row.wins ?? 0) - Number(row.ties ?? 0));
}

/** Best driver + best programming score per team number at the event. */
export function eventSkillTotals(skills) {
  const driver = new Map(), programming = new Map();
  for (const run of skills ?? []) {
    const number = upper(run.team?.name ?? run.team?.number);
    if (!number || run.score == null) continue;
    const type = String(run.type ?? '').toLowerCase();
    const target = type.includes('driver') ? driver : type.includes('program') || type.includes('auto') ? programming : null;
    if (target) target.set(number, Math.max(target.get(number) ?? 0, Number(run.score)));
  }
  const totals = new Map();
  for (const number of new Set([...driver.keys(), ...programming.keys()])) totals.set(number, (driver.get(number) ?? 0) + (programming.get(number) ?? 0));
  return totals;
}

export const STRENGTH_AXES = [
  { key: 'opr', label: 'OPR', title: 'Offensive power rating', better: 'higher' },
  { key: 'ccwm', label: 'CCWM', title: 'Contribution to winning margin', better: 'higher' },
  { key: 'dpr', label: 'DPR', title: 'Defensive power rating (points allowed)', better: 'lower' },
  { key: 'awp', label: 'AWP', title: 'Autonomous win points per match', better: 'higher' },
  { key: 'winRate', label: 'Win rate', title: 'Qualification wins, ties counted half', better: 'higher' },
  { key: 'skills', label: 'Skills', title: 'Best driver + programming at this event', better: 'higher' },
];

/**
 * Where a value sits among the field, 0 (bottom) to 1 (top): the share of the
 * other teams it beats, ties counted half. Null with fewer than two values.
 */
export function percentile(value, field, better = 'higher') {
  if (value == null || !Number.isFinite(value)) return null;
  const others = field.filter(v => v != null && Number.isFinite(v));
  if (others.length < 2) return null;
  let beaten = 0, level = -1; // -1: the team's own value is in the field
  for (const v of others) {
    if (v === value) level += 1;
    else if (better === 'higher' ? value > v : value < v) beaten += 1;
  }
  return (beaten + Math.max(0, level) * 0.5) / (others.length - 1);
}

/** 1-based place in the field, ties sharing the better place. */
export function place(value, field, better) {
  return 1 + field.filter(v => v != null && (better === 'higher' ? v > value : v < value)).length;
}

/**
 * The six strength axes for a team at an event, each placed against the rest
 * of its division so that points, ratings and rates share one 0-1 scale.
 * An axis is null (drawn at the centre, labelled as missing) when the event
 * has no data behind it yet.
 */
export function strengthProfile(detail, number) {
  const wanted = upper(number);
  const division = (detail?.divisions ?? []).find(d => (d.rankings ?? []).some(r => upper(r.team?.name ?? r.team?.number) === wanted));
  if (!division) return null;
  const rows = division.rankings;
  const ratings = powerRatings(division);
  const skillTotals = eventSkillTotals(detail.skills);
  const anySkills = rows.some(r => skillTotals.has(upper(r.team?.name ?? r.team?.number)));
  const valueOf = (row, key) => {
    const team = upper(row.team?.name ?? row.team?.number);
    const played = Number(row.wins ?? 0) + Number(row.losses ?? 0) + Number(row.ties ?? 0);
    switch (key) {
      case 'opr': case 'dpr': case 'ccwm': return ratings.stats.get(team)?.[key] ?? null;
      case 'awp': { const awp = awpCount(row); return awp == null || !played ? null : awp / played; }
      case 'winRate': return played ? (Number(row.wins ?? 0) + 0.5 * Number(row.ties ?? 0)) / played : null;
      case 'skills': return anySkills ? skillTotals.get(team) ?? 0 : null;
      default: return null;
    }
  };
  const me = rows.find(r => upper(r.team?.name ?? r.team?.number) === wanted);
  const myPlayed = Number(me.wins ?? 0) + Number(me.losses ?? 0) + Number(me.ties ?? 0);
  const axes = STRENGTH_AXES.map(axis => {
    const field = rows.map(r => valueOf(r, axis.key));
    const value = valueOf(me, axis.key);
    const score = percentile(value, field, axis.better);
    const ranked = field.filter(v => v != null).length;
    let display = '—';
    if (value != null) {
      if (axis.key === 'awp') display = `${awpCount(me)} in ${myPlayed}`;
      else if (axis.key === 'winRate') display = `${Math.round(value * 100)}%`;
      else if (axis.key === 'skills') display = String(value);
      else display = value.toFixed(1);
    }
    return { ...axis, value, score, display, place: score == null ? null : place(value, field, axis.better), of: ranked };
  });
  const scored = axes.filter(axis => axis.score != null);
  return {
    division: division.name,
    teams: rows.length,
    axes,
    overall: scored.length ? scored.reduce((sum, axis) => sum + axis.score, 0) / scored.length : null,
    provisional: ratings.provisional,
  };
}

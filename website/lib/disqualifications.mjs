/**
 * Disqualifications in qualification matches: which team, in which match.
 * Mirrored by VEXRankKit's Rulings.swift.
 *
 * VEX IQ: explicit. Both stations of a teamwork match carry the one shared
 * score; when they differ, the lower station's team was disqualified (or did
 * not show). The rule OpenScout uses (iqMatchResult).
 *
 * V5: match records carry no DQ flag, but the official standings reflect each
 * ruling, so the gap between a team's official win-loss-tie record and the
 * record its scores add up to says where they happened. A V5 qualification DQ
 * works like this (verified on 2026-27 Override results, e.g. Caution Tape,
 * RE-V5RC-26-4234: 252W in Q49 and 19109M in Q82 - the DQs OpenScout lists):
 *   - the disqualified team takes the loss;
 *   - the opposing alliance is given the win;
 *   - the disqualified team's partner keeps its result.
 * Both partners can be disqualified at once (the opponents win once).
 *
 * The smallest set of DQs that accounts exactly for every team's gap is the
 * answer. A DQ found in every such set is certain and shown; a DQ in a match
 * the team's alliance lost anyway changes no record and cannot be seen.
 */
import { allianceNumbers, isPlayed, isQualification } from './team-event.mjs';

const upper = value => String(value ?? '').toUpperCase();
const MAX_DQS = 40, MAX_SOLUTIONS = 8, MAX_STEPS = 20000;
const result = (own, other) => (own > other ? 'w' : own < other ? 'l' : 't');
/** Steps the last V5 search took (for tuning the budget). */
export let lastSteps = 0;

function v5Disqualifications(division) {
  const played = (division?.matches ?? []).filter(match => isQualification(match) && isPlayed(match) && (match.alliances ?? []).length === 2);
  const gap = new Map();
  for (const row of division?.rankings ?? []) gap.set(upper(row.team?.name ?? row.team?.number), { w: Number(row.wins ?? 0), l: Number(row.losses ?? 0), t: Number(row.ties ?? 0) });
  if (!gap.size) return { found: [], unresolved: [] };
  for (const match of played) {
    const [a, b] = match.alliances;
    for (const [own, other] of [[a, b], [b, a]]) for (const team of allianceNumbers(own).map(upper)) {
      const g = gap.get(team); if (g) g[result(Number(own.score), Number(other.score))]--;
    }
  }
  // A team whose official record counts a different number of matches than
  // were posted (an extra appearance that does not count for it, say) cannot
  // be balanced by DQs, so it is left out of the equations rather than
  // making every other team's DQs unfindable.
  for (const [team, g] of [...gap]) if (g.w + g.l + g.t !== 0) gap.delete(team);
  const needs = [...gap].filter(([, g]) => g.w || g.l || g.t).map(([team]) => team);
  if (!needs.length) return { found: [], unresolved: [] };

  // Each candidate DQ: who it disqualifies, and how it moves records.
  const candidates = [];
  for (const match of played) {
    const [a, b] = match.alliances;
    for (const [own, other] of [[a, b], [b, a]]) {
      const outcome = result(Number(own.score), Number(other.score));
      if (outcome === 'l') continue;
      const mine = allianceNumbers(own).map(upper), theirs = allianceNumbers(other).map(upper);
      const opponentsWin = new Map(theirs.map(team => [team, { [outcome === 'w' ? 'l' : 't']: -1, w: 1 }]));
      const sets = mine.length > 1 ? [...mine.map(team => [team]), mine] : [mine];
      for (const disqualified of sets) {
        const effect = new Map(opponentsWin);
        for (const team of disqualified) effect.set(team, { [outcome]: -1, l: 1 });
        candidates.push({ match: match.id, side: own.color, teams: disqualified, effect });
      }
    }
  }
  const byTeam = new Map();
  for (const candidate of candidates) for (const team of candidate.effect.keys()) { if (!byTeam.has(team)) byTeam.set(team, []); byTeam.get(team).push(candidate); }
  const remaining = new Map([...gap].map(([team, g]) => [team, { ...g }]));
  const apply = (candidate, sign) => { for (const [team, change] of candidate.effect) { const g = remaining.get(team); if (g) for (const key of ['w', 'l', 't']) g[key] -= sign * (change[key] ?? 0); } };
  // A team can be disqualified in one match and handed a win by an opponent's
  // DQ in another, which cancel out in its record (2551A at 66020: DQ in Q1,
  // given Q24). So a DQ may push a team one step past its official record -
  // a later one brings it back - but never further.
  const fits = candidate => [...candidate.effect].every(([team, change]) => {
    const g = remaining.get(team); if (!g) return true; // not in the equations
    return ['w', 'l', 't'].every(key => { const after = g[key] - (change[key] ?? 0); return Math.abs(after) < Math.abs(g[key]) || Math.abs(after) <= 1; });
  });
  const closes = candidate => [...candidate.effect].filter(([team, change]) => { const g = remaining.get(team); return g && ['w', 'l', 't'].some(key => (change[key] ?? 0) && Math.sign(change[key]) === Math.sign(g[key])); }).length;
  // Each DQ costs the disqualified team one win or tie: enough for every lost
  // one, plus a few that are offset elsewhere.
  const budget = [...gap.values()].reduce((sum, g) => sum + Math.max(0, -g.w) + Math.max(0, -g.t), 0) + 4;
  const solutions = []; let steps = 0;
  const search = (chosen, sides) => {
    if (++steps > MAX_STEPS || solutions.length >= MAX_SOLUTIONS || chosen.length > Math.min(MAX_DQS, budget)) return;
    // The most constrained team first: the one with the fewest DQs that fit.
    // Counted without building lists, stopping once a team cannot beat the best.
    const viable = (candidate, team, g) => {
      if (sides.has(`${candidate.match}:${candidate.side}`)) return false;
      const change = candidate.effect.get(team);
      return ['w', 'l', 't'].some(key => (change[key] ?? 0) && Math.sign(change[key]) === Math.sign(g[key])) && fits(candidate);
    };
    let pick = null, fewest = Infinity;
    for (const [team, g] of remaining) {
      if (!g.w && !g.l && !g.t) continue;
      let count = 0;
      for (const candidate of byTeam.get(team) ?? []) if (viable(candidate, team, g) && ++count >= fewest) break;
      if (!count) return;
      if (count < fewest) { fewest = count; pick = team; }
    }
    if (!pick) { solutions.push([...chosen]); return; }
    const options = byTeam.get(pick).filter(candidate => viable(candidate, pick, remaining.get(pick))).sort((a, b) => closes(b) - closes(a));
    for (const candidate of options) {
      const side = `${candidate.match}:${candidate.side}`;
      apply(candidate, 1); sides.add(side); chosen.push(candidate);
      search(chosen, sides);
      chosen.pop(); sides.delete(side); apply(candidate, -1);
      if (steps > MAX_STEPS || solutions.length >= MAX_SOLUTIONS) return;
    }
  };
  search([], new Set());
  lastSteps = steps;
  if (!solutions.length) return { found: [], unresolved: needs };
  const keyOf = candidate => `${candidate.match}|${candidate.teams.join('+')}`;
  const common = solutions.map(solution => new Set(solution.map(keyOf))).reduce((all, next) => new Set([...all].filter(key => next.has(key))));
  const found = solutions[0].filter(candidate => common.has(keyOf(candidate)));
  return { found, unresolved: common.size === solutions[0].length ? [] : needs };
}

/**
 * @returns {{ byMatch: Map<number, { team: string, ruling: 'dq' }[]>, unresolved: string[] }}
 */
const cache = new WeakMap();
export function officialRulings(division, { iq = false } = {}) {
  // Pages call this on every render; the result only changes with new data.
  const cached = division && cache.get(division)?.[iq ? 'iq' : 'v5'];
  if (cached) return cached;
  const computed = computeRulings(division, iq);
  if (division) cache.set(division, { ...cache.get(division), [iq ? 'iq' : 'v5']: computed });
  return computed;
}

function computeRulings(division, iq) {
  const byMatch = new Map();
  const add = (matchId, team) => { const list = byMatch.get(matchId) ?? []; list.push({ team, ruling: 'dq' }); byMatch.set(matchId, list); };
  if (iq) {
    const played = (division?.matches ?? []).filter(match => isQualification(match) && isPlayed(match) && (match.alliances ?? []).length === 2);
    for (const match of played) {
      const [a, b] = match.alliances.map(alliance => Number(alliance.score));
      if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) continue;
      for (const team of allianceNumbers(match.alliances[a < b ? 0 : 1])) add(match.id, team);
    }
    return { byMatch, unresolved: [] };
  }
  const names = new Map();
  for (const match of division?.matches ?? []) for (const alliance of match.alliances ?? []) for (const team of allianceNumbers(alliance)) names.set(upper(team), team);
  const { found, unresolved } = v5Disqualifications(division);
  for (const candidate of found) for (const team of candidate.teams) add(candidate.match, names.get(team) ?? team);
  return { byMatch, unresolved };
}

/** `team`'s ruling in `match`, if any. */
export function rulingFor(rulings, match, team) {
  return (rulings?.byMatch?.get(match?.id) ?? []).find(entry => upper(entry.team) === upper(team))?.ruling ?? null;
}

export const RULING_LABELS = Object.freeze({ dq: 'DQ' });

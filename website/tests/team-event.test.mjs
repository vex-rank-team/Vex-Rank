import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamMatches, teamStanding, powerRatings, recordCheck, scoredRecord, momentum, awpCount, percentile, strengthProfile, isPlayed } from '../lib/team-event.mjs';

// Captured Event.VEX event payloads - the same response the site loads. The
// iOS package tests against the same captures, so both platforms are held to
// the same figures.
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const finished = fixture('event-detail');
const live = fixture('event-live');
const dq = fixture('event-dq');
const seeded = detail => detail.divisions.flatMap(d => d.rankings).map(r => r.team.name);

const match = (id, red, blue, redScore, blueScore, extra = {}) => ({
  id, name: `Q${id}`, round: 2, matchnum: id,
  alliances: [
    { color: 'red', score: redScore, teams: red.map(name => ({ team: { name } })) },
    { color: 'blue', score: blueScore, teams: blue.map(name => ({ team: { name } })) },
  ],
  ...extra,
});

test('an unplayed fixture is 0-0 and is not a result', () => {
  assert.equal(isPlayed(match(1, ['A'], ['B'], 0, 0)), false);
  assert.equal(isPlayed(match(1, ['A'], ['B'], 12, 0)), true);
});

test('matches are read from the team\'s own side', () => {
  const detail = { divisions: [{ name: 'D', rankings: [], matches: [match(1, ['1A', '2B'], ['3C', '4D'], 40, 60), match(2, ['3C', '5E'], ['1A', '6F'], 10, 30)] }] };
  const [first, second] = teamMatches(detail, '1a');
  assert.deepEqual([first.colour, first.scoreFor, first.scoreAgainst, first.outcome], ['red', 40, 60, 'lost']);
  assert.deepEqual(first.partners, ['2B']);
  assert.deepEqual(first.opponents, ['3C', '4D']);
  assert.deepEqual([second.colour, second.scoreFor, second.scoreAgainst, second.outcome], ['blue', 30, 10, 'won']);
});

test('every seeded team at a finished event has its matches and a standing', () => {
  for (const number of seeded(finished)) {
    assert.ok(teamMatches(finished, number).length > 0, number);
    assert.ok(teamStanding(finished, number), number);
  }
});

test('the standings and the scores count the same qualification matches', () => {
  for (const detail of [finished, dq]) for (const number of seeded(detail)) {
    const standing = teamStanding(detail, number);
    const scored = scoredRecord(teamMatches(detail, number).filter(m => m.qualification && m.played));
    assert.equal(standing.wins + standing.losses + standing.ties, scored.wins + scored.losses + scored.ties, number);
  }
});

test('a team credited with a win the scores do not show is flagged', () => {
  // 978Z lost seven of eight on the scoreboard; the event credits two wins.
  const check = recordCheck(teamStanding(finished, '978Z'), teamMatches(finished, '978Z'));
  assert.equal(check.agrees, false);
  assert.equal(check.unexplainedWins, 1);
  assert.ok(seeded(finished).map(n => recordCheck(teamStanding(finished, n), teamMatches(finished, n))).filter(c => c.agrees).length > 20);
});

test('a disqualification shows up as a disagreement, not as a silent wrong label', () => {
  const disagreements = seeded(dq).map(n => recordCheck(teamStanding(dq, n), teamMatches(dq, n))).filter(c => !c.agrees);
  assert.ok(disagreements.length > 0);
});

test('a live event splits into played and still-to-play', () => {
  const number = seeded(live).find(n => teamMatches(live, n).some(m => !m.played));
  assert.ok(number, 'fixture has a team with matches left');
  const matches = teamMatches(live, number);
  assert.ok(matches.filter(m => !m.played).every(m => m.scoreFor === null && m.outcome === 'scheduled'));
});

test('momentum is the running sum of margins', () => {
  const points = momentum([{ played: true, name: 'Q1', scoreFor: 50, scoreAgainst: 40, outcome: 'won' }, { played: false }, { played: true, name: 'Q3', scoreFor: 20, scoreAgainst: 45, outcome: 'lost' }]);
  assert.deepEqual(points.map(p => p.cumulative), [10, -15]);
});

test('power ratings reproduce alliance scores on an exactly determined field', () => {
  // Four teams, each true contribution fixed; every pairing plays.
  const truth = { A: 30, B: 20, C: 10, D: 5 };
  const pairs = [[['A', 'B'], ['C', 'D']], [['A', 'C'], ['B', 'D']], [['A', 'D'], ['B', 'C']]];
  const matches = [];
  for (let round = 0; round < 3; round++) for (const [red, blue] of pairs) matches.push(match(matches.length + 1, red, blue, truth[red[0]] + truth[red[1]], truth[blue[0]] + truth[blue[1]]));
  const { stats, provisional } = powerRatings({ matches });
  assert.equal(provisional, false);
  for (const [team, value] of Object.entries(truth)) assert.ok(Math.abs(stats.get(team).opr - value) < 1e-3, team);
  assert.ok(Math.abs(stats.get('A').ccwm - (stats.get('A').opr - stats.get('A').dpr)) < 1e-9);
});

test('AWP is what is left of WP after wins and ties', () => {
  assert.equal(awpCount({ wp: 13, wins: 5, ties: 1 }), 2);
  assert.equal(awpCount({ wp: null, wins: 5, ties: 1 }), null);
  for (const row of [finished, dq, live].flatMap(d => d.divisions.flatMap(div => div.rankings))) assert.ok(awpCount(row) >= 0);
});

test('percentile: best is 1, worst is 0, lower-is-better flips it', () => {
  assert.equal(percentile(10, [10, 5, 1]), 1);
  assert.equal(percentile(1, [10, 5, 1]), 0);
  assert.equal(percentile(1, [10, 5, 1], 'lower'), 1);
  assert.equal(percentile(5, [5, 5, 1]), 0.75);
  assert.equal(percentile(5, [5]), null);
});

test('the strength profile has six axes on a 0-1 scale, with a place for each', () => {
  for (const number of seeded(finished)) {
    const profile = strengthProfile(finished, number);
    assert.equal(profile.axes.length, 6);
    for (const axis of profile.axes) {
      if (axis.score == null) continue;
      assert.ok(axis.score >= 0 && axis.score <= 1, `${number} ${axis.key}`);
      assert.ok(axis.place >= 1 && axis.place <= axis.of);
    }
  }
  // The team seeded first beats most of the field on win rate.
  const top = finished.divisions[0].rankings.find(r => r.rank === 1).team.name;
  assert.ok(strengthProfile(finished, top).axes.find(a => a.key === 'winRate').score > 0.8);
});

test('an unseeded team has no profile rather than a made-up one', () => {
  assert.equal(strengthProfile(finished, 'NOPE1'), null);
});

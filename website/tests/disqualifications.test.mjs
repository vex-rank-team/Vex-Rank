import test from 'node:test';
import assert from 'node:assert/strict';
import { officialRulings, rulingFor } from '../lib/disqualifications.mjs';

const side = (color, score, ...teams) => ({ color, score, teams: teams.map(name => ({ team: { name } })) });
const qual = (id, red, blue) => ({ id, round: 2, name: `Qualifier #${id}`, alliances: [red, blue] });
const rank = (name, wins, losses, ties = 0) => ({ team: { name }, wins, losses, ties });

test('VEX IQ: the lower of two differing stations is the DQ (OpenScout\'s rule)', () => {
  const division = { matches: [qual(1, side('red', 144, '19970A'), side('blue', 0, '5216A')), qual(2, side('red', 0, '1A'), side('blue', 0, '2A')), qual(3, side('red', 90, '7A'), side('blue', 85, '8A'))], rankings: [] };
  const rulings = officialRulings(division, { iq: true });
  assert.equal(rulingFor(rulings, { id: 1 }, '5216A'), 'dq');
  assert.equal(rulingFor(rulings, { id: 1 }, '19970A'), null);
  assert.equal(rulings.byMatch.has(2), false, 'an unplayed 0-0 is not a DQ');
  assert.equal(rulingFor(rulings, { id: 3 }, '8A'), 'dq');
});

test('V5: the DQ team takes the loss, the opponents get the win, the partner keeps its result', () => {
  // Caution Tape Q49 in miniature: 252W + 16610A beat 252H + 10909N on score,
  // 252W was disqualified. Officially 252W lost, 16610A still won, 252H and
  // 10909N were given the win.
  const division = {
    matches: [qual(49, side('red', 28, '252H', '10909N'), side('blue', 160, '252W', '16610A'))],
    rankings: [rank('252W', 0, 1), rank('16610A', 1, 0), rank('252H', 1, 0), rank('10909N', 1, 0)],
  };
  const rulings = officialRulings(division);
  assert.equal(rulingFor(rulings, { id: 49 }, '252W'), 'dq');
  assert.equal(rulingFor(rulings, { id: 49 }, '16610A'), null, 'the partner was not disqualified');
  assert.deepEqual(rulings.unresolved, []);
});

test('V5: both partners disqualified', () => {
  const division = {
    matches: [qual(89, side('red', 83, '2145V', '32K'), side('blue', 93, '2567U', '2567M'))],
    rankings: [rank('2567U', 0, 1), rank('2567M', 0, 1), rank('2145V', 1, 0), rank('32K', 1, 0)],
  };
  const rulings = officialRulings(division);
  assert.equal(rulingFor(rulings, { id: 89 }, '2567U'), 'dq');
  assert.equal(rulingFor(rulings, { id: 89 }, '2567M'), 'dq');
});

test('V5: a DQ and a win from an opponent\'s DQ can cancel out in one team\'s record', () => {
  // 2551A at 66020: disqualified in Q1, then given Q24 by 210B's DQ - its
  // record matches its scores, yet it was disqualified.
  const division = {
    matches: [
      qual(1, side('red', 26, '3300Z', '2088V'), side('blue', 51, '2551A', '45519J')),
      qual(24, side('red', 60, '14353S', '210B'), side('blue', 28, '3388H', '2551A')),
    ],
    rankings: [rank('2551A', 1, 1), rank('45519J', 1, 0), rank('3300Z', 1, 0), rank('2088V', 1, 0), rank('14353S', 1, 0), rank('210B', 0, 1), rank('3388H', 1, 0)],
  };
  const rulings = officialRulings(division);
  assert.equal(rulingFor(rulings, { id: 1 }, '2551A'), 'dq');
  assert.equal(rulingFor(rulings, { id: 24 }, '210B'), 'dq');
});

test('V5: a team whose official match count differs is left out, not allowed to block the rest', () => {
  const division = {
    matches: [qual(49, side('red', 28, '252H', '10909N'), side('blue', 160, '252W', '16610A')), qual(50, side('red', 40, '9651A', 'X1'), side('blue', 10, 'Y1', 'Z1'))],
    // 9651A: one win fewer and no extra loss - a match that does not count for it.
    rankings: [rank('252W', 0, 1), rank('16610A', 1, 0), rank('252H', 1, 0), rank('10909N', 1, 0), rank('9651A', 0, 0), rank('X1', 1, 0), rank('Y1', 0, 1), rank('Z1', 0, 1)],
  };
  assert.equal(rulingFor(officialRulings(division), { id: 49 }, '252W'), 'dq');
});

test('V5: when either of two matches could hold the DQ, neither is marked', () => {
  // A1 won two matches on score with the same opponents' records unchanged...
  // only one win was overturned, and nothing says which.
  const division = {
    matches: [qual(1, side('red', 50, 'A1', 'B1'), side('blue', 10, 'C1', 'D1')), qual(2, side('red', 60, 'A1', 'B1'), side('blue', 20, 'C1', 'D1'))],
    rankings: [rank('A1', 1, 1), rank('B1', 2, 0), rank('C1', 1, 1), rank('D1', 1, 1)],
  };
  assert.equal(officialRulings(division).byMatch.size, 0);
});

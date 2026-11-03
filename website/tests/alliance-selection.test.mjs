import test from 'node:test';
import assert from 'node:assert/strict';
import { allianceSelections, ordinalSeed, selectionSentence } from '../lib/team-event.mjs';

const side = (color, ...teams) => ({ color, score: 0, teams: teams.map(name => ({ team: { name } })) });
const match = (round, red, blue) => ({ round, alliances: [red, blue] });
const rank = (name, place) => ({ team: { name }, rank: place });

test('the higher-ranked partner is the captain, and captains are seeded by rank', () => {
  const division = {
    rankings: [rank('19109A', 1), rank('81208X', 2), rank('252H', 9), rank('19109Z', 20), rank('3505Z', 26), rank('3505E', 30)],
    matches: [
      match(2, side('red', '252H', '3505Z'), side('blue', '81208X', '19109A')), // a qualifier: not an alliance
      match(6, side('red', '19109Z', '19109A'), side('blue', '3505E', '3505Z')),
      match(6, side('red', '252H', '81208X'), side('blue', '3505Z', '3505E')),
    ],
  };
  const selections = allianceSelections(division);
  assert.deepEqual(selections.map(({ seed, captain, pick }) => [seed, captain, pick]), [[1, '19109A', '19109Z'], [2, '81208X', '252H'], [3, '3505Z', '3505E']]);
  assert.equal(selectionSentence(selections[1]), '81208X selects 252H as the 2nd seed alliance');
});

test('ordinals', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinalSeed), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamworkMatchesForRating, iqArchiveSlug, iqRankingsPath, iqHistoryPath, iqHistoryShard, IQ_HISTORY_SHARDS, useIqHistorySource, iqRatingHistory, CALIBRATION, IQ_RATING_READY } from '../lib/vcr-iq.mjs';

const event = JSON.parse(readFileSync(new URL('./fixtures/viqrc/event-65767-ms-qualification.json', import.meta.url), 'utf8'));
const division = event.divisions[0];

test('played teamwork matches with team ids', () => {
  const matches = teamworkMatchesForRating(event.event.id, division.id, division.matches);
  assert.equal(matches.length, 112);
  for (const match of matches) {
    assert.equal(match.round, 2);
    assert.ok(match.score > 0);
    assert.ok(match.teams.every(Number.isInteger));
  }
});

test('published files are named by season years, never mixed with V5 archives', () => {
  assert.equal(iqArchiveSlug(203), '2026-27');
  assert.equal(iqRankingsPath('203'), '/viqcr-2026-27.json');
  assert.equal(iqHistoryPath(196, 7), '/viqcr-history-2025-26-7.json');
  assert.equal(iqHistoryShard(186306), 186306 % IQ_HISTORY_SHARDS);
  assert.ok(iqHistoryShard(186306) >= 0 && iqHistoryShard(186306) < IQ_HISTORY_SHARDS);
  assert.throws(() => iqArchiveSlug(204), /No VEX IQ season/);
  assert.ok(!/vcr3/.test(iqRankingsPath(203)));
});

test('the calibration window is a fixed, stated rule', () => {
  assert.deepEqual({ ...CALIBRATION }, { days: 28, teamwork: 300, skills: 100 });
  assert.equal(IQ_RATING_READY, true);
});

test('history: null when nothing is published, [] for an unrated team, a failure never throws', async () => {
  useIqHistorySource(null);
  assert.equal(await iqRatingHistory(1, 203), null);
  useIqHistorySource(async (teamId) => (teamId === 7 ? [{ eventId: 1, rating: 540 }] : []));
  assert.deepEqual(await iqRatingHistory(7, 203), [{ eventId: 1, rating: 540 }]);
  assert.deepEqual(await iqRatingHistory(8, 203), []);
  useIqHistorySource(async () => { throw new Error('offline'); });
  assert.equal(await iqRatingHistory(7, 203), null);
  useIqHistorySource(null);
});

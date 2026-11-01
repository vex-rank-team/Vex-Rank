import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheDecision, FRESH_FOR, STALE_FOR, isRecentEvent } from '../cloudflare/cache-policy.ts';

const NOW = 1_800_000_000_000;
// A row's expiry is written as "now + FRESH_FOR", so its age is derived from it.
const rowAged = (seconds) => ({ expires_at: NOW - seconds * 1000 + FRESH_FOR });

test('nothing cached means somebody has to wait', () => {
  assert.deepEqual(cacheDecision(null, NOW, false), { serve: 'miss', age: 0 });
});

test('a current row is served as is', () => {
  assert.equal(cacheDecision(rowAged(60), NOW, false).serve, 'fresh');
});

test('an expired row is served immediately rather than waited on', () => {
  // The point of the whole change: official data takes seconds when it works
  // and hangs when it does not, and an event opened twenty minutes ago is the
  // same answer, slightly older. Making the reader watch a spinner for it buys
  // them nothing they can see.
  const decision = cacheDecision(rowAged(FRESH_FOR / 1000 + 300), NOW, false);
  assert.equal(decision.serve, 'stale');
  assert.equal(decision.age, FRESH_FOR / 1000 + 300);
});

test('staleness is bounded', () => {
  assert.equal(cacheDecision(rowAged(STALE_FOR - 1), NOW, false).serve, 'stale');
  // Yesterday's standings are not worth showing as though they were today's.
  assert.equal(cacheDecision(rowAged(STALE_FOR + 1), NOW, false).serve, 'miss');
});

test('pulling to refresh always takes the slow, truthful path', () => {
  // Someone refreshing at a live event is asking whether anything changed.
  // Handing back the copy they already have answers a different question.
  for (const age of [60, FRESH_FOR / 1000 + 300, STALE_FOR + 1]) {
    assert.equal(cacheDecision(rowAged(age), NOW, true).serve, 'miss',
      `a refresh at age ${age}s must reach official data`);
  }
});

test('a row that expired this instant is stale, not fresh', () => {
  assert.equal(cacheDecision({ expires_at: NOW }, NOW, false).serve, 'stale');
  assert.equal(cacheDecision({ expires_at: NOW + 1 }, NOW, false).serve, 'fresh');
});

test('an event is recent while it runs and for three days after it ends', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  assert.equal(isRecentEvent({ end: '2026-11-08T00:00:00Z' }, now), true);
  assert.equal(isRecentEvent({ end: '2026-11-01T00:00:00Z' }, now), false);
  assert.equal(isRecentEvent({ end: '2026-11-01T00:00:00Z', ongoing: true }, now), true);
  assert.equal(isRecentEvent({ end: null }, now), false);
  assert.equal(isRecentEvent({ end: '2026-11-24T00:00:00Z' }, now), false, 'an event weeks away is not refreshed every minute');
});

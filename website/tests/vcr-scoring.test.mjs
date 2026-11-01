import test from 'node:test';
import assert from 'node:assert/strict';
import { recencyWeight, confidenceFor, decayedRating, RECENCY_HALF_LIFE_DAYS } from '../lib/vcr-scoring.mjs';

const now = new Date('2026-09-17T00:00:00Z');
const daysAgo = n => new Date(now.getTime() - n * 86400000).toISOString();

test('recency weight halves over exactly one half-life', () => {
  assert.equal(recencyWeight(daysAgo(0), now), 1);
  assert.ok(Math.abs(recencyWeight(daysAgo(RECENCY_HALF_LIFE_DAYS), now) - 0.5) < 1e-9);
  assert.ok(Math.abs(recencyWeight(daysAgo(2 * RECENCY_HALF_LIFE_DAYS), now) - 0.25) < 1e-9);
});

test('future-dated results are not weighted above 1', () => {
  assert.equal(recencyWeight(daysAgo(-30), now), 1);
});

test('confidence shrinks with matches and is floored at 35', () => {
  assert.ok(confidenceFor(4) > confidenceFor(40));
  assert.equal(confidenceFor(100000), 35);
  assert.equal(confidenceFor(0), confidenceFor(1), 'zero matches must not divide by zero');
});

test('an empty history sits at the 1500 baseline', () => {
  assert.equal(decayedRating([], now), 1500);
});

test('a fresh result contributes its full change', () => {
  assert.equal(decayedRating([{ change: 50, eventDate: daysAgo(0) }], now), 1550);
});

test('an aged result contributes proportionally less', () => {
  const aged = decayedRating([{ change: 50, eventDate: daysAgo(RECENCY_HALF_LIFE_DAYS) }], now);
  assert.ok(Math.abs(aged - 1525) < 1e-6, `expected ~1525, got ${aged}`);
});

test('rawChange is preferred over the rounded change when present', () => {
  const raw = decayedRating([{ change: 46, rawChange: 46.9, eventDate: daysAgo(0) }], now);
  assert.ok(Math.abs(raw - 1546.9) < 1e-9);
});

test('losses decay towards the baseline just as gains do', () => {
  const fresh = decayedRating([{ change: -60, eventDate: daysAgo(0) }], now);
  const old = decayedRating([{ change: -60, eventDate: daysAgo(RECENCY_HALF_LIFE_DAYS) }], now);
  assert.equal(fresh, 1440);
  assert.ok(old > fresh && old < 1500, 'an old loss should hurt less but still hurt');
});

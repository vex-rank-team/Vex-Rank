import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialSeason, hasLoadedSeason, mergeProfiles, CURRENT_SEASON_ID } from '../lib/team-profile.mjs';

// Captured /api/teams/31260X responses: one season each, and all seasons.
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const s204 = fixture('team-season-204');
const s197 = fixture('team-season-197');
const full = fixture('team-all-seasons');
const bySeason = rows => [...rows].map(row => JSON.stringify(row)).sort();

test('a profile opens on the season it was reached from, else the current one', () => {
  assert.equal(initialSeason({ seasonId: 197 }), 197);
  assert.equal(initialSeason({ season: '2025–26 Push Back' }), 197);
  assert.equal(initialSeason({ number: '31260X' }), CURRENT_SEASON_ID);
  assert.equal(initialSeason(undefined), CURRENT_SEASON_ID);
});

test('two season responses merged hold exactly what the all-seasons one does', () => {
  const merged = mergeProfiles(s204, s197);
  assert.deepEqual(merged.loadedSeasonIds, [197, 204]);
  for (const key of ['rankings', 'awards', 'skills', 'ratingHistory']) assert.deepEqual(bySeason(merged[key]), bySeason(full[key]), key);
  // Including each event's finals result, which a naive merge would lose.
  assert.deepEqual(merged.events, full.events);
});

test('the first season alone lists every season for the picker', () => {
  assert.deepEqual([...new Set(s204.events.map(e => e.seasonId))].sort(), [197, 204]);
  assert.equal(hasLoadedSeason(s204, 204), true);
  assert.equal(hasLoadedSeason(s204, 197), false);
  assert.equal(hasLoadedSeason({ events: [] }, 197), true, 'an unscoped response carries everything');
  assert.equal(hasLoadedSeason(null, 204), false);
});

test('reading a season again replaces its rows instead of doubling them', () => {
  const once = mergeProfiles(s204, s197);
  const twice = mergeProfiles(once, s197);
  assert.equal(twice.rankings.length, once.rankings.length);
  assert.equal(twice.ratingHistory.length, once.ratingHistory.length);
});

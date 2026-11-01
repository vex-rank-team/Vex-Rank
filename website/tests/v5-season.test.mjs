import test from 'node:test';
import assert from 'node:assert/strict';
import { replayV5Season, emptyV5Replay, continueV5Replay, ratedFromReplay, serializeV5Replay, restoreV5Replay } from '../lib/v5-season.ts';

// A small season: 8 teams, 6 events, each a round of qualification matches.
const team = id => ({ team: { id, name: `${id}A` }, sitting: false });
const alliance = (color, score, ids) => ({ color, score, teams: ids.map(team) });
function season() {
  const events = [], matches = [];
  for (let e = 0; e < 6; e++) {
    const event = { id: 100 + e, name: `Event ${e} High School`, start: `2026-09-${String(5 + e * 7).padStart(2, '0')}`, end: `2026-09-${String(5 + e * 7).padStart(2, '0')}`, level: 'Other', divisions: [{ id: 1, name: 'Division 1' }] };
    events.push(event);
    for (let m = 0; m < 8; m++) {
      const ids = [1, 2, 3, 4, 5, 6, 7, 8].map(n => ((n + m + e) % 8) + 1);
      matches.push({ id: e * 100 + m, round: 2, eventId: event.id, gradeHint: 'High School', scheduled: `${event.start}T1${m}:00:00Z`,
        alliances: [alliance('red', 40 + ids[0] * 7 + m, ids.slice(0, 2)), alliance('blue', 30 + ids[2] * 6 + e, ids.slice(2, 4))] });
    }
  }
  return { events, matches };
}

test('a saved replay continued with later events equals one full replay', () => {
  const { events, matches } = season();
  const cutoff = new Date('2026-11-01T00:00:00Z');
  const full = replayV5Season({ completed: events, matches, cutoff });
  // Snapshot after four events, through JSON as it is published, then continue.
  const early = continueV5Replay(emptyV5Replay(), { completed: events.slice(0, 4), matches });
  const restored = restoreV5Replay(JSON.parse(JSON.stringify(serializeV5Replay(early))));
  const continued = ratedFromReplay(continueV5Replay(restored, { completed: events.slice(4), matches }), cutoff);
  const shape = rows => rows.map(row => [row.id, row.rating, row.matches, row.events, row.wins, row.losses, row.middleGradeEvents.size, row.highGradeEvents.size]).sort((a, b) => a[0] - b[0]);
  assert.ok(full.length > 0);
  assert.deepEqual(shape(continued), shape(full));
});

test('an event already in the replay is never applied twice', () => {
  const { events, matches } = season();
  const once = continueV5Replay(emptyV5Replay(), { completed: events, matches });
  const before = JSON.stringify(serializeV5Replay(once));
  continueV5Replay(once, { completed: events.slice(2), matches });
  assert.equal(JSON.stringify(serializeV5Replay(once)), before);
});

test('restoring twice from one parsed snapshot gives the same result both times', () => {
  // The Worker parses the snapshot once and restores it on every refresh.
  const { events, matches } = season();
  const cutoff = new Date('2026-11-01T00:00:00Z');
  const parsed = JSON.parse(JSON.stringify(serializeV5Replay(continueV5Replay(emptyV5Replay(), { completed: events.slice(0, 4), matches }))));
  const once = ratedFromReplay(continueV5Replay(restoreV5Replay(parsed), { completed: events.slice(4), matches }), cutoff);
  const twice = ratedFromReplay(continueV5Replay(restoreV5Replay(parsed), { completed: events.slice(4), matches }), cutoff);
  assert.deepEqual(twice.map(row => [row.id, row.rating]), once.map(row => [row.id, row.rating]));
});

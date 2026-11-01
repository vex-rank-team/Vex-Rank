import test from 'node:test';
import assert from 'node:assert/strict';
import { routeToHash, hashToRoute } from '../lib/routes.mjs';

test('top-level views round-trip through the hash', () => {
  for (const view of ['home', 'events', 'rankings', 'teams']) {
    assert.deepEqual(hashToRoute(routeToHash(view, null, null)), { view });
  }
});

test('old Stat leaders links lead to Rankings while the section is hidden', () => {
  assert.equal(routeToHash('stats', null, null), '#/rankings');
  assert.deepEqual(hashToRoute('#/stats'), { view: 'rankings' });
});

test('detail views carry their identifier both ways', () => {
  assert.equal(routeToHash('team', { number: '31260X' }, null), '#/teams/31260X');
  assert.deepEqual(hashToRoute('#/teams/31260X'), { view: 'team', teamNumber: '31260X' });
  assert.equal(routeToHash('event', null, { id: 64604 }), '#/events/64604');
  assert.deepEqual(hashToRoute('#/events/64604'), { view: 'event', eventId: '64604' });
});

test('a detail view without its identifier falls back to the list', () => {
  assert.equal(routeToHash('team', {}, null), '#/teams');
  assert.equal(routeToHash('event', null, undefined), '#/events');
});

test('team numbers needing encoding survive the round trip', () => {
  const number = '2775V/B';
  const hash = routeToHash('team', { number }, null);
  assert.ok(!hash.endsWith('/B'), 'slash must be encoded, not left as a path separator');
  assert.deepEqual(hashToRoute(hash), { view: 'team', teamNumber: number });
});

test('empty and unrecognised hashes are handled distinctly', () => {
  assert.deepEqual(hashToRoute(''), { view: 'home' });
  assert.deepEqual(hashToRoute('#/'), { view: 'home' });
  assert.equal(hashToRoute('#/nope'), null, 'unknown route is ignored, not guessed');
  assert.equal(hashToRoute('#/teams/%E0%A4%A'), null, 'malformed encoding must not throw');
});

test('a team at an event carries both identifiers both ways', () => {
  assert.equal(routeToHash('teamEvent', { number: '31260X' }, { id: 64604 }), '#/events/64604/teams/31260X');
  assert.deepEqual(hashToRoute('#/events/64604/teams/31260X'), { view: 'teamEvent', eventId: '64604', teamNumber: '31260X' });
});

test('a team at an event missing either half falls back to what it has', () => {
  assert.equal(routeToHash('teamEvent', {}, { id: 64604 }), '#/events/64604');
  assert.equal(routeToHash('teamEvent', { number: '31260X' }, {}), '#/events');
  assert.deepEqual(hashToRoute('#/events/64604/teams'), { view: 'event', eventId: '64604' });
});

test('VEX IQ routes carry the program under an iq/ prefix', () => {
  assert.equal(routeToHash('home', null, null, 'VIQRC'), '#/iq');
  assert.equal(routeToHash('events', null, null, 'VIQRC'), '#/iq/events');
  assert.equal(routeToHash('event', null, { id: 65767 }, 'VIQRC'), '#/iq/events/65767');
  assert.equal(routeToHash('teamEvent', { number: '86995D' }, { id: 65767 }, 'VIQRC'), '#/iq/events/65767/teams/86995D');
  assert.deepEqual(hashToRoute('#/iq'), { view: 'home', program: 'VIQRC' });
  assert.deepEqual(hashToRoute('#/iq/teams/86995D'), { view: 'team', teamNumber: '86995D', program: 'VIQRC' });
  assert.deepEqual(hashToRoute('#/iq/events/65767/teams/86995D'), { view: 'teamEvent', eventId: '65767', teamNumber: '86995D', program: 'VIQRC' });
  assert.equal(hashToRoute('#/iq/nope'), null);
});

test('V5 hashes are unchanged by the program argument', () => {
  for (const view of ['home', 'events', 'rankings', 'stats', 'teams']) {
    assert.equal(routeToHash(view, null, null, 'V5RC'), routeToHash(view, null, null));
  }
  assert.equal(routeToHash('team', { number: '31260X' }, null, 'V5RC'), '#/teams/31260X');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl } from '../cloudflare/canonical-url.ts';

const key = path => {
  const url = canonicalUrl(new Request(`https://worker.test${path}`));
  return url ? url.pathname + url.search : null;
};

test('V5 requests keep the cache keys they had before VEX IQ', () => {
  assert.equal(key('/api/events?season=204&classification=v49'), '/api/events?season=204');
  assert.equal(key('/api/events?season=204&program=V5RC'), '/api/events?season=204');
  assert.match(key('/api/rankings'), /^\/api\/rankings\?model=VCR-/);
});

test('an IQ request gets its own key', () => {
  assert.equal(key('/api/events?season=203&program=VIQRC'), '/api/events?season=203&program=VIQRC');
  assert.notEqual(key('/api/skills?season=203&program=VIQRC'), key('/api/skills?season=203'));
  assert.notEqual(key('/api/teams/86995D?program=VIQRC'), key('/api/teams/86995D'));
});

test('an unknown program is refused rather than served as V5', () => {
  assert.equal(key('/api/events?program=VEXU'), null);
  assert.equal(key('/api/events?program=viqrc'), null);
});

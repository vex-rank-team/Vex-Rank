import test from 'node:test';
import assert from 'node:assert/strict';
import { vexCountries, vexEventRegions, eventRegionsForCountry } from '../lib/event-regions.mjs';

test('vocabularies are non-empty and lead with the All sentinel', () => {
  assert.ok(vexCountries.length > 50);
  assert.equal(vexCountries[0], 'All');
  assert.equal(vexEventRegions[0], 'All');
});

test('All returns the full region vocabulary', () => {
  assert.equal(eventRegionsForCountry('All'), vexEventRegions);
});

test('grouped countries return their own region list, prefixed with All', () => {
  for (const country of ['United States', 'Canada', 'China', 'Europe', 'Asia Pacific']) {
    const regions = eventRegionsForCountry(country);
    assert.equal(regions[0], 'All', `${country} must lead with All`);
    assert.ok(regions.length > 1, `${country} must contribute regions`);
  }
});

test('aliased countries map onto their official region name', () => {
  assert.deepEqual(eventRegionsForCountry('Taiwan'), ['All', 'Chinese Taipei']);
  assert.deepEqual(eventRegionsForCountry('Georgia'), ['All', 'Georgia- Country']);
});

test('an unknown country degrades to just All rather than throwing', () => {
  assert.deepEqual(eventRegionsForCountry('Atlantis'), ['All']);
});

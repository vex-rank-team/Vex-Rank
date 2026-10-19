import test from 'node:test';
import assert from 'node:assert/strict';
import { eventRankingRows, sortRows, toCsv, fileName, eventIcs, EVENT_RANKING_COLUMNS } from '../lib/scout/tables.mjs';
import {
  filterSkills, wouldPlace, skillsFacets, compareProfile, compareTable, distanceKm, nearby, onDay,
  matchScore, searchAll, youTubeId, parseTimestamp, formatTimestamp, eventSku, streamTimes,
} from '../lib/scout/insights.mjs';
import {
  emptyScout, sanitizeScout, toggleFavorite, isFavorite, setNote, noteFor, addToPicklist, removeFromPicklist,
  movePick, updatePick, picklistOf, setStream, setMyTeam, createScoutStore, SCOUT_KEY,
} from '../lib/scout/store.mjs';

// A small division: four teams, three qualification matches.
const alliance = (color, a, b, score) => ({ color, score, teams: [{ team: { name: a } }, { team: { name: b } }] });
const division = {
  rankings: [
    { rank: 2, team: { id: 2, name: '2B' }, wins: 2, losses: 1, ties: 0, wp: 5, ap: 10, sp: 30, highScore: 90 },
    { rank: 1, team: { id: 1, name: '1A' }, wins: 3, losses: 0, ties: 0, wp: 7, ap: 12, sp: 40, highScore: 100 },
    { rank: 3, team: { id: 3, name: '3C' }, wins: 1, losses: 2, ties: 0, wp: 2, ap: 4, sp: 20, highScore: null },
    { rank: 4, team: { id: 4, name: '4D' }, wins: 0, losses: 3, ties: 0, wp: 0, ap: 0, sp: 10 },
  ],
  matches: [
    { round: 2, name: 'Q1', alliances: [alliance('red', '1A', '2B', 100), alliance('blue', '3C', '4D', 40)] },
    { round: 2, name: 'Q2', alliances: [alliance('red', '1A', '3C', 80), alliance('blue', '2B', '4D', 60)] },
    { round: 2, name: 'Q3', alliances: [alliance('red', '1A', '4D', 70), alliance('blue', '2B', '3C', 90)] },
  ],
};
const skills = [
  { team: { name: '1A' }, type: 'driver', score: 50 }, { team: { name: '1A' }, type: 'programming', score: 30 },
  { team: { name: '2B' }, type: 'driver', score: 40 },
];

test('event ranking rows combine official numbers with worked-out ones', () => {
  const rows = eventRankingRows(division, skills);
  assert.deepEqual(rows.map(r => r.number), ['1A', '2B', '3C', '4D']);
  const first = rows[0];
  assert.equal(first.record, '3-0-0');
  assert.equal(first.awp, 1, 'WP 7 = 2×3 wins + 1 AWP');
  assert.equal(first.avg, 83.3);
  assert.equal(first.high, 100);
  assert.equal(first.skills, 80);
  assert.equal(rows[2].high, 90, 'falls back to the best alliance score from matches');
  assert.equal(rows[3].skills, 0, 'no skills run counts as zero once any team has run');
  assert.ok(typeof first.opr === 'number');
});

test('sorting puts the best first, honours lower-is-better, and sinks blanks', () => {
  const rows = eventRankingRows(division, skills);
  assert.deepEqual(sortRows(rows, 'wp').map(r => r.number), ['1A', '2B', '3C', '4D']);
  assert.deepEqual(sortRows(rows, 'rank', 'worst').map(r => r.number), ['4D', '3C', '2B', '1A']);
  const withBlank = [{ number: 'X', dpr: null }, { number: 'Y', dpr: 30 }, { number: 'Z', dpr: 10 }];
  assert.deepEqual(sortRows(withBlank, 'dpr').map(r => r.number), ['Z', 'Y', 'X']);
  assert.deepEqual(sortRows(rows, 'number').map(r => r.number), ['1A', '2B', '3C', '4D']);
  assert.ok(EVENT_RANKING_COLUMNS.every(col => col.key && col.label));
});

test('CSV quotes what needs quoting and defuses spreadsheet formulas', () => {
  const csv = toCsv([{ key: 'a', label: 'Name' }, { key: 'b', label: 'Score' }], [
    { a: 'Ctrl, "Z"', b: 12 }, { a: '=HYPERLINK("x")', b: -3 }, { a: null, b: 0 },
  ]);
  assert.equal(csv, 'Name,Score\r\n"Ctrl, ""Z""",12\r\n"\'=HYPERLINK(""x"")",-3\r\n,0\r\n');
  assert.equal(fileName('RE-V5RC-26-4244', 'rankings/../x', 'UND'), 'RE-V5RC-26-4244 rankings..x UND');
  assert.ok(!fileName('x'.repeat(79), 'yz').endsWith(' '), 'no trailing space after cutting at 80');
});

test('calendar files are all-day, cover the last day, and fold long lines', () => {
  const ics = eventIcs({ sku: 'RE-V5RC-26-4244', name: 'University of North Dakota Signature at the Mall of America: VEX V5 Robotics Competition, High School', start: '2026-08-06T00:00:00-05:00', end: '2026-08-08T00:00:00-05:00', location: 'Mall of America; Bloomington, MN', url: 'https://example.com/e' }, new Date('2026-10-19T00:00:00Z'));
  assert.match(ics, /DTSTART;VALUE=DATE:20260806\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20260809\r\n/, 'DTEND is the day after the last day');
  assert.match(ics, /LOCATION:Mall of America\\; Bloomington\\, MN/);
  assert.ok(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
  assert.match(ics, /\r\n /, 'the long summary is folded');
});

const skillRows = [
  { number: '1A', name: 'One', organization: 'Org', region: 'Ontario, Canada', country: 'Canada', grade: 'High School', autoSkills: 100, driverSkills: 120, combinedSkills: 220, skillsRank: 1 },
  { number: '2B', name: 'Two', organization: 'Org', region: 'California, United States', country: 'United States', grade: 'High School', autoSkills: 60, driverSkills: 140, combinedSkills: 200, skillsRank: 2 },
  { number: '3C', name: 'Three', organization: 'School', region: 'California, United States', country: 'United States', grade: 'Middle School', autoSkills: 80, driverSkills: 100, combinedSkills: 180, skillsRank: 3 },
];

test('skills filters and facets', () => {
  assert.deepEqual(filterSkills(skillRows, { grade: 'High School' }).map(r => r.number), ['1A', '2B']);
  assert.deepEqual(filterSkills(skillRows, { country: 'United States', region: 'California' }).map(r => r.number), ['2B', '3C']);
  assert.deepEqual(filterSkills(skillRows, { search: 'school' }).map(r => r.number), ['3C']);
  assert.deepEqual(skillsFacets(skillRows).countries, ['Canada', 'United States']);
  assert.deepEqual(skillsFacets(skillRows, 'Canada').regions, ['Ontario']);
});

test('where would I place: rank, neighbours, and the programming tie-break', () => {
  const placed = wouldPlace(skillRows, { auto: 70, driver: 140 });
  assert.equal(placed.combined, 210);
  assert.equal(placed.rank, 2);
  assert.equal(placed.above.number, '1A');
  assert.equal(placed.below.number, '2B');
  assert.equal(wouldPlace(skillRows, { auto: 61, driver: 139 }).rank, 2, 'same 200 total, more programming: ahead of 2B');
  assert.equal(wouldPlace(skillRows, { auto: 50, driver: 150 }).rank, 3, 'same 200 total, less programming: behind 2B');
  assert.equal(wouldPlace(skillRows, { auto: 0, driver: 0 }).rank, 4);
  assert.equal(wouldPlace([], { auto: 10, driver: 10 }).rank, 1);
});

test('compare marks the best value per metric', () => {
  const a = compareProfile('1A', { rating: 1580, rank: 2, record: '21–1–1', events: 2, opr: 60, dpr: 20, ccwm: 40 }, { combinedSkills: 220, skillsRank: 1 });
  const b = compareProfile('2B', { rating: 1572, rank: 4, record: '21–3–0', events: 2, opr: 70, dpr: 25, ccwm: 45 }, null);
  assert.equal(a.matches, 23);
  assert.ok(Math.abs(a.winRate - 21.5 / 23) < 1e-9);
  const table = compareTable([a, b]);
  const row = key => table.find(r => r.key === key);
  assert.deepEqual(row('rating').best, [true, false]);
  assert.deepEqual(row('rank').best, [true, false], 'lower rank is better');
  assert.deepEqual(row('dpr').best, [true, false], 'lower DPR is better');
  assert.deepEqual(row('opr').best, [false, true]);
  assert.deepEqual(row('combinedSkills').best, [false, false], 'one value alone is not a win');
});

test('near me and day filters', () => {
  const toronto = { lat: 43.65, lon: -79.38 };
  assert.ok(Math.abs(distanceKm(toronto, { lat: 45.42, lon: -75.7 }) - 352) < 5, 'Toronto to Ottawa ≈ 352 km');
  const events = [{ id: 'far', lat: 34.05, lon: -118.24 }, { id: 'near', lat: 43.59, lon: -79.64 }, { id: 'nowhere' }];
  assert.deepEqual(nearby(events, toronto).map(e => e.id), ['near']);
  assert.equal(nearby(events, toronto)[0].distanceKm, 22);
  assert.ok(onDay({ date: '2026-10-17', endDate: '2026-10-19' }, '2026-10-19'));
  assert.ok(!onDay({ date: '2026-10-21' }, '2026-10-19'));
  assert.ok(onDay({ date: '2026-10-21' }, '2026-10-19', 3), 'near today: within three days');
});

test('search ranks team numbers, names and pages', () => {
  assert.equal(matchScore('471', '471B'), 80);
  assert.equal(matchScore('dakota', 'University of North Dakota Signature'), 60);
  assert.equal(matchScore('zz', '471B'), 0);
  const index = {
    pages: [{ label: 'World skills', view: 'skills' }, { label: 'Events', view: 'events' }],
    teams: [{ number: '471B', name: 'Moonshot' }, { number: '1471A', name: 'Other' }],
    events: [{ id: '1', name: 'Moonshot Classic', sku: 'RE-V5RC-26-1' }],
  };
  const results = searchAll('471', index);
  assert.equal(results[0].type, 'team');
  assert.equal(results[0].number, '471B');
  assert.deepEqual(searchAll('', index).map(r => r.view), ['skills', 'events']);
  assert.equal(searchAll('skills', index)[0].type, 'page');
});

test('Jumper parsing: video links, timestamps and SKUs', () => {
  for (const url of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ?si=x', 'dQw4w9WgXcQ']) assert.equal(youTubeId(url), 'dQw4w9WgXcQ', url);
  assert.equal(youTubeId('https://evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseTimestamp('1:02:03'), 3723);
  assert.equal(parseTimestamp('62:03'), 3723);
  assert.equal(parseTimestamp('1h2m3s'), 3723);
  assert.equal(parseTimestamp('nope'), null);
  assert.equal(formatTimestamp(3723), '1:02:03');
  assert.equal(formatTimestamp(65), '1:05');
  assert.equal(eventSku('https://events.vex.com/robot-competitions/vex-robotics-competition/RE-V5RC-26-4244.html'), 'RE-V5RC-26-4244');
  assert.equal(eventSku('nothing here'), null);
});

test('stream times follow official start times from one synced match', () => {
  const matches = [
    { id: 1, started: '2026-08-07T14:00:00Z' },
    { id: 2, started: '2026-08-07T14:03:30Z' },
    { id: 3, scheduled: '2026-08-07T14:10:00Z' },
    { id: 4 },
    { id: 5, started: '2026-08-07T13:00:00Z' },
  ];
  const times = streamTimes(matches, { matchId: '2', seconds: 1000 });
  assert.equal(times.get('2'), 1000);
  assert.equal(times.get('1'), 790);
  assert.equal(times.get('3'), 1390, 'falls back to the scheduled time');
  assert.ok(!times.has('4'), 'no time, no place');
  assert.ok(!times.has('5'), 'before the stream started');
  assert.equal(streamTimes(matches, { matchId: '99', seconds: 1 }).size, 0);
});

test('favourites, notes and picklists change immutably', () => {
  let s = emptyScout();
  s = toggleFavorite(s, 'team', { number: '471b', name: 'Moonshot' });
  assert.ok(isFavorite(s, 'team', '471B'));
  s = toggleFavorite(s, 'team', { number: '471B' });
  assert.ok(!isFavorite(s, 'team', '471B'));
  s = toggleFavorite(s, 'event', { id: 64244, name: 'UND', date: '2026-08-06' });
  assert.ok(isFavorite(s, 'event', '64244'));

  const before = s;
  s = setNote(s, '64244', 'match:Q12', '  strong auton  ', 5);
  assert.equal(noteFor(s, '64244', 'match:Q12'), 'strong auton');
  assert.equal(noteFor(before, '64244', 'match:Q12'), '', 'the old state is untouched');
  s = setNote(s, '64244', 'match:Q12', '');
  assert.deepEqual(s.notes, {}, 'clearing the last note removes the event');

  s = addToPicklist(s, '64244', '10102a', 'first');
  s = addToPicklist(s, '64244', '471B');
  s = addToPicklist(s, '64244', '471B');
  s = addToPicklist(s, '64244', 'not a team');
  assert.deepEqual(picklistOf(s, '64244').map(e => e.number), ['10102A', '471B']);
  s = movePick(s, '64244', 1, 0);
  assert.deepEqual(picklistOf(s, '64244').map(e => e.number), ['471B', '10102A']);
  s = updatePick(s, '64244', '471B', { picked: true, tier: 'avoid', note: 'x'.repeat(400) });
  assert.equal(picklistOf(s, '64244')[0].tier, 'avoid');
  assert.equal(picklistOf(s, '64244')[0].note.length, 300);
  s = updatePick(s, '64244', '471B', { tier: 'bogus' });
  assert.equal(picklistOf(s, '64244')[0].tier, 'avoid', 'unknown tiers are ignored');
  s = removeFromPicklist(s, '64244', '471B');
  assert.deepEqual(picklistOf(s, '64244').map(e => e.number), ['10102A']);

  s = setStream(s, '64244', { videoId: 'dQw4w9WgXcQ', anchor: { matchId: '2', seconds: 10 } });
  assert.equal(s.streams['64244'].videoId, 'dQw4w9WgXcQ');
  s = setMyTeam(s, ' 55288a ');
  assert.equal(s.myTeam, '55288A');
  assert.equal(setMyTeam(s, 'nope').myTeam, '');
});

test('stored scouting data is sanitised on read', () => {
  const clean = sanitizeScout({
    favorites: { teams: [{ number: '471B', name: 'M' }, { number: '<img>' }], events: [{ id: '64244', name: 'UND' }, { id: 'x' }] },
    notes: { '64244': { 'match:Q1': { text: 'ok', updatedAt: 1 }, 'bad target': { text: 'no' } }, nope: {} },
    picklists: { '64244': [{ number: '1A', tier: 'first' }, { number: '1A' }, { number: 'bad' }] },
    streams: { '64244': { videoId: 'short' } },
    myTeam: 'drop table',
  });
  assert.deepEqual(clean.favorites.teams, [{ number: '471B', name: 'M' }]);
  assert.deepEqual(clean.favorites.events.map(e => e.id), ['64244']);
  assert.deepEqual(Object.keys(clean.notes['64244']), ['match:Q1']);
  assert.deepEqual(clean.picklists['64244'].map(e => e.number), ['1A'], 'duplicates and bad numbers dropped');
  assert.deepEqual(clean.streams, {});
  assert.equal(clean.myTeam, '');
  assert.deepEqual(sanitizeScout('garbage'), emptyScout());
});

test('the store persists, notifies, and survives broken storage', () => {
  const data = {};
  const storage = { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; } };
  const store = createScoutStore(storage, null);
  let calls = 0;
  const stop = store.subscribe(() => { calls += 1; });
  store.update(state => toggleFavorite(state, 'team', { number: '1A' }));
  assert.equal(calls, 1);
  assert.ok(JSON.parse(data[SCOUT_KEY]).favorites.teams.length === 1);
  store.update(state => state);
  assert.equal(calls, 1, 'no change, no notification');
  stop();
  assert.ok(isFavorite(createScoutStore(storage, null).get(), 'team', '1A'), 'a new page load reads it back');

  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const fragile = createScoutStore(broken, null);
  fragile.update(state => toggleFavorite(state, 'team', { number: '2B' }));
  assert.ok(isFavorite(fragile.get(), 'team', '2B'), 'still works for the visit');
});

import { seasonSeries, seasonTotals } from '../lib/scout/team-season.mjs';

test('a team season becomes one point per event, oldest first, with running win rate', () => {
  const history = {
    events: [
      { id: 10, seasonId: 204, start: '2026-09-20T09:00:00', name: 'Second' },
      { id: 11, seasonId: 204, start: '2026-08-06T09:00:00', name: 'First' },
      { id: 12, seasonId: 197, start: '2026-03-01T09:00:00', name: 'Last season' },
    ],
    rankings: [
      { eventId: 11, seasonId: 204, wins: 3, losses: 1, ties: 0, wp: 7 },
      { eventId: 10, seasonId: 204, wins: 1, losses: 2, ties: 1, wp: 4 },
      { eventId: 10, seasonId: 204, wins: 2, losses: 0, ties: 0, wp: 4 },
      { eventId: 12, seasonId: 197, wins: 9, losses: 0, ties: 0, wp: 18 },
    ],
    skills: [
      { eventId: 11, seasonId: 204, type: 'driver', score: 40 }, { eventId: 11, seasonId: 204, type: 'driver', score: 55 },
      { eventId: 11, seasonId: 204, type: 'programming', score: 20 },
    ],
  };
  const series = seasonSeries(history, 204);
  assert.deepEqual(series.map(p => p.event), ['First', 'Second']);
  assert.equal(series[0].record, '3-1-0');
  assert.equal(series[0].winRate, 75);
  assert.equal(series[0].awp, 1, 'WP 7 with 3 wins');
  assert.equal(series[0].skills, 75);
  assert.equal(series[1].record, '3-2-1', 'two divisions at one event are combined');
  assert.equal(series[1].winRate, 65, '6.5 of 10 across both events');
  assert.equal(series[1].skills, null);
  const totals = seasonTotals(series);
  assert.equal(totals.events, 2);
  assert.equal(totals.record, '6-3-1');
  assert.equal(totals.winRate, 65);
  assert.equal(totals.wpPerMatch, 1.5, '15 WP over 10 matches');
  assert.equal(totals.bestSkills, 75);
  assert.equal(seasonSeries(history, 999).length, 0);
  assert.equal(seasonTotals([]).winRate, null);
});

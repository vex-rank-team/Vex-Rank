import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeId, youtubeChannel, eventStreams, buildJumper, matchTimes, matchesById, placeDropouts, videoTime } from '../lib/stream-jumper.mjs';

test('YouTube ids from every link shape, none from channels', () => {
  for (const url of ['https://www.youtube.com/watch?v=3XiT_3haGR4', 'https://youtu.be/3XiT_3haGR4?t=5', 'https://youtube.com/live/3XiT_3haGR4?feature=share', 'https://www.youtube.com/embed/3XiT_3haGR4', 'https://m.youtube.com/watch?v=3XiT_3haGR4&t=1'])
    assert.equal(youtubeId(url), '3XiT_3haGR4', url);
  for (const url of ['https://www.youtube.com/@CautionTape/streams', 'https://www.youtube.com/channel/UC-grQ9qvMoKXjtxOPDrC-yg', 'https://twitch.tv/x', 'not a link'])
    assert.equal(youtubeId(url), null, url);
});

test('channel links are recognised, for finding their broadcasts', () => {
  assert.equal(youtubeChannel('https://www.youtube.com/@WHRobotics1/streams'), '@WHRobotics1');
  assert.equal(youtubeChannel('https://www.youtube.com/channel/UC-grQ9qvMoKXjtxOPDrC-yg'), 'UC-grQ9qvMoKXjtxOPDrC-yg');
  assert.equal(youtubeChannel('https://www.youtube.com/user/929HZR'), 'user:929HZR');
  assert.equal(youtubeChannel('https://www.youtube.com/watch?v=3XiT_3haGR4'), null);
  const { streams, others, channels } = eventStreams('Live: https://www.youtube.com/watch?v=3XiT_3haGR4. Channel: https://www.youtube.com/@cautiontape', [{ videoId: '3XiT_3haGR4' }, { videoId: 'abcdefghijk' }]);
  assert.deepEqual(streams.map(s => [s.videoId, s.source]), [['3XiT_3haGR4', 'event'], ['abcdefghijk', 'viewer']]);
  assert.deepEqual(others, ['https://www.youtube.com/@cautiontape']);
  assert.deepEqual(channels, ['@cautiontape']);
});

const at = (clock) => `2026-10-31T${clock}-04:00`;
const scored = [{ color: 'red', score: 10, teams: [] }, { color: 'blue', score: 20, teams: [] }];
const match = (id, scheduled, started, extra = {}) => ({ id, name: `Q${id}`, round: 2, matchnum: id, scheduled: scheduled && at(scheduled), started: started && at(started), alliances: scored, ...extra });
const event = (matches, divisionId = 1) => [{ id: divisionId, name: `Division ${divisionId}`, matches }];
const jumper = (divisions, streams, nudges) => buildJumper({ divisions, streams, nudges, eventStart: '2026-10-31T00:00:00-04:00', eventEnd: '2026-10-31T23:59:00-04:00' });

test('matches are placed by when they started, never by schedule or play order', () => {
  // Q3 was played before Q2 after a field fault.
  const divisions = event([match(1, '09:00:00', '09:33:13'), match(2, '09:04:00', '09:50:00'), match(3, '09:08:00', '09:40:00')]);
  const j = jumper(divisions, [{ videoId: 'v1', startTime: at('09:25:42') }]);
  assert.equal(j.jumpFor(1).seconds, 451);
  assert.equal(j.jumpFor(3).seconds, 858);
  assert.equal(j.jumpFor(2).seconds, 1458);
});

test('a played match with no recorded start is estimated from its neighbours\' delay', () => {
  const divisions = event([match(1, '09:00:00', '09:30:00'), match(2, '09:10:00', null), match(3, '09:20:00', '09:50:00'), match(4, '09:30:00', null, { alliances: [] })]);
  const times = matchTimes(matchesById(divisions));
  assert.deepEqual(times.get(2), { time: Date.parse(at('09:40:00')), estimated: true }); // delay 30 → 30
  assert.equal(times.has(4), false, 'not played, so nothing to estimate');
  const j = jumper(divisions, [{ videoId: 'v1', startTime: at('09:00:00') }]);
  assert.deepEqual(j.jumpFor(2), { videoId: 'v1', seconds: 2400, estimated: true });
});

test('start times that cannot be real are treated as missing', () => {
  const batch = '2026-10-31T21:00:00-04:00';
  const divisions = event([
    match(1, '09:00:00', '09:30:00'), match(2, '09:10:00', '09:40:00'),
    ...[3, 4, 5, 6].map(id => ({ ...match(id, `10:${String(id).padStart(2, '0')}:00`, null), started: batch })),
    { ...match(7, '11:00:00', null), started: '2025-01-01T10:00:00Z' },
  ]);
  const times = matchTimes(matchesById(divisions), { eventStart: '2026-10-31T00:00:00-04:00', eventEnd: '2026-10-31T23:00:00-04:00' });
  for (const id of [3, 4, 5, 6, 7]) assert.equal(times.get(id).estimated, true, `match ${id}`);
});

// A real day: a match every five minutes, 9:30-12:00 and 13:00-16:00, lunch between.
const clock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;
const day = () => { const list = []; let id = 1; for (let m = 570; m <= 720; m += 5) list.push(match(id++, clock(m), clock(m))); for (let m = 780; m <= 960; m += 5) list.push(match(id++, clock(m), clock(m))); return list; };

test('a dropout over lunch: the first half from the start, the second half from the end', () => {
  // Live 9:00-17:00 (8 h), but the video is 7 h: the encoder was off an hour.
  const matches = day(), first = matches[0], last = matches.at(-1), afterLunch = matches.find(m => m.started === at('13:00:00'));
  const stream = { videoId: 'v1', startTime: at('09:00:00'), endTime: at('17:00:00'), duration: 7 * 3600 };
  const j = jumper(event(matches), [stream]);
  assert.equal(j.jumpFor(first.id).seconds, 1800, 'before the dropout, from the start');
  assert.equal(j.jumpFor(afterLunch.id).seconds, 4 * 3600 - 3600 + 150, 'after it: the hour is left out (less the last match before the break)');
  assert.equal(j.jumpFor(last.id).seconds, 7 * 3600 - 3600 + 150);
  // ...and so the last match lands where the end of the video says it does.
  assert.ok(Math.abs(j.jumpFor(last.id).seconds - (7 * 3600 - 3600)) <= 150);
});

test('a correction moves the dropout to the pause it actually happened in', () => {
  // Caution Tape's shape: the longest pause is lunch, but 14 minutes went
  // missing during alliance selection (16:05-16:40), before the eliminations.
  const matches = day().filter(m => Date.parse(m.started) <= Date.parse(at('16:00:00')));
  let id = 500; for (let m = 1000; m <= 1080; m += 5) matches.push(match(id++, clock(m), clock(m), { round: 6 }));
  const afterLunch = matches.find(m => m.started === at('13:00:00')), firstElim = matches.find(m => m.id === 500);
  const stream = { videoId: 'v1', startTime: at('09:00:00'), endTime: at('18:30:00'), duration: 9.5 * 3600 - 14 * 60 };
  const guessed = jumper(event(matches), [stream]);
  assert.equal(guessed.jumpFor(afterLunch.id).seconds, 4 * 3600 - 14 * 60 + 0, 'unaided, the missing time goes in the longest pause: lunch');
  // A viewer finds the first match after lunch where the clock says it is.
  const told = jumper(event(matches), [{ ...stream, anchors: [{ matchId: afterLunch.id, seconds: 4 * 3600 }] }]);
  assert.equal(told.jumpFor(afterLunch.id).seconds, 4 * 3600);
  assert.equal(told.jumpFor(matches.find(m => m.started === at('15:00:00')).id).seconds, 6 * 3600, 'the afternoon is now right too');
  assert.equal(told.jumpFor(firstElim.id).seconds, (1000 - 540) * 60 - 14 * 60, 'and the eliminations are still placed from the end');
  assert.equal(told.timelineOf('v1').corrections, 1);
});

test('more missing than every pause holds: the start of the archive is gone', () => {
  const times = day().map(m => Date.parse(m.started));
  const gaps = placeDropouts(Date.parse(at('09:25:00')), Date.parse(at('16:05:00')), 3 * 3600, times);
  const placed = gaps.reduce((sum, gap) => sum + gap.seconds, 0);
  assert.ok(placed >= 400 * 60 - 3 * 3600 - 150 && placed <= 400 * 60 - 3 * 3600, `all but the post-show room is placed among the matches (${placed})`);
  assert.ok(gaps.some(gap => gap.at === times[0]), 'the remainder sits before the first match');
});

test('a correction applies from its match on, and a far-off one is ignored', () => {
  const divisions = event([match(1, '09:30:00', '09:30:00'), match(2, '10:00:00', '10:00:00'), match(3, '14:00:00', '14:00:00')]);
  const base = { videoId: 'v1', startTime: at('09:00:00') };
  // Someone found Q2 two minutes earlier in the video than the clock says.
  const corrected = jumper(divisions, [{ ...base, anchors: [{ matchId: 2, seconds: 3600 - 120 }] }]);
  assert.equal(corrected.jumpFor(1).seconds, 1800, 'the first half is left alone');
  assert.equal(corrected.jumpFor(2).seconds, 3480);
  assert.equal(corrected.jumpFor(3).seconds, 18000 - 120);
  const mistaken = jumper(divisions, [{ ...base, anchors: [{ matchId: 2, seconds: 0 }] }]);
  assert.equal(mistaken.jumpFor(2).seconds, 3600, 'an hour off YouTube\'s timing: a mistake');
  const forty = jumper(divisions, [{ ...base, anchors: [{ matchId: 2, seconds: 3600 - 40 * 60 }] }]);
  assert.equal(forty.jumpFor(2).seconds, 3600, '40 minutes off: also a mistake');
});

test('an upload with no YouTube times is timed from corrections alone', () => {
  const divisions = event([match(1, '09:30:00', '09:30:00'), match(2, '09:40:00', '09:40:00')]);
  const j = jumper(divisions, [{ videoId: 'v1', anchors: [{ matchId: 2, seconds: 700 }] }]);
  assert.equal(j.jumpFor(1).seconds, 100);
  assert.equal(j.jumpFor(2).seconds, 700);
  assert.equal(jumper(divisions, [{ videoId: 'v2' }]).jumpFor(1), null, 'untimed');
  assert.equal(j.jumpFor(1) && jumper(divisions, [{ videoId: 'v1', anchors: [{ matchId: 2, seconds: 700 }] }], { v1: -10 }).jumpFor(1).seconds, 90, 'the viewer nudge');
});

test('streams per division (by title) and per day are told apart', () => {
  const divisions = [
    { id: 1, name: 'Science', matches: [match(1, '09:30:00', '09:30:00')] },
    { id: 2, name: 'Technology', matches: [match(2, '09:31:00', '09:31:00')] },
  ];
  const j = jumper(divisions, [{ videoId: 'sci', title: 'Worlds - Science Division', startTime: at('09:00:00') }, { videoId: 'tec', title: 'Worlds - Technology Division', startTime: at('09:10:00') }]);
  assert.equal(j.jumpFor(1).videoId, 'sci');
  assert.equal(j.jumpFor(2).videoId, 'tec');
  const days = event([match(1, '09:30:00', '09:30:00'), match(2, '15:00:00', '15:00:00')]);
  const d = jumper(days, [{ videoId: 'am', startTime: at('09:00:00'), endTime: at('12:00:00'), duration: 3 * 3600 }, { videoId: 'pm', startTime: at('13:00:00') }]);
  assert.equal(d.jumpFor(1).videoId, 'am');
  assert.equal(d.jumpFor(2).videoId, 'pm');
});

test('video positions read as clock times', () => {
  assert.equal(videoTime(3725), '1:02:05');
  assert.equal(videoTime(65), '1:05');
});

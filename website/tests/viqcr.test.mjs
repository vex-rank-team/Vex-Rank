import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createIQReplay, processIQEvent, rankIQTeams, teamRating, publicScore, fitIQNormalization, consistencyWindow,
  consistencySnapshot, consistencySignal, carryIQSeason, skillsPerformance, summarizeIQSkills, bestIQSkillsSession,
  iqStationTeamIds, serializeIQReplay, restoreIQReplay, VIQCR_VERSION,
} from '../lib/viqcr.mjs';
import { normalizeIQSession, sharedStationScore, IQImportError } from '../lib/viqcr-import.mjs';
import { packIQState, unpackIQState, iqRankingRows } from '../lib/viqcr-publish.mjs';

// The specification's illustrative profile - a fixture, not calibrated Level Up constants.
const normalization = {
  program: 'VIQRC', seasonId: '203', version: 'test-profile', rulesVersion: 'Level Up v2.1',
  trainedThrough: '2026-09-01T00:00:00Z',
  teamwork: { center: 100, scale: 25 }, driving: { center: 50, scale: 20 }, coding: { center: 40, scale: 20 },
};
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

let eventCounter = 0;
function event({ end = '2026-10-01T18:00:00Z', teamwork = [], skills = [], id = `e${++eventCounter}` } = {}) {
  return { id, sessionId: 'main', name: id, program: 'VIQRC', seasonId: '203', format: 'tournament', start: end, end, completed: true,
    coverage: { teamwork: true, skills: true }, teams: [], teamwork, skills };
}
const match = (id, teamIds, score, extra = {}) => ({ id, teamIds, stage: 'qualification', status: 'scored', score, noShowIds: [], dqIds: [], reliability: 1, ...extra });
const run = (events, replay = createIQReplay('203')) => events.reduce((state, e) => processIQEvent({ replay: state, event: e, normalization }).replay, replay);

/* Cooperative teamwork estimate */

test('equal priors split an above-baseline shared score equally', () => {
  const replay = run([event({ teamwork: [match('m1', ['a', 'b'], 150)] })]);
  close(replay.teams.get('a').components.teamwork.m, replay.teams.get('b').components.teamwork.m);
  assert.ok(replay.teams.get('a').components.teamwork.m > 0);
});

test('a known strong partner explains more of the shared score', () => {
  // b becomes well known and strong first; then a scores the same total with b.
  const strong = run([event({ end: '2026-09-10T18:00:00Z', teamwork: ['c', 'd', 'e', 'f', 'g', 'h'].map((p, i) => match(`s${i}`, ['b', p], 140)) })]);
  const after = run([event({ teamwork: [match('x', ['a', 'b'], 140), match('y', ['n1', 'n2'], 140)] })], strong);
  const helped = after.teams.get('a').components.teamwork.m;
  const unhelped = after.teams.get('n1').components.teamwork.m;
  assert.ok(helped < unhelped, `${helped} should be below ${unhelped}`);
});

test('match order does not change the posterior', () => {
  const rows = [match('m1', ['a', 'b'], 150), match('m2', ['a', 'c'], 80), match('m3', ['b', 'c'], 120), match('m4', ['a', 'd'], 170)];
  const forward = run([event({ id: 'same', teamwork: rows })]);
  const backward = run([event({ id: 'same', teamwork: [...rows].reverse() })]);
  for (const id of ['a', 'b', 'c', 'd']) close(forward.teams.get(id).components.teamwork.m, backward.teams.get(id).components.teamwork.m, 1e-9);
});

test('a repeated pair saturates at two units of information', () => {
  const twice = run([event({ teamwork: [match('1', ['a', 'b'], 150), match('2', ['a', 'b'], 150)] })]);
  const tenTimes = run([event({ teamwork: Array.from({ length: 10 }, (_, i) => match(String(i), ['a', 'b'], 150)) })]);
  close(twice.teams.get('a').components.teamwork.m, tenTimes.teams.get('a').components.teamwork.m, 1e-9);
});

test('finals add at most 0.35 units per team and session', () => {
  const finals = n => run([event({ teamwork: Array.from({ length: n }, (_, i) => match(`f${i}`, ['a', 'b'], 140, { stage: 'finals' })) })]);
  const one = finals(1).teams.get('a').components.teamwork, many = finals(5).teams.get('a').components.teamwork;
  close(one.m, many.m, 1e-9);
  const qualification = run([event({ teamwork: [match('q', ['a', 'b'], 140)] })]).teams.get('a').components.teamwork.m;
  assert.ok(one.m < qualification);
});

test('a scheduled solo finals appearance counts; a qualification without its partner does not', () => {
  const solo = run([event({ teamwork: [match('f', ['a'], 120, { stage: 'finals' })] })]);
  assert.ok(solo.teams.get('a').components.teamwork.m > 0);
  const result = processIQEvent({ replay: createIQReplay('203'), event: event({ teamwork: [match('q', ['a'], 120)] }), normalization });
  assert.equal(result.replay.teams.has('a'), false);
  assert.deepEqual(result.ledger.excluded, [{ id: 'q', reason: 'missing-partner' }]);
});

test('no-shows, disqualifications, practice and unplayed results are excluded and audited', () => {
  const { replay, ledger } = processIQEvent({ replay: createIQReplay('203'), normalization, event: event({ teamwork: [
    match('ns', ['a', 'b'], 0, { noShowIds: ['b'] }), match('dq', ['a', 'b'], 90, { dqIds: ['a'] }),
    match('p', ['a', 'b'], 90, { stage: 'practice' }), match('u', ['a', 'b'], 0, { status: 'unplayed' }),
  ] }) });
  assert.equal(replay.teams.size, 0);
  assert.deepEqual(ledger.excluded.map(row => row.reason), ['no-show', 'disqualification', 'practice', 'unplayed']);
});

test('a session moves no component more than 0.6, so the blend moves at most 120 points', () => {
  const huge = run([event({ teamwork: Array.from({ length: 6 }, (_, i) => match(String(i), ['a', `p${i}`], 2000)),
    skills: [{ id: 'd', teamId: 'a', mode: 'driving', status: 'scored', score: 999, detail: 'attempts' },
      { id: 'c', teamId: 'a', mode: 'coding', status: 'scored', score: 999, detail: 'attempts' }] })]);
  const entry = huge.teams.get('a').history[0];
  for (const change of Object.values(entry.changes)) assert.ok(Math.abs(change) <= 0.6 + 1e-12);
  assert.ok(Math.abs(entry.internalChange) <= 120 + 1e-9);
});

test('teamwork variance keeps a 0.5 floor until three distinct partners', () => {
  const two = run([event({ teamwork: Array.from({ length: 6 }, (_, i) => match(String(i), ['a', i % 2 ? 'b' : 'c'], 120)) })]);
  assert.ok(two.teams.get('a').components.teamwork.v >= 0.5);
});

/* Partner-adjusted consistency */

const rowsOf = contributions => contributions.map((contribution, i) => ({
  key: String(i), time: '2026-10-01T00:00:00Z', partnerId: `p${i % 3}`, partnerMean: 0, partnerVariance: 0, contribution, weight: 1,
}));

test('the specification table: A, S and supported ability', () => {
  for (const [values, A, S, supported] of [[[1, 1, 1, 1, 1, 1], 1, 0, 1], [[0, 2, 0, 2, 0, 2], 1, 1, 0.5], [[0, 0, 0, 0, 0, 0], 0, 0, 0], [[-1, -1, -1, -1, -1, -1], -1, 0, -1]]) {
    const window = consistencyWindow(rowsOf(values), '2026-10-01T00:00:00Z');
    close(window.A, A); close(window.S, S);
    close(consistencySnapshot(window).supported, supported);
  }
});

test('stable zero output is neutral, not rewarded for being uniform', () => {
  const window = consistencyWindow(rowsOf([0, 0, 0, 0, 0, 0]), '2026-10-01T00:00:00Z');
  close(consistencySnapshot(window).mean, 0);
});

test('consistency needs six rows, three partners and mass two', () => {
  assert.equal(consistencyWindow(rowsOf([1, 1, 1, 1, 1]), '2026-10-01T00:00:00Z').eligible, false);
  const twoPartners = rowsOf([1, 1, 1, 1, 1, 1]).map((row, i) => ({ ...row, partnerId: `p${i % 2}` }));
  assert.equal(consistencyWindow(twoPartners, '2026-10-01T00:00:00Z').eligible, false);
  const uncertainPartners = rowsOf([1, 1, 1, 1, 1, 1]).map(row => ({ ...row, partnerVariance: 3 }));
  assert.equal(consistencyWindow(uncertainPartners, '2026-10-01T00:00:00Z').eligible, false);
});

test('old rows expire: a window can stop being eligible as time passes', () => {
  assert.equal(consistencyWindow(rowsOf([1, 1, 1, 1, 1, 1]), '2026-10-01T00:00:00Z').eligible, true);
  assert.equal(consistencyWindow(rowsOf([1, 1, 1, 1, 1, 1]), '2027-02-01T00:00:00Z').eligible, false);
});

test('signals follow the listed order', () => {
  const base = { eligible: true, partnerStrength: 0 };
  assert.equal(consistencySignal({ ...base, eligible: false }), 'insufficient-evidence');
  assert.equal(consistencySignal({ ...base, A: 1, S: 0.2 }), 'repeatable-positive');
  assert.equal(consistencySignal({ ...base, A: 0.1, S: 0.9, partnerStrength: 0.5 }), 'partner-explained-upside');
  assert.equal(consistencySignal({ ...base, A: 0.1, S: 0.9 }), 'variable');
  assert.equal(consistencySignal({ ...base, A: 0.1, S: 0.3 }), 'mixed');
});

test('a full schedule with varied partners makes consistency eligible and moves it', () => {
  const replay = run([event({ teamwork: Array.from({ length: 8 }, (_, i) => match(String(i), ['a', `p${i % 4}`], 160)) })]);
  const team = replay.teams.get('a');
  assert.ok(team.components.consistency.m > 0);
  assert.equal(teamRating(team, '2026-10-01T18:00:00Z').consistency.eligible, true);
});

/* Driving and autonomous coding skills */

test('skills reward peak and repeatability; best-only rows count at half reliability', () => {
  const attempts = skillsPerformance([60, 40, 50].map((score, i) => ({ id: String(i), teamId: 'a', mode: 'driving', status: 'scored', score, detail: 'attempts' })));
  close(attempts.performance, 0.7 * 60 + 0.3 * 50); assert.equal(attempts.reliability, 1);
  const bestOnly = skillsPerformance([{ id: 'b', teamId: 'a', mode: 'driving', status: 'scored', score: 60, detail: 'best-only', attempts: 3 }]);
  assert.equal(bestOnly.performance, 60); assert.equal(bestOnly.reliability, 0.5);
  assert.throws(() => skillsPerformance([{ id: '1', teamId: 'a', mode: 'coding', status: 'scored', score: 1, detail: 'best-only' }, { id: '2', teamId: 'a', mode: 'coding', status: 'scored', score: 1, detail: 'attempts' }]));
});

test('a scored zero is an attempt; a missing mode leaves its prior alone', () => {
  const replay = run([event({ skills: [{ id: 'z', teamId: 'a', mode: 'coding', status: 'scored', score: 0, detail: 'attempts' }] })]);
  const team = replay.teams.get('a');
  assert.ok(team.components.coding.m < 0);
  assert.deepEqual(team.components.driving, { m: 0, v: 1 });
  assert.deepEqual(team.components.teamwork, { m: 0, v: 1 });
});

test('official-style skills totals never mix sessions', () => {
  assert.deepEqual(summarizeIQSkills([{ mode: 'driving', status: 'scored', score: 40 }]), { driving: 40, coding: null, total: 40 });
  const best = bestIQSkillsSession([
    { key: 's1', rows: [{ mode: 'driving', status: 'scored', score: 90 }, { mode: 'coding', status: 'scored', score: 10 }] },
    { key: 's2', rows: [{ mode: 'driving', status: 'scored', score: 50 }, { mode: 'coding', status: 'scored', score: 50 }] },
  ]);
  assert.deepEqual(best, { sessionKey: 's1', total: 100, unresolvedTie: true });
});

/* Public score, confidence, inactivity and resets */

test('a team with no evidence scores 312.5', () => {
  const fresh = { teamwork: { m: 0, v: 1 }, driving: { m: 0, v: 1 }, coding: { m: 0, v: 1 }, consistency: { m: 0, v: 1 } };
  const score = publicScore(fresh);
  close(score.mu, 1500); close(score.rd, 200); close(score.viqcr, 312.5);
});

test('inactivity widens variance 0.0025 a day up to 1.5, and reading changes nothing', () => {
  const replay = run([event({ teamwork: [match('m', ['a', 'b'], 150)] })]);
  const team = replay.teams.get('a');
  const before = JSON.stringify(team);
  const later = teamRating(team, '2026-11-10T18:00:00Z');
  close(later.components.teamwork.sd ** 2, Math.min(1.5, team.components.teamwork.v + 0.0025 * 40));
  assert.equal(JSON.stringify(team), before);
  assert.ok(later.viqcr < teamRating(team, '2026-10-01T18:00:00Z').viqcr);
});

test('provisional until two sessions, three partners, both skills modes and eligible consistency', () => {
  const replay = run([event({ teamwork: [match('m', ['a', 'b'], 150)] })]);
  const row = teamRating(replay.teams.get('a'), '2026-10-01T18:00:00Z');
  assert.equal(row.provisional, true);
  assert.deepEqual(row.provisionalReasons, ['needs two teamwork sessions', 'needs three distinct partners', 'no driving skills recorded', 'no coding skills recorded', 'consistency evidence insufficient']);
  assert.deepEqual(rankIQTeams(replay, { asOf: '2026-10-01T18:00:00Z' }), []);
  assert.equal(rankIQTeams(replay, { asOf: '2026-10-01T18:00:00Z', includeProvisional: true }).length, 2);
});

test('a confirmed team needs nothing else', () => {
  const sessions = ['2026-10-01T18:00:00Z', '2026-10-08T18:00:00Z'].map(end => event({ end,
    teamwork: Array.from({ length: 6 }, (_, i) => match(String(i), ['a', `p${i % 4}`], 150)),
    skills: [{ id: 'd', teamId: 'a', mode: 'driving', status: 'scored', score: 60, detail: 'best-only' }, { id: 'c', teamId: 'a', mode: 'coding', status: 'scored', score: 50, detail: 'best-only' }] }));
  const replay = run(sessions);
  const ranked = rankIQTeams(replay, { asOf: '2026-10-08T18:00:00Z' });
  assert.deepEqual(ranked.map(row => row.teamId), ['a']);
});

test('between games only a weak prior carries, and only for a confirmed identity', () => {
  const team = { id: 'a', number: '1A', grade: 'Middle School', components: { teamwork: { m: 3, v: 0.2 }, driving: { m: -1, v: 0.2 }, coding: { m: 1, v: 0.2 }, consistency: { m: 1, v: 0.2 } } };
  const carried = carryIQSeason(team, { sameIdentity: true });
  assert.deepEqual(carried.components, { teamwork: { m: 0.5, v: 1 }, driving: { m: -0.25, v: 1 }, coding: { m: 0.25, v: 1 }, consistency: { m: 0, v: 1 } });
  assert.deepEqual(carryIQSeason(team, { sameIdentity: false }).components.teamwork, { m: 0, v: 1 });
});

/* Import and replay contract */

test('processing leaves the input replay untouched and survives serialization', () => {
  const start = createIQReplay('203');
  const { replay } = processIQEvent({ replay: start, event: event({ teamwork: [match('m', ['a', 'b'], 150)] }), normalization });
  assert.equal(start.teams.size, 0);
  assert.deepEqual(restoreIQReplay(JSON.parse(JSON.stringify(serializeIQReplay(replay)))).teams.get('a'), replay.teams.get('a'));
});

test('invalid, duplicate, out-of-order and calibration-window input throws before any change', () => {
  const once = run([event({ id: 'dup', end: '2026-10-05T00:00:00Z', teamwork: [match('m', ['a', 'b'], 150)] })]);
  assert.throws(() => processIQEvent({ replay: once, event: event({ id: 'dup', end: '2026-10-05T00:00:00Z' }), normalization }), /already processed/);
  assert.throws(() => processIQEvent({ replay: once, event: event({ end: '2026-10-01T00:00:00Z' }), normalization }), /out of order/);
  assert.throws(() => processIQEvent({ replay: once, event: event({ end: '2026-10-09T00:00:00Z' }), normalization: { ...normalization, teamwork: { center: 101, scale: 25 } } }), /normalization changed/);
  assert.throws(() => processIQEvent({ replay: createIQReplay('203'), event: event({ end: '2026-08-01T00:00:00Z' }), normalization }), /calibration window/);
  assert.throws(() => processIQEvent({ replay: createIQReplay('203'), event: { ...event(), program: 'V5RC' }, normalization }), /not a VIQRC/);
  assert.throws(() => processIQEvent({ replay: createIQReplay('203'), event: event({ teamwork: [match('m', ['a', 'b'], -4)] }), normalization }), /invalid score/);
  assert.throws(() => processIQEvent({ replay: createIQReplay('203'), event: event({ teamwork: [match('m', ['a', 'b'], 9), match('m', ['a', 'b'], 9)] }), normalization }), /duplicate/);
  assert.equal(once.processed.length, 1);
});

test('the profile fits median and 1.4826 x MAD, with a positive floor', () => {
  const sessions = [event({ end: '2026-08-01T00:00:00Z', teamwork: [match('1', ['a', 'b'], 80), match('2', ['c', 'd'], 120)],
    skills: [{ id: 'x', teamId: 'a', mode: 'driving', status: 'scored', score: 30, detail: 'best-only' }, { id: 'y', teamId: 'b', mode: 'driving', status: 'scored', score: 50, detail: 'best-only' },
      { id: 'z', teamId: 'a', mode: 'coding', status: 'scored', score: 0, detail: 'best-only' }] })];
  const profile = fitIQNormalization({ seasonId: '203', sessions, trainedThrough: '2026-09-01T00:00:00Z' });
  assert.deepEqual(profile.teamwork, { center: 100, scale: 1.4826 * 20 });
  assert.deepEqual(profile.driving, { center: 40, scale: 1.4826 * 10 });
  assert.deepEqual(profile.coding, { center: 0, scale: 5 });
});

test('stations: two one-team partners sharing one score, or the import fails', () => {
  const station = (id, score) => ({ score, teams: [{ team: { id } }] });
  assert.deepEqual(iqStationTeamIds({ id: 1, alliances: [station(5, 9), station(6, 9)] }), ['5', '6']);
  assert.deepEqual(sharedStationScore({ id: 1, alliances: [station(5, 9), station(6, 9)] }), { score: 9, zeroed: [] });
  assert.deepEqual(sharedStationScore({ id: 1, alliances: [station(5, 0), station(6, 144)] }), { score: 144, zeroed: ['5'] });
  assert.throws(() => sharedStationScore({ id: 1, alliances: [station(5, 9), station(6, 8)] }), IQImportError);
  assert.throws(() => iqStationTeamIds({ id: 1, alliances: [station(5, 9), station(5, 9)] }));
});

test('a match listing no teams is skipped and noted, not fatal to the event', () => {
  const station = (id, score) => ({ score, teams: id ? [{ team: { id } }] : [] });
  const session = normalizeIQSession({ event: { id: 9, name: 'x', start: '2026-10-01', end: '2026-10-01T18:00:00Z' }, seasonId: 203, skills: [], divisions: [{ id: 1, matches: [
    { id: 1, round: 2, instance: 1, matchnum: 1, started: '2026-10-01T10:00:00Z', alliances: [station(5, 90), station(6, 90)] },
    { id: 2, round: 2, instance: 1, matchnum: 2, started: '2026-10-01T10:05:00Z', alliances: [station(null, 96), station(null, 96)] },
  ] }] });
  assert.equal(session.coverage.teamwork, true);
  assert.equal(session.teamwork.length, 1);
  assert.deepEqual(session.official.skipped, [{ match: 2, reason: 'no teams listed' }]);
});

/* Real data */

test('a real Level Up event imports and replays: every team that played is rated once', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/viqrc/event-65767-ms-qualification.json', import.meta.url), 'utf8'));
  const session = normalizeIQSession({ event: fixture.event, seasonId: 203, divisions: fixture.divisions, skills: fixture.skills });
  assert.equal(session.coverage.teamwork, true);
  assert.equal(session.teamwork.filter(row => row.stage === 'qualification' && row.status === 'scored').length, 112);
  // TeamWork #58: 5216A's station shows 0 beside its partner's 144.
  assert.deepEqual(session.teamwork.filter(row => row.zeroedIds.length).map(row => row.zeroedIds), [['185882']]);
  const { replay } = processIQEvent({ replay: createIQReplay('203'), event: session, normalization: { ...normalization, teamwork: { center: 200, scale: 60 }, driving: { center: 100, scale: 40 }, coding: { center: 80, scale: 40 } } });
  const played = new Set(session.teamwork.flatMap(row => row.teamIds));
  for (const id of played) assert.ok(replay.teams.has(id));
  const ranked = rankIQTeams(replay, { asOf: session.end, includeProvisional: true });
  assert.equal(new Set(ranked.map(row => row.teamId)).size, ranked.length);
  // Teamwork is the largest component, so model order should follow each
  // team's average shared score (rank correlation), and the leader should be
  // the team whose partners and it scored most: 69666V (170585), avg 298.
  const average = id => { const rows = session.teamwork.filter(row => row.status === 'scored' && !row.zeroedIds.length && row.teamIds.includes(id)); return rows.reduce((sum, row) => sum + row.score, 0) / rows.length; };
  const order = ranked.filter(row => played.has(row.teamId));
  const byAverage = [...order].sort((a, b) => average(b.teamId) - average(a.teamId));
  const position = new Map(byAverage.map((row, i) => [row.teamId, i]));
  const n = order.length;
  const spearman = 1 - 6 * order.reduce((sum, row, i) => sum + (i - position.get(row.teamId)) ** 2, 0) / (n * (n * n - 1));
  assert.ok(spearman > 0.8, `rank correlation ${spearman}`);
  assert.equal(ranked[0].teamId, '170585');
  assert.equal(replay.modelVersion, VIQCR_VERSION);
});

test('a packed snapshot continued in place equals one full replay', () => {
  // Ten weekly sessions, rotating partners, both skills modes.
  const sessions = Array.from({ length: 10 }, (_, week) => event({
    id: `w${week}`, end: new Date(Date.parse('2026-09-05T18:00:00Z') + week * 7 * 86400000).toISOString(),
    teamwork: Array.from({ length: 12 }, (_, i) => match(`m${i}`, [`t${i % 6}`, `t${(i + week + 1) % 6 === i % 6 ? (i + 2) % 6 : (i + week + 1) % 6}`], 90 + ((i * 37 + week * 11) % 120))),
    skills: ['t0', 't1', 't2', 't3', 't4', 't5'].flatMap((id, i) => [
      { id: `d${id}`, teamId: id, mode: 'driving', status: 'scored', score: 30 + ((i * 13 + week * 7) % 60), detail: 'best-only' },
      { id: `c${id}`, teamId: id, mode: 'coding', status: 'scored', score: 20 + ((i * 17 + week * 5) % 60), detail: 'best-only' }]),
  }));
  const asOf = '2026-11-20T00:00:00Z';
  const full = run(sessions);
  // One parsed snapshot, restored twice, as the Worker does on each refresh.
  const parsed = JSON.parse(JSON.stringify(packIQState(run(sessions.slice(0, 6)))));
  const continueFrom = () => sessions.slice(6).reduce((replay, session) => processIQEvent({ replay, event: session, normalization, mutate: true }).replay, unpackIQState(parsed));
  continueFrom();
  const continued = continueFrom();
  const shape = replay => iqRankingRows(replay, { asOf, identities: new Map(), seasonId: 203, season: { label: 'test' } }).rows
    .map(row => [row.id, row.viqcr, row.provisional, row.signal, row.change, row.components.consistency.points]);
  assert.deepEqual(shape(continued), shape(full));
});

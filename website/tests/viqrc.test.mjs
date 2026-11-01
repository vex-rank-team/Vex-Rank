import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { teamworkPair, teamworkPairs, iqTeamMatches, iqDivisionStandings, iqStanding, iqScoreSeries, iqSkillBests, iqStrengthProfile, iqGradeFromContext, IQ_STRENGTH_AXES } from '../lib/viqrc.mjs';
import { teamMatches } from '../lib/team-event.mjs';
import { PROGRAMS, programCode, programOf, seasonFor, officialEventUrl, isProgram } from '../lib/programs.mjs';
import { classifyEvent } from '../lib/event-classification.ts';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/viqrc/${name}`, import.meta.url), 'utf8'));
const singleDivision = fixture('event-65767-ms-qualification.json');
const twoDivisions = fixture('event-61958-es-two-divisions.json');

test('a teamwork match is one pair with one shared score', () => {
  const match = singleDivision.divisions[0].matches[0];
  // The API's shape: two one-team "alliances", red and blue, equal scores.
  assert.equal(match.alliances.length, 2);
  assert.equal(match.alliances[0].score, match.alliances[1].score);
  const pair = teamworkPair(match);
  assert.deepEqual(pair.teams.sort(), ['50380B', '86995D']);
  assert.equal(pair.score, 314);
  assert.equal(pair.played, true);
  assert.equal(pair.qualification, true);
  for (const field of ['colour', 'outcome', 'opponents', 'scoreAgainst', 'winner']) assert.ok(!(field in pair), `${field} must not exist on an IQ match`);
});

test('the V5 reader would have called that match a tie between opponents', () => {
  // Kept as a regression guard: this is the misreading the IQ module exists to avoid.
  const v5 = teamMatches(singleDivision, '86995D')[0];
  assert.equal(v5.outcome, 'tied');
  assert.deepEqual(v5.opponents, ['50380B']);
  const iq = iqTeamMatches(singleDivision, '86995D')[0];
  assert.deepEqual(iq.partners, ['50380B']);
  assert.equal(iq.score, 314);
});

test('every match at the event is read as a pair, in play order', () => {
  const pairs = teamworkPairs(singleDivision);
  assert.equal(pairs.length, 112);
  assert.ok(pairs.every(pair => pair.teams.length >= 1 && pair.teams.length <= 2));
  const mine = iqTeamMatches(singleDivision, '86995D');
  assert.ok(mine.length > 0);
  const times = mine.map(match => Date.parse(match.scheduled));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('an unplayed fixture has no score', () => {
  const unplayed = { id: 1, round: 2, name: 'TeamWork #9', alliances: [{ color: 'red', score: 0, teams: [{ team: { name: '1A' } }] }, { color: 'blue', score: 0, teams: [{ team: { name: '2B' } }] }] };
  const pair = teamworkPair(unplayed);
  assert.equal(pair.played, false);
  assert.equal(pair.score, null);
});

test('standings keep the event rank and add average and high score', () => {
  const rows = iqDivisionStandings(singleDivision.divisions[0]);
  assert.equal(rows.length, 28);
  const ranks = rows.map(row => row.rank);
  assert.deepEqual(ranks, ranks.toSorted((a, b) => a - b));
  for (const row of rows) {
    assert.ok(row.highScore == null || row.highScore >= (row.average ?? 0), `${row.number}: high below average`);
    assert.equal(row.averageFromEvent, false, 'this fixture predates average pass-through');
  }
  const own = iqStanding(singleDivision, '86995D');
  assert.equal(own.rank, 4);
  assert.equal(own.highScore, 330);
  assert.ok(own.average > 0 && own.average <= 330);
  assert.equal(own.division, 'Division 1');
});

test('an average served by the event wins over the computed one', () => {
  const division = { name: 'D', rankings: [{ rank: 1, team: { name: '1A' }, highScore: 200, averagePoints: 150.5 }], matches: [] };
  const [row] = iqDivisionStandings(division);
  assert.equal(row.average, 150.5);
  assert.equal(row.averageFromEvent, true);
});

test('two divisions plus an empty Final division are all handled', () => {
  assert.deepEqual(twoDivisions.divisions.map(d => d.name), ['Division A', 'Division B', 'Final']);
  const final = twoDivisions.divisions.find(d => d.name === 'Final');
  assert.deepEqual(iqDivisionStandings(final), []);
  const someone = twoDivisions.divisions[1].rankings[0].team.name;
  assert.equal(iqStanding(twoDivisions, someone).division, 'Division B');
});

test('score series has one point per played match', () => {
  const series = iqScoreSeries(iqTeamMatches(singleDivision, '86995D'));
  assert.ok(series.length > 0);
  assert.deepEqual(series.map(point => point.match), series.map((_, index) => index + 1));
  assert.ok(series.every(point => point.score > 0 && point.partners.length === 1));
});

test('skills bests split driver and autonomous coding', () => {
  const { driver, coding } = iqSkillBests(singleDivision.skills);
  assert.equal(driver.size, 20);
  assert.equal(coding.size, 20);
  for (const [, score] of [...driver, ...coding]) assert.ok(score >= 0);
});

test('the strength profile uses measured axes only', () => {
  const profile = iqStrengthProfile(singleDivision, '86995D');
  assert.deepEqual(profile.axes.map(axis => axis.key), IQ_STRENGTH_AXES.map(axis => axis.key));
  assert.ok(!profile.axes.some(axis => ['opr', 'dpr', 'ccwm', 'awp', 'winRate'].includes(axis.key)));
  assert.equal(profile.provisional, false);
  for (const axis of profile.axes) {
    if (axis.score == null) continue;
    assert.ok(axis.score >= 0 && axis.score <= 1);
    assert.ok(axis.place >= 1 && axis.place <= axis.of);
  }
  assert.equal(profile.axes.find(axis => axis.key === 'high').display, '330');
});

test('grades are read from IQ event and division names', () => {
  assert.equal(iqGradeFromContext('2025-2026赛季VEX机器人亚洲公开赛华北大区赛（一）VIQRC_ES: Elementary School'), 'Elementary School');
  assert.equal(iqGradeFromContext('VEX IQ Robotics Competition Middle School Division 1'), 'Middle School');
  assert.equal(iqGradeFromContext('Elementary and Middle School Open'), null);
  assert.equal(iqGradeFromContext('Division 1'), null);
});

test('the classifier recognises the elementary grade without moving any V5 event', () => {
  assert.equal(classifyEvent(twoDivisions.event.name, null).grade, 'Elementary School');
  assert.equal(classifyEvent(singleDivision.event.name, null).grade, 'Middle School');
  assert.equal(classifyEvent('Elementary and Middle School IQ Open', null).grade, 'Mixed');
  for (const [name, grade] of [['Kalahari Classic High School', 'High School'], ['Riverbots Middle School Signature', 'Middle School'], ['Pacific Open', 'Mixed']]) {
    assert.equal(classifyEvent(name, null).grade, grade);
  }
});

test('program table: ids, seasons, grades and links', () => {
  assert.equal(PROGRAMS.VIQRC.id, singleDivision.event.program.id);
  assert.equal(programOf(singleDivision.event), 'VIQRC');
  assert.equal(programOf({ program: { id: 1 } }), 'V5RC');
  assert.equal(PROGRAMS.VIQRC.seasons[singleDivision.event.season.id].label, '2026–27 Level Up');
  assert.deepEqual(Object.keys(PROGRAMS.VIQRC.seasons).sort(), ['189', '196', '203']);
  assert.deepEqual(PROGRAMS.VIQRC.grades, ['Middle School', 'Elementary School']);
  assert.equal(programCode('VIQRC'), 'VIQRC');
  for (const other of [undefined, null, '', 'viqrc', 'VEXU', 'V5RC']) assert.equal(programCode(other), 'V5RC');
  assert.equal(isProgram('VIQRC') && isProgram('V5RC') && !isProgram('IQ'), true);
  assert.equal(seasonFor('VIQRC', '196'), '196');
  assert.equal(seasonFor('VIQRC', '204'), '203', 'a V5 season id is not an IQ season');
  assert.equal(seasonFor('V5RC', undefined), '204');
  assert.match(officialEventUrl('VIQRC', 'VE-IQ-26-65767'), /vex-iq-robotics-competition\/VE-IQ-26-65767\.html$/);
  assert.match(officialEventUrl('V5RC', 'RE-V5RC-26-4604'), /\/vex-robotics-competition\/RE-V5RC-26-4604\.html$/);
});

test('V5 program values are unchanged from the routes they replaced', () => {
  assert.equal(PROGRAMS.V5RC.id, 1);
  assert.equal(PROGRAMS.V5RC.currentSeason, 204);
  assert.deepEqual(PROGRAMS.V5RC.skillsSeasons, ['197', '204']);
  assert.deepEqual(PROGRAMS.V5RC.skillsGrades, ['High School', 'Middle School', 'Elementary School']);
  assert.equal(PROGRAMS.V5RC.seasons[197].label, '2025–26 Push Back');
});

test('IQ skills fixtures carry the grades and scores the skills route reads', () => {
  for (const [name, grade] of [['skills-203-middle-school-top40.json', 'Middle School'], ['skills-203-elementary-top40.json', 'Elementary']]) {
    const rows = fixture(name);
    assert.ok(rows.length === 40);
    assert.ok(rows.every(row => row.team.program === 'VIQRC' && row.team.gradeLevel === grade));
    assert.ok(rows.every(row => row.scores.score === row.scores.programming + row.scores.driver));
  }
});

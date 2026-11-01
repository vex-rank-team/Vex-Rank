// Builds the VEX IQ ratings (VIQCR 1.1, lib/viqcr.mjs) for one season and
// publishes them to archive-assets/, where the Worker serves them.
//
//   ROBOT_EVENTS_API_TOKEN=... node scripts/build-iq-ratings.mjs [--season 203] [--refresh]
//
// The importer step of the specification: fetch every completed event's
// divisions, matches and skills, normalize them (lib/viqcr-import.mjs), fit the
// season's calibration window, then replay everything after it in order.
//
// A season is ~500 official requests and the token allows 100 a minute, which
// is why this runs here and not inside a Worker request. Finished events are
// cached in work/, so a later run fetches only what is new; --refresh ignores
// the cache (for corrected upstream results, which need a full replay anyway).
import { readFile, writeFile } from 'node:fs/promises';
import { officialPages, BudgetExhausted } from './official-pages.mjs';
import { recordSnapshot } from './snapshots.mjs';
import { PROGRAMS } from '../lib/programs.mjs';
import { normalizeIQSession } from '../lib/viqcr-import.mjs';
import { createIQReplay, processIQEvent, fitIQNormalization, VIQCR_VERSION } from '../lib/viqcr.mjs';
import { iqRankingRows, iqHistoryPoints, packIQState } from '../lib/viqcr-publish.mjs';
import { iqRankingsPath, iqHistoryPath, iqHistoryShard, iqStatePath, IQ_HISTORY_SHARDS, CALIBRATION } from '../lib/vcr-iq.mjs';

const token = process.env.ROBOT_EVENTS_API_TOKEN;
if (!token) throw new Error('ROBOT_EVENTS_API_TOKEN is required');
const argument = name => { const at = process.argv.indexOf(`--${name}`); return at > 0 ? process.argv[at + 1] : null; };
const seasonId = String(argument('season') ?? PROGRAMS.VIQRC.currentSeason);
const season = PROGRAMS.VIQRC.seasons[seasonId];
if (!season) throw new Error(`Unknown VEX IQ season ${seasonId}`);
const refresh = process.argv.includes('--refresh');
const { collection, state } = await officialPages({ token, cacheDir: `work/iq-pages-${seasonId}`, refresh });

// Every event of the season, fresh; completed, uncancelled ones become sessions.
// BUILD_UNTIL (ISO date) builds the season as it stood then (see build-v5-rankings.mjs).
const now = Math.min(Date.now(), Date.parse(process.env.BUILD_UNTIL ?? '9999-01-01'));
const events = (await collection(`/events?season%5B%5D=${seasonId}`, { cache: false }))
  .filter(event => event.program?.id === PROGRAMS.VIQRC.id && Date.parse(event.end) <= now && !/cancell?ed/i.test(event.name))
  .sort((a, b) => Date.parse(a.end) - Date.parse(b.end) || JSON.stringify([String(a.id), 'main']).localeCompare(JSON.stringify([String(b.id), 'main'])));

// Verified identities and grades come from the published directory, not names.
const directory = JSON.parse(await readFile('archive-assets/team-directory-viqrc.json', 'utf8'));
if (directory.program !== 'VIQRC') throw new Error('archive-assets/team-directory-viqrc.json is not the VEX IQ directory.');
const identities = new Map(directory.teams.map(team => [String(team.id), team]));
const identity = id => {
  const team = identities.get(id);
  return team ? { number: team.number, grade: team.grade === 'Elementary School' || team.grade === 'Middle School' ? team.grade : 'Unknown', region: team.region || team.country || null } : {};
};

// Only events that ended over a week ago are read from the cache: results keep
// arriving and being corrected for days after an event (see build-v5-rankings.mjs).
const settled = event => now - Date.parse(event.end) > 7 * 86400000;
const sessions = [];
const issues = [];
for (const [index, event] of events.entries()) {
  const divisions = [];
  let teamworkError = null;
  try {
    for (const division of event.divisions ?? []) divisions.push({ ...division, matches: await collection(`/events/${event.id}/divisions/${division.id}/matches`, { cache: settled(event) }) });
  } catch (error) {
    if (error instanceof BudgetExhausted) throw error;
    teamworkError = `matches could not be fetched: ${error.message}`;
  }
  let skills = [], skillsError = null;
  try { skills = await collection(`/events/${event.id}/skills`, { cache: settled(event) }); }
  catch (error) {
    if (error instanceof BudgetExhausted) throw error;
    skillsError = `skills could not be fetched: ${error.message}`;
  }
  const session = normalizeIQSession({ event, seasonId, divisions, skills, teamworkError, identities: new Map() });
  // An API failure is not an empty collection: without its skills list the
  // event's skills are not covered at all.
  if (skillsError) { session.skills = []; session.coverage.skills = false; issues.push({ event: event.id, sku: event.sku, issue: skillsError }); }
  session.teams = session.teams.map(team => ({ ...team, ...identity(team.id) }));
  if (session.official.importIssue) issues.push({ event: event.id, sku: event.sku, issue: session.official.importIssue });
  if (session.teamwork.length || session.skills.length) sessions.push(session);
  if ((index + 1) % 25 === 0) console.log(`fetched ${index + 1}/${events.length} events (${state.requests} requests)`);
}

// Calibration window: the season's first CALIBRATION.days of results, widened
// a week at a time until every mode has a minimum cohort. Those sessions train
// the profile and are not replayed as rated evidence.
const firstEnd = Date.parse(sessions[0].end);
let windowEnd = firstEnd + CALIBRATION.days * 86400000;
const inWindow = end => sessions.filter(session => Date.parse(session.end) <= end);
const cohort = end => fitIQNormalization({ seasonId, sessions: inWindow(end), trainedThrough: new Date(end).toISOString() }).cohort;
while (true) {
  const counts = (() => { try { return cohort(windowEnd); } catch { return null; } })();
  if (counts && counts.teamwork >= CALIBRATION.teamwork && counts.driving >= CALIBRATION.skills && counts.coding >= CALIBRATION.skills) break;
  if (windowEnd > now) throw new Error('Not enough results this season to fit a calibration window yet.');
  windowEnd += 7 * 86400000;
}
const trainedThrough = new Date(windowEnd).toISOString();
const normalization = fitIQNormalization({ seasonId, sessions: inWindow(windowEnd), trainedThrough, version: `${seasonId}-calibration-v1`, rulesVersion: 'Level Up v2.1 + reviewed Q&A' });
const rated = sessions.filter(session => Date.parse(session.end) > windowEnd);

let replay = createIQReplay(seasonId);
let matches = 0;
for (const session of rated) {
  const result = processIQEvent({ replay, event: session, normalization });
  replay = result.replay;
  matches += result.diagnostics.observations;
}

const asOf = new Date(Math.min(now, Date.parse(season.end))).toISOString();
// Official details for the teams in the replay, as rows read them.
const teamInfo = new Map([...replay.teams.keys()].filter(id => identities.has(id)).map(id => {
  const team = identities.get(id);
  return [id, { number: team.number, name: team.name, organization: team.organization, region: team.region, country: team.country }];
}));
const { rows: rankings, confirmed } = iqRankingRows(replay, { asOf, identities: teamInfo, seasonId, season });
const histories = Object.fromEntries([...replay.teams.values()].map(team => [team.id, iqHistoryPoints(team, seasonId)]));

const envelope = {
  program: 'VIQRC', seasonId: Number(seasonId), season: season.label, modelVersion: VIQCR_VERSION, asOf, updatedAt: new Date().toISOString(),
  normalization, calibrationEvents: sessions.length - rated.length, eventsProcessed: rated.length, matchesProcessed: matches,
  confirmed, provisional: rankings.length - confirmed, importIssues: issues, rankings,
};
await writeFile(`archive-assets${iqRankingsPath(seasonId)}`, JSON.stringify(envelope));
// The replay itself, with its frozen profile, for the live route to continue.
await writeFile(`archive-assets${iqStatePath(seasonId)}`, JSON.stringify({
  program: 'VIQRC', seasonId: Number(seasonId), modelVersion: VIQCR_VERSION, asOf, normalization,
  calibrationEvents: envelope.calibrationEvents, eventsProcessed: rated.length, matchesProcessed: matches,
  replay: packIQState(replay), identities: Object.fromEntries(teamInfo),
  // Every event this build looked at - rated, calibration, or with no results -
  // so the live route treats none of them as missed.
  seen: events.map(event => event.id),
}));
// Histories by shard (lib/vcr-iq.mjs), so a profile reads only a small file.
const shards = Array.from({ length: IQ_HISTORY_SHARDS }, () => ({}));
for (const [id, points] of Object.entries(histories)) shards[iqHistoryShard(id)][id] = points;
for (const [shard, teams] of shards.entries()) {
  await writeFile(`archive-assets${iqHistoryPath(seasonId, shard)}`, JSON.stringify({ program: 'VIQRC', seasonId: Number(seasonId), modelVersion: VIQCR_VERSION, asOf, shard, teams }));
}
await recordSnapshot(current => ({ ...current, viqrc: { ...(current.viqrc ?? {}), [seasonId]: asOf } }));
console.log(JSON.stringify({ season: season.label, events: events.length, calibrationEvents: envelope.calibrationEvents, rated: rated.length, matches, teams: rankings.length, confirmed, provisional: envelope.provisional, importIssues: issues.length, trainedThrough, normalization: { teamwork: normalization.teamwork, driving: normalization.driving, coding: normalization.coding, cohort: normalization.cohort }, requests: state.requests }, null, 2));

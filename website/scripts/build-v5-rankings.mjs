// Builds the current V5 season's VCR rankings from every completed event and
// publishes them to archive-assets/, where the Worker serves them.
//
//   ROBOT_EVENTS_API_TOKEN=... node scripts/build-v5-rankings.mjs [--refresh]
//
// The live route (app/api/rankings/route.ts) can afford only the latest 36
// events inside a free-plan Worker request, so a team whose events are all
// older than that is missing from it. This replays the whole season with the
// same code (lib/v5-season.ts) and the same rules: VCR 3, 4+ matches to be
// rated, decay measured from now.
//
// Finished events are cached in work/v5-pages-<season>; a run fetches only
// events that finished since the last one. --refresh refetches everything.
import { readFile, writeFile } from 'node:fs/promises';
import { PROGRAMS } from '../lib/programs.mjs';
import { VCR_VERSION } from '../lib/vcr3.mjs';
import { emptyV5Replay, continueV5Replay, ratedFromReplay, serializeV5Replay, v5RankingRows, gradeFromContext, v5CurrentPath, v5StatePath } from '../lib/v5-season.ts';
import { officialPages, BudgetExhausted } from './official-pages.mjs';
import { recordSnapshot } from './snapshots.mjs';

const seasonId = String(PROGRAMS.V5RC.currentSeason);
const season = PROGRAMS.V5RC.seasons[seasonId];
const refresh = process.argv.includes('--refresh');
const { collection, state } = await officialPages({ token: process.env.ROBOT_EVENTS_API_TOKEN, cacheDir: `work/v5-pages-${seasonId}`, refresh });

// BUILD_UNTIL (ISO date) builds the season as it stood then - for testing the
// live route's catch-up against a full build.
const now = new Date(Math.min(Date.now(), Date.parse(process.env.BUILD_UNTIL ?? '9999-01-01')));
const cutoff = new Date(Math.min(now.getTime(), Date.parse(season.end)));
// Same selection as the live route, without its 36-event limit.
const completed = (await collection(`/events?season%5B%5D=${seasonId}`, { cache: false }))
  .filter(event => event.program?.id === 1 && String(event.season?.id) === seasonId && new Date(event.end) <= cutoff && event.divisions?.length && !/cancell?ed/i.test(event.name))
  .sort((a, b) => String(a.end).localeCompare(String(b.end)));

// Results keep arriving and being corrected for days after an event, so only
// events that ended over a week ago are read from the cache; newer ones are
// fetched again on every run.
const settled = event => now.getTime() - Date.parse(event.end) > 7 * 86400000;
const matches = [];
const failures = [];
for (const [index, event] of completed.entries()) {
  for (const division of event.divisions) {
    try {
      const rows = await collection(`/events/${event.id}/divisions/${division.id}/matches?round%5B%5D=2&round%5B%5D=3&round%5B%5D=4&round%5B%5D=5&round%5B%5D=6`, { cache: settled(event) });
      matches.push(...rows.map(match => ({ ...match, eventId: event.id, gradeHint: gradeFromContext(`${event.name} ${division.name}`) })));
    } catch (error) {
      if (error instanceof BudgetExhausted) throw error;
      failures.push({ event: event.id, division: division.id, error: error.message });
    }
  }
  if ((index + 1) % 25 === 0) console.log(`fetched ${index + 1}/${completed.length} events (${state.requests} requests)`);
}
// A ranking with holes is worse than last week's complete one.
if (failures.length) throw new Error(`${failures.length} divisions could not be fetched; nothing was published. First: ${JSON.stringify(failures[0])}`);
const played = matches.filter(match => match.alliances?.length === 2 && match.alliances.every(alliance => Number.isFinite(alliance.score) && alliance.score >= 0 && alliance.teams?.length));

const replay = continueV5Replay(emptyV5Replay(), { completed, matches: played });
const rated = ratedFromReplay(replay, cutoff);

// Official team records: the published directory first, then the API for any
// team it does not have yet (new registrations since it was built).
const directory = JSON.parse(await readFile('archive-assets/team-directory.json', 'utf8'));
if ((directory.program ?? 'V5RC') !== 'V5RC') throw new Error('archive-assets/team-directory.json is not the V5 directory.');
const official = new Map(directory.teams.map(team => [Number(team.id), {
  id: Number(team.id), number: team.number, team_name: team.name, organization: team.organization, grade: team.grade,
  location: { city: team.city, region: team.region === 'Unassigned' ? null : team.region, country: team.country === 'Unassigned' ? null : team.country }, robot_name: '',
}]));
const missing = rated.map(team => team.id).filter(id => !official.has(id));
for (let index = 0; index < missing.length; index += 100) {
  const group = missing.slice(index, index + 100);
  for (const team of await collection(`/teams?${group.map(id => `id%5B%5D=${id}`).join('&')}`, { cache: false })) official.set(team.id, team);
}

const rankings = v5RankingRows({ rated, official, seasonId, season });
const envelope = {
  rankings,
  eventsProcessed: completed.length,
  matchesProcessed: played.length,
  method: `${VCR_VERSION} · event settlement · 75-day evidence half-life · every completed event`,
  modelVersion: VCR_VERSION,
  season: season.label,
  seasonId: Number(seasonId),
  coverage: 'full-season',
  asOf: cutoff.toISOString(),
  updatedAt: now.toISOString(),
};
await writeFile(`archive-assets${v5CurrentPath}`, JSON.stringify(envelope));
// The replay itself, for the live route to continue with events that finish
// before the next build, plus the official records of the teams in it.
const keep = info => ({ id: info.id, number: info.number, team_name: info.team_name, organization: info.organization, grade: info.grade, robot_name: info.robot_name ?? '', location: { region: info.location?.region ?? null, country: info.location?.country ?? null } });
await writeFile(`archive-assets${v5StatePath}`, JSON.stringify({
  seasonId: Number(seasonId), asOf: envelope.asOf, modelVersion: VCR_VERSION, eventsProcessed: completed.length, matchesProcessed: played.length,
  replay: serializeV5Replay(replay),
  official: Object.fromEntries([...replay.states.keys()].filter(id => official.has(id)).map(id => [id, keep(official.get(id))])),
}));
await recordSnapshot(current => ({ ...current, v5: envelope.asOf }));
console.log(JSON.stringify({ season: season.label, events: completed.length, matches: played.length, teams: rankings.length, directoryMisses: missing.length, requests: state.requests }, null, 2));

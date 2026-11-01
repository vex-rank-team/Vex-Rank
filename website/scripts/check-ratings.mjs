// Checks freshly built ratings before they are deployed, against those live
// now (saved to work/previous/ by scripts/fetch-deployed-assets.mjs): the V5
// full-season rankings (build-v5-rankings.mjs) and VIQCR (build-iq-ratings.mjs).
// A failure means: do not deploy; the live ratings stay as they are.
import { readFile } from 'node:fs/promises';
import { PROGRAMS } from '../lib/programs.mjs';
import { iqRankingsPath, iqHistoryPath, iqHistoryShard, IQ_HISTORY_SHARDS } from '../lib/vcr-iq.mjs';
import { VIQCR_VERSION } from '../lib/viqcr.mjs';
import { v5CurrentPath } from '../lib/v5-season.ts';

const MAX_DROP = 0.1;
const seasonId = String(process.argv[2] ?? PROGRAMS.VIQRC.currentSeason);
const read = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };
const problems = [];
const fail = message => problems.push(message);

const fresh = await read(`archive-assets${iqRankingsPath(seasonId)}`);
const previous = await read(`work/previous${iqRankingsPath(seasonId)}`);
if (!fresh) { console.error(`archive-assets${iqRankingsPath(seasonId)} is missing.`); process.exit(1); }
if (fresh.program !== 'VIQRC' || String(fresh.seasonId) !== seasonId) fail(`file says ${fresh.program} season ${fresh.seasonId}.`);
if (fresh.modelVersion !== VIQCR_VERSION) fail(`model ${fresh.modelVersion}, expected ${VIQCR_VERSION}.`);
const rows = Array.isArray(fresh.rankings) ? fresh.rankings : [];
if (!rows.length) fail('no rated teams.');
const ids = new Set();
let confirmed = 0;
rows.forEach((row, index) => {
  if (row.rank !== index + 1) fail(`row ${index} has rank ${row.rank}.`);
  if (ids.has(row.id)) fail(`team ${row.id} appears twice.`);
  ids.add(row.id);
  if (!Number.isInteger(row.rating) || row.rating < 0 || row.rating > 1000) fail(`team ${row.id}: rating ${row.rating} outside 0-1000.`);
  if (!Number.isInteger(row.confidence) || row.confidence < 0) fail(`team ${row.id}: bad confidence.`);
  if (index && row.viqcr > rows[index - 1].viqcr) fail(`rows out of order at ${index}.`);
  if (!row.provisional) confirmed++;
});
if (confirmed !== fresh.confirmed) fail(`confirmed count ${fresh.confirmed} disagrees with rows (${confirmed}).`);
if (previous?.rankings?.length) {
  if (rows.length < previous.rankings.length * (1 - MAX_DROP)) fail(`${rows.length} rated teams, down from ${previous.rankings.length}.`);
  if (fresh.eventsProcessed < previous.eventsProcessed) fail(`${fresh.eventsProcessed} events, down from ${previous.eventsProcessed}.`);
  if (Date.parse(fresh.asOf) < Date.parse(previous.asOf)) fail('older than the live ratings.');
}
// Every rated team has its history, in the shard the Worker will look in.
const shards = [];
for (let shard = 0; shard < IQ_HISTORY_SHARDS; shard++) {
  const file = await read(`archive-assets${iqHistoryPath(seasonId, shard)}`);
  if (!file || file.program !== 'VIQRC' || file.shard !== shard) { fail(`history shard ${shard} is missing or wrong.`); continue; }
  shards[shard] = file.teams;
}
for (const row of rows) if (!shards[iqHistoryShard(row.id)]?.[String(row.id)]?.length) { fail(`team ${row.id} has no history.`); break; }

// V5: complete, ordered, and not smaller or older than what is live.
const v5 = await read(`archive-assets${v5CurrentPath}`);
const v5Previous = await read(`work/previous${v5CurrentPath}`);
if (!v5) fail(`archive-assets${v5CurrentPath} is missing.`);
else {
  if (v5.coverage !== 'full-season' || String(v5.seasonId) !== String(PROGRAMS.V5RC.currentSeason)) fail(`V5 file is ${v5.coverage} for season ${v5.seasonId}.`);
  const v5Rows = Array.isArray(v5.rankings) ? v5.rankings : [];
  if (!v5Rows.length) fail('V5: no rated teams.');
  if (v5Rows.some((row, index) => row.rank !== index + 1 || !Number.isFinite(row.rating))) fail('V5: ranks are not 1..n or a rating is missing.');
  if (new Set(v5Rows.map(row => row.id)).size !== v5Rows.length) fail('V5: a team appears twice.');
  if (v5Previous?.rankings?.length) {
    if (v5Rows.length < v5Previous.rankings.length * (1 - MAX_DROP)) fail(`V5: ${v5Rows.length} rated teams, down from ${v5Previous.rankings.length}.`);
    if (v5.eventsProcessed < v5Previous.eventsProcessed) fail(`V5: ${v5.eventsProcessed} events, down from ${v5Previous.eventsProcessed}.`);
  }
  if (!problems.length) console.log(`V5 ${v5.season}: ${v5Rows.length} teams, ${v5.eventsProcessed} events${v5Previous ? `; was ${v5Previous.rankings.length} teams` : ' (first publish)'}`);
}

if (problems.length) { for (const problem of problems.slice(0, 20)) console.error(`ratings: ${problem}`); process.exit(1); }
console.log(`VIQCR ${fresh.season}: ${rows.length} teams (${confirmed} confirmed), ${fresh.eventsProcessed} events${previous ? `; was ${previous.rankings.length} teams, ${previous.eventsProcessed} events` : ' (first publish)'}`);

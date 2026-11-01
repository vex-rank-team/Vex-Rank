// A deploy replaces every file the Worker serves with archive-assets/. This
// refuses to deploy unless everything the Worker serves now is present and
// every file is within Cloudflare's limits, so a deploy cannot remove a past
// season, a directory or the VEX IQ ratings by accident.
import { readFile, readdir, stat } from 'node:fs/promises';
import { PROGRAMS } from '../lib/programs.mjs';
import { iqRankingsPath, iqHistoryPath, iqStatePath, IQ_HISTORY_SHARDS } from '../lib/vcr-iq.mjs';
import { v5CurrentPath, v5StatePath } from '../lib/v5-season.ts';

const ASSET_LIMIT = 25 * 1024 * 1024;     // Workers static assets, per file
const SHARD_LIMIT = 1024 * 1024;          // parsed inside a request: keep small
const problems = [];
const exists = async path => { try { return await stat(path); } catch { return null; } };

const manifest = JSON.parse(await readFile('archive-assets/manifest.json', 'utf8').catch(() => 'null'));
if (!manifest?.archives?.length) problems.push('archive-assets/manifest.json is missing or lists no archives.');
for (const archive of manifest?.archives ?? []) if (!(await exists(`archive-assets${archive.path}`))) problems.push(`missing ${archive.path}`);
for (const name of ['team-directory.json', 'team-directory-viqrc.json', 'ratings-snapshots.json', v5CurrentPath.slice(1), v5StatePath.slice(1), iqStatePath(PROGRAMS.VIQRC.currentSeason).slice(1)]) if (!(await exists(`archive-assets/${name}`))) problems.push(`missing ${name}`);
const current = String(PROGRAMS.VIQRC.currentSeason);
if (!(await exists(`archive-assets${iqRankingsPath(current)}`))) problems.push(`missing ${iqRankingsPath(current)}`);
for (let shard = 0; shard < IQ_HISTORY_SHARDS; shard++) {
  const info = await exists(`archive-assets${iqHistoryPath(current, shard)}`);
  if (!info) problems.push(`missing ${iqHistoryPath(current, shard)}`);
  else if (info.size > SHARD_LIMIT) problems.push(`${iqHistoryPath(current, shard)} is ${info.size} bytes; shards must stay under ${SHARD_LIMIT}.`);
}
for (const name of await readdir('archive-assets')) {
  const info = await stat(`archive-assets/${name}`);
  if (info.size > ASSET_LIMIT) problems.push(`${name} is ${info.size} bytes, over the ${ASSET_LIMIT}-byte asset limit.`);
}
if (problems.length) { for (const problem of problems) console.error(`deploy: ${problem}`); process.exit(1); }
console.log(`deploy: ${(await readdir('archive-assets')).length} files present and within limits`);

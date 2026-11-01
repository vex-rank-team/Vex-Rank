// Downloads what the live Worker serves from its asset store into
// archive-assets/, so a deploy keeps it.
//
// A deploy uploads the whole archive-assets folder, and anything missing from
// it disappears from the Worker. The past-season ranking archives are not in
// the repository (only their published copies are), so a deploy from a fresh
// checkout must start from what is live.
//
// Each archive is checked against the SHA-256 the live manifest publishes, so a
// truncated download fails here instead of being redeployed. The current team
// directories are saved to work/ as the baseline the new builds are compared
// against (scripts/check-directories.mjs); the builds write fresh ones.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { PROGRAMS } from '../lib/programs.mjs';
import { iqRankingsPath, iqHistoryPath, IQ_HISTORY_SHARDS } from '../lib/vcr-iq.mjs';
import { v5CurrentPath } from '../lib/v5-season.ts';

const base = process.env.VEXRANK_API_BASE ?? 'https://vexrank-api-test.qiansteven54.workers.dev';
const headers = { 'User-Agent': 'VEXRank-directory-refresh/1.0', Accept: 'application/json' };

async function get(path) {
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir('archive-assets', { recursive: true });
await mkdir('work/previous', { recursive: true });

const manifestBytes = await get('/api/archive-manifest');
const manifest = JSON.parse(manifestBytes.toString('utf8'));
if (!Array.isArray(manifest.archives) || !manifest.archives.length) throw new Error('The live archive manifest lists no archives.');
for (const archive of manifest.archives) {
  const bytes = await get(archive.path);
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (archive.sha256 && sha !== archive.sha256) throw new Error(`${archive.path}: checksum ${sha} does not match the manifest's ${archive.sha256}.`);
  await mkdir(dirname(`archive-assets${archive.path}`), { recursive: true });
  await writeFile(`archive-assets${archive.path}`, bytes);
  console.log(`kept ${archive.path} (${archive.season}, ${bytes.length} bytes)`);
}
await writeFile('archive-assets/manifest.json', manifestBytes);

// Published VEX IQ ratings (scripts/build-iq-ratings.mjs), when a season has them.
// The current V5 season from every completed event (scripts/build-v5-rankings.mjs).
try {
  const bytes = await get(v5CurrentPath);
  if (JSON.parse(bytes.toString('utf8')).coverage !== 'full-season') throw new Error('not a full-season file');
  await writeFile(`archive-assets${v5CurrentPath}`, bytes);
  await writeFile(`work/previous${v5CurrentPath}`, bytes);
  console.log(`kept ${v5CurrentPath} (${bytes.length} bytes)`);
} catch (error) { console.log(`no live ${v5CurrentPath}: ${error.message}`); }

// A season's history shards are kept only together with its rankings file.
for (const seasonId of Object.keys(PROGRAMS.VIQRC.seasons)) {
  let rankings;
  try { rankings = await get(iqRankingsPath(seasonId)); } catch (error) { console.log(`no live VIQCR for season ${seasonId}: ${error.message}`); continue; }
  if (JSON.parse(rankings.toString('utf8')).program !== 'VIQRC') throw new Error(`${iqRankingsPath(seasonId)} is not a VIQRC file`);
  const shards = [];
  for (let shard = 0; shard < IQ_HISTORY_SHARDS; shard++) shards.push(await get(iqHistoryPath(seasonId, shard)));
  await writeFile(`archive-assets${iqRankingsPath(seasonId)}`, rankings);
  await writeFile(`work/previous${iqRankingsPath(seasonId)}`, rankings);
  for (const [shard, bytes] of shards.entries()) await writeFile(`archive-assets${iqHistoryPath(seasonId, shard)}`, bytes);
  console.log(`kept VIQCR for season ${seasonId} (rankings + ${IQ_HISTORY_SHARDS} history shards)`);
}

// Baselines only. A program's file is kept when the server answers with that
// program's list - an older server answers the IQ request with V5's.
for (const [program, query, name] of [['V5RC', '', 'team-directory.json'], ['VIQRC', '?program=VIQRC', 'team-directory-viqrc.json']]) {
  try {
    const bytes = await get(`/api/team-directory${query}`);
    const served = JSON.parse(bytes.toString('utf8')).program ?? 'V5RC';
    if (served !== program) { console.log(`no live ${program} directory yet`); continue; }
    await writeFile(`work/previous-${name}`, bytes);
    // Also kept for the deploy, so a run that rebuilds only the ratings does
    // not remove the directories. A directory build overwrites it.
    await writeFile(`archive-assets/${name}`, bytes);
    console.log(`baseline ${program} directory saved and kept`);
  } catch (error) {
    console.log(`no live ${program} directory: ${error.message}`);
  }
}

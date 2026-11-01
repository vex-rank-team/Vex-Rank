// Checks a deployed Worker answers everything readers depend on. The weekly
// workflow runs it after deploying and rolls back if it fails.
//
//   VEXRANK_API_BASE=https://... node scripts/smoke-test.mjs
import { readFile } from 'node:fs/promises';
import { PROGRAMS } from '../lib/programs.mjs';
import { iqRankingsPath } from '../lib/vcr-iq.mjs';
import { v5CurrentPath } from '../lib/v5-season.ts';

const base = process.env.VEXRANK_API_BASE ?? 'https://vexrank-api-test.qiansteven54.workers.dev';
const headers = { 'User-Agent': 'VEXRank-smoke-test/1.0', Accept: 'application/json' };
const failures = [];

async function check(name, path, verify) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const problem = verify(await response.json());
      if (problem) throw new Error(problem);
      console.log(`ok   ${name}`);
      return;
    } catch (error) {
      if (attempt === 2) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`); }
      else await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

const published = JSON.parse(await readFile(`archive-assets${iqRankingsPath(PROGRAMS.VIQRC.currentSeason)}`, 'utf8'));
const leader = published.rankings[0];
const v5 = JSON.parse(await readFile(`archive-assets${v5CurrentPath}`, 'utf8'));

await check('health', '/api/health', body => body.status !== 'ok' && 'not ok');
await check('archive manifest', '/api/archive-manifest', body => !body.archives?.length && 'no archives');
await check('V5 directory', '/api/team-directory', body => !(body.total > 1000) && `total ${body.total}`);
await check('VEX IQ directory', '/api/team-directory?program=VIQRC', body => body.program !== 'VIQRC' && `program ${body.program}`);
// Live answers are the weekly files plus events finished since: never fewer rows.
await check('V5 rankings (full season)', '/api/rankings', body =>
  body.coverage !== 'full-season' ? `coverage ${body.coverage}`
    : !(body.rankings?.length >= v5.rankings.length) && `${body.rankings?.length} rows, fewer than the weekly ${v5.rankings.length}`);
await check('VEX IQ ratings', '/api/rankings?program=VIQRC', body =>
  body.program !== 'VIQRC' ? `program ${body.program}`
    : body.modelVersion !== published.modelVersion ? `model ${body.modelVersion}`
      : !(body.rankings?.length >= published.rankings.length) && `${body.rankings?.length} rows, fewer than the weekly ${published.rankings.length}`);
await check('VEX IQ history', `/api/viqcr/history?teamId=${leader.id}`, body => !body.history?.length && 'no history for the leading team');
await check('app config', '/api/app-config', body => !body.programs?.VIQRC && 'no VIQRC config');

if (failures.length) process.exit(1);
console.log(`deployed Worker at ${base} answers every check`);

// Checks freshly built team directories before they are deployed.
//
// The build script already refuses a download that disagrees with the
// official page count. This catches the other way a refresh goes wrong: the
// official API answering, consistently, with far fewer teams than yesterday
// (an outage, a filter change). A directory that shrank by more than the
// allowed share is not deployed, and yesterday's stays live.
import { readFile } from 'node:fs/promises';

const MAX_DROP = 0.05;
const read = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } };

let failed = false;
for (const [program, name] of [['V5RC', 'team-directory.json'], ['VIQRC', 'team-directory-viqrc.json']]) {
  const fresh = await read(`archive-assets/${name}`);
  const previous = await read(`work/previous-${name}`);
  const fail = message => { console.error(`${program}: ${message}`); failed = true; };
  if (!fresh) { fail(`archive-assets/${name} is missing.`); continue; }
  if (fresh.program !== program) fail(`file says program ${fresh.program}, expected ${program}.`);
  if (!Array.isArray(fresh.teams) || fresh.teams.length !== fresh.total || !fresh.total) fail(`team count ${fresh.teams?.length} does not match total ${fresh.total}.`);
  if (previous?.total && fresh.total < previous.total * (1 - MAX_DROP)) fail(`${fresh.total} teams, down from ${previous.total} - more than ${MAX_DROP * 100}%.`);
  if (!failed) console.log(`${program}: ${fresh.total} teams${previous?.total ? ` (was ${previous.total})` : ' (first build)'}`);
}
if (failed) process.exit(1);

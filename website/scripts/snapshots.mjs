// The date of each published replay snapshot, in one small file, so the
// Worker can key its cache to the current snapshot without parsing the
// multi-megabyte state files on every request. Each season build updates its
// own entry: { v5: asOf, viqrc: { [seasonId]: asOf } }.
import { readFile, writeFile } from 'node:fs/promises';

export const SNAPSHOTS_PATH = '/ratings-snapshots.json';

export async function recordSnapshot(update) {
  let current = {};
  try { current = JSON.parse(await readFile(`archive-assets${SNAPSHOTS_PATH}`, 'utf8')); } catch {}
  const next = update(current);
  await writeFile(`archive-assets${SNAPSHOTS_PATH}`, JSON.stringify(next));
}

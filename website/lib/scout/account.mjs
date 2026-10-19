/**
 * Browser-side account rules: reading the sign-in link Discord sends the
 * reader back with, and merging what this browser saved with what the
 * account already holds, so signing in never loses either. Pure; tested in
 * tests/scout.test.mjs.
 */
import { sanitizeScout } from './store.mjs';

/**
 * `#/signed-in/<code>?return=%23%2Fevents` → { code, returnTo }, or null.
 * The return path is re-checked here so a crafted link can't send the
 * reader anywhere but a page of this site.
 */
export function parseSignIn(hash) {
  const match = String(hash ?? '').match(/^#\/signed-in\/([\w-]{20,60})(?:\?return=([^&]*))?$/);
  if (!match) return null;
  let returnTo = '#/';
  try { returnTo = decodeURIComponent(match[2] ?? '%23%2F'); } catch { /* keep the home page */ }
  if (!/^#\/[\w/.-]{0,200}$/.test(returnTo)) returnTo = '#/';
  return { code: match[1], returnTo };
}

const byKey = (list, key) => new Map(list.map(item => [item[key], item]));

/**
 * The union of local and account data. Favourites and streams are combined;
 * for a note present in both, the newer edit wins; a picklist the account
 * already has wins over this browser's, since it may have been reordered
 * elsewhere; "my team" keeps the account's choice when there is one.
 */
export function mergeScout(localRaw, remoteRaw) {
  const local = sanitizeScout(localRaw);
  const remote = sanitizeScout(remoteRaw);
  const teams = byKey(remote.favorites.teams, 'number');
  for (const team of local.favorites.teams) if (!teams.has(team.number)) teams.set(team.number, team);
  const events = byKey(remote.favorites.events, 'id');
  for (const event of local.favorites.events) if (!events.has(event.id)) events.set(event.id, event);

  const notes = structuredClone(remote.notes);
  for (const [eventId, targets] of Object.entries(local.notes)) {
    for (const [target, note] of Object.entries(targets)) {
      const theirs = notes[eventId]?.[target];
      if (!theirs || note.updatedAt > theirs.updatedAt) (notes[eventId] ??= {})[target] = note;
    }
  }
  return sanitizeScout({
    v: 1,
    favorites: { teams: [...teams.values()], events: [...events.values()] },
    notes,
    picklists: { ...local.picklists, ...remote.picklists },
    streams: { ...local.streams, ...remote.streams },
    myTeam: remote.myTeam || local.myTeam,
  });
}

/** Whether two scouting states hold the same data (so an unchanged one isn't re-sent). */
export function sameScout(a, b) {
  return JSON.stringify(sanitizeScout(a)) === JSON.stringify(sanitizeScout(b));
}

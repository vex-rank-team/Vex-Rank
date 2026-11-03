import { teamProfileResponse } from './team-profile-build';
import { useIqHistorySource } from './vcr-iq.mjs';

declare const __VEX_DIRECT_TOKEN__: string;
declare const __VEX_API_BASE__: string;

// A VEX IQ rating history is published by the Worker, not built from one
// team's records, so a profile built here asks the Worker for it.
useIqHistorySource(async (teamId: number, seasonId: number) => {
  const base = typeof __VEX_API_BASE__ === 'undefined' ? '' : __VEX_API_BASE__;
  const response = await fetch(`${base}/api/viqcr/history?teamId=${teamId}&season=${seasonId}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return null;
  return ((await response.json()) as { history: unknown[] | null }).history;
});

/**
 * Team profiles read straight from events.vex, in the browser, with the token
 * baked in at build time (vite.pages.config.ts). The profile is built by the
 * same code the Worker runs, so the page cannot tell the two apart.
 *
 * The token is visible to anyone who opens the site's code. That was a
 * deliberate choice; the token never enters the repository.
 *
 * Returns null whenever the direct path does not produce a profile - no
 * token, a rejected or rate-limited token, a network failure - and the caller
 * then asks the Worker, which keeps its own token and cache.
 */
export function hasDirectToken() {
  return typeof __VEX_DIRECT_TOKEN__ !== 'undefined' && Boolean(__VEX_DIRECT_TOKEN__);
}

export async function directTeamProfile(path: string): Promise<Response | null> {
  if (!hasDirectToken()) return null;
  const url = new URL(path, 'https://direct.invalid');
  const match = /^\/api\/teams\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  const number = decodeURIComponent(match[1]).trim().toUpperCase();
  if (!/^[0-9]+[A-Z0-9-]*$/.test(number)) return null;
  try {
    const response = await teamProfileResponse(new Request(url), number, __VEX_DIRECT_TOKEN__);
    // A 404 is a real answer (no such team), not a reason to ask again.
    return response.ok || response.status === 404 ? response : null;
  } catch {
    return null;
  }
}

/**
 * A running event straight from events.vex: standings and matches the moment
 * they are posted, rather than a Worker copy up to a minute old.
 *
 * Every reader shares one token and its rate limit, so after any failure
 * (a 429 included) direct reads stop for five minutes and the Worker - which
 * keeps one shared, minute-fresh copy - answers instead.
 *
 * The organizer notes come from the public event page, which a browser cannot
 * read, so they are taken from the Worker's answer when it arrives within
 * 1.5 s (`worker`); a poll passes no `worker` and keeps the notes it has.
 */
let directEventsPausedUntil = 0;
// The Worker's answer for each event, kept past the 1.5 s wait so notes that
// arrive later still reach the page (organizerNotes).
const workerNotes = new Map<string, Promise<{ organizer?: any } | null>>();
export async function directEventDetail(id: string, worker?: () => Promise<Response>): Promise<Response | null> {
  if (!hasDirectToken() || Date.now() < directEventsPausedUntil) return null;
  const notes = worker ? worker().then(response => response.ok ? response.json() : null).catch(() => null) : null;
  if (notes) workerNotes.set(id, notes as Promise<{ organizer?: any } | null>);
  try {
    const { eventDetailResponse } = await import('./event-detail-build');
    const response = await eventDetailResponse(id, __VEX_DIRECT_TOKEN__, { organizer: false });
    if (!response.ok) throw new Error(`direct event ${response.status}`);
    const data = await response.json() as { organizer?: unknown };
    if (notes) {
      const fromWorker = await Promise.race([notes, new Promise(resolve => setTimeout(() => resolve(null), 1500))]) as { organizer?: unknown } | null;
      if (fromWorker?.organizer) data.organizer = fromWorker.organizer;
    }
    return Response.json(data);
  } catch {
    directEventsPausedUntil = Date.now() + 5 * 60000;
    return null;
  }
}

/**
 * An event's organizer notes (webcast, agenda...) when the page's copy came
 * without them: the Worker answer the direct read started, however late it
 * lands. Null when there is none.
 */
export async function organizerNotes(id: string): Promise<any | null> {
  const pending = workerNotes.get(id);
  if (!pending) return null;
  const body = await pending;
  const organizer = body?.organizer;
  return organizer && Object.values(organizer).some(Boolean) ? organizer : null;
}

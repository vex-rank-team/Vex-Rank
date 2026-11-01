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

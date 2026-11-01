// How long a cached response counts as current, and how long past that it may
// still be served when official data cannot be reached at all.
export const FRESH_FOR = 900000;      // 15 minutes

// An event in progress or just finished: official results keep arriving and
// being corrected for days after it ends, so its page is current for a minute.
// A route marks such a response with this header; the Worker keeps it that long.
export const RECENT_FRESH_FOR = 60000;
export const FRESH_FOR_HEADER = 'X-VEXRank-Fresh-For';
export const RECENT_DAYS = 3;
/** In progress, or ended within RECENT_DAYS. */
export function isRecentEvent(event: { end?: string | null; ongoing?: boolean | null }, now = Date.now()) {
  const end = Date.parse(event?.end ?? '');
  // Ending within a day covers an event running now whose `ongoing` flag lags.
  return Boolean(event?.ongoing) || (Number.isFinite(end) && now - end < RECENT_DAYS * 86400000 && end - now < 86400000);
}
export const STALE_FOR = 86400;       // 24 hours, in seconds

/// Which copy to serve, given what is in the cache.
///
/// `fresh` goes straight back. `stale` goes back immediately too, with a
/// refresh started behind it - official data takes seconds when it is working
/// and hangs when it is not, and the reader gains nothing from waiting for it
/// when we are holding the same answer a few minutes older. `miss` has to wait,
/// because there is nothing else to show.
///
/// A reader who pulled to refresh is asking whether anything has changed, so
/// they get the slow, truthful path rather than the copy they already have.
export function cacheDecision(
  saved: { expires_at: number } | null,
  now: number,
  wantsLive: boolean,
): { serve: 'fresh' | 'stale' | 'miss'; age: number } {
  if (!saved) return { serve: 'miss', age: 0 };
  const age = Math.round((now - (saved.expires_at - FRESH_FOR)) / 1000);
  if (saved.expires_at > now) return { serve: wantsLive ? 'miss' : 'fresh', age };
  if (wantsLive || age > STALE_FOR) return { serve: 'miss', age };
  return { serve: 'stale', age };
}

// Process-local cache of successful upstream pages, keyed by full URL.
// This is shared public competition data; do not reuse for user-specific responses.
const pages = new Map<string, { expires:number; data:any }>();

// Pages that outlive one request. A Worker on Cloudflare's free plan may make
// only 50 outbound requests per incoming one, and a full live rankings build
// needs more than that. So a build that runs out stops, keeping every page it
// fetched here, and the next request carries on from them instead of starting
// over. The Worker supplies the store (its D1 cache); without one, nothing
// persists and calls behave as before.
// `stale: true` returns a page even past its lifetime: the fallback when a
// request has no budget left to refetch it.
export interface PageStore { get(key: string, options?: { stale?: boolean }): Promise<any | undefined>; put(key: string, data: any, keepFor: number): Promise<void> }
let store: PageStore | undefined;
export function usePageStore(next: PageStore | undefined) { store = next; }

/** Thrown before a request that would go over the caller's budget. */
export class FetchBudgetExhausted extends Error {
  constructor() { super('This request used its share of official data requests.'); }
}
// `keepFor` (ms) opts a call into the page store. `budget.left` counts the
// fetches this caller may still make, retries included.
export interface FetchOptions { keepFor?: number; budget?: { left: number } }
/** Read complete official collections. A failed page must never masquerade as no results. */
export async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  // Claim each index before awaiting: workers share the cursor but preserve input order.
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }));
  return results;
}

// Retry timeouts, network errors, 429 and 5xx; other HTTP failures are terminal.
// Cache successes for five minutes and cap entries to bound long-lived worker memory.
export async function vexJson(url: string, headers: Record<string, string>, options: FetchOptions = {}): Promise<any> {
  const cached=pages.get(url);
  if(cached&&cached.expires>Date.now())return cached.data;
  const persist=options.keepFor&&store?store:undefined;
  if(persist){
    const kept=await persist.get(url).catch(()=>undefined);
    if(kept!==undefined){remember(url,kept);return kept}
  }
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.budget) {
      if (options.budget.left <= 0) {
        // Out of requests: last refresh's copy beats dropping the page, which
        // would make a live ranking briefly lose an event it already showed.
        const old=persist?await persist.get(url,{stale:true}).catch(()=>undefined):undefined;
        if(old!==undefined)return old;
        throw new FetchBudgetExhausted();
      }
      options.budget.left--;
    }
    try {
      // `manual` because official data answers an unauthenticated or expired
      // request with a 302 to its login page, not a 401. Followed, that lands
      // on an HTML page, which then fails to parse as JSON and is retried three
      // times - so a token that needs renewing looks exactly like an outage and
      // costs twenty seconds to not find out.
      const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new Error('Event.VEX rejected the credentials (redirected to sign-in). The API token needs renewing.');
      }
      if (response.status === 401 || response.status === 403) {
        await response.body?.cancel();
        throw new Error(`Event.VEX rejected the credentials (${response.status}). The API token needs renewing.`);
      }
      if (response.ok) {
        const data=await response.json();
        remember(url,data);
        if(persist)await persist.put(url,data,options.keepFor!).catch(()=>{});
        return data;
      }
      lastStatus = response.status;
      if (response.status !== 429 && response.status < 500) throw new Error(`Event.VEX request failed (${response.status}).`);
      await response.body?.cancel();
      if(response.status===429&&attempt<2){
        const seconds=Number(response.headers.get('retry-after'));
        await new Promise(resolve=>setTimeout(resolve,Math.min(10000,Math.max(2000,Number.isFinite(seconds)?seconds*1000:2000))));
      }
    } catch (error) {
      // Terminal: neither a wrong request nor a bad token improves on a retry.
      if (attempt === 2 || (error instanceof Error && (error.message.startsWith('Event.VEX request failed') || error.message.includes('credentials')))) throw error;
    }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * 2 ** attempt));
  }
  throw new Error(`Event.VEX is temporarily unavailable (${lastStatus}). Please retry.`);
}

function remember(url: string, data: any) {
  if(pages.size>=600)pages.delete(pages.keys().next().value!);
  // Short: results for a running or just-finished event keep changing, and a
  // longer memory here would hide them from a refresh. Long-lived reuse is the
  // page store's job, with an explicit lifetime per call.
  pages.set(url,{expires:Date.now()+30000,data});
}

// Fetch every page with the original filters intact. Reject the whole collection
// if any page fails, so callers cannot publish a partial ranking as complete.
export async function vexCollection(url: string, headers: Record<string, string>, options: FetchOptions = {}): Promise<any[]> {
  const parsed = new URL(url);
  parsed.searchParams.set('per_page', '250');
  parsed.searchParams.set('page', '1');
  const first = await vexJson(parsed.href, headers, options);
  if (!Array.isArray(first.data)) throw new Error('Event.VEX returned an invalid collection.');
  const lastPage = Math.max(1, Number(first.meta?.last_page ?? 1));
  const rest = await mapLimit(Array.from({ length: lastPage - 1 }, (_, index) => index + 2), 2, async page => {
    const next = new URL(parsed);
    next.searchParams.set('page', String(page));
    const payload = await vexJson(next.href, headers, options);
    if (!Array.isArray(payload.data)) throw new Error('Event.VEX returned an invalid collection.');
    return payload.data;
  });
  return [...first.data, ...rest.flat()];
}

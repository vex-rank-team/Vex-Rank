// Fetching official events.vex pages for the season builds
// (build-iq-ratings.mjs, build-v5-rankings.mjs).
//
// The token is shared with the Worker, which serves readers from it all the
// time. So requests are paced (IQ_BUILD_INTERVAL_MS, default 1.5 s apart -
// about 40 a minute, leaving most of the 100-a-minute limit to the Worker),
// a 429 waits out its Retry-After, and a run stops at a budget
// (IQ_BUILD_MAX_REQUESTS) rather than hammering: what it fetched is cached,
// nothing is published, and the next run carries on.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const API = 'https://events.vex.com/api/v2';

export class BudgetExhausted extends Error {}

export async function officialPages({ token, cacheDir, refresh = false }) {
  if (!token) throw new Error('ROBOT_EVENTS_API_TOKEN is required');
  const interval = Number(process.env.IQ_BUILD_INTERVAL_MS ?? 1500);
  const budget = Number(process.env.IQ_BUILD_MAX_REQUESTS ?? (refresh ? 2000 : 600));
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'VEXRank-season-build/1.0' };
  await mkdir(cacheDir, { recursive: true });
  const state = { requests: 0 };

  async function page(url, { cache }) {
    const file = `${cacheDir}/${createHash('sha1').update(url).digest('hex')}.json`;
    if (cache && !refresh) { try { return JSON.parse(await readFile(file, 'utf8')); } catch {} }
    for (let attempt = 0; attempt < 6; attempt++) {
      if (state.requests >= budget) throw new BudgetExhausted(`Stopped at the ${budget}-request budget; cached pages are kept for the next run. Nothing was published.`);
      state.requests++;
      const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (response?.ok) {
        const body = await response.json();
        if (cache) await writeFile(file, JSON.stringify(body));
        await new Promise(resolve => setTimeout(resolve, interval));
        return body;
      }
      if (response && response.status >= 300 && response.status < 400) throw new Error('The token was rejected (redirected to sign-in).');
      if (response && response.status !== 429 && response.status < 500) throw new Error(`${url}: ${response.status}`);
      const wait = response?.status === 429 ? 1000 * Math.max(10, Number(response.headers.get('retry-after')) || 60) : 2000 * 2 ** attempt;
      console.log(`retry ${attempt + 1} in ${Math.round(wait / 1000)}s: ${response ? response.status : 'no response'} ${url.replace(API, '')}`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    throw new Error(`${url}: gave up after retries`);
  }

  /** Every page of an official collection, or an error. */
  async function collection(path, { cache }) {
    const join = path.includes('?') ? '&' : '?';
    const first = await page(`${API}${path}${join}per_page=250&page=1`, { cache });
    const rows = [...first.data];
    for (let number = 2; number <= (first.meta?.last_page ?? 1); number++) rows.push(...(await page(`${API}${path}${join}per_page=250&page=${number}`, { cache })).data);
    return rows;
  }

  return { collection, state };
}

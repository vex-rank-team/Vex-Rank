import { GET as events } from '../app/api/events/route';
import { GET as event } from '../app/api/events/[id]/route';
import { GET as team } from '../app/api/teams/[number]/route';
import { GET as rankings } from '../app/api/rankings/route';
import { GET as skills } from '../app/api/skills/route';
import { VCR_VERSION } from '../lib/vcr3.mjs';
import { archiveSource } from './archive-source';
import { cacheDecision, FRESH_FOR, STALE_FOR, FRESH_FOR_HEADER } from './cache-policy';
import { canonicalUrl } from './canonical-url';
import { PROGRAMS } from '../lib/programs.mjs';
import { usePageStore, type PageStore } from '../lib/vex-api';
import { useIqHistorySource, useIqStateSource, useIqLiveHistorySink, iqRankingsPath, iqHistoryPath, iqHistoryShard, iqStatePath } from '../lib/vcr-iq.mjs';
import { v5CurrentPath, v5StatePath, useV5SnapshotSource } from '../lib/v5-season';

interface Env { DB: D1Database; ROBOT_EVENTS_API_TOKEN: string; ARCHIVES: Fetcher }

// Settings the apps read at launch, so that things which change on someone
// else's schedule - the season id, cache lifetimes, a note to readers - do not
// need a new binary and an App Store release. These are the defaults; a row in
// `app_config` overrides any of them without a deploy. Clients validate every
// field and fall back to what they were built with, so a mistake here costs one
// setting rather than the app. Native code is never delivered this way.
const APP_CONFIG_DEFAULTS = {
  currentSeason: 204,
  program: 'V5RC',
  // Per-program current season. `currentSeason` above stays V5's, for builds
  // that predate VEX IQ support.
  programs: {
    V5RC: { currentSeason: PROGRAMS.V5RC.currentSeason },
    VIQRC: { currentSeason: PROGRAMS.VIQRC.currentSeason },
  },
  eventCacheSeconds: 30,
  directoryCacheSeconds: 3600,
  defaultCacheSeconds: 120,
  flags: {} as Record<string, boolean>,
  // Zero means "nothing to say about builds". The version, url and notes that
  // drive the update banner come from the override row, which is written when
  // a build actually exists to point at.
  update: { latestBuild: 0, minimumBuild: 0 },
};

async function appConfig(env: Env, platform: string) {
  let stored: Record<string, unknown> = {};
  try {
    // Missing table or row is the normal state, not an error: it means nothing
    // has been overridden yet.
    const row = await env.DB.prepare('SELECT value FROM app_config WHERE key=?').bind(platform).first<{ value: string }>();
    if (row?.value) stored = JSON.parse(row.value);
  } catch { /* fall through to defaults */ }
  const merged = { ...APP_CONFIG_DEFAULTS, ...stored };
  // max-age is short because it is the floor on how fast a change reaches a
  // reader, and stale-while-revalidate keeps that from costing a round trip.
  return cors(Response.json(merged, { headers: { 'Cache-Control': 'public,max-age=300,stale-while-revalidate=3600' } }));
}

// Official pages kept between requests (see lib/vex-api.ts), in the same table
// as whole responses under a `page:` prefix. The keys are public API URLs; the
// token travels in a header and is never part of one.
function d1PageStore(db: D1Database): PageStore {
  return {
    async get(url, options) {
      const row = await db.prepare('SELECT body FROM api_cache WHERE key=? AND expires_at>?').bind(`page:${url}`, options?.stale ? 0 : Date.now()).first<{ body: string }>();
      return row ? JSON.parse(row.body) : undefined;
    },
    async put(url, data, keepFor) {
      const body = JSON.stringify(data);
      if (body.length >= 1800000) return;
      await db.batch([
        db.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(`page:${url}`, body, Date.now() + keepFor),
        // Team-detail URLs change with the rated set, so old ones would pile up.
        // Kept a week past expiry as the out-of-budget fallback.
        db.prepare("DELETE FROM api_cache WHERE key LIKE 'page:%' AND expires_at<?").bind(Date.now() - 8 * 86400000),
      ]);
    },
  };
}

// The weekly V5 replay state (scripts/build-v5-rankings.mjs), parsed once per
// isolate (~2 MB, a few ms). The rankings route continues it with events that
// finished since it was built.
let v5State: Promise<unknown | null> | null = null;
function v5StateFile(env: Env) {
  if (!v5State) v5State = env.ARCHIVES.fetch(new Request(new URL(v5StatePath, 'https://archives.invalid')))
    .then(response => response.ok ? response.json() : null)
    .catch(() => { v5State = null; return null; });
  return v5State;
}

// The weekly VIQCR replay per season (scripts/build-iq-ratings.mjs), ~5 MB,
// parsed once per isolate and continued by the rankings route.
const iqStates = new Map<string, Promise<unknown | null>>();
function iqStateFile(env: Env, seasonId: number) {
  const key = String(seasonId);
  if (!iqStates.has(key)) {
    let path: string;
    try { path = iqStatePath(seasonId); } catch { return Promise.resolve(null); }
    iqStates.set(key, env.ARCHIVES.fetch(new Request(new URL(path, 'https://archives.invalid')))
      .then(response => response.ok ? response.json() : null)
      .catch(() => { iqStates.delete(key); return null; }));
  }
  return iqStates.get(key)!;
}

// The date of each published snapshot (scripts/snapshots.mjs): a few bytes,
// read once per isolate, so cache keys never require parsing a state file.
let snapshotDates: Promise<{ v5?: string; viqrc?: Record<string, string> }> | null = null;
function snapshotDateFile(env: Env) {
  if (!snapshotDates) snapshotDates = env.ARCHIVES.fetch(new Request(new URL('/ratings-snapshots.json', 'https://archives.invalid')))
    .then(response => response.ok ? response.json() as Promise<{ v5?: string; viqrc?: Record<string, string> }> : {})
    .catch(() => { snapshotDates = null; return {}; });
  return snapshotDates;
}

// History points the live IQ route added since the weekly build, by team.
async function iqLiveHistory(env: Env, seasonId: number): Promise<Record<string, unknown[]>> {
  const row = await env.DB.prepare('SELECT body FROM api_cache WHERE key=?').bind(`viqcr-live-history:${seasonId}`).first<{ body: string }>().catch(() => null);
  try { return row ? JSON.parse(row.body) : {}; } catch { return {}; }
}

// D1 holds at most 2 MB per value, and the season rankings are about that, so
// large bodies are stored gzip-compressed (JSON shrinks ~8x) and expanded on read.
const PACKED = 'gz64:';
async function packBody(body: string) {
  if (body.length < 1000000) return body;
  const compressed = new Uint8Array(await new Response(new Blob([body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  let binary = '';
  for (let index = 0; index < compressed.length; index += 0x8000) binary += String.fromCharCode(...compressed.subarray(index, index + 0x8000));
  return PACKED + btoa(binary);
}
async function unpackBody(stored: string) {
  if (!stored.startsWith(PACKED)) return stored;
  const binary = atob(stored.slice(PACKED.length));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}
// `freshFor`: a route's own, shorter life for the answer (FRESH_FOR_HEADER),
// used for events whose results are still arriving.
async function storeResponse(env: Env, key: string, body: string, freshFor?: string | null) {
  const packed = await packBody(body);
  if (packed.length >= 1800000) return;
  const life = Math.min(FRESH_FOR, Number(freshFor) || FRESH_FOR);
  await env.DB.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(key, packed, Date.now() + life).run();
  // A snapshot-keyed answer (`…#<snapshot date>`) replaces those built on older
  // snapshots, and the unversioned one from before snapshots existed.
  const marker = key.indexOf('#');
  if (marker > 0) await env.DB.prepare("DELETE FROM api_cache WHERE (key LIKE ? AND key<>?) OR key=?").bind(`${key.slice(0, marker)}#%`, key, key.slice(0, marker)).run();
}

// VIQCR rating histories (scripts/build-iq-ratings.mjs), one small shard per
// slice of team ids, parsed once per isolate.
const iqHistories = new Map<string, Promise<{ teams: Record<string, unknown[]> } | null>>();
function iqHistoryFile(env: Env, seasonId: number, teamId: number) {
  const shard = iqHistoryShard(teamId);
  const key = `${seasonId}/${shard}`;
  if (!iqHistories.has(key)) {
    let path: string;
    try { path = iqHistoryPath(seasonId, shard); } catch { return Promise.resolve(null); }
    iqHistories.set(key, env.ARCHIVES.fetch(new Request(new URL(path, 'https://archives.invalid')))
      .then(response => response.ok ? response.json() as Promise<{ teams: Record<string, unknown[]> }> : null)
      .catch(() => { iqHistories.delete(key); return null; }));
  }
  return iqHistories.get(key)!;
}

async function dispatch(url: URL) {
  if (url.pathname.startsWith('/api/archive-source')) return archiveSource(url);
  const request = new Request(url);
  if (url.pathname === '/api/events') return events(request);
  if (url.pathname === '/api/rankings') return rankings(request);
  if (url.pathname === '/api/skills') return skills(request);
  if (url.pathname.startsWith('/api/events/')) return event(request, { params: Promise.resolve({ id: url.pathname.split('/').at(-1)! }) });
  return team(request, { params: Promise.resolve({ number: url.pathname.split('/').at(-1)! }) });
}

// Carries the caller's validators through to the asset store. Building the
// asset request from scratch drops them, and without them every launch
// re-downloads a file the reader already has.
function assetRequest(path: string, incoming: URL, request: Request) {
  const headers = new Headers();
  for (const name of ['If-None-Match', 'If-Modified-Since']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Request(new URL(path, incoming.origin), { headers });
}

// The website: vex-rank.com (GitHub Pages from vex-rank-team/Vex-Rank), and
// the owners' github.io copies.
const ALLOWED_ORIGINS = ['https://vex-rank.com', 'https://www.vex-rank.com', 'https://stevenqqian.github.io', 'https://easonli29.github.io'];

function cors(response: Response) {
  const result = new Response(response.body, response);
  result.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  result.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  return result;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await handle(request, env, ctx);
    const origin = request.headers.get('Origin');
    if (!origin || !ALLOWED_ORIGINS.includes(origin) || !response.headers.has('Access-Control-Allow-Origin')) return response;
    const result = new Response(response.body, response);
    result.headers.set('Access-Control-Allow-Origin', origin);
    result.headers.append('Vary', 'Origin');
    return result;
  },
};

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    usePageStore(d1PageStore(env.DB));
    useV5SnapshotSource(() => v5StateFile(env));
    useIqStateSource((seasonId: number) => iqStateFile(env, seasonId));
    useIqLiveHistorySink(async (seasonId: number, history: Record<string, unknown[]>) => {
      await env.DB.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at')
        .bind(`viqcr-live-history:${seasonId}`, JSON.stringify(history), Date.now() + 8 * 86400000).run();
    });
    // Weekly history, plus any points the live route added since.
    const teamHistory = async (teamId: number, seasonId: number) => {
      const file = await iqHistoryFile(env, seasonId, teamId);
      if (!file) return null;
      const weekly = (file.teams[String(teamId)] ?? []) as { eventId: number }[];
      const seen = new Set(weekly.map(point => point.eventId));
      const live = ((await iqLiveHistory(env, seasonId))[String(teamId)] ?? []) as { eventId: number }[];
      return [...weekly, ...live.filter(point => !seen.has(point.eventId))];
    };
    useIqHistorySource(teamHistory);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'GET') return cors(Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, OPTIONS' } }));
    const archiveSeasons:Record<string,string>={'197':'2025-26','190':'2024-25','181':'2023-24','173':'2022-23'};
    const incoming=new URL(request.url),archiveSeason=incoming.searchParams.get('season');
    if(incoming.pathname==='/api/app-config'){
      const platform=incoming.searchParams.get('platform');
      return appConfig(env, platform&&/^[a-z]{1,16}$/.test(platform)?platform:'ios');
    }
    if(incoming.pathname==='/api/archive-manifest')return cors(await env.ARCHIVES.fetch(new Request(new URL('/manifest.json',incoming.origin))));
    if(incoming.pathname==='/api/team-directory'){
      const iq=incoming.searchParams.get('program')==='VIQRC';
      const asset=await env.ARCHIVES.fetch(assetRequest(iq?'/team-directory-viqrc.json':'/team-directory.json',incoming,request));
      // 304 is a success, and the valuable one: the directory is 11 MB of JSON
      // that changes once a day, so a reader who already has it should be told
      // "still yours" rather than sent it again. Treating it as a failure - which
      // `asset.ok` does, since ok is 200-299 - would turn that into a 503.
      if(asset.status===304)return cors(asset);
      if(!asset.ok)return cors(Response.json({error:iq&&asset.status===404?"The VEX IQ team directory isn't available yet.":'Team directory is temporarily unavailable.'},{status:503}));
      const response=cors(asset);response.headers.set('Cache-Control','public,max-age=3600');return response;
    }
    // Historical rankings come only from published static archives. A missing asset
    // is a 503, not a fallback to the live route's partial event sample.
    // V5 archives here; VEX IQ seasons are served from their VIQCR files below.
    const v5Request=(incoming.searchParams.get('program')??'V5RC')==='V5RC';
    const archivePath=/^\/(rankings-20\d{2}-\d{2}-vcr3|rankings-current-v5|viqcr-20\d{2}-\d{2}|viqcr-history-20\d{2}-\d{2}-\d{1,2})\.json$/.test(incoming.pathname)?incoming.pathname:incoming.pathname==='/api/rankings'&&v5Request&&archiveSeason&&archiveSeasons[archiveSeason]?`/rankings-${archiveSeasons[archiveSeason]}-vcr3.json`:null;
    if(archivePath){
      const asset=await env.ARCHIVES.fetch(assetRequest(archivePath,incoming,request));
      if(asset.status===304)return cors(asset);
      if(!asset.ok)return cors(Response.json({error:'This historical archive is not published yet.'},{status:503,headers:{'Cache-Control':'no-store'}}));
      return cors(asset);
    }
    // Current V5 rankings are the weekly snapshot plus events finished since,
    // built by the route below and cached like any response. If that fails
    // with nothing cached to fall back on, the weekly file itself is served.
    const currentV5=incoming.pathname==='/api/rankings'&&v5Request&&(!archiveSeason||archiveSeason===String(PROGRAMS.V5RC.currentSeason));
    const weeklyV5=async()=>{
      if(!currentV5&&!currentIq)return null;
      const asset=await env.ARCHIVES.fetch(new Request(new URL(currentIq?iqRankingsPath(iqSeason):v5CurrentPath,'https://archives.invalid'))).catch(()=>null);
      if(!asset?.ok)return null;
      const response=cors(asset);response.headers.set('Cache-Control','no-store');response.headers.set('X-VEXRank-Cache','weekly-snapshot');return response;
    };
    // VEX IQ ratings: the season's published VIQCR file. Without one the route
    // below answers "pending", as it did before the rating existed.
    const iqSeason=incoming.searchParams.get('season')??String(PROGRAMS.VIQRC.currentSeason);
    const currentIq=incoming.pathname==='/api/rankings'&&incoming.searchParams.get('program')==='VIQRC'&&iqSeason===String(PROGRAMS.VIQRC.currentSeason)&&Boolean((await snapshotDateFile(env)).viqrc?.[iqSeason]);
    // Past IQ seasons, and the current one until its replay is published: the file as it is.
    if(incoming.pathname==='/api/rankings'&&incoming.searchParams.get('program')==='VIQRC'&&!currentIq){
      let path:string|null=null;
      try{path=iqRankingsPath(incoming.searchParams.get('season')??PROGRAMS.VIQRC.currentSeason)}catch{}
      const asset=path?await env.ARCHIVES.fetch(assetRequest(path,incoming,request)):null;
      if(asset?.status===304)return cors(asset);
      if(asset?.ok){const response=cors(asset);response.headers.set('Cache-Control','public,max-age=900');return response}
    }
    // One team's VIQCR history, for profiles the browser builds itself.
    if(incoming.pathname==='/api/viqcr/history'){
      const teamId=Number(incoming.searchParams.get('teamId')),seasonId=Number(incoming.searchParams.get('season')??PROGRAMS.VIQRC.currentSeason);
      if(!Number.isInteger(teamId)||teamId<=0||!Number.isInteger(seasonId))return cors(Response.json({error:'teamId and season are required.'},{status:400}));
      return cors(Response.json({teamId,seasonId,history:await teamHistory(teamId,seasonId)},{headers:{'Cache-Control':'public,max-age=900'}}));
    }
    if (new URL(request.url).pathname === '/api/health') {
      await env.DB.prepare('SELECT 1').first();
      return cors(Response.json({ status: 'ok', environment: 'test', database: 'D1', modelVersion: VCR_VERSION }));
    }
    const url = canonicalUrl(request);
    if (!url) return cors(Response.json({ error: 'Unsupported route or query' }, { status: 400 }));
    // Current rankings are keyed to the snapshot they continue, so a new weekly
    // snapshot never serves - even as a stale fallback - an answer built on the last one.
    const dates=currentIq||currentV5?await snapshotDateFile(env):null;
    const snapshotOf=currentIq?dates?.viqrc?.[iqSeason]:currentV5?dates?.v5:null;
    const key = url.pathname + url.search + (snapshotOf ? `#${snapshotOf}` : '');
    const saved = await env.DB.prepare('SELECT body, expires_at FROM api_cache WHERE key=?').bind(key).first<{body:string; expires_at:number}>().catch(()=>null);
    const wantsLive = request.headers.get('X-VEXRank-Refresh') === '1';
    const decision = cacheDecision(saved, Date.now(), wantsLive);
    const staleAge = decision.age;
    if (decision.serve === 'fresh') return cors(new Response(await unpackBody(saved!.body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=60', 'X-VEXRank-Cache': 'hit' } }));
    // An expired row is still worth more than an error page. Official data goes
    // down and it hangs, and when it does, the reader who opened an event a
    // minute ago is better served by standings that are twenty minutes old than
    // by a spinner that turns into "please retry" after twenty seconds. Bounded,
    // and labelled, so neither the app nor a reader can mistake it for live.
    const savedBody = saved ? await unpackBody(saved.body) : null;
    const stale = (why: string) => {
      if (!saved || staleAge > STALE_FOR) return null;
      return cors(new Response(savedBody, { headers: {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-VEXRank-Cache': 'stale', 'X-VEXRank-Stale-Reason': why, 'Age': String(staleAge),
      } }));
    };

    // Hand back the expired copy now and refresh behind it. Official data is
    // slow when it is working and hangs for twenty seconds when it is not, and
    // making the reader wait for it buys them nothing they can see: the row we
    // already hold is the same answer, minutes older.
    //
    // A reader who pulled to refresh is asking a different question, and gets
    // the slow, truthful path instead.
    if (decision.serve === 'stale') {
      ctx.waitUntil((async () => {
        try {
          const response = await dispatch(url);
          if (!response.ok) return;
          await storeResponse(env, key, await response.text(), response.headers.get(FRESH_FOR_HEADER));
        } catch { /* the copy we just served is still the best answer */ }
      })());
      return stale('revalidating')!;
    }

    // The current season's rankings with nothing cached yet: the weekly file
    // now, and the live update in the background, so a reader never waits on
    // (or sees a failure of) a rebuild.
    if (decision.serve === 'miss' && !wantsLive && (currentV5 || currentIq)) {
      const weekly = await weeklyV5();
      if (weekly) {
        ctx.waitUntil((async () => {
          try { const response = await dispatch(url); if (response.ok) await storeResponse(env, key, await response.text(), response.headers.get(FRESH_FOR_HEADER)); } catch { /* next request tries again */ }
        })());
        return weekly;
      }
    }

    try {
      const response = await dispatch(url);
      if (response.ok) {
        // Large bodies are stored compressed (storeResponse); still too large ones just aren't cached.
        const body = await response.clone().text();
        ctx.waitUntil(storeResponse(env, key, body, response.headers.get(FRESH_FOR_HEADER)).catch(() => {}));
        return cors(response);
      }
      return stale(`upstream-${response.status}`) ?? await weeklyV5() ?? cors(response);
    } catch (error) {
      console.error('API request failed', error instanceof Error ? error.message : 'unknown');
      const limited=error instanceof Error&&/\(429\)/.test(error.message);
      const served = stale(limited ? 'upstream-429' : 'upstream-error') ?? await weeklyV5();
      if (served) return served;
      const expired=error instanceof Error&&/credentials/i.test(error.message);
      return cors(Response.json({ error: limited?'Official data rate limit reached. Resume the archive rebuild later.':expired?'The official data credentials were rejected. The API token needs renewing.':'Official data is temporarily unavailable. Please retry.' }, { status: limited?429:502, headers: { 'Cache-Control': 'no-store',...(limited?{'Retry-After':'300'}:{}) } }));
    }
}

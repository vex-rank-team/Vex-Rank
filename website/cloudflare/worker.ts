import { GET as events } from '../app/api/events/route';
import { GET as event } from '../app/api/events/[id]/route';
import { GET as team } from '../app/api/teams/[number]/route';
import { GET as rankings } from '../app/api/rankings/route';
import { GET as skills } from '../app/api/skills/route';
import { VCR_VERSION } from '../lib/vcr3.mjs';
import { archiveSource } from './archive-source';
import { handleAccount, type AccountEnv } from './account';

interface Env extends AccountEnv { DB: D1Database; ROBOT_EVENTS_API_TOKEN: string; ARCHIVES: Fetcher }

// Allowlist routes and query fields before constructing a stable shared-cache key.
// Unknown query fields are dropped. Add new data-affecting parameters here as well
// as in their route, or distinct requests can incorrectly share cached responses.
function canonicalUrl(request: Request) {
  const incoming = new URL(request.url);
  if (!/^\/api\/(archive-source(?:\/\d{1,10})?|events(?:\/\d{1,10})?|teams\/[0-9]{1,8}[A-Za-z0-9-]{0,12}|rankings|skills)$/.test(incoming.pathname)) return null;
  const url = new URL(incoming.pathname, incoming.origin);
  for (const key of ['season', 'teamId', 'division', 'page']) {
    const value = incoming.searchParams.get(key);
    if (value) {
      if (!/^\d{1,10}$/.test(value)) return null;
      url.searchParams.set(key, value);
    }
  }
  const mode=incoming.searchParams.get('mode');
  if(mode){if(!['metadata','teams','matches'].includes(mode))return null;url.searchParams.set('mode',mode)}
  // Model-version namespace prevents a new rating model from reusing old responses.
  if (url.pathname === '/api/rankings' || url.pathname.startsWith('/api/teams/')) url.searchParams.set('model', VCR_VERSION);
  return url;
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

function cors(response: Response) {
  const result = new Response(response.body, response);
  result.headers.set('Access-Control-Allow-Origin', 'https://vex-rank.com');
  // Account routes (cloudflare/account.ts) write, and authenticate with a Bearer token.
  result.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  result.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  result.headers.set('Access-Control-Max-Age', '600');
  result.headers.set('X-Content-Type-Options', 'nosniff');
  return result;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    // Sign-in, synced scouting data, scouting groups and votes. Never cached.
    const account = await handleAccount(request, env);
    if (account) return cors(account);
    if (request.method !== 'GET') return cors(Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, OPTIONS' } }));
    const archiveSeasons:Record<string,string>={'197':'2025-26','190':'2024-25','181':'2023-24','173':'2022-23'};
    const incoming=new URL(request.url),archiveSeason=incoming.searchParams.get('season');
    if(incoming.pathname==='/api/archive-manifest')return cors(await env.ARCHIVES.fetch(new Request(new URL('/manifest.json',incoming.origin))));
    if(incoming.pathname==='/api/team-directory'){
      const asset=await env.ARCHIVES.fetch(new Request(new URL('/team-directory.json',incoming.origin)));
      if(!asset.ok)return cors(Response.json({error:'Team directory is temporarily unavailable.'},{status:503}));
      const response=cors(asset);response.headers.set('Cache-Control','public,max-age=3600');return response;
    }
    // Historical rankings come only from published static archives. A missing asset
    // is a 503, not a fallback to the live route's partial event sample.
    const archivePath=/^\/rankings-20\d{2}-\d{2}-vcr3\.json$/.test(incoming.pathname)?incoming.pathname:incoming.pathname==='/api/rankings'&&archiveSeason&&archiveSeasons[archiveSeason]?`/rankings-${archiveSeasons[archiveSeason]}-vcr3.json`:null;
    if(archivePath){
      const asset=await env.ARCHIVES.fetch(new Request(new URL(archivePath,incoming.origin)));
      if(!asset.ok)return cors(Response.json({error:'This historical archive is not published yet.'},{status:503,headers:{'Cache-Control':'no-store'}}));
      return cors(asset);
    }
    if (new URL(request.url).pathname === '/api/health') {
      await env.DB.prepare('SELECT 1').first();
      return cors(Response.json({ status: 'ok', environment: 'test', database: 'D1', modelVersion: VCR_VERSION }));
    }
    const url = canonicalUrl(request);
    if (!url) return cors(Response.json({ error: 'Unsupported route or query' }, { status: 400 }));
    const key = url.pathname + url.search;
    try {
      const saved = await env.DB.prepare('SELECT body, expires_at FROM api_cache WHERE key=?').bind(key).first<{body:string; expires_at:number}>();
      if (saved && saved.expires_at > Date.now()) return cors(new Response(saved.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public,max-age=60', 'X-VEXRank-Cache': 'hit' } }));
      const response = await dispatch(url);
      if (response.ok) {
        const body = await response.clone().text();
        // D1 limits individual strings to 2 MB. Larger results still reach the visitor.
        if (new TextEncoder().encode(body).length < 1800000) {
          ctx.waitUntil(env.DB.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at').bind(key, body, Date.now() + 900000).run());
        }
      }
      return cors(response);
    } catch (error) {
      console.error('API request failed', error instanceof Error ? error.message : 'unknown');
      const limited=error instanceof Error&&/\(429\)/.test(error.message);
      return cors(Response.json({ error: limited?'Official data rate limit reached. Resume the archive rebuild later.':'Official data is temporarily unavailable. Please retry.' }, { status: limited?429:502, headers: { 'Cache-Control': 'no-store',...(limited?{'Retry-After':'300'}:{}) } }));
    }
  },
};


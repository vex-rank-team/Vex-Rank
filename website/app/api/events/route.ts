import { classifyEvent } from '@/lib/event-classification';
import { vexCollection } from '@/lib/vex-api';
import { env } from 'cloudflare:workers';
import { eventRankLocksSchema } from '@/db/schema';

const API_ROOT = 'https://events.vex.com/api/v2';
async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

type VexEvent = {
  id: number;
  sku: string;
  name: string;
  start: string;
  end: string;
  level: string | null;
  ongoing: boolean;
  program: { id: number; code: string };
  season: { id:number; name: string };
  location: { city: string | null; region: string | null; country: string | null; coordinates?: { lat?: number; lon?: number } | null } | null;
};


export async function GET(request:Request) {
  const token = process.env.ROBOT_EVENTS_API_TOKEN;
  if (!token) return Response.json({ error: 'RobotEvents API is not configured.' }, { status: 503 });
  const cached=await readCache(request);if(cached)return cached;

  const requestedSeason=new URL(request.url).searchParams.get('season') ?? '204';
  const seasonId=/^\d+$/.test(requestedSeason)?requestedSeason:'204';
  const url = `${API_ROOT}/events?season%5B%5D=${seasonId}&per_page=250`;
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let allEvents:VexEvent[];
  try { allEvents = await vexCollection(url,headers); }
  catch { return Response.json({error:'The event calendar could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
  const currentEvents=allEvents.filter(event=>event.program?.id===1&&String(event.season?.id)===seasonId);
  const signatures=currentEvents.filter(event=>classifyEvent(event.name,event.level).levelClass==='Signature Event');
  const teamCounts=new Map<number,number>();let cursor=0;
  await Promise.all(Array.from({length:Math.min(6,signatures.length)},async()=>{while(cursor<signatures.length){const event=signatures[cursor++];const countResponse=await fetch(`${API_ROOT}/events/${event.id}/teams?per_page=1`,{headers});if(countResponse.ok){const payload=await countResponse.json() as {meta?:{total?:number}};teamCounts.set(event.id,Number(payload.meta?.total??0))}}}));
  const tierFor=(count:number)=>count>=80?{tier:'Gold S',score:3}:count>=48?{tier:'Silver S',score:2}:{tier:'Bronze S',score:1};
  let database:any=null;try{database=(env as any).DB;if(database)await database.prepare(eventRankLocksSchema).run()}catch{}
  const lockedRanks=new Map<number,{tier:string;score:number;count:number;lockedAt:string}>();const now=new Date();
  for(const event of signatures){const count=teamCounts.get(event.id)??0;const provisional=tierFor(count);const lockDate=new Date(new Date(event.start).getTime()-7*86400000);if(now>=lockDate&&database){await database.prepare('INSERT OR IGNORE INTO event_rank_locks (event_id,tier,rank_score,team_count,locked_at) VALUES (?,?,?,?,?)').bind(event.id,provisional.tier,provisional.score,count,now.toISOString()).run();const row=await database.prepare('SELECT tier,rank_score,team_count,locked_at FROM event_rank_locks WHERE event_id=?').bind(event.id).first();if(row)lockedRanks.set(event.id,{tier:String(row.tier),score:Number(row.rank_score),count:Number(row.team_count),lockedAt:String(row.locked_at)})}}
  const events = currentEvents.map(event => {
    const details = classifyEvent(event.name, event.level);
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    const city = [event.location?.city, event.location?.region].filter(Boolean).join(', ') || event.location?.country || 'Location to be announced';
    const teamCount=teamCounts.get(event.id)??0;const provisional=tierFor(teamCount);const locked=lockedRanks.get(event.id);const lockDate=new Date(startDate.getTime()-7*86400000);
    return {
      id: String(event.id), sku: event.sku, date: event.start.slice(0,10), end: endDate.toLocaleString('en-US',{month:'short',day:'2-digit'}).toUpperCase(),
      // For "Today" / "Near today" and "Near me" on the events page.
      endDate: String(event.end ?? event.start).slice(0,10), lat: Number.isFinite(event.location?.coordinates?.lat) ? event.location?.coordinates?.lat : null, lon: Number.isFinite(event.location?.coordinates?.lon) ? event.location?.coordinates?.lon : null,
      tier: details.levelClass === 'World Championship' ? 'Worlds' : details.levelClass === 'Signature Event' ? (locked?.tier??provisional.tier) : 'Official',
      name: event.name, city, region: event.location?.country || 'Unassigned', class: details.levelClass, format: details.format, grade: details.grade,
      teams: details.levelClass==='Signature Event'?(locked?.count??teamCount):0, status: /\bcancell?ed\b/i.test(event.name) ? 'Cancelled' : event.ongoing ? 'In progress' : endDate < now ? 'Completed' : 'Upcoming', weight: 1, eventRegion: event.location?.region || event.location?.country || 'Unassigned',
      eventType: details.eventType, levelClass: details.levelClass, formats: details.eventType === 'Invitational Tournament' ? [details.format,'Invitational'] : [details.format],
      worldQualifier: details.worldQualifier,
      season: event.season?.name, startsAt: startDate.toISOString(),rankScore:details.levelClass==='Signature Event'?(locked?.score??provisional.score):0,rankLocked:Boolean(locked),rankLockDate:lockDate.toISOString(),
    };
  });
  const result=Response.json({ events, source: 'Event.VEX', fetchedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=1800' } });
  await writeCache(request,result);return result;
}

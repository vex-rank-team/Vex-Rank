import { vexCollection, mapLimit, FetchBudgetExhausted } from '@/lib/vex-api';
import { isRecentEvent } from '@/cloudflare/cache-policy';
import { VCR_VERSION } from '@/lib/vcr3.mjs';
import { PROGRAMS, programCode } from '@/lib/programs.mjs';
import { IQ_RATING_PENDING, iqState, saveIqLiveHistory } from '@/lib/vcr-iq.mjs';
import { processIQEvent, VIQCR_VERSION } from '@/lib/viqcr.mjs';
import { normalizeIQSession } from '@/lib/viqcr-import.mjs';
import { unpackIQState, iqRankingRows, iqHistoryPoints } from '@/lib/viqcr-publish.mjs';
import { replayV5Season, v5RankingRows, gradeFromContext, v5Snapshot, restoreV5Replay, continueV5Replay, ratedFromReplay } from '@/lib/v5-season';

const API_ROOT='https://events.vex.com/api/v2';
const SEASONS=PROGRAMS.V5RC.seasons as Record<string,{label:string;start:string;end:string}>;
// A live build needs more official requests than one Worker invocation may
// make on the free plan (50). Each request spends at most this many and keeps
// what it fetched, so a build finishes over a few requests. The event list
// changes as events finish; a finished event's matches and team details don't.
const FETCH_BUDGET=45, KEEP_EVENT_LIST=15*60000, KEEP_SETTLED=6*3600000;
// Results for an event in progress or just finished keep arriving and being
// corrected, so its pages are refetched every 10 minutes rather than kept 6 hours.
const keepForEvent=(event:any)=>isRecentEvent(event)?10*60000:KEEP_SETTLED;

/**
 * VEX IQ: the weekly VIQCR replay (build-iq-ratings.mjs) continued with events
 * finished since, oldest first, within the request budget. An event that
 * finished before the snapshot's last one but was posted late cannot be put in
 * order without a full rebuild, so it waits for the weekly one (VIQCR rejects
 * out-of-order input). `liveHistory` carries the history points added here, so
 * profiles can show them before the next weekly build.
 */
async function liveIqFromSnapshot({state,seasonId,season,headers}:{state:any;seasonId:string;season:{label:string;end:string};headers:Record<string,string>}){
  const cutoff=new Date(Math.min(Date.now(),Date.parse(season.end)));
  const budget={left:FETCH_BUDGET};
  const order=(event:any)=>[Date.parse(event.end),JSON.stringify([String(event.id),'main'])] as const;
  const completed=(await vexCollection(`${API_ROOT}/events?season%5B%5D=${seasonId}&per_page=250`,headers,{keepFor:KEEP_EVENT_LIST,budget}))
    .filter(event=>event.program?.id===PROGRAMS.VIQRC.id&&Date.parse(event.end)<=cutoff.getTime()&&!/cancell?ed/i.test(event.name))
    .sort((a,b)=>order(a)[0]-order(b)[0]||(order(a)[1]<order(b)[1]?-1:1));
  const replay=unpackIQState(state.replay);
  const processed=new Set(replay.processed),seen=new Set(state.seen??[]);
  const missed=completed.filter(event=>!seen.has(event.id)&&!processed.has(order(event)[1]));
  const last=replay.lastOrder;
  const late=missed.filter(event=>last&&(order(event)[0]<last[0]||(order(event)[0]===last[0]&&order(event)[1]<=last[1])));
  const fresh=missed.filter(event=>!late.includes(event));
  const identities=new Map<string,any>(Object.entries(state.identities));
  const historyBefore=new Map<string,number>();
  let applied=0,matchesAdded=0;
  try{
    for(const event of fresh){
      const divisions:any[]=[];
      for(const division of event.divisions??[])divisions.push({...division,matches:await vexCollection(`${API_ROOT}/events/${event.id}/divisions/${division.id}/matches`,headers,{keepFor:keepForEvent(event),budget})});
      const skills=await vexCollection(`${API_ROOT}/events/${event.id}/skills`,headers,{keepFor:keepForEvent(event),budget});
      // New teams get their number from the match records; the weekly build
      // adds their verified details.
      for(const division of divisions)for(const match of division.matches)for(const alliance of match.alliances??[])for(const entry of alliance.teams??[]){const id=String(entry.team?.id??'');if(id&&!identities.has(id))identities.set(id,{number:entry.team?.name})}
      const session=normalizeIQSession({event,seasonId,divisions,skills});
      session.teams=session.teams.map((team:any)=>({...team,number:identities.get(team.id)?.number,grade:identities.get(team.id)?.grade}));
      if(!session.teamwork.length&&!session.skills.length){applied++;seen.add(event.id);continue}
      for(const team of session.teams)if(!historyBefore.has(team.id))historyBefore.set(team.id,replay.teams.get(team.id)?.history.length??0);
      const result=processIQEvent({replay,event:session,normalization:state.normalization,mutate:true});
      matchesAdded+=result.diagnostics.observations;applied++;
    }
  }catch(error){if(!(error instanceof FetchBudgetExhausted)&&!(error instanceof Error&&/\(429\)/.test(error.message)))throw error}
  const {rows,confirmed}=iqRankingRows(replay,{asOf:cutoff.toISOString(),identities,seasonId,season});
  const liveHistory:Record<string,any[]>=Object.fromEntries([...historyBefore].map(([id,before])=>[id,iqHistoryPoints({history:replay.teams.get(id)?.history.slice(before)??[]},seasonId)]).filter(([,points])=>(points as any[]).length));
  await saveIqLiveHistory(Number(seasonId),liveHistory);
  return Response.json({program:'VIQRC',seasonId:Number(seasonId),season:season.label,modelVersion:VIQCR_VERSION,asOf:cutoff.toISOString(),updatedAt:new Date().toISOString(),
    normalization:state.normalization,calibrationEvents:state.calibrationEvents,eventsProcessed:state.eventsProcessed+applied,matchesProcessed:state.matchesProcessed+matchesAdded,
    confirmed,provisional:rows.length-confirmed,snapshotAsOf:state.asOf,liveEvents:applied,liveEventsPending:fresh.length-applied+late.length,rankings:rows,liveHistory},
    {headers:{'Cache-Control':'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200'}});
}

// VEX IQ rankings: the live snapshot path above when the season's replay is
// published; otherwise "pending". A full season replay is ~500 official
// requests and is never run inside a request.
async function iqRankings(request:Request,token:string){
  const program=PROGRAMS.VIQRC;
  const seasons=program.seasons as Record<string,{label:string;start:string;end:string}>;
  const requested=new URL(request.url).searchParams.get('season')??String(program.currentSeason);
  const seasonId=seasons[requested]?requested:String(program.currentSeason);const season=seasons[seasonId];
  const state=await iqState(seasonId);
  if(state&&String(state.seasonId)===seasonId)return liveIqFromSnapshot({state,seasonId,season,headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  return Response.json({program:program.code,seasonId:Number(seasonId),season:season.label,updatedAt:new Date().toISOString(),rankings:[],ratingStatus:IQ_RATING_PENDING,eventsProcessed:0,matchesProcessed:0},{headers:{'Cache-Control':'public, max-age=900, s-maxage=1800'}});
}

async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

const isPlayed=(match:any)=>match.alliances?.length===2&&match.alliances.every((alliance:any)=>Number.isFinite(alliance.score)&&alliance.score>=0&&alliance.teams?.length);

/**
 * The current season from the weekly full-season snapshot (build-v5-rankings.mjs)
 * plus every event that has finished since: only those events' matches are
 * fetched, and they are replayed on top of the snapshot in order. A request
 * that runs out of its budget stops after the last complete event - keeping
 * the order - serves that, and the next refresh carries on from its cached pages.
 */
async function liveFromSnapshot({snapshot,seasonId,season,cutoff,headers}:{snapshot:any;seasonId:string;season:any;cutoff:Date;headers:Record<string,string>}){
  const budget={left:FETCH_BUDGET};
  const eventRows=await vexCollection(`${API_ROOT}/events?season%5B%5D=${seasonId}&per_page=250`,headers,{keepFor:KEEP_EVENT_LIST,budget});
  const completed=eventRows.filter(event=>event.program?.id===1&&String(event.season?.id)===seasonId&&new Date(event.end)<=cutoff&&event.divisions?.length&&!/cancell?ed/i.test(event.name)).sort((a,b)=>String(a.end).localeCompare(String(b.end)));
  const replay=restoreV5Replay(snapshot.replay);
  const missed=completed.filter(event=>!replay.processed.has(event.id));
  const applied:any[]=[],matches:any[]=[];
  try{
    for(const event of missed){
      const eventMatches:any[]=[];
      for(const division of event.divisions){
        const rows=await vexCollection(`${API_ROOT}/events/${event.id}/divisions/${division.id}/matches?round%5B%5D=2&round%5B%5D=3&round%5B%5D=4&round%5B%5D=5&round%5B%5D=6`,headers,{keepFor:keepForEvent(event),budget});
        eventMatches.push(...rows.map(match=>({...match,eventId:event.id,gradeHint:gradeFromContext(`${event.name} ${division.name}`)})));
      }
      matches.push(...eventMatches.filter(isPlayed));applied.push(event);
    }
  }catch(error){if(!(error instanceof FetchBudgetExhausted)&&!(error instanceof Error&&/\(429\)/.test(error.message)))throw error}
  continueV5Replay(replay,{completed:applied,matches});
  const rated=ratedFromReplay(replay,cutoff);
  // Official records: the snapshot's, then the API for teams new since it.
  const official=new Map<number,any>(Object.entries(snapshot.official).map(([id,info])=>[Number(id),info]));
  const unknown=rated.map((team:any)=>team.id).filter((id:number)=>!official.has(id));
  try{for(let index=0;index<unknown.length;index+=100){const ids=unknown.slice(index,index+100).map((id:number)=>`id%5B%5D=${id}`).join('&');for(const team of await vexCollection(`${API_ROOT}/teams?${ids}`,headers,{keepFor:KEEP_SETTLED,budget}))official.set(team.id,team)}}
  catch(error){if(!(error instanceof FetchBudgetExhausted))throw error}
  const rankings=v5RankingRows({rated,official,seasonId,season});
  return Response.json({rankings,eventsProcessed:snapshot.eventsProcessed+applied.length,matchesProcessed:snapshot.matchesProcessed+matches.length,coverage:'full-season',snapshotAsOf:snapshot.asOf,liveEvents:applied.length,liveEventsPending:missed.length-applied.length,method:`${VCR_VERSION} · event settlement · 75-day evidence half-life · every completed event`,modelVersion:VCR_VERSION,season:season.label,seasonId:Number(seasonId),updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200'}});
}

// Live/sample ranking path: only the latest 36 completed events are replayed.
// The Cloudflare entry point intercepts historical seasons and serves archives.
// A direct call to this route is therefore not a full historical-season rebuild.
export async function GET(request:Request){
  const token=process.env.ROBOT_EVENTS_API_TOKEN;
  if(!token)return Response.json({error:'RobotEvents API is not configured.'},{status:503});
  if(programCode(new URL(request.url).searchParams.get('program'))==='VIQRC'){
    // Like the V5 snapshot path below: the Worker's D1 cache is the only cache of this answer.
    try{return await iqRankings(request,token)}
    catch{return Response.json({error:'Rankings could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}})}
  }
  const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
  const requested=new URL(request.url).searchParams.get('season')??'204';const seasonId=SEASONS[requested]?requested:'204';const season=SEASONS[seasonId];
  const wallClock=new Date();const cutoff=new Date(Math.min(wallClock.getTime(),new Date(season.end).getTime()));
  // The current season, when a full-season snapshot is published: snapshot
  // plus the events finished since. Otherwise the 36-event sample below.
  const snapshot=seasonId===String(PROGRAMS.V5RC.currentSeason)?await v5Snapshot():null;
  if(snapshot&&String(snapshot.seasonId)===seasonId){
    // Not kept in the edge cache: the Worker caches it in D1 and refreshes it
    // every 15 minutes, and an edge copy would hold that refresh back.
    try{return await liveFromSnapshot({snapshot,seasonId,season,cutoff,headers})}
    catch(error){console.error('V5 live update failed',error instanceof Error?error.message:'unknown');return Response.json({error:'Rankings could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}})}
  }
  const cached=await readCache(request);if(cached)return cached;
  const eventsUrl=`${API_ROOT}/events?season%5B%5D=${seasonId}&per_page=250`;
  try {
  const budget={left:FETCH_BUDGET};
  const eventRows=await vexCollection(eventsUrl,headers,{keepFor:KEEP_EVENT_LIST,budget});
  const completed=eventRows.filter(event=>event.program?.id===1&&String(event.season?.id)===seasonId&&new Date(event.end)<=cutoff&&event.divisions?.length&&!/cancell?ed/i.test(event.name)).sort((a,b)=>String(a.end).localeCompare(String(b.end))).slice(-36);
  const jobs=completed.flatMap(event=>event.divisions.map((division:any)=>({event,division})));
  const matchGroups=await mapLimit(jobs,3,async({event,division})=>{
    const data=await vexCollection(`${API_ROOT}/events/${event.id}/divisions/${division.id}/matches?round%5B%5D=2&round%5B%5D=3&round%5B%5D=4&round%5B%5D=5&round%5B%5D=6`,headers,{keepFor:KEEP_SETTLED,budget});
    return data.map(match=>({...match,eventId:event.id,gradeHint:gradeFromContext(`${event.name} ${division.name}`)}));
  });
  const matches=matchGroups.flat().filter(match=>match.alliances?.length===2&&match.alliances.every((alliance:any)=>Number.isFinite(alliance.score)&&alliance.score>=0&&alliance.teams?.length));
  const rated=replayV5Season({completed,matches,cutoff});
  const groups=Array.from({length:Math.ceil(rated.length/100)},(_,index)=>rated.slice(index*100,index*100+100));
  const detailPayloads=await mapLimit(groups,3,async group=>{const ids=group.map(team=>`id%5B%5D=${team.id}`).join('&');return vexCollection(`${API_ROOT}/teams?${ids}`,headers,{keepFor:KEEP_SETTLED,budget})});
  const official=new Map(detailPayloads.flat().map(team=>[team.id,team]));
  // The fields called opr/dpr here are half-alliance scoring averages, not fitted
  // OPR/DPR estimates. Zero auto/ase/skills values are placeholders in this response.
  const rankings=v5RankingRows({rated,official,seasonId,season});
  const response=Response.json({rankings,eventsProcessed:completed.length,matchesProcessed:matches.length,method:`${VCR_VERSION} · event settlement · 75-day evidence half-life`,modelVersion:VCR_VERSION,season:season.label,updatedAt:new Date().toISOString()},{headers:{'Cache-Control':'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200'}});
  await writeCache(request,response);return response;
  } catch(error) {
    // Out of requests, or rate limited: either way the pages fetched so far are
    // kept, and the next request carries on from them.
    if(error instanceof FetchBudgetExhausted||(error instanceof Error&&/\(429\)/.test(error.message)))return Response.json({error:'Rankings are being updated. Try again in a minute.',building:true},{status:503,headers:{'Cache-Control':'no-store','Retry-After':'15'}});
    console.error('V5 rankings failed',error instanceof Error?error.message:'unknown'); return Response.json({error:'Rankings could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
}


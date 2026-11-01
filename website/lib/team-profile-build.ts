// Builds a team profile from the team's own official records: one team
// lookup and five collections (events, rankings, awards, skills, matches).
// Nothing here reads another team's data or our database, so the same code
// runs in the Worker (app/api/teams/[number]/route.ts) and in the browser,
// which calls official data directly when it has a token (lib/direct-profile.ts).
import { vexCollection } from './vex-api';
import seasonGradeOverrides from './season-grade-overrides.json';
import { processCompletedEvent, VCR_VERSION } from './vcr3.mjs';
import { decayedRating as computeRating } from './vcr-scoring.mjs';
import { PROGRAMS, programCode } from './programs.mjs';
import { iqGradeFromContext } from './viqrc.mjs';
import { iqRatingHistory, IQ_RATING_PENDING } from './vcr-iq.mjs';
import { VIQCR_VERSION } from './viqcr.mjs';

const API_ROOT = 'https://events.vex.com/api/v2';
const gradeFromContext=(value:string)=>{const text=String(value??'').toLowerCase().replace(/[_/-]+/g,' ');const middle=/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bms\b/.test(text);const high=/\bhigh school\b|\bsenior high\b|\bhs\b/.test(text);return middle&&!high?'Middle School':high&&!middle?'High School':null};
const gradeFromOrganization=(value:string)=>/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bintermediate school\b|\belementary school\b/i.test(String(value??''))?'Middle School':/\bhigh school\b|\bsenior high\b|\bsecondary school\b/i.test(String(value??''))?'High School':null;
const getAll = (url:string,headers:Record<string,string>,_maxPages?:number) => vexCollection(url,headers);

/** `number` is already validated and upper-cased. */
export async function teamProfileResponse(request: Request, number: string, token: string): Promise<Response> {
  const requestUrl=new URL(request.url);const requestedSeason=requestUrl.searchParams.get('season');const requestedTeamId=requestUrl.searchParams.get('teamId');
  const programCodeValue=programCode(requestUrl.searchParams.get('program'));const program=PROGRAMS[programCodeValue];const isIQ=programCodeValue==='VIQRC';
  const seasonFilter=requestedSeason&&/^\d+$/.test(requestedSeason)?`&season%5B%5D=${requestedSeason}`:'';
  const headers = { Authorization:`Bearer ${token}`, Accept:'application/json' };
  try {
  let team:any=null;
  if(requestedTeamId&&/^\d+$/.test(requestedTeamId)){try{const response=await fetch(`${API_ROOT}/teams/${requestedTeamId}`,{headers});if(response.ok){const payload=await response.json() as any;const candidate=payload.data??payload;if(String(candidate.number).toUpperCase()===number&&Number(candidate.program?.id??program.id)===program.id)team=candidate}}catch{}}
  if(!team){const teams=await getAll(`${API_ROOT}/teams?number%5B%5D=${encodeURIComponent(number)}&program%5B%5D=${program.id}&per_page=100`,headers,2);team=teams.find((entry:any)=>String(entry.number).toUpperCase()===number)}
  if (!team) return Response.json({error:`Team ${number} was not found.`},{status:404});

  const base = `${API_ROOT}/teams/${team.id}`;
  const [events, rankings, awards, skills, matches] = await Promise.all([
    getAll(`${base}/events?per_page=250`, headers),
    getAll(`${base}/rankings?per_page=250${seasonFilter}`, headers),
    getAll(`${base}/awards?per_page=250${seasonFilter}`, headers),
    getAll(`${base}/skills?per_page=250${seasonFilter}`, headers),
    getAll(`${base}/matches?per_page=250${seasonFilter}`, headers),
  ]);
  const sortedEvents = events.sort((a:any,b:any)=>String(b.start).localeCompare(String(a.start)));
  const eventMap = new Map(sortedEvents.map((event:any)=>[event.id,event]));
  const matchesByEvent=new Map<number,any[]>();for(const match of matches){const eventId=Number(match.event?.id);if(!matchesByEvent.has(eventId))matchesByEvent.set(eventId,[]);matchesByEvent.get(eventId)!.push(match)}
  const eliminationByEvent = new Map<number,string>();
  const stageOrder:Record<number,number> = {6:1,3:2,4:3,5:4};
  // V5 elimination stages. IQ has teamwork finals, not a bracket, and their
  // encoding is unconfirmed, so IQ events carry no finals line for now.
  for (const event of isIQ ? [] : sortedEvents) {
    const elimination = (matchesByEvent.get(event.id)??[]).filter((match:any)=>stageOrder[match.round]);
    if (!elimination.length) continue;
    const bestStage = Math.max(...elimination.map((match:any)=>stageOrder[match.round]));
    const round = Number(Object.keys(stageOrder).find(key=>stageOrder[Number(key)]===bestStage));
    if (round===5) {
      const finals=elimination.filter((match:any)=>match.round===5);let wins=0;let losses=0;
      for(const match of finals){const own=match.alliances?.find((alliance:any)=>alliance.teams?.some((entry:any)=>entry.team?.id===team.id));const other=match.alliances?.find((alliance:any)=>alliance!==own);if(!own||!other)continue;if(own.score>other.score)wins++;else if(own.score<other.score)losses++}
      eliminationByEvent.set(event.id,wins>losses?'Champion · final rank 1':'Finalist · final rank 2');
    } else if (round===4) eliminationByEvent.set(event.id,'Semifinalist · final rank 3–4');
    else if (round===3) eliminationByEvent.set(event.id,'Quarterfinalist · final rank 5–8');
    else eliminationByEvent.set(event.id,'Round of 16 · final rank 17–32');
  }
  const currentEvents = sortedEvents.filter((event:any)=>event.season?.id===program.currentSeason);
  const seasonIds = new Set(sortedEvents.map((event:any)=>event.season?.id).filter(Boolean));
  const gradeEvidence=new Map<number,{middle:Set<number>;high:Set<number>}>();
  const evidenceFor=(seasonId:number)=>{if(!gradeEvidence.has(seasonId))gradeEvidence.set(seasonId,{middle:new Set(),high:new Set()});return gradeEvidence.get(seasonId)!};
  for(const event of sortedEvents){const seasonId=Number(event.season?.id);const hint=gradeFromContext(event.name);if(!seasonId||!hint)continue;const evidence=evidenceFor(seasonId);(hint==='Middle School'?evidence.middle:evidence.high).add(event.id)}
  for(const row of rankings){const event=eventMap.get(row.event?.id) as any;const seasonId=Number(event?.season?.id);const hint=gradeFromContext(`${event?.name??''} ${row.division?.name??''}`);if(!seasonId||!hint)continue;const evidence=evidenceFor(seasonId);(hint==='Middle School'?evidence.middle:evidence.high).add(event.id)}
  const organizationGrade=gradeFromOrganization(team.organization);
  // IQ grades are Elementary and Middle School, named in IQ event and division
  // titles ("VIQRC_ES: Elementary School"); the V5 evidence above never sees them.
  const iqGrades=new Map<number,{elementary:number;middle:number}>();
  if(isIQ)for(const row of rankings){const event=eventMap.get(row.event?.id) as any;const seasonId=Number(event?.season?.id);const hint=iqGradeFromContext(`${event?.name??''} ${row.division?.name??''}`);if(!seasonId||!hint)continue;const tally=iqGrades.get(seasonId)??{elementary:0,middle:0};if(hint==='Elementary School')tally.elementary++;else tally.middle++;iqGrades.set(seasonId,tally)}
  const seasonGrades=isIQ?Object.fromEntries([...seasonIds].map(value=>{const tally=iqGrades.get(Number(value));const grade=tally&&tally.elementary!==tally.middle?(tally.elementary>tally.middle?'Elementary School':'Middle School'):team.grade??'Unknown';return[Number(value),grade]})):Object.fromEntries([...seasonIds].map(value=>{const seasonId=Number(value);const evidence=evidenceFor(seasonId);const eventGrade=evidence.middle.size===evidence.high.size?null:evidence.middle.size>evidence.high.size?'Middle School':'High School';const verifiedGrade=(seasonGradeOverrides as Record<string,Record<string,string>>)[String(seasonId)]?.[team.number];return[seasonId,verifiedGrade??eventGrade??organizationGrade??team.grade??'Unknown']}));
  // Season-scoped, one fresh state per season, because /api/rankings does the
  // same. Accumulating a whole career here made a veteran team's graph end
  // ~111 points above the rating its own ranking row showed.
  const ratingHistoryByTeam=new Map<number,any[]>();
  const orderedEvents=[...sortedEvents].sort((a:any,b:any)=>String(a.start).localeCompare(String(b.start)));
  const seasonsInOrder=[...new Set(orderedEvents.map((event:any)=>Number(event.season?.id)).filter(Boolean))];
  // The V5 model reads two alliances as opponents. An IQ teamwork match has
  // none, so it must never run here; the IQ hook answers instead.
  for(const seasonId of isIQ ? [] : seasonsInOrder){
    const seasonStates=new Map<number,any>();
    for(const event of orderedEvents){
      if(Number(event.season?.id)!==seasonId)continue;
      const eventMatches=(matchesByEvent.get(event.id)??[]).filter((match:any)=>match.started).sort((a:any,b:any)=>String(a.scheduled??a.started).localeCompare(String(b.scheduled??b.started)));
      if(eventMatches.length)processCompletedEvent({event,matches:eventMatches,states:seasonStates,historyByTeam:ratingHistoryByTeam});
    }
  }
  // Re-express each point through the same decayed formula the ranking uses, so
  // the last point of the graph equals the rating in the table.
  const ratingCutoff=new Date();
  const rawHistory=ratingHistoryByTeam.get(team.id)??[];
  const bySeason=new Map<number,any[]>();
  for(const row of rawHistory){const list=bySeason.get(row.seasonId)??[];list.push(row);bySeason.set(row.seasonId,list)}
  const v5History=()=>rawHistory.map(row=>{
    const seasonRows=bySeason.get(row.seasonId)??[];
    const upToHere=seasonRows.slice(0,seasonRows.indexOf(row)+1);
    return{...row,rating:Math.round(computeRating(upToHere,ratingCutoff))};
  });
  // VIQCR history comes from the season's published ratings (lib/vcr-iq.mjs):
  // a season replay is far too large to run for one profile.
  const iqHistory=isIQ?await iqRatingHistory(team.id,Number(requestedSeason??program.currentSeason)):null;
  const ratingHistory=isIQ?(iqHistory??[]):v5History();
  const response=Response.json({
    team:{id:team.id,number:team.number,name:team.team_name||team.organization||team.number,organization:team.organization||'',robot:team.robot_name||'',grade:team.grade||'Unknown',region:[team.location?.city,team.location?.region,team.location?.country].filter(Boolean).join(', ')||'Unassigned',country:team.location?.country||'Unassigned',registered:Boolean(team.registered),active:currentEvents.length>0,currentSeasonEvents:currentEvents.length,seasons:seasonIds.size},
    events:sortedEvents.map((event:any)=>({id:event.id,sku:event.sku,name:event.name,start:event.start,end:event.end,season:event.season?.name||'Unknown season',seasonId:event.season?.id,level:event.level,location:[event.location?.city,event.location?.region,event.location?.country].filter(Boolean).join(', '),elimination:isIQ?null:eliminationByEvent.get(event.id)||'No elimination result'})),
    rankings:rankings.map((row:any)=>{const event=eventMap.get(row.event?.id) as any;return{event:row.event?.name||row.event?.code||'Official event',eventId:row.event?.id,season:event?.season?.name||'',seasonId:event?.season?.id,division:row.division?.name||'',rank:row.rank,wins:row.wins,losses:row.losses,ties:row.ties,wp:row.wp,ap:row.ap,sp:row.sp,highScore:row.high_score,...(isIQ?{averagePoints:row.average_points??null}:{})}}),
    awards:awards.map((award:any)=>{const event=eventMap.get(award.event?.id) as any;return{title:award.title||award.name,event:award.event?.name||'Official event',eventId:award.event?.id,season:event?.season?.name||'',seasonId:event?.season?.id}}),
    skills:skills.sort((a:any,b:any)=>Number(b.score)-Number(a.score)).map((skill:any)=>({event:skill.event?.name||'Official event',eventId:skill.event?.id,type:skill.type,score:skill.score,attempts:skill.attempts,rank:skill.rank,season:skill.season?.name||'',seasonId:skill.season?.id??(eventMap.get(skill.event?.id) as any)?.season?.id})),
    seasonGrades,
    ratingHistory,modelVersion:isIQ?VIQCR_VERSION:VCR_VERSION,program:programCodeValue,
    ...(isIQ&&!iqHistory?{ratingStatus:IQ_RATING_PENDING}:{}),
    loadedSeasonIds:requestedSeason?[Number(requestedSeason)]:[...seasonIds].map(Number),
  },{headers:{'Cache-Control':'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200'}});
  return response;
  } catch { return Response.json({error:'Team history could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}}); }
}


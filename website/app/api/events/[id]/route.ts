import { vexCollection, vexJson, mapLimit } from '@/lib/vex-api';
import { isRecentEvent, RECENT_FRESH_FOR, FRESH_FOR_HEADER } from '@/cloudflare/cache-policy';
import { officialEventUrl, programOf } from '@/lib/programs.mjs';
const API_ROOT = 'https://events.vex.com/api/v2';

async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

const getAllTeams = (id:string, headers:Record<string,string>) => vexCollection(`${API_ROOT}/events/${id}/teams`,headers);
const getAll = (url:string, headers:Record<string,string>) => vexCollection(`${API_ROOT}${url}`,headers);

function htmlToText(html:string) {
  return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/td>/gi,' | ').replace(/<\/(p|li|tr|div|h[1-6])>/gi,'\n')
    .replace(/<li[^>]*>/gi,'• ').replace(/<[^>]+>/g,'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&ndash;/gi,'–').replace(/&mdash;/gi,'—')
    .replace(/&#(\d+);/g,(_,code)=>String.fromCharCode(Number(code))).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}

function organizerSections(html:string) {
  const names=['General Info','Agenda','Volunteer','Emergency/Bad Weather Policy','Refund and Payment Policies','Travel Info','Webcast','Judging Format','Teams','Waitlist','Results','Awards'];
  const headings=[...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)].map(match=>({index:match.index ?? 0,end:(match.index ?? 0)+match[0].length,name:htmlToText(match[2]).trim()}));
  const read=(name:string)=>{
    const candidates=headings.filter(heading=>heading.name.toLowerCase()===name.toLowerCase()).map(heading=>{
      const next=headings.find(other=>other.index>heading.end&&names.some(section=>section.toLowerCase()===other.name.toLowerCase()));
      return htmlToText(html.slice(heading.end,next?.index ?? html.length));
    }).filter(Boolean).sort((a,b)=>b.length-a.length);
    return candidates[0] ?? '';
  };
  return {general:read('General Info'),agenda:read('Agenda'),travel:read('Travel Info'),webcast:read('Webcast')};
}

export async function GET(request:Request, context:{params:Promise<{id:string}>}) {
  const token = process.env.ROBOT_EVENTS_API_TOKEN;
  if (!token) return Response.json({error:'RobotEvents API is not configured.'},{status:503});
  const {id} = await context.params;
  if (!/^\d+$/.test(id)) return Response.json({error:'Invalid event.'},{status:400});
  const cached=await readCache(request);if(cached)return cached;
  const headers = {Authorization:`Bearer ${token}`,Accept:'application/json'};
  try {
  const event = await vexJson(`${API_ROOT}/events/${id}`,headers);
  const divisions = event.divisions ?? [];
  const program = programOf(event);
  const officialUrl = officialEventUrl(program, event.sku);
  const organizerPromise=(async()=>{try{const officialResponse=await fetch(officialUrl,{headers:{Accept:'text/html','User-Agent':'VEXRank/1.0'}});if(officialResponse.ok)return organizerSections(await officialResponse.text())}catch{}return{general:'',agenda:'',travel:'',webcast:''}})();
  const [teams,awards,skills,divisionData,organizer] = await Promise.all([
    getAllTeams(id,headers),
    getAll(`/events/${id}/awards`,headers),
    getAll(`/events/${id}/skills`,headers),
    mapLimit(divisions,1,async (division:any) => {
      // V5 elimination rounds. VEX IQ teamwork finals are not in these rounds
      // and are not fetched yet: how they are encoded needs confirming with a
      // token first (docs/viqrc-plan.md, open question 3). IQ screens show no
      // finals section until then rather than an empty one.
      const eliminationRounds='round%5B%5D=3&round%5B%5D=4&round%5B%5D=5&round%5B%5D=6';
      const [rankings,qualificationMatches,eliminationMatches] = await Promise.all([
        getAll(`/events/${id}/divisions/${division.id}/rankings`,headers),
        getAll(`/events/${id}/divisions/${division.id}/matches?round%5B%5D=2`,headers),
        getAll(`/events/${id}/divisions/${division.id}/matches?${eliminationRounds}`,headers),
      ]);
      const matches=[...qualificationMatches,...eliminationMatches].sort((a:any,b:any)=>Number(a.round)-Number(b.round)||Number(a.instance)-Number(b.instance)||Number(a.matchnum)-Number(b.matchnum));
      return {
        id:division.id,name:division.name,
        // IQ ranks by average teamwork score. Passed through when upstream
        // serves it; IQ screens compute it from the matches when it does not.
        rankings:rankings.map((row:any)=>({rank:row.rank,team:row.team,wins:row.wins,losses:row.losses,ties:row.ties,wp:row.wp,ap:row.ap,sp:row.sp,highScore:row.high_score,...(program==='VIQRC'?{averagePoints:row.average_points??null,totalPoints:row.total_points??null}:{})})),
        matches:matches.map((match:any)=>({id:match.id,name:match.name,round:Number(match.round),instance:match.instance,matchnum:match.matchnum,scheduled:match.scheduled,started:match.started,field:match.field,scored:Boolean(match.scored),alliances:match.alliances})),
      };
    }),
    organizerPromise,
  ]);
  const response=Response.json({
    event:{
      id:event.id,sku:event.sku,name:event.name,start:event.start,end:event.end,season:event.season,program:event.program,
      location:event.location,locations:event.locations ?? [],divisions:event.divisions ?? [],level:event.level,eventType:event.event_type,
      ongoing:event.ongoing,awardsFinalized:event.awards_finalized,officialUrl,
    },
    teams:teams.map(team=>({id:team.id,number:team.number,name:team.team_name,robot:team.robot_name,organization:team.organization,grade:team.grade,location:team.location})),
    divisions:divisionData,
    awards:awards.map((award:any)=>({id:award.id,title:award.title,designation:award.designation,classification:award.classification,teamWinners:award.teamWinners ?? [],individualWinners:award.individualWinners ?? []})),
    skills:skills.map((skill:any)=>({id:skill.id,team:skill.team,type:skill.type,rank:skill.rank,score:skill.score,attempts:skill.attempts ?? 0})),
    organizer,
  },{headers:isRecentEvent(event)
    // Results are still arriving: a short life everywhere, and the Worker told
    // to keep it a minute rather than its usual fifteen.
    ?{'Cache-Control':'public, max-age=30, stale-while-revalidate=60',[FRESH_FOR_HEADER]:String(RECENT_FRESH_FOR)}
    :{'Cache-Control':'public, max-age=300, s-maxage=300, stale-while-revalidate=1800'}});
  if(!isRecentEvent(event))await writeCache(request,response);
  return response;
  } catch (error) {
    console.error('Event data load failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({error:'Official event data could not be fully loaded. Please retry.'},{status:502,headers:{'Cache-Control':'no-store'}});
  }
}

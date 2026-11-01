import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { confidenceFor } from '../lib/vcr-scoring.mjs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { processCompletedEvent, VCR_VERSION } from '../lib/vcr3.mjs';
import { historicalMatches } from '../lib/archive-matches.mjs';

// Run from website/: node scripts/rebuild-season-archives.mjs 197 [190 181 173].
// Downloads are resumable; publishing the generated assets is a separate step.
// Uses the existing public competition-data API; its server retains the API credential.
const api = 'https://vexrank-api-test.qiansteven54.workers.dev';
const seasons = {197:['2025–26 Push Back','2026-06-01','2025-26'],190:['2024–25 High Stakes','2025-06-01','2024-25'],181:['2023–24 Over Under','2024-06-01','2023-24'],173:['2022–23 Spin Up','2023-06-01','2022-23']};
const selected = process.argv.slice(2).map(Number);
if (!selected.length || selected.some(id=>!seasons[id])) throw new Error('Specify season IDs: 197 190 181 173');
const overrides = JSON.parse(await readFile(resolve('lib/season-grade-overrides.json'),'utf8'));
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
// Cache successful pages as well as complete event payloads, so a failed final
// page does not force earlier pages to be downloaded again. Caches have no TTL:
// a rebuild reuses snapshots; upstream corrections require deliberate refresh.
const pageCache=resolve('.ranking-cache/archive-pages');await mkdir(pageCache,{recursive:true});
// Shared reservation clock spaces both download workers' requests by 1.8 seconds.
let nextRequest=0;
async function get(path) {
  const cachedFile=resolve(pageCache,createHash('sha256').update(path).digest('hex')+'.json');
  try{return JSON.parse(await readFile(cachedFile,'utf8'))}catch{}
  for(let attempt=0;attempt<5;attempt++) {
    try {
      const wait=Math.max(0,nextRequest-Date.now());nextRequest=Math.max(nextRequest,Date.now())+1800;if(wait)await sleep(wait);
      const r=await fetch(api+path,{signal:AbortSignal.timeout(90000)});
      if(r.ok){const data=await r.json();await writeFile(cachedFile,JSON.stringify(data));return data}
      if(r.status===429)throw Object.assign(new Error('Official API rate limit reached; cached progress preserved. Retry later.'),{rateLimited:true});
      if(r.status<500&&r.status!==429)throw new Error(`HTTP ${r.status}: ${path}`);
    } catch(error) { if(error.rateLimited||attempt===4)throw error; }
    await sleep(Math.min(30000,2000*2**attempt));
  }
  throw new Error(`Could not retrieve ${path}`);
}
async function paged(path){const first=await get(path);if(!Array.isArray(first.data))throw new Error('Invalid source page');const data=[...first.data];for(let page=2;page<=Number(first.meta?.last_page??1);page++){const next=await get(`${path}&page=${page}`);if(!Array.isArray(next.data))throw new Error('Invalid source page');data.push(...next.data)}return data}
// Reuse the older direct-API cache only when every division page is present.
// Otherwise fetch through the public adapter; historicalMatches filters afterward.
async function divisionMatches(event,d){
  const url=`https://events.vex.com/api/v2/events/${event.id}/divisions/${d.id}/matches?per_page=250`;
  const readLegacy=async path=>JSON.parse(await readFile(resolve(`.ranking-cache/${event.season.id}/${createHash('sha1').update(path).digest('hex')}.json`),'utf8'));
  try{const first=await readLegacy(url),data=[...first.data];for(let page=2;page<=Number(first.meta?.last_page??1);page++)data.push(...(await readLegacy(`${url}&page=${page}`)).data);return data}catch{}
  return paged(`/api/archive-source/${event.id}?mode=matches&division=${d.id}`);
}
async function eventPayload(event){
  const id=event.id;
  const teams=await paged(`/api/archive-source/${id}?mode=teams`),divisions=[];
  for(const d of event.divisions??[])divisions.push({...d,matches:await divisionMatches(event,d)});
  return{event,divisions,teams:teams.map(t=>({id:t.id,number:t.number,name:t.team_name,organization:t.organization,grade:t.grade,location:t.location}))};
}
for(const season of selected) {
  const [label,end,suffix]=seasons[season],cache=resolve(`.ranking-cache/${season}/event-payloads`);
  await mkdir(cache,{recursive:true});
  const calendar=await get(`/api/archive-source?season=${season}`);
  if(!Array.isArray(calendar.events)||!calendar.events.length)throw new Error(`Missing calendar for ${season}`);
  const events=calendar.events.filter(e=>e.status==='Completed').sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||Number(a.id)-Number(b.id));
  const failures=[],payloads=new Map();let cursor=0,done=0;
  console.log(`${label}: loading ${events.length} completed events`);
  await Promise.all(Array.from({length:2},async()=>{while(cursor<events.length){
    const e=events[cursor++],file=resolve(cache,`${e.id}.json`);
    try {
      let p;try{p=JSON.parse(await readFile(file,'utf8'))}catch{p=await eventPayload(e)}
      if(Number(p.event?.season?.id)!==season||!Array.isArray(p.divisions)||!Array.isArray(p.teams))throw new Error('Invalid event payload');
      await writeFile(file,JSON.stringify(p));payloads.set(Number(e.id),p);
    } catch(error){failures.push({event:e.id,error:String(error)});console.error(`Event ${e.id}: ${error}`);if(error.rateLimited)cursor=events.length}
    done++;if(done%20===0||done===events.length)console.log(`${season}: ${done}/${events.length}; failures=${failures.length}`);
  }}));
  // Coverage means every event in the fetched calendar has a payload. Stop before
  // replacing the public file if any payload failed; the prior archive stays usable.
  const report={season,expectedEvents:events.length,loadedEvents:payloads.size,failures,modelVersion:VCR_VERSION};
  await writeFile(resolve(cache,'coverage.json'),JSON.stringify(report,null,2));
  if(failures.length||payloads.size!==events.length)throw new Error(`${season}: incomplete data; previous archive preserved. Resume this command to retry cached gaps.`);
  const states=new Map(),historyByTeam=new Map(),profiles=new Map();let matchesProcessed=0,eventsWithMatches=0;
  // Download order is nondeterministic. Replay by end date, then ID, because each
  // event's frozen starting ratings depend on all previously settled events.
  for(const p of [...payloads.values()].sort((a,b)=>a.event.end.localeCompare(b.event.end)||a.event.id-b.event.id)){
    const matches=historicalMatches(p.divisions);
    if(!matches.length)continue;
    processCompletedEvent({event:p.event,matches,states,historyByTeam});matchesProcessed+=matches.length;eventsWithMatches++;
    for(const team of p.teams)profiles.set(team.id,team);
  }
  const rankings=[...states.values()].filter(t=>t.matches>=4).map(t=>{
    const info=profiles.get(t.id)??{},history=historyByTeam.get(t.id)??[];
    // Decay event deltas at a fixed season end (75-day half-life), not today's date.
    // This affects leaderboard display only; replay state retains undecayed ratings.
    const rating=1500+history.reduce((sum,h)=>sum+h.rawChange*2**(-Math.max(0,(Date.parse(end)-Date.parse(h.eventDate))/86400000)/75),0);
    const confidence=confidenceFor(t.matches);
    return {id:t.id,number:info.number??t.number,name:info.name??t.number,region:[info.location?.region,info.location?.country].filter(Boolean).join(', ')||'Unassigned',country:info.location?.country??'Unassigned',rating:Math.round(rating),displayedStrength:rating-confidence,confidence,change:history.at(-1)?.change??0,record:`${t.wins}–${t.losses}–${t.ties}`,matches:t.matches,events:t.events.size,opr:t.pointsFor/t.matches/2,dpr:t.pointsAgainst/t.matches/2,ccwm:(t.pointsFor-t.pointsAgainst)/t.matches/2,auto:0,ase:0,skills:0,form:history.slice(-5),grade:overrides[season]?.[info.number??t.number]??info.grade??'Unknown',organization:info.organization??'',seasonId:season,season:label};
  }).sort((a,b)=>b.displayedStrength-a.displayedStrength||a.number.localeCompare(b.number)).map((t,i)=>({...t,rank:i+1}));
  if(!rankings.length||rankings.some(t=>!Number.isFinite(t.rating)))throw new Error('Invalid rebuilt rankings');
  const output={rankings,eventsProcessed:eventsWithMatches,matchesProcessed,coverage:report,modelVersion:VCR_VERSION,method:`${VCR_VERSION} · full completed-season event settlement · 75-day half-life at season end`,season:label,seasonId:season,asOf:end,updatedAt:new Date().toISOString()};
  // Versioned artifact: retain the original archive until publication succeeds.
  const outputFile=resolve(`public/rankings-${suffix}-vcr3.json`);
  await writeFile(outputFile+'.tmp',JSON.stringify(output));await rename(outputFile+'.tmp',outputFile);
  console.log(`SAVED ${outputFile}: ${rankings.length} teams, ${matchesProcessed} matches`);
}


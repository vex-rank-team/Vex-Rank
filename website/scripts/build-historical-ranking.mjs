// Legacy direct-token builder. Run from website/ with a season ID.
// It reads at most three divisions per event and emits unversioned JSON without
// full coverage metadata. Use rebuild-season-archives.mjs for publishable VCR 3
// archives; changing the filename alone does not make this output complete.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { recencyWeight as sharedRecencyWeight, confidenceFor } from '../lib/vcr-scoring.mjs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { processCompletedEvent, VCR_VERSION } from '../lib/vcr3.mjs';

const token=process.env.ROBOT_EVENTS_API_TOKEN;
if(!token)throw new Error('ROBOT_EVENTS_API_TOKEN is required');
const root='https://events.vex.com/api/v2';
const headers={Authorization:`Bearer ${token}`,Accept:'application/json'};
const seasons={
  197:{label:'2025–26 Push Back',start:'2025-04-15T00:00:00Z',end:'2026-06-01T00:00:00Z',file:'rankings-2025-26.json'},
  190:{label:'2024–25 High Stakes',start:'2024-04-01T00:00:00Z',end:'2025-06-01T00:00:00Z',file:'rankings-2024-25.json'},
  181:{label:'2023–24 Over Under',start:'2023-04-01T00:00:00Z',end:'2024-06-01T00:00:00Z',file:'rankings-2023-24.json'},
  173:{label:'2022–23 Spin Up',start:'2022-04-01T00:00:00Z',end:'2023-06-01T00:00:00Z',file:'rankings-2022-23.json'},
};
const seasonId=Number(process.argv[2]??197);const config=seasons[seasonId];if(!config)throw new Error('Unsupported season id');
const seasonEnd=new Date(config.end);
// Decay is measured from the season's end, not today: an archive must not
// change every time it is regenerated.
const recencyWeight=date=>sharedRecencyWeight(date,seasonEnd);
const gradeFromContext=value=>{const text=String(value??'').toLowerCase().replace(/[_/-]+/g,' ');const middle=/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bms\b/.test(text);const high=/\bhigh school\b|\bsenior high\b|\bhs\b/.test(text);return middle&&!high?'Middle School':high&&!middle?'High School':null};
const gradeFromOrganization=value=>/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bintermediate school\b|\belementary school\b/i.test(String(value??''))?'Middle School':/\bhigh school\b|\bsenior high\b|\bsecondary school\b/i.test(String(value??''))?'High School':null;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const cacheDir=resolve(`.ranking-cache/${seasonId}`);await mkdir(cacheDir,{recursive:true});
let nextRequestAt=0;
async function requestSlot(){const now=Date.now();const wait=Math.max(0,nextRequestAt-now);nextRequestAt=Math.max(now,nextRequestAt)+900;if(wait)await delay(wait)}
async function get(url,attempt=0){
  const cacheFile=resolve(cacheDir,`${createHash('sha1').update(url).digest('hex')}.json`);
  try{return JSON.parse(await readFile(cacheFile,'utf8'))}catch{}
  await requestSlot();
  const response=await fetch(url,{headers});
  if((response.status===429||response.status>=500)&&attempt<30){
    const retryAfter=Number(response.headers.get('retry-after')??0);
    const wait=Math.max(retryAfter*1000,Math.min(60000,2000*2**Math.min(5,attempt)));
    nextRequestAt=Math.max(nextRequestAt,Date.now()+wait);
    console.warn(`${response.status}; retrying in ${Math.ceil(wait/1000)}s`);
    await delay(wait);return get(url,attempt+1);
  }
  if(!response.ok)throw new Error(`${response.status} ${url}`);
  const payload=await response.json();await writeFile(cacheFile,JSON.stringify(payload));return payload;
}
async function mapLimit(items,limit,worker){const results=new Array(items.length);let next=0;async function run(){while(next<items.length){const index=next++;results[index]=await worker(items[index],index);if((index+1)%100===0)console.log(`Fetched ${index+1}/${items.length}`)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return results}

const base=`${root}/events?start=${encodeURIComponent(config.start)}&end=${encodeURIComponent(config.end)}&per_page=250`;
const first=await get(base);
const otherPages=await mapLimit(Array.from({length:first.meta.last_page-1},(_,index)=>index+2),1,page=>get(`${base}&page=${page}`).then(payload=>payload.data));
const events=[...first.data,...otherPages.flat()].filter(event=>event.program?.id===1&&event.season?.id===seasonId&&event.divisions?.length);
const jobs=events.flatMap(event=>event.divisions.slice(0,3).map(division=>({event,division})));
console.log(`Loading ${jobs.length} divisions from ${events.length} ${config.label} events...`);
const matchGroups=await mapLimit(jobs,1,async({event,division})=>{const url=`${root}/events/${event.id}/divisions/${division.id}/matches?per_page=250`;const firstPage=await get(url);const rest=firstPage.meta.last_page>1?await mapLimit(Array.from({length:firstPage.meta.last_page-1},(_,index)=>index+2),1,page=>get(`${url}&page=${page}`).then(payload=>payload.data)):[];return[...firstPage.data,...rest.flat()].map(match=>({...match,eventId:event.id,eventDate:event.start,gradeHint:gradeFromContext(`${event.name} ${division.name}`)}))});
const matches=matchGroups.flat().filter(match=>match.alliances?.length===2&&match.alliances.every(alliance=>Number.isFinite(alliance.score)&&alliance.teams?.length));
matches.sort((a,b)=>String(a.scheduled??a.updated_at??a.eventDate).localeCompare(String(b.scheduled??b.updated_at??b.eventDate)));
const states=new Map(),historyByTeam=new Map(),matchesByEvent=new Map();for(const match of matches){if(!matchesByEvent.has(match.eventId))matchesByEvent.set(match.eventId,[]);matchesByEvent.get(match.eventId).push(match)}
for(const event of events.sort((a,b)=>String(a.end).localeCompare(String(b.end)))){const eventMatches=matchesByEvent.get(event.id)??[];processCompletedEvent({event,matches:eventMatches,states,historyByTeam});for(const match of eventMatches)for(const alliance of match.alliances??[])for(const entry of alliance.teams??[]){const team=states.get(entry.team?.id);if(!team)continue;if(match.gradeHint==='Middle School')team.middleGradeEvents.add(event.id);if(match.gradeHint==='High School')team.highGradeEvents.add(event.id)}}
const rated=[...states.values()].filter(team=>team.matches>=4).map(team=>{const confidence=confidenceFor(team.matches);const history=historyByTeam.get(team.id)??[];const rating=1500+history.reduce((sum,row)=>sum+Number(row.rawChange??row.change)*recencyWeight(row.eventDate),0);return{...team,rating,events:team.events.size,confidence,displayedStrength:rating-confidence,form:history.slice(-5)}}).sort((a,b)=>b.displayedStrength-a.displayedStrength);
const detailGroups=[];for(let i=0;i<rated.length;i+=100)detailGroups.push(rated.slice(i,i+100));
const detailPayloads=await mapLimit(detailGroups,1,group=>get(`${root}/teams?${group.map(team=>`id%5B%5D=${team.id}`).join('&')}&per_page=100`).then(payload=>payload.data));
const official=new Map(detailPayloads.flat().map(team=>[team.id,team]));
const rankings=rated.map((team,index)=>{const info=official.get(team.id);const games=Math.max(1,team.matches);const opr=team.pointsFor/games/2;const dpr=team.pointsAgainst/games/2;const eventGrade=team.middleGradeEvents.size===team.highGradeEvents.size?null:team.middleGradeEvents.size>team.highGradeEvents.size?'Middle School':'High School';const grade=eventGrade??gradeFromOrganization(info?.organization)??info?.grade??'Unknown';return{rank:index+1,id:team.id,number:info?.number??team.number,name:info?.team_name??info?.organization??team.number,region:[info?.location?.region,info?.location?.country].filter(Boolean).join(', ')||'Unassigned',country:info?.location?.country||'Unassigned',rating:Math.round(team.rating),confidence:team.confidence,change:team.form.at(-1)?.change??0,record:`${team.wins}–${team.losses}–${team.ties}`,events:team.events,opr:Number(opr.toFixed(1)),dpr:Number(dpr.toFixed(1)),ccwm:Number((opr-dpr).toFixed(1)),auto:0,ase:0,consistency:Math.max(0,Math.min(100,Math.round(100-team.confidence/2))),skills:0,form:team.form,matches:team.matches,grade,organization:info?.organization??'',robot:info?.robot_name??''}});
const output={rankings,eventsProcessed:events.length,matchesProcessed:matches.length,method:`${VCR_VERSION} · event settlement · 75-day evidence half-life`,modelVersion:VCR_VERSION,season:config.label,updatedAt:new Date().toISOString()};
await writeFile(resolve(`public/${config.file}`),JSON.stringify(output));
console.log(`Wrote ${rankings.length} teams from ${matches.length} matches and ${events.length} events.`);


import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const token=process.env.ROBOT_EVENTS_API_TOKEN;
if(!token)throw new Error('ROBOT_EVENTS_API_TOKEN is required');
// `--program 41` builds the VEX IQ directory into its own asset; the default,
// program 1, writes exactly the V5 files it always has.
const programFlag=process.argv.indexOf('--program');
const programId=programFlag>=0?Number(process.argv[programFlag+1]):1;
if(![1,41].includes(programId))throw new Error('--program must be 1 (V5RC) or 41 (VIQRC)');
const suffix=programId===41?'-viqrc':'';
// Written into the file so a client can tell which list it was handed: a
// server that predates VEX IQ answers the IQ request with the V5 file.
const programCode=programId===41?'VIQRC':'V5RC';
const cacheDir=`work/team-directory-pages${suffix}`;
await mkdir(cacheDir,{recursive:true});
async function page(number,refresh=false,registered=false){
  const path=`${cacheDir}/${registered?'registered-':''}${number}.json`;
  try{const saved=JSON.parse(await readFile(path,'utf8'));if(!refresh&&Date.now()-saved.savedAt<86400000)return saved.payload;}catch{}
  for(let attempt=0;attempt<5;attempt++){
    await new Promise(resolve=>setTimeout(resolve,1400));
    const response=await fetch(`https://events.vex.com/api/v2/teams?program%5B%5D=${programId}&per_page=250&page=${number}${registered?'&registered=true':''}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
    if(response.ok){const payload=await response.json();if(!Array.isArray(payload.data)||!payload.meta)throw new Error('Invalid directory page');await writeFile(path,JSON.stringify({savedAt:Date.now(),payload}));return payload;}
    if(response.status!==429&&response.status<500)throw new Error(`Directory request failed: ${response.status}`);
    await new Promise(resolve=>setTimeout(resolve,response.status===429?60000:2000));
  }
  throw new Error(`Failed to load directory page ${number}`);
}
const first=await page(1),all=[...first.data];
let cursor=2,completed=1;
await Promise.all(Array.from({length:2},async()=>{while(cursor<=first.meta.last_page){
  const n=cursor++,data=await page(n,n===first.meta.last_page);all.push(...data.data);completed++;
  if(completed%20===0)console.log(`Directory pages ${completed}/${first.meta.last_page}`);
}}));
// New registrations can shift the number-sorted pages during a long download.
// Overlay the much smaller current-registration collection to reconcile additions.
const activeFirst=await page(1,true,true);all.push(...activeFirst.data);
let activeCursor=2;
await Promise.all(Array.from({length:2},async()=>{while(activeCursor<=activeFirst.meta.last_page){const data=await page(activeCursor++,true,true);all.push(...data.data);}}));
const teams=[...new Map(all.filter(t=>t.program?.id===programId).map(t=>[t.id,{id:t.id,number:t.number,name:t.team_name||t.number,organization:t.organization||'',country:t.location?.country||'Unassigned',region:t.location?.region||'Unassigned',city:t.location?.city||'',grade:t.grade||'Unknown',registered:Boolean(t.registered)}])).values()].sort((a,b)=>a.number.localeCompare(b.number,undefined,{numeric:true}));
// Registrations can be added during pagination; compare against a fresh total.
const latest=await page(1,true);
if(teams.length!==latest.meta.total||latest.meta.last_page!==first.meta.last_page)throw new Error(`Incomplete directory: ${teams.length}/${latest.meta.total}. Existing published index was not replaced.`);
const asOf=new Date().toISOString();
const content=JSON.stringify({asOf,source:'Event.VEX',program:programCode,total:teams.length,includesInactive:true,teams});
if(Buffer.byteLength(content)>25*1024*1024)throw new Error('Directory exceeds asset limit');
await mkdir('archive-assets',{recursive:true});
await writeFile(`archive-assets/team-directory${suffix}.json`,content);
await writeFile(`cloudflare/team-directory-manifest${suffix}.json`,JSON.stringify({asOf,program:programCode,total:teams.length,includesInactive:true,pages:first.meta.last_page,sha256:createHash('sha256').update(content).digest('hex'),bytes:Buffer.byteLength(content)},null,2)+'\n');
console.log(`Directory ready: ${teams.length} teams; 2011 family: ${teams.filter(t=>/^2011[A-Z]*$/.test(t.number)).map(t=>t.number).join(', ')}`);


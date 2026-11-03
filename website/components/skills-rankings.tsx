'use client';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { PROGRAMS } from '@/lib/programs.mjs';
import { siteFetch } from '@/lib/client-fetch';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import LoadMore from '@/components/load-more';

type Program='V5RC'|'VIQRC';
type Team={id:number;number:string;name:string;country:string;region:string;eventRegion?:string;grade:string;driverSkills:number;autoSkills:number;combinedSkills:number;skillsRank:number};
const requests=new Map<string,Promise<Team[]>>();
function load(program:Program,season:string){
  const key=`${program}:${season}`;
  if(!requests.has(key))requests.set(key,siteFetch(`/api/skills?season=${season}${program==='VIQRC'?'&program=VIQRC':''}`,{signal:AbortSignal.timeout(60000)})
    .then(async response=>{if(!response.ok)throw new Error('World skills standings could not be loaded. Please retry.');const data=await response.json() as {rankings?:unknown};if(!Array.isArray(data.rankings))throw new Error('Invalid skills standings. Please retry.');return data.rankings as Team[]})
    .catch(error=>{requests.delete(key);throw error}));
  return requests.get(key)!;
}
const regionOf=(team:Team)=>team.eventRegion??String(team.region??'Unassigned').split(',')[0].trim();
function Select({label,value,options,onChange,allLabel}: {label:string;value:string;options:string[];onChange:(value:string)=>void;allLabel?:string}){
  return <NativeSelect aria-label={label} value={value} onChange={event=>onChange(event.target.value)} className="w-full [&_select]:h-10 [&_select]:rounded-none [&_select]:border-0 [&_select]:border-b [&_select]:border-white/15 [&_select]:bg-transparent">{options.map(option=><NativeSelectOption key={option} value={option}>{option==='All'?allLabel??'All':option}</NativeSelectOption>)}</NativeSelect>;
}
export default function SkillsRankings({program,openTeam,savedState,setSavedState}: {program:Program;openTeam:(team:any)=>void;savedState:any;setSavedState:(state:any)=>void}){
  const config=PROGRAMS[program];
  const seasons=Object.entries(config.seasons).filter(([id])=>config.skillsSeasons.some(value=>value===id)).sort(([a],[b])=>Number(b)-Number(a));
  const saved=savedState.skills??{};
  const [season,setSeason]=useState<string>(seasons.some(([id])=>id===saved.season)?saved.season:String(config.currentSeason));
  const [grade,setGrade]=useState<string>(config.grades.some(value=>value===saved.grade)?saved.grade:'All');
  const [country,setCountry]=useState<string>(saved.country??'All');
  const [region,setRegion]=useState<string>(saved.region??'All');
  const [search,setSearch]=useState<string>(saved.search??'');
  const [limit,setLimit]=useState<number>(saved.limit??100);
  const [retry,setRetry]=useState(0);
  const key=`${program}:${season}:${retry}`;
  const [result,setResult]=useState<{key:string;rows?:Team[];error?:string}|null>(null);
  useEffect(()=>{let active=true;load(program,season).then(rows=>{if(active)setResult({key,rows})}).catch(error=>{if(active)setResult({key,error:error.message})});return()=>{active=false}},[program,season,key]);
  useEffect(()=>setLimit(100),[season,grade,country,region,search]);
  useEffect(()=>setSavedState((previous:any)=>({...previous,tab:'skills',skills:{season,grade,country,region,search,limit}})),[season,grade,country,region,search,limit,setSavedState]);
  const current=result?.key===key?result:null;
  const rows=current?.rows??[];
  const countries=['All',...Array.from(new Set(rows.map(team=>team.country).filter(Boolean))).sort()];
  const regions=['All',...Array.from(new Set(rows.filter(team=>country==='All'||team.country===country).map(regionOf).filter(Boolean))).sort()];
  const filtered=rows.filter(team=>(grade==='All'||team.grade===grade)&&(country==='All'||team.country===country)&&(region==='All'||regionOf(team)===region)&&(!search||`${team.number} ${team.name}`.toLowerCase().includes(search.toLowerCase())));
  const seasonLabel=seasons.find(([id])=>id===season)?.[1].label??season;
  const tabs=['All teams',...config.grades,'Skills'];
  const open=(team:Team)=>openTeam({...team,season:seasonLabel,seasonId:Number(season)});
  const head='text-[10px] font-semibold uppercase tracking-wider text-white/50';
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <div className="max-w-3xl border-b border-white/[.08] pb-6"><p className="text-[11px] italic text-white/45">Official {config.short} skills standings</p><h1 className="font-display mt-1.5 text-[2.6rem] leading-[1.05] sm:text-[3.4rem]">World skills ranking</h1><p className="mt-4 max-w-xl text-sm leading-relaxed text-white/45">Compare official driving and {program==='VIQRC'?'autonomous coding':'autonomous'} skills scores, then narrow by grade, season, country and event region.</p></div>
    <div className="mt-8 flex flex-wrap gap-x-7 gap-y-1 border-b border-white/[.08]">{tabs.map(tab=><button key={tab} aria-pressed={tab==='Skills'} onClick={()=>{if(tab!=='Skills')setSavedState({...savedState,tab:'rating',grade:tab})}} className={`-mb-px min-h-10 border-b-2 pb-2.5 pt-1 text-sm transition-colors ${tab==='Skills'?'border-[var(--c-accent)] text-white':'border-transparent text-white/55 hover:text-white/75'}`}>{program==='V5RC'&&tab!=='All teams'&&tab!=='Skills'?`${tab} ranking`:tab}</button>)}</div>
    <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-5">
      <Select label="Skills season" value={seasonLabel} options={seasons.map(([,entry])=>entry.label)} onChange={label=>{setSeason(seasons.find(([,entry])=>entry.label===label)![0]);setCountry('All');setRegion('All')}} />
      <Select label="Skills grade" allLabel="All school levels" value={grade} options={['All',...config.grades]} onChange={setGrade} />
      <Select label="Skills country" allLabel="All countries" value={country} options={countries} onChange={value=>{setCountry(value);setRegion('All')}} />
      <Select label="Skills event region" allLabel="All event regions" value={region} options={regions} onChange={setRegion} />
      <label className="relative"><Search className="absolute left-0 top-3 h-4 w-4 text-white/45" aria-hidden="true" /><input aria-label="Search skills teams" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search team number or name" className="h-10 w-full border-0 border-b border-white/15 bg-transparent pl-6 text-sm outline-none focus:border-white/40" /></label>
    </div>
    <p role="status" className="mt-5 text-xs text-white/55">{current?.rows?`${filtered.length.toLocaleString()} teams listed · Ranked by combined skills score`:'Loading world skills standings…'}</p>
    {current?.error&&<div role="alert" className="mt-5 border border-rose-400/30 bg-rose-400/5 p-5"><p className="text-sm text-rose-200">{current.error}</p><button onClick={()=>setRetry(value=>value+1)} className="mt-3 border border-white/20 px-4 py-2 text-sm font-bold">Retry</button></div>}
    {current?.rows&&<div className="mt-6 overflow-x-auto border border-white/10 bg-[var(--c-surface)]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent">{['Rank','Team','Region','Grade','Driver',program==='VIQRC'?'Coding':'Auto','Combined'].map(label=><TableHead key={label} className={`${head} ${['Driver','Coding','Auto','Combined'].includes(label)?'text-right':''} ${label==='Rank'||label==='Combined'?'px-5':''}`}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{filtered.slice(0,limit).map(team=><TableRow key={team.number} role="link" tabIndex={0} onClick={()=>open(team)} onKeyDown={event=>{if(event.key==='Enter')open(team)}} className="cursor-pointer border-white/[.07] hover:bg-white/[.04]"><TableCell className="px-5 text-lg font-semibold text-white/55" title="World skills rank">#{team.skillsRank}</TableCell><TableCell><b>{team.number}</b><small className="ml-3 text-white/50">{team.name}</small></TableCell><TableCell className="text-white/45">{team.region}</TableCell><TableCell className="text-white/45">{team.grade}</TableCell><TableCell className="text-right font-mono text-white/65">{team.driverSkills}</TableCell><TableCell className="text-right font-mono text-white/65">{team.autoSkills}</TableCell><TableCell className="px-5 text-right font-mono text-lg font-semibold">{team.combinedSkills}</TableCell></TableRow>)}</TableBody></Table></div>}
    {current?.rows&&!filtered.length&&<p className="mt-4 border border-dashed border-white/15 p-10 text-center text-sm text-white/50">No teams match these filters.</p>}
    {limit<filtered.length&&<LoadMore count={limit} onReach={()=>setLimit(value=>value+250)} />}
    <p className="mt-4 text-xs text-white/45">Scores and world ranks come from the official Event.VEX world skills standings for the selected season.</p>
  </section>;
}

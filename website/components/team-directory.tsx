'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUpRight } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { siteFetch } from '@/lib/client-fetch';
import LoadMore from '@/components/load-more';
import { directoryLocations, normalizeCountry, searchDirectory, directoryMatchesProgram, IQ_DIRECTORY_UNAVAILABLE } from '@/lib/team-directory.mjs';

type Team={id:number;number:string;name:string;organization:string;country:string;region:string;city:string;grade:string;registered:boolean};
type Directory={teams:Team[];asOf:string;total:number;program?:string};
type Program='V5RC'|'VIQRC';
// One snapshot per program: the V5 and VEX IQ directories are separate files.
const directoryRequests=new Map<Program,Promise<Directory>>();
function loadDirectory(program:Program){
  if(!directoryRequests.has(program))directoryRequests.set(program,siteFetch(`/api/team-directory${program==='VIQRC'?'?program=VIQRC':''}`,{signal:AbortSignal.timeout(60000)})
    // The server's own message when it has one: "not published yet" is a
    // different answer from "try again", and retrying will not change it.
    .then(async response=>{if(!response.ok){const body=await response.json().catch(()=>null) as {error?:string}|null;throw new Error(body?.error||'The team directory could not be loaded. Please retry.')}const data=await response.json() as Directory;if(!directoryMatchesProgram(data,program))throw new Error(program==='VIQRC'?IQ_DIRECTORY_UNAVAILABLE:'The team directory could not be loaded. Please retry.');if(!Array.isArray(data.teams)||data.teams.length!==data.total)throw new Error('The team directory is incomplete. Please retry.');return data;})
    .catch(error=>{directoryRequests.delete(program);throw error;}));
  return directoryRequests.get(program)!;
}
const GRADES:Record<Program,string[]>={V5RC:['Middle School','High School'],VIQRC:['Middle School','Elementary School']};
export default function TeamDirectory({program='V5RC',search,setSearch,country,setCountry,region,setRegion,grade,setGrade,openTeam}:any){
  const [directory,setDirectory]=useState<Directory|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[limit,setLimit]=useState(60);
  useEffect(()=>{let active=true;setError('');loadDirectory(program).then(data=>{if(active)setDirectory(data)}).catch(failure=>{if(active)setError(failure?.message||'The team directory could not be loaded. Please retry.')});return()=>{active=false}},[retry,program]);
  const teams=directory?.teams??[];
  const selectedCountry=country==='All'?'All':normalizeCountry(country);
  const selectedGrade=GRADES[program as Program].includes(grade)?grade:'All';
  const locations=useMemo(()=>directoryLocations(teams,selectedCountry),[teams,selectedCountry]);
  const results=useMemo(()=>searchDirectory(teams,search,{country:selectedCountry,region,grade:selectedGrade}),[teams,search,selectedCountry,region,selectedGrade]);
  useEffect(()=>setLimit(60),[search,selectedCountry,region,selectedGrade]);
  const selectClass='w-full [&_select]:h-10 [&_select]:rounded-none [&_select]:border-white/10 [&_select]:bg-black/20';
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    {/* Set like every other page head (PageHead in app/page.tsx), so the
        directory does not read as a different site. */}
    <div className="max-w-3xl border-b border-white/[.08] pb-6">
      <p className="text-[11px] italic text-white/45">Team directory</p>
      <h1 className="font-display mt-1.5 text-[2.6rem] leading-[1.05] sm:text-[3.4rem]">Find any {program==='VIQRC'?'VEX IQ':'V5RC'} team</h1>
      <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/45">Search a team number, part of a number, name or organization. Includes currently registered and historical {program==='VIQRC'?'VEX IQ':'V5RC'} teams.</p>
    </div>
    <div className="mt-8 grid gap-3 border border-white/10 bg-[var(--c-surface)] p-4 sm:grid-cols-3 xl:grid-cols-[2fr_1fr_1fr_1fr]">
      <label className="relative sm:col-span-3 xl:col-span-1"><Search className="absolute left-3 top-3 h-4 w-4 text-white/50" aria-hidden="true"/><input aria-label="Search team directory" value={search} onChange={e=>setSearch(e.target.value)} placeholder={program==='VIQRC'?'Try 31200A or 31200K':'Try 8829C or 55288A'} className="h-10 w-full border border-white/10 bg-black/20 pl-9 pr-3 text-sm outline-none focus:border-white/30"/></label>
      <NativeSelect aria-label="Team country" value={selectedCountry} onChange={e=>{setCountry(e.target.value);setRegion('All')}} className={selectClass}><NativeSelectOption value="All">All countries</NativeSelectOption>{locations.countries.map((c:string)=><NativeSelectOption key={c} value={c}>{c}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Team region" value={region} onChange={e=>setRegion(e.target.value)} className={selectClass}><NativeSelectOption value="All">All regions</NativeSelectOption>{locations.regions.map((r:string)=><NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}</NativeSelect>
      <NativeSelect aria-label="Team grade" value={selectedGrade} onChange={e=>setGrade(e.target.value)} className={selectClass}><NativeSelectOption value="All">All school levels</NativeSelectOption>{GRADES[program as Program].map(level=><NativeSelectOption key={level} value={level}>{level}</NativeSelectOption>)}</NativeSelect>
    </div>
    {error?<div role="alert" className="my-4 border border-rose-400/30 bg-rose-400/5 p-5"><p className="text-sm text-rose-200">{error}</p><button onClick={()=>setRetry(n=>n+1)} className="mt-3 border border-white/20 px-4 py-2 text-sm font-bold transition-colors hover:bg-white hover:text-black">Retry</button></div>:!directory?<div role="status" aria-label="Loading the team directory" className="mt-5"><p className="text-sm text-white/50">Loading the team directory…</p><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6},(_,index)=><div key={index} className="animate-pulse rounded-[var(--radius-md)] border border-white/10 bg-[var(--c-surface)] p-5" style={{animationDelay:`${index*60}ms`}}><div className="h-6 w-24 rounded bg-white/10" /><div className="mt-3 h-4 w-3/4 rounded bg-white/[.08]" /><div className="mt-5 h-3 w-1/2 rounded bg-white/[.06]" /></div>)}</div></div>:<>
      <p role="status" className="mt-5 text-sm text-white/55">{results.length.toLocaleString()} teams found · Directory updated {new Date(directory.asOf).toLocaleDateString()}</p>
      <p className="mt-2 text-xs text-white/55">School level and location reflect each team’s latest official profile, including inactive teams.</p>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{results.slice(0,limit).map((t:Team)=><button key={t.id} onClick={()=>openTeam({...t,region:[t.city,t.region,t.country].filter(v=>v&&v!=='Unassigned').join(', ')})} className="float-card group border border-white/10 bg-[var(--c-surface)] p-5 text-left hover:border-white/30">
        <div className="flex items-center justify-between"><h2 className="text-xl font-semibold transition-colors group-hover:text-[var(--c-accent)]">{t.number}</h2><ArrowUpRight className="h-4 w-4 text-white/50" aria-hidden="true"/></div>
        <p className="mt-2 text-sm text-white/80">{t.name}</p>{t.organization&&t.organization!==t.name&&<p className="mt-1 text-sm text-white/45">{t.organization}</p>}
        <p className="mt-4 text-sm text-white/50">{[t.city,t.region,t.country].filter(v=>v&&v!=='Unassigned').join(', ')||'Location unavailable'}</p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-white/55"><span>{t.grade}</span><span>·</span><span>{t.registered?'Currently registered':'Not currently registered'}</span></div>
      </button>)}</div>
      {!results.length&&<p className="mt-5 border border-dashed border-white/15 p-10 text-center text-sm text-white/50">No teams match this search and these filters.</p>}
      {results.length>limit&&<LoadMore count={limit} onReach={()=>setLimit(n=>n+60)} />}
    </>}
  </section>;
}


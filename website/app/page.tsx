'use client';
import { RANKING_SEASONS, validateArchive } from '@/lib/ranking-seasons.mjs';
import TeamDirectory from '@/components/team-directory';
import SignedNumber from '@/components/signed-number';
import StrengthHexagon, { ordinal } from '@/components/strength-hexagon';
import { teamMatches, teamStanding, recordCheck, momentum as teamMomentum, strengthProfile } from '@/lib/team-event.mjs';
import { siteFetch } from '@/lib/client-fetch';
import { bracketRound } from '@/lib/bracket';
import { routeToHash, hashToRoute } from '@/lib/routes.mjs';
import PakaLoader from '@/components/paka';
import { version } from '../package.json';
import { vexCountries, vexEventRegions, eventRegionsForCountry } from '@/lib/event-regions.mjs';

import { useEffect, useMemo, useState } from 'react';
import { parseAgenda } from '@/lib/agenda';
import { ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BarChart3, CalendarDays, ChevronRight, Filter, Gauge, Globe2, MapPin, Menu, Search, Users, X } from 'lucide-react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type View = 'home' | 'events' | 'event' | 'teamEvent' | 'rankings' | 'stats' | 'teams' | 'team';

const THEMES=[
  {id:'midnight',name:'Midnight',swatch:'#ee3240'},
  {id:'ember',name:'Ember',swatch:'#f5a524'},
  {id:'abyss',name:'Abyss',swatch:'#38bdf8'},
  {id:'moss',name:'Moss',swatch:'#a3e635'},
] as const;
const THEME_KEY='vexrank-theme';

function ThemePicker(){
  // null until the stored choice is read, so the sync effect below cannot write
  // 'midnight' over the theme index.html already applied and cause a flash.
  const [theme,setTheme]=useState<string|null>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{
    // Deferred a frame: a synchronous setState in an effect body is what the
    // react-compiler rule warns about, and matches how useReducedMotion reads.
    const frame=requestAnimationFrame(()=>{
      const active=document.documentElement.dataset.theme;
      setTheme(active&&THEMES.some(entry=>entry.id===active)?active:'midnight');
    });
    return()=>cancelAnimationFrame(frame);
  },[]);
  useEffect(()=>{
    if(theme===null)return;
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem(THEME_KEY,theme)}catch{/* private mode: theme lasts the session */}
  },[theme]);
  // Paka can change the theme too ("theme ember"); follow it so the label matches.
  useEffect(()=>{
    const onPaka=(event:Event)=>{const id=(event as CustomEvent<string>).detail;if(THEMES.some(entry=>entry.id===id))setTheme(id)};
    window.addEventListener('vexrank-theme',onPaka);
    return()=>window.removeEventListener('vexrank-theme',onPaka);
  },[]);
  const choose=(id:string)=>{setTheme(id);setOpen(false)};
  const current=THEMES.find(entry=>entry.id===theme)??THEMES[0];
  return <div className="relative">
    <button onClick={()=>setOpen(value=>!value)} aria-haspopup="menu" aria-expanded={open} aria-label={`Colour theme: ${current.name}`}
      className="flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/70 hover:border-white/35 hover:text-white">
      <span className="h-2.5 w-2.5 rounded-full" style={{background:current.swatch}} aria-hidden="true" />
      {current.name}
    </button>
    {open&&<div role="menu" className="absolute right-0 z-50 mt-2 w-40 overflow-hidden rounded-lg border border-white/15 bg-[var(--c-surface-2)] py-1 shadow-2xl">
      {THEMES.map(entry=><button key={entry.id} role="menuitemradio" aria-checked={entry.id===theme} onClick={()=>choose(entry.id)}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs hover:bg-white/[.06] ${entry.id===theme?'text-white':'text-white/60'}`}>
        <span className="h-2.5 w-2.5 rounded-full" style={{background:entry.swatch}} aria-hidden="true" />
        {entry.name}
      </button>)}
    </div>}
  </div>;
}

function useAvailableRankingSeasons(){
  const [available,setAvailable]=useState(['2026–27 Override','2025–26 Push Back']);
  useEffect(()=>{let active=true;siteFetch('/api/archive-manifest').then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(active&&Array.isArray(data.archives)){const ids=new Set(data.archives.map((a:any)=>a.seasonId));setAvailable(Object.keys(RANKING_SEASONS).filter(s=>RANKING_SEASONS[s].id===204||ids.has(RANKING_SEASONS[s].id)))}}).catch(()=>undefined);return()=>{active=false}},[]);
  return available;
}

const eventDetailCache=new Map<string,any>();
const eventCalendarCache=new Map<string,any>();
const teamHistoryCache=new Map<string,any>();
const requestCache=new Map<string,Promise<any>>();
const cacheTimes=new Map<string,number>();
const eventDetailUrl=(id:string|number)=>`/api/events/${id}?results=v49`;
/**
 * Retries transient upstream failures. The test worker returns intermittent
 * 502s, which previously surfaced to the user as a bare error or - worse, on
 * the home view - as a confident "no events" message.
 *
 * Only 5xx and network errors are retried: a 4xx will not fix itself, and a
 * timeout has already cost 60s so retrying it just compounds the wait.
 */
/**
 * The site is served from GitHub Pages while the data service lives on a
 * separate *.workers.dev origin, so every data request is third-party. Content
 * blockers drop those: workers.dev appears on several lists, and strict modes
 * block cross-origin XHR outright. The request then fails at the network layer
 * with a TypeError and no status, which is indistinguishable from being offline
 * but very distinguishable from a server error - so it is worth saying out loud
 * rather than reporting "temporarily unavailable".
 */
const UNREACHABLE='Could not reach the ranking service. A browser content blocker or privacy extension is the usual cause - allow this site and reload. You may also be offline.';
const OFFLINE='You appear to be offline. Reconnect and retry.';
const isNetworkLevel=(error:any)=>error instanceof TypeError;
const describeFetchError=(error:any,fallback:string)=>{
  if(error?.message===UNREACHABLE||error?.message===OFFLINE)return error.message;
  if(isNetworkLevel(error))return navigator.onLine===false?OFFLINE:UNREACHABLE;
  return fallback;
};

async function fetchWithBackoff(url:string,attempts=3){
  let lastError:any=new Error('Request failed');
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await siteFetch(url,{signal:AbortSignal.timeout(60000)});
      if(response.status<500||attempt===attempts-1)return response;
      lastError=new Error(`Upstream returned ${response.status}`);
    }catch(error:any){
      if(error?.name==='TimeoutError')throw error;
      // A block is deterministic, so retrying it three times only delays the
      // message by ~750ms. Allow one retry to cover a genuine network blip,
      // then report something the reader can act on.
      if(isNetworkLevel(error)&&attempt>=1) throw new Error(navigator.onLine===false?OFFLINE:UNREACHABLE);
      if(attempt===attempts-1) throw isNetworkLevel(error)?new Error(navigator.onLine===false?OFFLINE:UNREACHABLE):error;
      lastError=error;
    }
    // Exponential backoff with jitter, so a burst of parallel requests does not
    // retry in lockstep: ~250ms, ~500ms.
    await new Promise(resolve=>setTimeout(resolve,250*(2**attempt)+Math.random()*120));
  }
  throw lastError;
}

async function cachedJson(url:string,cache:Map<string,any>,key:string){if(cache.has(key)&&Date.now()-(cacheTimes.get(url)??0)<300000)return cache.get(key);if(requestCache.has(url))return requestCache.get(url);const request=fetchWithBackoff(url).then(async response=>{const data:any=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');cache.set(key,data);cacheTimes.set(url,Date.now());return data}).catch(error=>{if(error?.name==='TimeoutError')throw new Error('Official data took too long to load. Please retry.');throw error}).finally(()=>requestCache.delete(url));requestCache.set(url,request);return request}
const prefetchEvent=(id:string|number)=>cachedJson(eventDetailUrl(id),eventDetailCache,String(id)).catch(()=>undefined);
const teamCacheKey=(number:string,seasonId?:string|number,teamId?:string|number)=>`${number.toUpperCase()}:${seasonId??'all'}:${teamId??'search'}`;
const teamProfileUrl=(number:string,seasonId?:string|number,teamId?:string|number)=>`/api/teams/${encodeURIComponent(number)}?profile=v8${seasonId?`&season=${seasonId}`:''}${teamId?`&teamId=${teamId}`:''}`;
const prefetchTeam=(number:string,seasonId?:string|number,teamId?:string|number)=>cachedJson(teamProfileUrl(number,seasonId,teamId),teamHistoryCache,teamCacheKey(number,seasonId,teamId)).catch(()=>undefined);


const events = [
  { id: 'kalahari', date: '2026-09-12', end: 'SEP 14', tier: 'Gold S', name: 'Kalahari Classic', city: 'Sandusky, Ohio', region: 'United States', class: 'Signature', format: 'In-Person', grade: 'High School', teams: 96, status: 'Registration open', weight: 1.6 },
  { id: 'canadian', date: '2026-10-03', end: 'OCT 05', tier: 'Silver S', name: 'Canadian Open', city: 'Toronto, Ontario', region: 'Canada', class: 'Signature', format: 'In-Person', grade: 'Mixed', teams: 72, status: 'Registration open', weight: 1.35 },
  { id: 'riverbots', date: '2026-11-14', end: 'NOV 16', tier: 'Bronze S', name: 'Riverbots Signature', city: 'Louisville, Kentucky', region: 'United States', class: 'Signature', format: 'In-Person', grade: 'High School', teams: 64, status: 'Waitlist', weight: 1.15 },
  { id: 'pacific', date: '2026-11-28', end: 'NOV 29', tier: 'A', name: 'Pacific Northwest Regional', city: 'Vancouver, British Columbia', region: 'Canada', class: 'Regional', format: 'In-Person', grade: 'Middle School', teams: 48, status: 'Registration open', weight: .95 },
  { id: 'singapore', date: '2026-12-05', end: 'DEC 07', tier: 'Bronze S', name: 'Singapore V5RC Championship', city: 'Singapore', region: 'Singapore', class: 'Championship', format: 'In-Person', grade: 'Mixed', teams: 54, status: 'Invitational', weight: 1.15 },
  { id: 'winter', date: '2027-01-16', end: 'JAN 16', tier: 'B', name: 'Winter Remote Skills Open', city: 'Online', region: 'Global', class: 'Regional', format: 'Remote', grade: 'Mixed', teams: 120, status: 'Registration open', weight: .82 },
  { id: 'texas', date: '2027-02-20', end: 'FEB 22', tier: 'Gold S', name: 'Lone Star Signature', city: 'Dallas, Texas', region: 'United States', class: 'Signature', format: 'In-Person', grade: 'High School', teams: 88, status: 'Coming soon', weight: 1.6 },
  { id: 'worlds', date: '2027-04-22', end: 'APR 30', tier: 'Worlds', name: 'VEX Robotics World Championship', city: 'St. Louis, Missouri', region: 'United States', class: 'Championship', format: 'In-Person', grade: 'Mixed', teams: 800, status: 'Qualification required', weight: 1.85 },
];



function AppLogo() { return <span className="flex items-center gap-2 font-semibold tracking-[-.04em]"><img src="/vex-rank-icon.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0 object-contain" /><span className="text-xl">VEX<span className="text-[var(--c-accent)]">-Rank</span></span></span>; }
function liveTeamsLabel(rows:any[]) { return rows[0]?.matches ? 'Provisional live VCR' : 'Loading live VCR'; }
function Tier({ value='Official' }: { value?: string }) { const cls = value.includes('Gold') || value === 'Worlds' ? 'bg-amber-400/10 text-amber-300 border-amber-400/20' : value.includes('Silver') ? 'bg-slate-300/10 text-slate-200 border-slate-300/20' : value.includes('Bronze') ? 'bg-orange-400/10 text-orange-300 border-orange-400/20' : 'bg-white/5 text-white/55 border-white/10'; return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${cls}`}>{value}</span>; }
function EventStatus({ value='Upcoming' }: { value?: string }) { const normalized=value.toLowerCase();const cls=normalized==='cancelled'?'text-[#ff3347]':normalized==='upcoming'?'text-sky-400':'text-emerald-400';return <span className={`text-[10px] font-bold uppercase tracking-wider ${cls}`}>{value}</span>; }

export default function Home() {
  const [view, setView] = useState<View>('home');
  const [mobile, setMobile] = useState(false);
  const [eventSearch, setEventSearch] = useState('');
  const [region, setRegion] = useState('All');
  const [eventClass, setEventClass] = useState('All');
  const [format, setFormat] = useState('All');
  const [time, setTime] = useState('All events');
  const [grade, setGrade] = useState('All');
  const [eventExtras, setEventExtras] = useState({ season: '2026–27: Override', level: 'All', from: '', to: '', eventRegion: 'All', city: '', affiliation: '', registrationOpen: false, spotsOpen: false, worldQualifier: false, girlPowered: false, includeCanceled: false });
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const [homeEvents, setHomeEvents] = useState<any[]>([]);
  const [eventsError,setEventsError]=useState('');
  const [eventsLoading,setEventsLoading]=useState(true);
  const [eventsRetry,setEventsRetry]=useState(0);
  const [eventsLive, setEventsLive] = useState(false);
  const [liveTeams, setLiveTeams] = useState<any[]>([]);
  const [rankingsMeta, setRankingsMeta] = useState<any>(null);
  const [rankingsError,setRankingsError]=useState('');
  const [rankingsRetry,setRankingsRetry]=useState(0);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamRegion, setTeamRegion] = useState('All');
  const [teamDirectoryRegion,setTeamDirectoryRegion]=useState('All');
  const [rankingRange, setRankingRange] = useState('All');
  const [rankingViewState,setRankingViewState]=useState({season:'2026–27 Override',country:'All',region:'All',grade:'All teams',search:'',visibleCount:100});
  const [selectedTeam, setSelectedTeam] = useState<any>({number:'',name:''});
  const [teamReturnView,setTeamReturnView]=useState<View>('teams');
  const [teamEventReturnView,setTeamEventReturnView]=useState<View>('event');
  const [selectedEvent, setSelectedEvent] = useState<any>({});
  const [navigationRestored,setNavigationRestored]=useState(false);

  useEffect(()=>{
    try {
      const saved=JSON.parse(sessionStorage.getItem('vexrank-navigation')??'null');
      if(saved){if(saved.view)setView(saved.view==='stats'?'rankings':saved.view);if(saved.selectedTeam)setSelectedTeam(saved.selectedTeam);if(saved.selectedEvent)setSelectedEvent(saved.selectedEvent);if(saved.eventSearch!=null)setEventSearch(saved.eventSearch);if(saved.teamSearch!=null)setTeamSearch(saved.teamSearch);if(saved.region)setRegion(saved.region);if(saved.eventClass)setEventClass(saved.eventClass);if(saved.format)setFormat(saved.format);if(saved.time)setTime(saved.time);if(saved.grade)setGrade(saved.grade);if(saved.eventExtras)setEventExtras(saved.eventExtras);if(saved.teamRegion)setTeamRegion(saved.teamRegion);if(saved.teamDirectoryRegion)setTeamDirectoryRegion(saved.teamDirectoryRegion);if(saved.rankingRange)setRankingRange(saved.rankingRange);if(saved.rankingViewState)setRankingViewState(saved.rankingViewState);if(saved.teamReturnView)setTeamReturnView(saved.teamReturnView==='stats'?'rankings':saved.teamReturnView);if(saved.teamEventReturnView)setTeamEventReturnView(saved.teamEventReturnView);requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,saved.scrollY??0)))}
    } catch {}
    // Outside the try, and outside the saved branch: an explicit URL must win
    // over restored state, and must still work when there is no saved state at
    // all - a link pasted into a different browser is the whole point.
    const linked=hashToRoute(window.location.hash);
    if(linked){
      if(linked.teamNumber)setSelectedTeam({number:linked.teamNumber,name:''});
      if(linked.eventId)setSelectedEvent({id:linked.eventId});
      setView(linked.view);
      window.scrollTo({top:0,behavior:'instant' as ScrollBehavior});
    }
    setNavigationRestored(true);
  },[]);

  useEffect(()=>{
    if(!navigationRestored)return;
    const save=()=>{try{sessionStorage.setItem('vexrank-navigation',JSON.stringify({view,selectedTeam,selectedEvent,eventSearch,teamSearch,region,eventClass,format,time,grade,eventExtras,teamRegion,teamDirectoryRegion,rankingRange,rankingViewState,teamReturnView,teamEventReturnView,scrollY:window.scrollY}));}catch{}};
    save();window.addEventListener('pagehide',save);return()=>window.removeEventListener('pagehide',save);
  },[navigationRestored,view,selectedTeam,selectedEvent,eventSearch,teamSearch,region,eventClass,format,time,grade,eventExtras,teamRegion,teamDirectoryRegion,rankingRange,rankingViewState,teamReturnView,teamEventReturnView]);

  useEffect(() => {
    let active = true;
    const seasonId=({'2026–27: Override':'204','2025–26: Push Back':'197','2024–25: High Stakes':'190','2023–24: Over Under':'181'} as Record<string,string>)[eventExtras.season]??'204';
    setEventsLoading(true);setEventsError('');setLiveEvents([]);setEventsLive(false);
    cachedJson(`/api/events?season=${seasonId}&classification=v49`,eventCalendarCache,seasonId).then((payload:any) => {
      if (active && Array.isArray(payload.events)) { setLiveEvents(payload.events); setEventsLive(true); }
    }).catch((error:any) => {if(active)setEventsError(describeFetchError(error,'Events could not be loaded. Please retry.'));}).finally(()=>{if(active)setEventsLoading(false)});
    return () => { active = false; };
  }, [eventExtras.season,eventsRetry]);

  // Homepage data never follows the calendar's saved season or search filters.
  useEffect(() => {
    if(view!=='home')return;
    let active=true;
    const refresh=()=>cachedJson('/api/events?season=204&classification=v49',eventCalendarCache,'204')
      .then((payload:any)=>{if(active&&Array.isArray(payload.events))setHomeEvents([...payload.events]);})
      .catch(()=>undefined);
    void refresh();
    const timer=window.setInterval(refresh,300000);
    window.addEventListener('focus',refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[view,eventsRetry]);

  useEffect(()=>{
    if(!['home','rankings','stats','teams'].includes(view)||rankingsMeta)return;
    let active=true;
    setRankingsError('');
    fetchWithBackoff('/api/rankings?data=v49').then(response=>response.ok?response.json():Promise.reject(new Error('Rankings request failed'))).then((payload:any)=>{if(active&&Array.isArray(payload.rankings)){setLiveTeams(payload.rankings);setRankingsMeta(payload)}}).catch((error:any)=>{if(active)setRankingsError(describeFetchError(error,'Rankings are temporarily unavailable. Please retry.'));});
    return()=>{active=false};
  },[rankingsRetry,view]);

  const eventRows = liveEvents;
  const teamRows = liveTeams;

  useEffect(()=>{
    const onPop=()=>{
      const r=hashToRoute(window.location.hash);
      if(!r)return;
      if(r.teamNumber)setSelectedTeam((current:any)=>current?.number===r.teamNumber?current:{number:r.teamNumber,name:''});
      if(r.eventId)setSelectedEvent((current:any)=>String(current?.id)===r.eventId?current:{id:r.eventId});
      setView(r.view);
    };
    // popstate covers back/forward; hashchange covers a hand-edited address bar
    // or an in-page anchor, which popstate does not fire for.
    window.addEventListener('popstate',onPop);
    window.addEventListener('hashchange',onPop);
    return()=>{window.removeEventListener('popstate',onPop);window.removeEventListener('hashchange',onPop)};
  },[]);

  useEffect(()=>{
    if(!navigationRestored)return;
    const next=routeToHash(view,selectedTeam,selectedEvent);
    // No guard needed for popstate: the browser has already updated the hash by
    // the time the handler runs, so this equality check short-circuits and no
    // duplicate entry is pushed.
    if(window.location.hash===next)return;
    window.history.pushState(null,'',next);
  },[navigationRestored,view,selectedTeam,selectedEvent]);

  useEffect(()=>{
    // Pointer-tracked highlight. Skipped entirely on touch and for users who
    // asked for reduced motion, so neither pays for a listener they cannot use.
    if(!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)return;
    if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    let frame=0;let pending:{x:number;y:number;target:EventTarget|null}|null=null;
    const apply=()=>{
      frame=0;const move=pending;pending=null;
      const card=(move?.target as HTMLElement|null)?.closest?.('.float-card') as HTMLElement|null;
      if(!card||!move)return;
      const box=card.getBoundingClientRect();
      card.style.setProperty('--mx',`${move.x-box.left}px`);
      card.style.setProperty('--my',`${move.y-box.top}px`);
    };
    const onMove=(event:PointerEvent)=>{
      pending={x:event.clientX,y:event.clientY,target:event.target};
      if(!frame)frame=requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove',onMove,{passive:true});
    return()=>{window.removeEventListener('pointermove',onMove);if(frame)cancelAnimationFrame(frame)};
  },[]);

  const go = (next: View) => {
    setView(next==='stats'?'rankings':next); setMobile(false);
    // Instant, not smooth. A smooth scroll from deep in a long list takes
    // ~700ms, during which the new view is already rendered and its entrance
    // animations have started - on a team profile that means the signature is
    // being written above the fold while the viewport is still travelling.
    // Real navigation jumps; only in-page scrolling should glide.
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };
  const openTeam = (team: any) => { void prefetchTeam(team.number,team.seasonId,team.id);setSelectedTeam(team); setTeamReturnView(view); go('team'); };
  const openEvent = (event:any) => { void prefetchEvent(event.id);setSelectedEvent(event); go('event'); };
  const openTeamAtEvent = (team:any,event:any) => { void prefetchEvent(event.id);setSelectedTeam(team);setSelectedEvent(event);setTeamEventReturnView(view==='team'?'team':'event');go('teamEvent'); };

  const shownEvents = useMemo(() => eventRows.filter((e:any) => {
    if (!eventExtras.includeCanceled && /cancell?ed/i.test(e.status ?? e.name)) return false;
    const level = e.levelClass ?? (e.id === 'worlds' ? 'World Championship' : e.class === 'Signature' ? 'Signature Event' : e.id === 'singapore' ? 'Event Region Championship' : 'None');
    const eventRegion = e.eventRegion ?? ({ kalahari: 'Ohio', canadian: 'Ontario', riverbots: 'Kentucky', pacific: 'British Columbia (BC)', singapore: 'Singapore', winter: 'Unassigned', texas: 'Texas - Region 3', worlds: 'Missouri' } as Record<string,string>)[e.id];
    const eventType = e.eventType ?? (e.id === 'singapore' ? 'Invitational Tournament' : e.id === 'pacific' ? 'School-Based Tournament' : e.id === 'winter' ? 'Live Remote Skills' : 'Open Tournament');
    const eventFormats = e.formats ?? [e.format, ...(e.status === 'Invitational' ? ['Invitational'] : []), ...(e.id === 'winter' ? ['Skills Only'] : [])];
    const worldQualifier = e.worldQualifier ?? false;
    const girlPowered = /girl powered/i.test(e.name);
    const today=new Date().toISOString().slice(0,10);const next30=new Date(Date.now()+30*86400000).toISOString().slice(0,10);const normalize=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]/g,'');const seasonLabel=String(e.season??'').includes('2026-2027')||!e.season?'2026–27: Override':String(e.season??'').includes('2025-2026')?'2025–26: Push Back':String(e.season??'').includes('2024-2025')?'2024–25: High Stakes':String(e.season??'').includes('2023-2024')?'2023–24: Over Under':e.season;
    return (!eventSearch || `${e.name} ${e.city}`.toLowerCase().includes(eventSearch.toLowerCase())) && (region === 'All' || normalize(e.region) === normalize(region)) && (eventExtras.season==='All'||seasonLabel===eventExtras.season) && (eventClass === 'All' || eventType === eventClass) && (format === 'All' || eventFormats.includes(format)) && (grade === 'All' || e.grade === grade || e.grade === 'Mixed') && (time === 'All events' || (time === 'Upcoming only'&&e.date>=today) || (time === 'Next 30 days' && e.date>=today&&e.date<=next30)) && (eventExtras.level === 'All' || level === eventExtras.level) && (!eventExtras.from || e.date >= eventExtras.from) && (!eventExtras.to || e.date <= eventExtras.to) && (eventExtras.eventRegion === 'All' || normalize(eventRegion)===normalize(eventExtras.eventRegion)) && (!eventExtras.city || e.city.toLowerCase().includes(eventExtras.city.toLowerCase())) && (!eventExtras.affiliation || e.name.toLowerCase().includes(eventExtras.affiliation.toLowerCase())) && (!eventExtras.registrationOpen || e.status === 'Registration open') && (!eventExtras.spotsOpen || e.status === 'Registration open') && (!eventExtras.worldQualifier || worldQualifier) && (!eventExtras.girlPowered || girlPowered);
  }), [eventRows, eventSearch, region, eventClass, format, time, grade, eventExtras]);


  return <main className="min-h-screen bg-[var(--c-page)] text-[#f4f5f7]">
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[var(--c-header)] backdrop-blur-xl">
      <div className="scroll-progress" aria-hidden="true" />
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-8 px-5 lg:px-8">
        <button aria-label="Go home" onClick={() => go('home')}><AppLogo /></button>
        <nav className="hidden h-full items-center gap-7 text-sm font-semibold text-white/55 md:flex">
          {([['events','Events'],['rankings','Rankings'],['teams','Teams']] as const).map(([id,label]) => <button key={id} onClick={() => go(id)} className={`h-full border-b-2 transition ${view === id || (view === 'team' && id === teamReturnView) ? 'border-[var(--c-accent)] text-white' : 'border-transparent hover:text-white'}`}>{label}</button>)}
        </nav>
        <div className="ml-auto" />
        <a href="https://discord.gg/Gu4TUEmhhY" target="_blank" rel="noopener noreferrer" aria-label="Join the VEX-Rank Discord" title="Join the VEX-Rank Discord" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/70 transition hover:border-white/35 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--c-accent)]">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" /></svg>
        </a>
        <ThemePicker />
        <button className="ml-auto md:hidden" onClick={() => setMobile(!mobile)} aria-label="Toggle navigation">{mobile ? <X /> : <Menu />}</button>
      </div>
      {mobile && <nav className="border-t border-white/10 bg-[var(--c-chrome)] p-4 md:hidden">{(['events','rankings','teams'] as View[]).map(v => <button key={v} onClick={() => go(v)} className="block w-full border-b border-white/10 px-2 py-3 text-left font-bold capitalize">{v}</button>)}</nav>}
    </header>

    <div key={view} className="view-enter">
    {view === 'home' && <HomeView go={go} openTeam={openTeam} openEvent={openEvent} eventRows={homeEvents} teamRows={teamRows} loading={eventsLoading} error={eventsError} retry={()=>setEventsRetry(value=>value+1)} />}
    {view === 'events' && <EventsView loading={eventsLoading} error={eventsError} retry={()=>setEventsRetry(value=>value+1)} results={shownEvents} live={eventsLive} openEvent={openEvent} search={eventSearch} setSearch={setEventSearch} filters={{region,eventClass,format,time,grade}} setters={{setRegion,setEventClass,setFormat,setTime,setGrade}} extras={eventExtras} setExtras={setEventExtras} />}
    {view === 'event' && <EventInfoView key={selectedEvent.id} event={selectedEvent} goBack={() => go('events')} openTeam={openTeam} openTeamAtEvent={(team:any)=>openTeamAtEvent(team,selectedEvent)} />}
    {view === 'teamEvent' && <TeamEventView key={`${selectedEvent.id}:${selectedTeam.number}`} event={selectedEvent} team={selectedTeam} backLabel={teamEventReturnView==='team'?String(selectedTeam.number||'team'):'event'} goBack={() => go(teamEventReturnView)} openEvent={openEvent} openTeam={openTeam} />}
    {(view==='rankings'||view==='stats'||view==='home')&&rankingsError&&<LoadError message={rankingsError} retry={()=>setRankingsRetry(value=>value+1)} />}
    {view === 'rankings' && <RankingsView teams={teamRows} meta={rankingsMeta} openTeam={openTeam} savedState={rankingViewState} setSavedState={setRankingViewState} />}
    {view === 'stats' && <StatRankingsView teams={teamRows} openTeam={openTeam} />}
    {view === 'teams' && <TeamDirectory search={teamSearch} setSearch={setTeamSearch} country={teamRegion} setCountry={setTeamRegion} region={teamDirectoryRegion} setRegion={setTeamDirectoryRegion} grade={rankingRange} setGrade={setRankingRange} openTeam={openTeam} />}
    {view === 'team' && <TeamView key={`${selectedTeam.number}:${selectedTeam.seasonId??selectedTeam.season??''}`} team={selectedTeam} goBack={() => go(teamReturnView)} backLabel={teamReturnView==='rankings'?'rankings':teamReturnView==='stats'?'stat leaders':teamReturnView==='events'||teamReturnView==='event'?'event':'teams'} openEvent={openEvent} openTeamAtEvent={openTeamAtEvent} />}
    </div>

    <footer className="mt-16 border-t border-white/10 bg-[var(--c-chrome)]"><div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 py-8 text-xs text-white/50 sm:flex-row sm:items-center lg:px-8"><AppLogo /><p>Independent V5RC analytics using official Event.VEX results.</p><p className="sm:ml-auto">VCR model · 2026–27 season · <span title="Website version, see CHANGELOG.md">v{version}</span></p></div><p className="mx-auto max-w-[1440px] border-t border-white/10 px-5 py-4 text-[11px] leading-relaxed text-white/40 lg:px-8">VEX-Rank is not affiliated with VEX Robotics and is not a VEX product. Team, event and match data comes from the events.vex.com API. Ratings and statistics are calculated by VEX-Rank and are not official.</p></footer>
    {/* Paka, the pixel cat: desktop only, loaded once the page is idle. */}
    <PakaLoader view={view} selectedTeam={selectedTeam} selectedEvent={selectedEvent} teamRows={teamRows}
      eventRows={homeEvents.length?homeEvents:eventExtras.season==='2026–27: Override'?eventRows:[]}
      go={go} openTeam={openTeam} openEvent={openEvent} />
  </main>;
}

function HomeView({ go, openTeam, openEvent, eventRows, teamRows, loading, error, retry }: { go: (v: View) => void; openTeam: (t:any) => void; openEvent:(event:any)=>void; eventRows: typeof events; teamRows:any[]; loading?:boolean; error?:string; retry?:()=>void }) {
  const upcomingSignatures=eventRows.filter((event:any)=>event.class==='Signature Event'&&!/cancell?ed/i.test(event.status)&&event.date>=new Date().toISOString().slice(0,10));
  const bestByDate=new Map<string,any>();upcomingSignatures.forEach((event:any)=>{const current=bestByDate.get(event.date);if(!current||(event.rankScore??0)>(current.rankScore??0))bestByDate.set(event.date,event)});
  const featured=[...bestByDate.values()].sort((a:any,b:any)=>a.date.localeCompare(b.date)||(b.rankScore??0)-(a.rankScore??0));
  const primaryEvent = featured[0];
  return <>
    <section className="mx-auto max-w-[1440px] px-5 pb-8 pt-10 lg:px-8">
      <div className="mb-6 flex items-end justify-between gap-4"><div><p className="mb-1.5 text-[11px] italic text-white/45">2026–27 V5RC season</p><h1 className="font-display text-3xl tracking-[-.04em] sm:text-5xl">The competition starts here.</h1></div><button onClick={() => go('events')} className="hidden items-center gap-2 text-sm font-bold text-white/60 hover:text-white sm:flex">Browse all events <ArrowUpRight className="h-4 w-4" /></button></div>
      <div className="grid gap-4 lg:grid-cols-[1.65fr_1fr]">
        {primaryEvent?<article className="float-card relative min-h-[360px] overflow-hidden border border-white/10 bg-[linear-gradient(160deg,var(--c-hero-a),var(--c-hero-b))] p-7 sm:p-9"><div aria-hidden="true" className="absolute right-5 top-4 whitespace-nowrap text-[150px] font-semibold leading-none text-white/[.025]">{new Date(`${primaryEvent.date}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'2-digit'}).toUpperCase()}</div><Tier value={primaryEvent.tier} /><div className="mt-16 max-w-xl"><p className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/55"><CalendarDays className="h-4 w-4 text-white/45" /> {new Date(`${primaryEvent.date}T12:00:00`).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p><h2 className="font-display max-w-3xl text-[1.9rem] leading-[1.15] sm:text-[2.5rem]">{primaryEvent.name}</h2><p className="mt-4 flex items-center gap-2 text-sm text-white/55"><MapPin className="h-4 w-4" /> {primaryEvent.city}{primaryEvent.teams ? ` · ${primaryEvent.teams} teams` : ''} · {primaryEvent.grade}</p><p className="mt-2 text-xs text-white/50">{primaryEvent.rankLocked?'Event rank locked':'Rank locks'} · {new Date(primaryEvent.rankLockDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</p></div><button onClick={() => openEvent(primaryEvent)} className="mt-8 inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-black hover:bg-[var(--c-accent)] hover:text-white">View event <ArrowUpRight className="h-4 w-4" /></button></article>:loading?<div className="min-h-[360px] animate-pulse rounded-xl border border-white/10 bg-[var(--c-surface)] p-7 sm:p-9"><div className="h-3 w-40 rounded bg-white/10" /><div className="mt-6 h-9 w-3/4 rounded bg-white/10" /><div className="mt-3 h-9 w-1/2 rounded bg-white/10" /><div className="mt-8 h-4 w-56 rounded bg-white/10" /></div>
        :error?<LoadError message={error} retry={retry??(()=>undefined)} />
        :<Empty text="No upcoming Signature Events are currently listed." />}
        <aside className="overflow-hidden border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow={liveTeamsLabel(teamRows)} title="World ranking" />{teamRows.slice(0,5).map(t => <button onClick={() => openTeam(t)} key={t.number} className="grid w-full grid-cols-[32px_1fr_auto] items-center gap-3 border-b border-white/[.07] px-5 py-3.5 text-left hover:bg-white/[.04]"><b className="text-lg text-white/25">{String(t.rank).padStart(2,'0')}</b><span><b className="block">{t.number}</b><small className="block truncate text-white/55">{t.name}</small></span><span className="text-right"><b className="block font-mono">{t.rating}</b><small className="text-white/45">±{t.confidence ?? '—'}</small></span></button>)}<button onClick={() => go('rankings')} className="flex w-full items-center justify-center gap-2 px-5 py-4 text-xs font-semibold uppercase tracking-wider text-white/55 hover:text-white">Full ranking <ArrowRight className="h-3.5 w-3.5" /></button></aside>
      </div>
    </section>
    <section className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8"><div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] italic text-white/45">On the calendar</p><h2 className="font-display mt-1 text-2xl">Upcoming Signature Events</h2></div><button onClick={() => go('events')} className="text-sm font-bold text-white/50 hover:text-white">Browse calendar</button></div><div className="grid gap-3 md:grid-cols-3">{featured.slice(0,3).map(e => <button onClick={() => openEvent(e)} key={e.id} className="group flex overflow-hidden border border-white/10 bg-[var(--c-surface)] text-left hover:-translate-y-0.5 hover:border-white/25"><div className="grid w-20 place-items-center border-r border-white/10 bg-white/[.025] py-5 text-center"><span><small className="block font-bold text-[var(--c-accent)]">{new Date(`${e.date}T12:00:00`).toLocaleString('en',{month:'short'}).toUpperCase()}</small><b className="block text-3xl">{e.date.slice(-2)}</b></span></div><span className="min-w-0 p-4"><Tier value={e.tier} /><b className="mt-2 block truncate group-hover:text-[var(--c-accent)]">{e.name}</b><small className="mt-2 block truncate text-white/55">{e.city}{e.teams ? ` · ${e.teams} teams` : ''}</small><small className="mt-1 block text-white/25">{e.rankLocked?'Rank locked':`Locks ${new Date(e.rankLockDate).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`}</small></span></button>)}</div></section>
    <section className="mx-auto grid max-w-[1440px] gap-4 px-5 py-8 md:grid-cols-2 lg:px-8"><StatFeature icon={<Gauge />} title="VCR team rating" copy="Compare provisional team ratings based on recorded match results and opponent strength." /><StatFeature icon={<Globe2 />} title="Event strength" copy="Explore upcoming Signature Events and their registered fields." /></section>
  </>;
}

function EventsView({ loading,error,retry,results, live, openEvent, search, setSearch, filters, setters, extras, setExtras }: any) {
  const [visibleCount,setVisibleCount]=useState(60);
  const update = (key:string, value:string|boolean) => setExtras((old:any) => ({...old,[key]:value}));
  const eventRegionOptions = eventRegionsForCountry(filters.region);
  const changeCountry = (country:string) => { setters.setRegion(country); update('eventRegion','All'); };
  const reset = () => { setSearch(''); setters.setRegion('All'); setters.setEventClass('All'); setters.setFormat('All'); setters.setTime('All events'); setters.setGrade('All'); setExtras({ season: '2026–27: Override', level: 'All', from: '', to: '', eventRegion: 'All', city: '', affiliation: '', registrationOpen: false, spotsOpen: false, worldQualifier: false, girlPowered: false, includeCanceled: false }); };
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8"><PageHead eyebrow="Competition calendar" title="Find your next event" copy="Search the worldwide V5RC calendar by location, date, event format, grade and registration availability." />
    <div className="mt-8 border border-white/10 bg-[var(--c-surface)] p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><div className="md:col-span-2 xl:col-span-4"><FilterInput icon={<Search />} value={search} onChange={setSearch} placeholder="Search events by name or location" /></div><FilterSelect label="Country" allLabel="All countries" value={filters.region} options={vexCountries} onChange={changeCountry} /><FilterSelect label="Event region" allLabel="All event regions" value={extras.eventRegion} options={eventRegionOptions} onChange={(v:string)=>update('eventRegion',v)} /><FilterSelect label="Season" value={extras.season} options={['2026–27: Override','2025–26: Push Back','2024–25: High Stakes','2023–24: Over Under']} onChange={(v:string)=>update('season',v)} /><FilterSelect label="Event type" allLabel="All types" value={filters.eventClass} options={['All','Open Tournament','Invitational Tournament','School-Based Tournament','League','Live Remote Skills']} onChange={setters.setEventClass} /><FilterSelect label="Event format" allLabel="All formats" value={filters.format} options={['All','In-Person','Invitational','Remote','Skills Only']} onChange={setters.setFormat} /><FilterSelect label="Grade level" allLabel="All grade levels" value={filters.grade} options={['All','Middle School','High School']} onChange={setters.setGrade} /><FilterSelect label="Level class" allLabel="All level classes" value={extras.level} options={['All','Event Region Championship','National Championship','World Championship','Signature Event','Spotlight Event','Conference Championship','JROTC Brigade Championship','JROTC National Championship','Showcase Event']} onChange={(v:string)=>update('level',v)} /><FilterSelect label="Time" value={filters.time} options={['All events','Upcoming only','Next 30 days']} onChange={setters.setTime} /><FilterInput value={extras.city} onChange={(v:string)=>update('city',v)} placeholder="City" /><FilterInput value={extras.affiliation} onChange={(v:string)=>update('affiliation',v)} placeholder="Team affiliation" /><label className="filter-date"><span>From date</span><input type="date" value={extras.from} onChange={e=>update('from',e.target.value)} /></label><label className="filter-date"><span>To date</span><input type="date" value={extras.to} onChange={e=>update('to',e.target.value)} /></label></div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-white/10 pt-4">{[['registrationOpen','Registration open'],['spotsOpen','Spots open'],['worldQualifier','World qualifiers'],['girlPowered','Girl Powered'],['includeCanceled','Include canceled']].map(([key,label]) => <label key={key} className="flex cursor-pointer items-center gap-2 text-xs text-white/60"><input type="checkbox" checked={extras[key]} onChange={e=>update(key,e.target.checked)} className="accent-[var(--c-accent)]" />{label}</label>)}<button onClick={reset} className="ml-auto text-sm text-white/55 hover:text-white">Reset filters</button></div>
    </div>
    <div className="mt-5 flex items-center justify-between"><p className="text-sm text-white/45"><b className="text-white">{results.length}</b> events found {live && <span className="ml-2 text-emerald-400">● Live Event.VEX data</span>}</p><span className="flex items-center gap-2 text-xs text-white/50"><Filter className="h-3.5 w-3.5" /> Ranked by date</span></div>
    {error&&<LoadError message={error} retry={retry} />}{loading&&<p role="status" className="mt-5 text-sm text-white/60">Loading official events…</p>}<div className="mt-3 space-y-3">{results.slice(0,visibleCount).map((e:any) => <article onClick={()=>openEvent(e)} key={e.id} className="float-card grid cursor-pointer gap-4 border border-white/10 bg-[var(--c-surface)] p-5 hover:border-white/25 sm:grid-cols-[95px_1fr_auto] sm:items-center"><div className="border-b border-white/10 pb-3 sm:border-b-0 sm:border-r sm:pb-0"><small className="font-semibold text-[var(--c-accent)]">{new Date(`${e.date}T12:00:00`).toLocaleString('en',{month:'short'}).toUpperCase()}</small><b className="block text-4xl">{e.date.slice(-2)}</b><small className="text-white/50">to {e.end}</small></div><div><div className="flex flex-wrap items-center gap-2"><Tier value={e.tier} /><EventStatus value={e.status} /></div><h2 className="mt-2 text-xl font-semibold">{e.name}</h2><p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{e.city}</span>{e.teams > 0 && <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{e.teams} teams</span>}<span>{e.grade}</span><span>{e.format}</span>{e.sku && <span>{e.sku}</span>}</p></div><button onClick={click=>{click.stopPropagation();openEvent(e)}} aria-label={`View ${e.name} details`} className="grid h-10 w-10 place-items-center border border-white/10 hover:bg-white hover:text-black"><ChevronRight /></button></article>)}{!loading&&!error&&!results.length && <Empty text="No events match those filters. Try widening your search." />}</div>
    {visibleCount<results.length&&<button onClick={()=>setVisibleCount((count:number)=>count+120)} className="mt-4 w-full border border-white/10 bg-[var(--c-surface)] py-3 text-sm text-white/50 hover:border-white/30 hover:text-white">Show more events · {results.length-visibleCount} remaining</button>}
  </section>;
}

function EventInfoView({ event, goBack, openTeam, openTeamAtEvent }: {event:any;goBack:()=>void;openTeam:(team:any)=>void;openTeamAtEvent:(team:any)=>void}) {
  const [details,setDetails] = useState<any>(()=>eventDetailCache.get(String(event.id))??null);
  const [loading,setLoading] = useState(()=>!eventDetailCache.has(String(event.id)));
  const [tab,setTab] = useState('general');
  const [detailError,setDetailError]=useState('');
  const [detailRetry,setDetailRetry]=useState(0);
  const [resultsTab,setResultsTab] = useState('qualification');
  const [skillsMode,setSkillsMode] = useState('combined');
  const [qualificationView,setQualificationView]=useState('ranking');
  const [eventTabsRestored,setEventTabsRestored]=useState(false);
  useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(`vexrank-event-tabs-${event.id}`)??'null');if(saved?.tab)setTab(saved.tab);if(saved?.resultsTab)setResultsTab(saved.resultsTab);if(saved?.skillsMode)setSkillsMode(saved.skillsMode);if(saved?.qualificationView)setQualificationView(saved.qualificationView)}catch{}setEventTabsRestored(true)},[event.id]);
  useEffect(()=>{if(eventTabsRestored)sessionStorage.setItem(`vexrank-event-tabs-${event.id}`,JSON.stringify({tab,resultsTab,skillsMode,qualificationView}))},[event.id,eventTabsRestored,tab,resultsTab,skillsMode,qualificationView]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setDetailError('');setDetails(null);
    cachedJson(eventDetailUrl(event.id),eventDetailCache,String(event.id)).then((data:any)=>{if(active)setDetails(data)}).catch(error=>{if(active)setDetailError(error.message)}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[event.id,detailRetry]);
  const info=details?.event;
  const teamsList=details?.teams ?? [];
  const divisions=details?.divisions ?? [];
  const awards=details?.awards ?? [];
  const eventSkills=details?.skills ?? [];
  const organizer=details?.organizer ?? {};
  const location=info?.location;
  const dateStart=info?.start ?? `${event.date}T12:00:00`;
  const dateEnd=info?.end ?? `${event.date}T12:00:00`;
  const fullAddress=location ? [location.venue,location.address_1,location.city,location.region,location.postcode,location.country].filter(Boolean).join(', ') : event.city;
  const officialUrl=info?.officialUrl ?? `https://events.vex.com/robot-competitions/vex-robotics-competition/${event.sku}.html`;
  const mapsUrl=`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`;
  const tabs=[['general','General info'],['agenda','Agenda'],['travel','Travel info'],['webcast','Webcast'],['results','Results'],['awards','Awards'],['teams','Teams']];
  const eventDays=Array.from({length:Math.min(10,Math.max(1,Math.floor((new Date(dateEnd).getTime()-new Date(dateStart).getTime())/86400000)+1))},(_,index)=>new Date(new Date(dateStart).getTime()+index*86400000));
  const agendaData=parseAgenda(organizer.agenda,eventDays);
  const generalSummary=simplifyGeneralInfo(organizer.general);
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <button onClick={goBack} className="mb-6 flex items-center gap-2 text-sm font-bold text-white/50 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to events</button>
    <div className="border border-white/10 bg-[var(--c-hero)] p-6 sm:p-8"><div className="flex flex-wrap items-center gap-2"><Tier value={event.tier} /><EventStatus value={/cancell?ed/i.test(info?.name??event.name??'')?'Cancelled':info?.ongoing?'In progress':info?.end?(new Date(info.end)<new Date()?'Completed':'Upcoming'):(event.status??'Upcoming')} /></div><p className="mt-5 text-[11px] italic text-white/45">{event.sku ?? info?.sku ?? 'Official V5RC event'}</p><h1 className="font-display mt-1.5 max-w-4xl text-[2rem] leading-[1.1] sm:text-[2.75rem]">{info?.name ?? event.name}</h1><a href={officialUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 text-sm text-white/45 hover:text-white">Open on Event.VEX <ArrowUpRight className="h-4 w-4" /></a><div className="mt-6 flex flex-wrap gap-x-8 gap-y-3 text-sm text-white/55"><span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[var(--c-accent)]" />{new Date(dateStart).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})} – {new Date(dateEnd).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</span><span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-[var(--c-accent)]" />{fullAddress}</span></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Program" value={info?.program?.code ?? 'V5RC'} detail={info?.program?.name ?? 'VEX V5 Robotics Competition'} /><Metric label="Season" value={seasonYearLabel(info?.season?.name ?? event.season)} detail={info?.season?.name ?? event.season ?? 'Official season'} /><Metric label="Level class" value={event.levelClass ?? event.class ?? 'Other'} detail={event.eventType ?? 'Official competition'} /><Metric label="Registered teams" value={loading ? '…' : String(teamsList.length)} detail={loading ? 'Loading Event.VEX registrations' : 'Live registration list'} /></div>
    <nav className="mt-4 flex overflow-x-auto border border-white/10 bg-[var(--c-surface)]" aria-label="Event information">{tabs.map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap border-r border-white/10 px-5 py-4 text-xs font-semibold uppercase tracking-wider transition ${tab===key?'bg-[var(--c-accent)] text-white':'text-white/45 hover:bg-white/[.04] hover:text-white'}`}>{label}{key==='awards'&&awards.length>0?` ${awards.length}`:''}</button>)}</nav>
    <div key={tab} className="view-enter mt-4">
      {detailError&&<LoadError message={detailError} retry={()=>{eventDetailCache.delete(String(event.id));setDetailRetry(value=>value+1)}} />}
      {loading&&<article className="border border-white/10 bg-[var(--c-surface)] p-8 text-sm text-white/55">Loading official event information…</article>}
      {!loading&&!detailError&&tab==='general'&&<div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]"><article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Event profile" title="Essential details" /><dl className="mt-4 text-sm">{[['Event code',event.sku ?? info?.sku],['Format',event.format],['Grade level',event.grade],['Event region',event.eventRegion ?? location?.region],['Venue',location?.venue],['Divisions',info?.divisions?.map((division:any)=>division.name).join(', ') || 'To be announced']].map(([label,value])=><div key={label as string} className="flex justify-between gap-6 border-b border-white/[.07] py-4"><dt className="text-white/55">{label}</dt><dd className="text-right font-bold">{value || 'Not listed'}</dd></div>)}</dl></article><article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="From the organizer" title="What you need to know" />{generalSummary?<p className="mt-5 whitespace-pre-line text-sm leading-7 text-white/60">{generalSummary}</p>:<p className="mt-5 text-sm text-white/45">No additional organizer notes have been published yet.</p>}</article></div>}
      {!loading&&!detailError&&tab==='agenda'&&<article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Event schedule" title="Agenda" />{agendaData.notes.length>0&&<div className="mt-5 border-l-2 border-[var(--c-accent)] bg-white/[.025] px-4 py-3 text-xs leading-5 text-white/45">{agendaData.notes.join(' ')}</div>}<div className="mt-5 grid items-start gap-3 lg:grid-cols-3">{agendaData.days.map((day:any,index:number)=><section key={`${day.title}-${index}`} className="border border-white/10 p-5"><p className="text-[11px] italic text-white/45">Day {index+1}</p><h3 className="mt-2 text-xl font-semibold">{day.title}</h3>{day.entries.length?<div className="mt-4 divide-y divide-white/[.06]">{day.entries.map((entry:any,entryIndex:number)=><div key={`${entry.time}-${entryIndex}`} className="grid gap-1 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"><span className="font-semibold leading-5 text-white/65">{entry.activity}{entry.location&&<small className="block text-[10px] font-normal text-white/45">{entry.location}</small>}</span>{entry.time&&<time className="whitespace-nowrap text-right font-semibold text-white/75">{entry.time}</time>}</div>)}</div>:<p className="mt-4 text-sm text-white/55">Detailed times have not been published for this day.</p>}</section>)}</div>{!organizer.agenda&&<OfficialFallback href={officialUrl} text="Check the Event.VEX agenda" />}</article>}
      {!loading&&!detailError&&tab==='travel'&&<article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Plan your visit" title="Travel information" /><div className="mt-5 grid gap-4 md:grid-cols-2"><div className="border border-white/10 p-5"><p className="text-[11px] text-white/50">Venue</p><h3 className="mt-2 text-xl font-semibold">{location?.venue || 'Venue not announced'}</h3><p className="mt-2 text-sm leading-6 text-white/50">{fullAddress}</p><a href={mapsUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 border border-white/15 px-4 py-3 text-sm hover:bg-white hover:text-black">Open in maps <ArrowUpRight className="h-4 w-4" /></a></div><div className="border border-white/10 p-5"><p className="text-[11px] text-white/50">Organizer travel notes</p><h3 className="mt-2 text-xl font-semibold">Hotels, parking and arrival</h3>{organizer.travel?<p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/60">{organizer.travel}</p>:<><p className="mt-2 text-sm leading-6 text-white/50">No organizer travel notes have been published yet.</p><OfficialFallback href={officialUrl} text="Check Event.VEX travel details" compact /></>}</div></div></article>}
      {!loading&&!detailError&&tab==='webcast'&&<article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Watch live" title="Event webcast" /><div className="mt-5 border border-white/10 p-6"><h3 className="text-xl font-semibold">Webcast information</h3>{organizer.webcast?<p className="mt-3 whitespace-pre-line text-sm leading-7 text-white/60">{organizer.webcast}</p>:<p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">No webcast information has been published yet.</p>}<OfficialFallback href={officialUrl} text="Open webcast section on Event.VEX" /></div></article>}
      {!loading&&!detailError&&tab==='results'&&<EventResults openTeamAtEvent={(team:any)=>openTeamAtEvent({...team,seasonId:info?.season?.id,season:info?.season?.name})} divisions={divisions} skills={eventSkills} resultsTab={resultsTab} setResultsTab={setResultsTab} skillsMode={skillsMode} setSkillsMode={setSkillsMode} qualificationView={qualificationView} setQualificationView={setQualificationView} />}
      {!loading&&!detailError&&tab==='awards'&&<article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Official honors" title="Awards" />{awards.length?<div className="mt-5 grid gap-3 md:grid-cols-2">{awards.map((award:any)=><div key={award.id} className="border border-white/10 p-5"><p className="text-[11px] italic text-white/45">{award.designation || award.classification || 'Award'}</p><h3 className="mt-2 text-lg font-semibold">{award.title}</h3>{award.teamWinners?.map((winner:any)=><p key={winner.team?.id ?? winner.team?.name} className="mt-2 text-sm text-white/55"><b className="text-white">{winner.team?.name || winner.team?.number}</b>{winner.team?.team_name?` · ${winner.team.team_name}`:''}</p>)}{award.individualWinners?.map((winner:any,index:number)=><p key={index} className="mt-2 text-sm text-white/55">{winner.name}{winner.team?.name?` · ${winner.team.name}`:''}</p>)}</div>)}</div>:<Empty text="Awards have not been published for this event yet." />}</article>}
      {!loading&&!detailError&&tab==='teams'&&<article className="overflow-hidden border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Live registration" title="Teams attending" />{teamsList.length ? <div className="max-h-[650px] overflow-auto"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="px-5">Team</TableHead><TableHead>Organization</TableHead><TableHead>Grade</TableHead><TableHead className="px-5 text-right">Location</TableHead></TableRow></TableHeader><TableBody>{teamsList.map((team:any)=><TableRow key={team.id} tabIndex={0} role="link" onKeyDown={e=>{if(e.key==='Enter')openTeam({...team,seasonId:info?.season?.id,season:info?.season?.name})}} onClick={()=>openTeam({...team,region:[team.location?.region,team.location?.country].filter(Boolean).join(', '),country:team.location?.country,seasonId:info?.season?.id,season:info?.season?.name??event.season})} className="cursor-pointer border-white/[.07] hover:bg-white/[.04]"><TableCell className="px-5"><b>{team.number}</b><small className="ml-2 text-white/50">{team.name}</small></TableCell><TableCell className="text-white/55">{team.organization || '—'}</TableCell><TableCell className="text-white/55">{team.grade || '—'}</TableCell><TableCell className="px-5 text-right text-white/45">{[team.location?.city,team.location?.region,team.location?.country].filter(Boolean).join(', ')}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty text="No registered teams are listed yet." />}</article>}
    </div>
  </section>;
}

function OfficialFallback({href,text,compact=false}:{href:string;text:string;compact?:boolean}) {
  return <a href={href} target="_blank" rel="noreferrer" className={`${compact?'mt-4':'mt-6'} inline-flex items-center gap-2 border border-white/15 px-4 py-3 text-sm hover:bg-white hover:text-black`}>{text}<ArrowUpRight className="h-4 w-4" /></a>;
}

function EventResults({openTeamAtEvent,divisions,skills,resultsTab,setResultsTab,skillsMode,setSkillsMode,qualificationView,setQualificationView}:any) {
  const [eliminationView,setEliminationView]=useState<'classic'|'bracket'>('classic');
  const [divisionIndex,setDivisionIndex]=useState(0);
  const activeDivisionIndex=Math.min(divisionIndex,Math.max(0,divisions.length-1));
  const visibleDivisions=divisions.length?[divisions[activeDivisionIndex]]:[];
  const skillTeams=Array.from(skills.reduce((map:Map<string,any>,run:any)=>{const key=String(run.team?.id ?? run.team?.name);const row=map.get(key)??{team:run.team,driver:0,auto:0};const type=String(run.type).toLowerCase();if(type.includes('driver'))row.driver=Math.max(row.driver,run.score??0);else row.auto=Math.max(row.auto,run.score??0);map.set(key,row);return map},new Map()).values()).map((row:any)=>({...row,combined:row.driver+row.auto})).sort((a:any,b:any)=>b[skillsMode]-a[skillsMode]);
  const resultTabs=[['qualification','Qualification'],['elimination','Elimination'],['skills','Skills ranking']];
  return <article className="border border-white/10 bg-[var(--c-surface)] p-6"><SectionTitle eyebrow="Official competition data" title="Results" />
    <div className="mt-5 flex flex-wrap border border-white/10">{resultTabs.map(([key,label])=><button key={key} onClick={()=>setResultsTab(key)} className={`border-r border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-wider ${resultsTab===key?'bg-white text-black':'text-white/45 hover:text-white'}`}>{label}</button>)}</div>
    {resultsTab!=='skills'&&divisions.length>1&&<div className="mt-4 flex flex-wrap items-center border border-white/10 bg-black/15"><span className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[.16em] text-white/50">Division</span>{divisions.map((division:any,index:number)=><button key={division.id??index} onClick={()=>setDivisionIndex(index)} className={`border-l border-white/10 px-5 py-3 text-xs font-semibold uppercase tracking-wider ${activeDivisionIndex===index?'bg-[var(--c-accent)] text-white':'text-white/50 hover:bg-white/[.04] hover:text-white'}`}>{division.name||`Division ${index+1}`}</button>)}</div>}
    {resultsTab==='qualification'&&<div className="mt-5"><div className="mb-4 flex gap-2">{[['ranking','Rankings'],['matches','Match results']].map(([key,label])=><button key={key} onClick={()=>setQualificationView(key)} className={`border px-4 py-2 text-xs font-semibold uppercase tracking-wider ${qualificationView===key?'border-[var(--c-accent)] bg-[var(--c-accent)] text-white':'border-white/10 text-white/45 hover:text-white'}`}>{label}</button>)}</div><div className="space-y-8">{visibleDivisions.some((division:any)=>division.rankings.length||qualificationMatches(division).length)?visibleDivisions.map((division:any)=><section key={division.id}><h3 className="mb-3 text-lg font-semibold">{division.name || 'Division'}</h3>{qualificationView==='ranking'?(division.rankings.length>0?<div className="overflow-x-auto border border-white/10"><Table><TableHeader><TableRow className="border-white/10"><TableHead className="px-4">Rank</TableHead><TableHead>Team</TableHead><TableHead>Record</TableHead><TableHead className="text-right">WP / AP / SP</TableHead></TableRow></TableHeader><TableBody>{division.rankings.slice().sort((a:any,b:any)=>Number(a.rank)-Number(b.rank)).map((row:any)=><TableRow key={row.team?.id} className="border-white/[.07] hover:bg-white/[.04]"><TableCell className="px-4 font-semibold">#{row.rank}</TableCell><TableCell><button onClick={()=>openTeamAtEvent({id:row.team?.id,number:row.team?.name})} aria-label={`${row.team?.name} match history`} className="inline-flex items-center font-bold hover:text-[var(--c-accent)]">{row.team?.name || row.team?.number}<ChevronRight className="ml-1 h-3.5 w-3.5 text-white/30" aria-hidden="true" /></button></TableCell><TableCell>{row.wins}–{row.losses}–{row.ties}</TableCell><TableCell className="text-right font-mono text-white/50">{row.wp} / {row.ap} / {row.sp}</TableCell></TableRow>)}</TableBody></Table></div>:<Empty text="Qualification rankings have not been posted yet." />):<MatchGrid matches={qualificationMatches(division)} empty="Qualification match results have not been posted yet." />}</section>):<Empty text="Qualification rankings and matches have not been posted yet." />}</div></div>}
    {resultsTab==='elimination'&&<div className="mt-5"><div className="mb-5 flex gap-2">{([['classic','Classic view'],['bracket','Bracket view']] as const).map(([key,label])=><button key={key} onClick={()=>setEliminationView(key)} className={`border px-4 py-2 text-xs font-semibold uppercase tracking-wider ${eliminationView===key?'border-[var(--c-accent)] bg-[var(--c-accent)] text-white':'border-white/10 text-white/45 hover:text-white'}`}>{label}</button>)}</div><div className="space-y-8">{visibleDivisions.some((division:any)=>eliminationMatches(division).length)?visibleDivisions.map((division:any)=><section key={division.id}><h3 className="mb-3 text-lg font-semibold">{division.name || 'Division'}</h3>{eliminationView==='classic'?<MatchGrid matches={eliminationMatches(division)} empty="Elimination match results have not been posted yet." />:<EliminationBracket division={division} divisionNames={finalistDivisions(division,divisions)} />}</section>):<Empty text="Elimination matches have not been posted yet." />}</div></div>}
    {resultsTab==='skills'&&<div className="mt-5"><div className="mb-4 flex flex-wrap gap-2">{[['driver','Driver skills'],['auto','Auto skills'],['combined','Combined skills']].map(([key,label])=><button key={key} onClick={()=>setSkillsMode(key)} className={`border px-4 py-2 text-xs font-semibold uppercase tracking-wider ${skillsMode===key?'border-[var(--c-accent)] bg-[var(--c-accent)] text-white':'border-white/10 text-white/45 hover:text-white'}`}>{label}</button>)}</div>{skillTeams.length?<div className="overflow-x-auto border border-white/10"><Table><TableHeader><TableRow className="border-white/10"><TableHead className="w-20 px-4">Rank</TableHead><TableHead>Team</TableHead><TableHead className="text-right">Driver</TableHead><TableHead className="text-right">Auto</TableHead><TableHead className="px-4 text-right">Combined</TableHead></TableRow></TableHeader><TableBody>{skillTeams.map((row:any,index:number)=><TableRow key={row.team?.id ?? index} className="border-white/[.07]"><TableCell className="px-4 font-semibold">#{index+1}</TableCell><TableCell><b>{row.team?.name || row.team?.number}</b></TableCell><TableCell className="text-right font-mono">{row.driver}</TableCell><TableCell className="text-right font-mono">{row.auto}</TableCell><TableCell className="px-4 text-right font-mono font-semibold">{row.combined}</TableCell></TableRow>)}</TableBody></Table></div>:<Empty text="Skills scores have not been posted yet." />}</div>}
  </article>;
}

function qualificationMatches(division:any) { return (division.matches??[]).filter((match:any)=>Number(match.round)===2||/qual/i.test(match.name??'')).sort((a:any,b:any)=>Number(a.matchnum)-Number(b.matchnum)); }
function eliminationMatches(division:any) { const order=(round:number)=>round===6?0:round;return (division.matches??[]).filter((match:any)=>Number(match.round)>=3&&!/qual|practice/i.test(match.name??'')).sort((a:any,b:any)=>order(Number(a.round))-order(Number(b.round))||Number(a.matchnum)-Number(b.matchnum)); }
function MatchGrid({matches,empty='No scored matches in this section yet.'}:{matches:any[];empty?:string}) { return matches.length?<div className="mt-4 grid gap-2 md:grid-cols-2">{matches.map((match:any)=>{const hasScore=(match.alliances??[]).some((alliance:any)=>alliance.score!==null&&alliance.score!==undefined&&Number(alliance.score)>=0);return <div key={match.id} className="border border-white/10 p-4"><div className="mb-3 flex items-center justify-between"><div><b>{match.name}</b><small className="mt-1 block text-white/50">{match.field || (hasScore?'Final score':'Scheduled')}</small></div><span className="text-[10px] text-[11px] text-white/50">{hasScore?'Final':'Not played'}</span></div><div className="grid grid-cols-2 gap-2">{[...(match.alliances??[])].sort((a:any,b:any)=>(a.color==='red'?0:1)-(b.color==='red'?0:1)).map((alliance:any)=><div key={alliance.color} className={`border-l-2 pl-3 ${alliance.color==='red'?'border-red-400':'border-blue-400'}`}><div className={`font-mono text-lg font-semibold ${alliance.color==='red'?'text-red-400':'text-blue-400'}`}>{hasScore&&alliance.score!=null?alliance.score:'—'}</div><small className="block truncate text-white/45">{allianceTeams(alliance)}</small></div>)}</div></div>})}</div>:<p className="mt-3 text-sm text-white/50">{empty}</p>; }
function allianceTeams(alliance:any) { const names=(alliance.teams??[]).map((entry:any)=>entry.team?.name??entry.team?.number??entry.name??entry.number).filter(Boolean);return names.length?names.join(' + '):'Teams not assigned'; }

function EliminationBracket({division,divisionNames=[]}:{division:any;divisionNames?:string[]}) {
  const matches=eliminationMatches(division);const seeds=new Map<number,number>();
  const roundInfo=[[6,'Round of 16'],[3,'Quarterfinals'],[4,'Semifinals']] as const;
  const rounds=roundInfo.map(([round,label])=>({round,label,matches:bracketRound(matches,round,round===6?8:round===3?4:2)})).filter(group=>group.matches.some(Boolean));
  const halves=(side:'upper'|'lower')=>rounds.map(group=>{const midpoint=Math.ceil(group.matches.length/2);return{...group,matches:side==='upper'?group.matches.slice(0,midpoint):group.matches.slice(midpoint)}}).filter(group=>group.matches.length);
  const finals=matches.filter((match:any)=>Number(match.round)===5).sort((a:any,b:any)=>Number(a.matchnum)-Number(b.matchnum));
  if(!rounds.length&&finals.length)return <div className="overflow-x-auto border border-white/10 bg-black/15 px-6 py-10"><div className="mx-auto grid w-full min-w-[34rem] max-w-3xl grid-cols-[minmax(12rem,1fr)_minmax(22rem,1.7fr)] items-end"><div className="border border-r-0 border-white/10 bg-[var(--c-chrome)]"><div className="flex h-[45px] items-center justify-end border-b border-white/10 px-4 text-[11px] font-semibold uppercase tracking-[.16em] text-white/55">Divisions</div>{[0,1].map(index=><div key={index} className={`flex min-h-11 items-center justify-end border-r-[3px] px-4 text-right text-xs font-semibold ${index===0?'border-r-red-500':'border-r-blue-500'} ${index===0?'border-b border-white/10':''}`}>{divisionNames[index]||'Division not listed'}</div>)}</div><FinalSeries matches={finals} seeds={seeds} /></div></div>;
  const BracketHalf=({side,title}:{side:'upper'|'lower';title:string})=><section className="bracket-half"><p className="bracket-half-title text-xs font-semibold uppercase tracking-[.16em] text-white/45">{title}</p><div className="bracket-rounds">{halves(side).map(group=><div key={group.round} className="bracket-round"><p className="bracket-round-label text-xs font-bold text-white/50">{group.label}</p><div className="bracket-round-matches">{group.matches.map((match:any,index:number)=><div key={match?.id??index} className="bracket-match-slot">{index%2===0&&index+1<group.matches.length?<span className="bracket-join" aria-hidden="true" />:null}{match&&<BracketMatch match={match} seeds={seeds} />}</div>)}</div></div>)}</div></section>;
  return <div className="overflow-x-auto border border-white/10 bg-black/15 p-5"><div className="bracket-layout" style={{'--bracket-height':`${Math.max(28,...rounds.map(group=>Math.ceil(group.matches.length/2)*7))}rem`} as React.CSSProperties}><div className="bracket-halves"><BracketHalf side="upper" title="Upper bracket" /><BracketHalf side="lower" title="Lower bracket" /></div><div className="bracket-final-stage"><div className="bracket-final-card"><p className="mb-3 text-[11px] italic text-white/45">Grand final</p><FinalSeries matches={finals} seeds={seeds} /></div></div></div></div>;
}

function allianceKey(alliance:any){return (alliance?.teams??[]).map((entry:any)=>entry.team?.id??entry.team?.name??entry.name).filter(Boolean).sort().join('|')}
function allianceSeed(alliance:any,seeds:Map<any,any>){const values=(alliance?.teams??[]).map((entry:any)=>seeds.get(Number(entry.team?.id))).filter(Number.isFinite);return values.length?Math.min(...values):null}
function hasAllianceScore(alliance:any){return alliance?.score!==null&&alliance?.score!==undefined&&Number(alliance.score)>=0}

function BracketMatch({match,seeds}:{match:any;seeds:Map<any,any>}) {
  const alliances=[...(match.alliances??[])].sort((a:any,b:any)=>(a.color==='red'?0:1)-(b.color==='red'?0:1));const scored=alliances.length===2&&alliances.every(hasAllianceScore);const winningAlliance=scored&&Number(alliances[0].score)!==Number(alliances[1].score)?(Number(alliances[0].score)>Number(alliances[1].score)?alliances[0]:alliances[1]):null;
  const detail=match.games?.length>1?match.games.map((game:any)=>`${game.name}: Red ${game.alliances?.find((a:any)=>a.color==='red')?.score??'—'} – Blue ${game.alliances?.find((a:any)=>a.color==='blue')?.score??'—'}`).join(' · '):scored?`${match.name}: Red ${alliances.find((alliance:any)=>alliance.color==='red')?.score ?? '—'} – Blue ${alliances.find((alliance:any)=>alliance.color==='blue')?.score ?? '—'}`:`${match.name}: not scored yet`;
  return <div tabIndex={0} title={detail} className="bracket-card group relative w-full border border-white/10 bg-[var(--c-surface-2)] shadow-lg outline-none focus:border-white/30"><div className="absolute left-full top-1/2 z-20 ml-2 hidden w-max max-w-64 -translate-y-1/2 border border-white/15 bg-[var(--c-page)] px-3 py-2 text-xs text-white/75 shadow-xl group-hover:block group-focus:block">{detail}</div>{alliances.map((alliance:any,index:number)=>{const won=winningAlliance===alliance;const lost=Boolean(winningAlliance)&&!won;const isRed=alliance.color==='red';return <div key={alliance.color??index} className={`flex min-h-10 items-center gap-2 border-l-[3px] px-3 py-2 ${index?'border-t border-t-white/[.07]':''} ${isRed?'border-l-red-500':'border-l-blue-500'} ${won?'bg-emerald-400/[.10] text-white ring-1 ring-inset ring-emerald-400/30':lost?'bg-black/25 opacity-35':'text-white/65'}`}><span aria-label={`${isRed?'Red':'Blue'} alliance`} className={`flex h-4 w-4 shrink-0 items-center justify-center text-[8px] font-semibold text-white ${isRed?'bg-red-500':'bg-blue-500'}`}>{isRed?'R':'B'}</span><span className="w-7 shrink-0 text-[11px] font-semibold text-white/55">{allianceSeed(alliance,seeds)?`#${allianceSeed(alliance,seeds)}`:'—'}</span><span className="max-w-32 flex-1 truncate text-xs font-bold">{allianceTeams(alliance)}</span><span className="font-mono text-sm font-semibold">{hasAllianceScore(alliance)?alliance.score:'—'}</span></div>})}</div>;
}

function FinalSeries({matches,seeds}:{matches:any[];seeds:Map<any,any>}) {
  if(!matches.length)return <div className="border border-dashed border-white/15 p-5 text-sm text-white/50">Final not posted yet.</div>;
  const first=matches.find((match:any)=>(match.alliances??[]).length===2)??matches[0];const finalists=[...(first.alliances??[])].sort((a:any,b:any)=>(a.color==='red'?0:1)-(b.color==='red'?0:1));const keys=finalists.map(allianceKey);const wins=[0,0];
  for(const match of matches){const alliances=match.alliances??[];if(alliances.length!==2||!alliances.every(hasAllianceScore)||Number(alliances[0].score)===Number(alliances[1].score))continue;const winningAlliance=Number(alliances[0].score)>Number(alliances[1].score)?alliances[0]:alliances[1];const index=keys.indexOf(allianceKey(winningAlliance));if(index>=0)wins[index]++}
  const winner=Math.max(...wins)<2||wins[0]===wins[1]?-1:(wins[0]>wins[1]?0:1);const detail=matches.map((match:any,index:number)=>{const alliances=match.alliances??[];return `Game ${index+1}: ${alliances.length===2&&alliances.every(hasAllianceScore)?`Red ${alliances.find((a:any)=>a.color==='red')?.score??'—'} – Blue ${alliances.find((a:any)=>a.color==='blue')?.score??'—'}`:'not scored'}`}).join(' · ');
  return <div tabIndex={0} title={detail} className="group relative border border-white/10 bg-[var(--c-surface-2)] shadow-xl outline-none focus:border-white/30"><div className="absolute bottom-full right-0 z-20 mb-2 hidden w-max max-w-80 border border-white/15 bg-[var(--c-page)] px-3 py-2 text-xs leading-5 text-white/75 shadow-xl group-hover:block group-focus:block">{detail}</div><div className="border-b border-white/10 px-3 py-2 text-center font-mono text-lg font-semibold text-[var(--c-accent)]">{wins[0]} : {wins[1]}</div>{finalists.map((alliance:any,index:number)=>{const won=winner===index;const lost=winner>=0&&!won;const isRed=alliance.color==='red';return <div key={keys[index]||index} className={`flex min-h-11 items-center gap-2 border-l-[3px] px-3 py-2 ${index?'border-t border-t-white/[.07]':''} ${isRed?'border-l-red-500':'border-l-blue-500'} ${won?'bg-emerald-400/[.10] text-white ring-1 ring-inset ring-emerald-400/30':lost?'bg-black/25 opacity-35':'text-white/65'}`}><span aria-label={`${isRed?'Red':'Blue'} alliance`} className={`flex h-4 w-4 shrink-0 items-center justify-center text-[8px] font-semibold text-white ${isRed?'bg-red-500':'bg-blue-500'}`}>{isRed?'R':'B'}</span><span className="w-7 shrink-0 text-[11px] font-semibold text-white/55">{allianceSeed(alliance,seeds)?`#${allianceSeed(alliance,seeds)}`:'—'}</span><span className="flex-1 truncate text-xs font-bold">{allianceTeams(alliance)}</span><span className="font-mono font-semibold">{wins[index]}</span></div>})}</div>;
}


function simplifyGeneralInfo(text:string) {
  const blocks=String(text||'').split(/\n{2,}/).map(block=>block.replace(/\s+/g,' ').trim()).filter(block=>block.length>45&&!/^(grade level|skills challenge|judging format|event dates)/i.test(block));
  const summary=blocks.slice(0,2).join('\n\n');
  return summary.length>900?`${summary.slice(0,897).trim()}…`:summary;
}

function RankingsView({ teams: rows, meta, openTeam, savedState, setSavedState }: { teams: any[]; meta:any; openTeam:(t:any)=>void;savedState:any;setSavedState:(state:any)=>void }) {
  const availableSeasons=useAvailableRankingSeasons();
  const [season,setSeason]=useState(savedState.season??'2026–27 Override');const [rankingCountry,setRankingCountry]=useState(savedState.country??'All');const [rankingRegion,setRankingRegion]=useState(savedState.region??'All');const [gradeList,setGradeList]=useState(savedState.grade??'All teams');const [rankingSearch,setRankingSearch]=useState(savedState.search??'');const [archives,setArchives]=useState<Record<string,any>>({});const [archiveError,setArchiveError]=useState('');const [archiveRetry,setArchiveRetry]=useState(0);const [visibleCount,setVisibleCount]=useState(savedState.visibleCount??100);
  useEffect(()=>{if(season==='2026–27 Override'||archives[season])return;let active=true;setArchiveError('');const base=RANKING_SEASONS[season].archive;siteFetch(base).then(response=>response.ok?response.json():Promise.reject()).then((data:any)=>{const archive=validateArchive(data,season);if(active)setArchives(old=>({...old,[season]:archive}))}).catch(()=>{if(active)setArchiveError('The season archive could not be loaded. Please retry.');});return()=>{active=false}},[season,archives,archiveRetry]);
  useEffect(()=>setVisibleCount(100),[season,rankingCountry,rankingRegion,gradeList,rankingSearch]);
  useEffect(()=>setSavedState({season,country:rankingCountry,region:rankingRegion,grade:gradeList,search:rankingSearch,visibleCount}),[season,rankingCountry,rankingRegion,gradeList,rankingSearch,visibleCount,setSavedState]);
  const historical=archives[season];const activeRows=season==='2026–27 Override'?rows:(historical?.rankings??[]);const activeMeta=season==='2026–27 Override'?meta:historical;const countries=['All',...Array.from(new Set(activeRows.map((team:any)=>team.country).filter(Boolean))).sort((a:string,b:string)=>a.localeCompare(b))] as string[];const regionOf=(team:any)=>team.eventRegion??String(team.region??'Unassigned').split(',')[0].trim();const regions=['All',...Array.from(new Set(activeRows.filter((team:any)=>rankingCountry==='All'||team.country===rankingCountry).map(regionOf).filter(Boolean))).sort((a:string,b:string)=>a.localeCompare(b))] as string[];const filteredRows=activeRows.filter((team:any)=>(gradeList==='All teams'||team.grade===gradeList)&&(rankingCountry==='All'||team.country===rankingCountry)&&(rankingRegion==='All'||regionOf(team)===rankingRegion)&&(!rankingSearch||`${team.number} ${team.name}`.toLowerCase().includes(rankingSearch.toLowerCase())));const visibleRows=filteredRows.slice(0,visibleCount);const isFullArchive=season!=='2026–27 Override'&&Boolean(historical);
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8"><PageHead eyebrow="Live VEX Competitive Rating" title="World team ranking" copy="Compare current standings with past seasons, then narrow by school level, country and event region." />
    {archiveError&&<LoadError message={archiveError} retry={()=>setArchiveRetry(value=>value+1)} />}<div className="mt-8 flex flex-wrap gap-x-7 gap-y-1 border-b border-white/[.08]">{['All teams','High School','Middle School'].map(level=><button key={level} onClick={()=>setGradeList(level)} className={`-mb-px border-b-2 pb-2.5 pt-1 text-sm ${gradeList===level?'border-[var(--c-accent)] text-white':'border-transparent text-white/55 hover:text-white/75'}`}>{level==='All teams'?level:`${level} ranking`}</button>)}</div>
    <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2 xl:grid-cols-4"><FilterSelect label="Season" value={season} options={availableSeasons} onChange={value=>{setSeason(value);setRankingCountry('All');setRankingRegion('All')}} /><FilterSelect label="Country" allLabel="All countries" value={rankingCountry} options={countries} onChange={value=>{setRankingCountry(value);setRankingRegion('All')}} /><FilterSelect label="Event region" allLabel="All event regions" value={rankingRegion} options={regions} onChange={setRankingRegion} /><FilterInput icon={<Search />} value={rankingSearch} onChange={setRankingSearch} placeholder="Search team number or name" /></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-3"><Metric label={`${gradeList} rated`} value={season!=='2026–27 Override'&&!historical?'…':String(filteredRows.length)} detail={rankingCountry==='All'?'Minimum four official matches':`${filteredRows.length} teams in ${rankingCountry}`} /><Metric label="Events processed" value={String(activeMeta?.eventsProcessed ?? '…')} detail={`${activeMeta?.matchesProcessed ?? '…'} official matches`} /><Metric label="Rating leader" value={String(filteredRows[0]?.rating ?? '…')} detail={filteredRows[0] ? `${filteredRows[0].number} · ${gradeList} #1` : 'No qualifying teams'} /></div>
    <p className="mt-3 text-xs text-white/55">{isFullArchive?'VCR 3.0 · completed-season archive.':`Live official-data sample${activeMeta?.eventsProcessed?` · ${activeMeta.eventsProcessed} events`:''}. The complete season archive is not available yet.`}</p>
    <div className="mt-6 overflow-hidden border border-white/10 bg-[var(--c-surface)]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="w-20 px-5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Rank</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Team</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Region</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Record</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Matches</TableHead><TableHead className="px-5 text-right text-[10px] font-semibold uppercase tracking-wider text-white/50">VCR</TableHead></TableRow></TableHeader><TableBody>{visibleRows.map((t:any,index:number) => <TableRow key={t.number} tabIndex={0} role="link" onKeyDown={e=>{if(e.key==='Enter')openTeam({...t,season,seasonId:RANKING_SEASONS[season].id})}} onClick={() => openTeam({...t,season,seasonId:RANKING_SEASONS[season].id})} className="cursor-pointer border-white/[.07] hover:bg-white/[.04]"><TableCell className="px-5"><span className={`text-lg font-semibold ${index < 3 ? 'text-[var(--c-accent)]' : 'text-white/55'}`}>#{index+1}</span></TableCell><TableCell><b>{t.number}</b><small className="ml-3 text-white/50">{t.name}</small></TableCell><TableCell className="text-white/45">{t.region}</TableCell><TableCell className="font-mono text-white/65">{t.record}</TableCell><TableCell className="text-white/45">{t.matches}</TableCell><TableCell className="px-5 text-right font-mono text-lg font-semibold">{t.rating}<small className="ml-2 text-xs text-white/25">±{t.confidence}</small></TableCell></TableRow>)}</TableBody></Table></div>
    {visibleCount<filteredRows.length&&<button onClick={()=>setVisibleCount((count:number)=>count+250)} className="mt-4 w-full border border-white/10 bg-[var(--c-surface)] py-3 text-sm text-white/50 hover:border-white/30 hover:text-white">Show more teams · {filteredRows.length-visibleCount} remaining</button>}
    <p className="mt-4 text-xs text-white/45">Provisional VCR uses the specification’s opponent-adjusted match model and conservative uncertainty adjustment. Elimination results contribute to VCR 3.0. Contribution and autonomous components remain neutral where data is unavailable.</p>
  </section>;
}

function StatRankingsView({ teams: rows, openTeam }: { teams: any[]; openTeam:(t:any)=>void }) {
  const availableSeasons=useAvailableRankingSeasons();
  const [category, setCategory] = useState('Offense');
  const [statRegion, setStatRegion] = useState('All');
  const [season,setSeason]=useState('2026–27 Override');
  const [historical,setHistorical]=useState<Record<string,any>>({});
  const [skills,setSkills]=useState<any[]>([]);
  const [visibleCount,setVisibleCount]=useState(100);
  const skillCategory=category.includes('Skills');
  useEffect(()=>{let active=true;if(RANKING_SEASONS[season].archive&&!historical[season])siteFetch(RANKING_SEASONS[season].archive).then(r=>r.ok?r.json():Promise.reject()).then(data=>{const archive=validateArchive(data,season);if(active)setHistorical(old=>({...old,[season]:archive}))}).catch(()=>undefined);return()=>{active=false}},[season,historical]);
  useEffect(()=>{let active=true;setSkills([]);siteFetch(`/api/skills?season=${RANKING_SEASONS[season].id}`).then(r=>r.ok?r.json():Promise.reject()).then((data:any)=>{if(active)setSkills(data.rankings??[])}).catch(()=>{if(active)setSkills([])});return()=>{active=false}},[season]);
  useEffect(()=>setVisibleCount(100),[category,statRegion,season]);
  const matchRows=season!=='2026–27 Override'?(historical[season]?.rankings??[]):rows;
  const winRate=(team:any)=>{const [wins,,ties]=String(team.record??'0–0–0').split('–').map(Number);return team.matches?((wins+(ties||0)*.5)/team.matches)*100:0};
  const pickingScore=(team:any)=>Math.max(0,Math.min(100,.45*winRate(team)+.35*Math.max(0,Math.min(100,(team.rating-1250)/7.5))+.2*Math.max(0,Math.min(100,(team.ccwm+20)*1.25))));
  const consistencyScore=(team:any)=>Math.max(0,Math.min(100,100-Number(team.confidence??100)));
  const categories: Record<string,{label:string; description:string; value:(team:any)=>number; suffix:string; lower?:boolean; qualify:(team:any)=>boolean}> = {
    Offense: { label: 'Offensive rating', description: 'Teams that create the most scoring value, with at least 12 scored matches.', value: team => team.opr, suffix: '', qualify: team=>team.matches>=12 },
    Defense: { label: 'Defensive impact', description: 'Lowest opponent score share among teams with at least 12 scored matches.', value: team => team.dpr, suffix: '', lower: true, qualify: team=>team.matches>=12 },
    'Picking Strategy': { label: 'Strategic reliability', description: 'A 0–100 proxy combining results, opponent-adjusted strength and scoring margin. Requires 36 matches across 4 events.', value: pickingScore, suffix: '', qualify: team=>team.matches>=36&&team.events>=4 },
    Consistency: { label: 'Rating stability', description: 'How firmly the rating is supported by repeat results. Requires 36 matches across 4 events.', value: consistencyScore, suffix: '', qualify: team=>team.matches>=36&&team.events>=4 },
    'Auto Skills': { label: 'Autonomous skills', description: 'Official Event.VEX programming-skills score.', value: team => team.autoSkills, suffix: '', qualify: team=>team.autoSkills>0 },
    'Driver Skills': { label: 'Driver skills', description: 'Official Event.VEX driver-skills score.', value: team => team.driverSkills, suffix: '', qualify: team=>team.driverSkills>0 },
    'Combined Skills': { label: 'Combined skills', description: 'Official Event.VEX autonomous plus driver skills total.', value: team => team.combinedSkills, suffix: '', qualify: team=>team.combinedSkills>0 },
  };
  const active = categories[category];
  const sourceRows:any[]=skillCategory?skills:matchRows;
  const regions=['All',...Array.from(new Set(sourceRows.map((team:any)=>team.country).filter(Boolean))).sort((a:string,b:string)=>a.localeCompare(b))] as string[];
  const ranking = sourceRows.filter(team => active.qualify(team)&&(statRegion === 'All' || team.country === statRegion)).sort((a,b) => active.lower ? active.value(a)-active.value(b) : active.value(b)-active.value(a));
  const visible=ranking.slice(0,visibleCount);
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8"><PageHead eyebrow="Performance leaderboards" title="Who leads every part of the game?" copy="Go beyond the overall world ranking and discover the teams setting the standard in scoring, defense, autonomous play and strategy." />
    <div className="mt-8 flex flex-wrap gap-2">{Object.keys(categories).map(key => <button key={key} onClick={()=>setCategory(key)} className={`border px-4 py-2 text-xs font-semibold transition ${category === key ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-white' : 'border-white/10 bg-[var(--c-surface)] text-white/50 hover:border-white/30 hover:text-white'}`}>{key}</button>)}</div>
    <div className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-[1fr_1fr_2fr] sm:items-end"><FilterSelect label="Season" value={season} options={availableSeasons} onChange={value=>{setSeason(value);setStatRegion('All')}} /><FilterSelect label="Region" value={statRegion} options={regions} onChange={setStatRegion} /><div><p className="text-[11px] italic text-white/45">{active.label}</p><p className="mt-1 text-sm text-white/55">{active.description}</p></div></div>
    <div className="mt-4 overflow-hidden border border-white/10 bg-[var(--c-surface)]"><Table><TableHeader><TableRow className="border-white/10 hover:bg-transparent"><TableHead className="w-20 px-5 text-[10px] font-semibold uppercase tracking-wider text-white/50">Rank</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Team</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">Region</TableHead><TableHead className="text-[10px] font-semibold uppercase tracking-wider text-white/50">{skillCategory?'Grade':'Overall'}</TableHead><TableHead className="px-5 text-right text-[10px] font-semibold uppercase tracking-wider text-white/50">{active.label}</TableHead></TableRow></TableHeader><TableBody>{visible.map((team,index)=><TableRow key={team.number} onClick={()=>!skillCategory&&openTeam({...team,season})} className={`${skillCategory?'':'cursor-pointer'} border-white/[.07] hover:bg-white/[.04]`}><TableCell className="px-5 text-lg font-semibold text-white/50">#{index+1}</TableCell><TableCell><b>{team.number}</b><small className="ml-3 text-white/50">{team.name}</small></TableCell><TableCell className="text-white/45">{team.region}</TableCell><TableCell className="text-white/45">{skillCategory?(team.grade??'—'):`World #${team.rank}`}</TableCell><TableCell className="px-5 text-right font-mono text-lg font-semibold">{active.value(team).toFixed(skillCategory||category==='Picking Strategy'||category==='Consistency'?0:1)}{active.suffix}</TableCell></TableRow>)}</TableBody></Table></div>
    {visibleCount<ranking.length&&<button onClick={()=>setVisibleCount(count=>count+250)} className="mt-4 w-full border border-white/10 bg-[var(--c-surface)] py-3 text-sm text-white/50 hover:border-white/30 hover:text-white">Show more teams · {ranking.length-visibleCount} remaining</button>}
    {!visible.length&&<div className="mt-4"><Empty text="No teams currently meet this category’s qualification threshold." /></div>}
    <p className="mt-4 text-xs text-white/45">Skills scores come directly from the official Event.VEX world skills standings. Strategic reliability and rating stability require 36 scored matches across at least four events, preventing small samples from leading those categories.</p>
  </section>;
}

function useInView<T extends HTMLElement>(){
  const [node,setNode]=useState<T|null>(null);
  const [inView,setInView]=useState(false);
  useEffect(()=>{
    if(!node)return;
    // Without IntersectionObserver, show the final state rather than nothing.
    // Deferred a frame so the effect body does not setState synchronously.
    if(typeof IntersectionObserver==='undefined'){
      const frame=requestAnimationFrame(()=>setInView(true));
      return ()=>cancelAnimationFrame(frame);
    }
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setInView(true);observer.disconnect()}
    // threshold 0, not a fraction: a tall element (the season band is ~730px)
    // can have its top edge well onto the screen while still showing less than
    // 20% of itself, which left its contents sitting at opacity 0 until a
    // scroll nudged the observer. The negative bottom margin still delays the
    // trigger until the element is meaningfully in view.
    },{threshold:0,rootMargin:'0px 0px -12% 0px'});
    observer.observe(node);
    return ()=>observer.disconnect();
  },[node]);
  return [setNode,inView] as const;
}

/** The global reduced-motion rule in globals.css cannot reach SVG drawn by
    Recharts, so the chart has to opt out in JS. */
function useReducedMotion(){
  const [reduce,setReduce]=useState(false);
  useEffect(()=>{
    const query=window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if(!query)return;
    const onChange=()=>setReduce(query.matches);
    // Initial read is deferred a frame; starting at false keeps the first paint
    // identical to the server's, so hydration does not mismatch.
    const frame=requestAnimationFrame(onChange);
    query.addEventListener('change',onChange);
    return ()=>{cancelAnimationFrame(frame);query.removeEventListener('change',onChange)};
  },[]);
  return reduce;
}

function SeasonRatingChart({data,onOpenEvent}:{data:any[];onOpenEvent:(point:any)=>void}) {
  const [selected,setSelected]=useState<any>(data.at(-1));
  useEffect(()=>setSelected(data.at(-1)),[data]);
  const [chartRef,chartInView]=useInView<HTMLDivElement>();
  const reduceMotion=useReducedMotion();
  // Axes and grid render immediately so the box reserves its height (no CLS);
  // only the curve itself waits to be scrolled to.
  const drawCurve=chartInView||reduceMotion;
  if(!data.length)return <article className="mt-6 border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Season progression" title="Tournament rating movement" /><Empty text="No scored tournament matches are available for this season." /></article>;
  const chartData=data.map((point,index)=>({...point,index,label:new Date(point.eventDate).toLocaleDateString(undefined,{month:'short',day:'numeric'})}));
  const ratings=chartData.map(point=>point.rating);const low=Math.min(...ratings);const high=Math.max(...ratings);const padding=Math.max(15,Math.ceil((high-low)*.15));
  const detail=selected??chartData.at(-1);
  return <article className="mt-6 border border-white/10 bg-[var(--c-surface)]">
    <SectionTitle eyebrow="Season progression" title="Tournament rating movement" />
    <div className="p-5">
      <div className="mb-5 flex flex-col gap-2 rounded-r-lg border-l-2 border-[var(--c-accent)] bg-white/[.025] p-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="text-[11px] text-white/50">{new Date(detail.eventDate).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})}</p>
          <button onClick={()=>onOpenEvent(detail)} className="mt-1 block max-w-full truncate text-left font-semibold hover:text-[var(--c-accent)]">{detail.event}</button>
        </div>
        <div className="sm:ml-auto sm:text-right">
          <b className={`font-mono text-xl ${detail.change>=0?'text-emerald-400':'text-rose-400'}`}>{detail.change>=0?'+':''}{detail.change} pts</b>
          <p className="text-xs text-white/50">Rating {detail.rating} · {detail.matches} matches</p>
        </div>
      </div>
      <div ref={chartRef} className="h-[320px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{top:12,right:18,left:-12,bottom:8}}>
            <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false}/>
            <XAxis dataKey="label" stroke="rgba(255,255,255,.3)" tickLine={false} axisLine={false} minTickGap={24}/>
            <YAxis domain={[low-padding,high+padding]} stroke="rgba(255,255,255,.3)" tickLine={false} axisLine={false}/>
            <Tooltip cursor={{stroke:'rgba(255,255,255,.18)'}} content={({active,payload}:any)=>{const point=payload?.[0]?.payload;if(!active||!point)return null;return <div className="max-w-72 border border-white/15 bg-[var(--c-page)] p-3 text-xs shadow-2xl"><b className="block text-sm">{point.event}</b><span className="mt-1 block text-white/45">{point.label} · {point.matches} matches</span><span className={`mt-2 block font-mono font-semibold ${point.change>=0?'text-emerald-400':'text-rose-400'}`}>{point.change>=0?'+':''}{point.change} points · rating {point.rating}</span></div>}}/>
            {drawCurve&&<Line
              type="monotone"
              dataKey="rating"
              stroke="var(--c-accent)"
              strokeWidth={3}
              isAnimationActive={!reduceMotion}
              animationDuration={1100}
              animationEasing="ease-out"
              activeDot={false}
              dot={(props:any)=>(
                <circle
                  cx={props.cx}
                  cy={props.cy}
                  r={selected?.eventId===props.payload.eventId?6:4.5}
                  fill={props.payload.change>=0?'#34d399':'#fb7185'}
                  stroke="var(--c-surface)"
                  strokeWidth={2}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer outline-none focus:stroke-white"
                  aria-label={`${props.payload.event}: ${props.payload.change>=0?'gained':'lost'} ${Math.abs(props.payload.change)} points`}
                  onClick={()=>setSelected(props.payload)}
                  onKeyDown={(event:any)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(props.payload)}}}
                />
              )}
            />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 text-xs text-white/50">Select any point to inspect the tournament. Movement is replayed from the team’s official scored matches and grouped by event. The published world ranking is computed from a rolling sample of the season’s most recent official events, so a team’s earliest results may sit outside it — this graph can therefore run ahead of the rating shown in the rankings table.</p>
    </div>
  </article>;
}

function TeamView({ team, goBack, backLabel, openEvent, openTeamAtEvent }: { team:any; goBack:()=>void;backLabel:string;openEvent:(event:any)=>void;openTeamAtEvent:(team:any,event:any)=>void }) {
  const initialCacheKey=teamCacheKey(String(team.number),team.seasonId,team.id);const [history,setHistory]=useState<any>(()=>team.history??teamHistoryCache.get(initialCacheKey)??null);const [historyError,setHistoryError]=useState('');const [retry,setRetry]=useState(0);const winRate=team.matches&&team.record?Math.round((Number(team.record.split('–')[0])/team.matches)*100):0;
  const profile=history?.team??team;
  const [bandRef,bandInView]=useInView<HTMLDivElement>();
  const numberText=String(profile.number??'');
  const numberDigits=(/^(\d*)/.exec(numberText)?.[1])||numberText;
  const numberSuffix=numberText.slice(numberDigits.length);
  const seasons=history?Array.from(new Map(history.events.map((event:any)=>[event.seasonId,{id:event.seasonId,name:event.season}])).values()) as {id:number;name:string}[]:[];
  const [selectedSeason,setSelectedSeason]=useState<number|undefined>(seasons[0]?.id);
  useEffect(()=>{const cacheKey=teamCacheKey(String(team.number),team.seasonId,team.id);const cached=team.history??teamHistoryCache.get(cacheKey);setHistory(cached??null);setHistoryError('');if(cached?.seasonGrades)return;let active=true;cachedJson(teamProfileUrl(team.number,team.seasonId,team.id),teamHistoryCache,cacheKey).then((data:any)=>{if(active)setHistory(data)}).catch(error=>{if(active)setHistoryError(error.message||'Team history could not be loaded.')});return()=>{active=false}},[team.number,team.id,team.seasonId,team.history,retry]);
  useEffect(()=>{const requested=Number(team.seasonId)||(team.season==='2025–26 Push Back'?197:team.season==='2026–27 Override'?204:undefined);setSelectedSeason(previous=>previous&&seasons.some(season=>season.id===previous)?previous:requested&&seasons.some(season=>season.id===requested)?requested:seasons[0]?.id)},[team.number,team.seasonId,team.season,history]);
  useEffect(()=>{if(!history||!selectedSeason||(history.loadedSeasonIds??[]).includes(selectedSeason))return;let active=true;const cacheKey=teamCacheKey(String(team.number),selectedSeason,team.id);cachedJson(teamProfileUrl(team.number,selectedSeason,team.id),teamHistoryCache,cacheKey).then((data:any)=>{if(active)setHistory(data)}).catch(error=>{if(active)setHistoryError(error.message)});return()=>{active=false}},[team.number,team.id,selectedSeason,history?.loadedSeasonIds,retry]);
  const seasonEvents=history?history.events.filter((event:any)=>event.seasonId===selectedSeason):[];
  const seasonAwards=history?history.awards.filter((award:any)=>award.seasonId===selectedSeason):[];
  const seasonSkills=history?history.skills.filter((skill:any)=>skill.seasonId===selectedSeason):[];
  const bestDriver=Math.max(0,...seasonSkills.filter((skill:any)=>skill.type==='driver').map((skill:any)=>Number(skill.score)));
  const bestProgramming=Math.max(0,...seasonSkills.filter((skill:any)=>skill.type==='programming').map((skill:any)=>Number(skill.score)));
  const skillEvents=new Map<number,{driver:number;programming:number}>();
  seasonSkills.forEach((skill:any)=>{const score=skillEvents.get(skill.eventId)??{driver:0,programming:0};if(skill.type==='driver')score.driver=Math.max(score.driver,Number(skill.score));if(skill.type==='programming')score.programming=Math.max(score.programming,Number(skill.score));skillEvents.set(skill.eventId,score)});
  const bestCombined=Math.max(0,...[...skillEvents.values()].map(score=>score.driver+score.programming));
  const seasonTrend=history?(history.ratingHistory??[]).filter((point:any)=>point.seasonId===selectedSeason).sort((a:any,b:any)=>String(a.eventDate).localeCompare(String(b.eventDate))):[];
  const seasonGrade=history?.seasonGrades?.[String(selectedSeason)]??profile.grade;
  return <section><div className="border-b border-white/10 bg-[var(--c-hero)]"><div className="mx-auto max-w-[1440px] px-5 pb-12 pt-8 lg:px-8"><button onClick={goBack} className="flex items-center gap-2 text-xs text-white/55 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to {backLabel}</button>
      <div className="team-hero-parallax">
      <div className="rise mt-10 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-[.22em] text-white/50" style={{'--i':0} as React.CSSProperties}><span>V5RC team profile</span><span className="text-white/15">/</span><span>{history?(profile.active?'Active':'Inactive'):(team.rank?`World #${team.rank}`:'Loading')}</span></div>
      <h1 className="team-lockup mt-3" style={{'--i':1} as React.CSSProperties}><span className="sr-only">{numberText}</span><SignedNumber value={numberText} accentFrom={numberDigits.length} /></h1>
      {profile.region&&<p className="rise mt-4 flex items-center gap-2.5 text-lg leading-snug text-white/75 sm:text-2xl" style={{'--i':2} as React.CSSProperties}><MapPin className="h-5 w-5 shrink-0 text-[var(--c-accent)]" aria-hidden="true" />{profile.region}</p>}
      <div className="rise mt-6 flex flex-col gap-6 border-t border-white/10 pt-6 sm:flex-row sm:items-end" style={{'--i':3} as React.CSSProperties}><div className="min-w-0"><p className="text-xl uppercase leading-tight tracking-tight text-white/70 sm:text-2xl">{profile.name}</p>{profile.organization&&<p className="mt-2 text-sm text-white/50">{profile.organization} · {seasonGrade}</p>}</div><div className="sm:ml-auto sm:text-right"><p className="text-[11px] font-bold uppercase tracking-[.22em] text-white/50">{team.rating?'Live VCR':'Ranking status'}</p><p className="team-figure mt-1">{team.rating??'—'}</p><p className="mt-1 text-sm text-white/50">{team.rating?`Confidence ±${team.confidence??'—'}`:'Not rated this season'}</p></div></div>
    </div></div></div>
    {history?<div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8">{historyError&&<LoadError message={historyError} retry={()=>{setHistoryError('');setRetry(value=>value+1)}} />}<div className="grid gap-3 border border-white/10 bg-[var(--c-surface)] p-4 sm:grid-cols-[1fr_3fr] sm:items-end"><FilterSelect label="Team season" value={String(selectedSeason??'')} options={seasons.map(season=>String(season.id))} optionLabels={Object.fromEntries(seasons.map(season=>[String(season.id),season.name]))} onChange={value=>setSelectedSeason(Number(value))} /><p className="pb-2 text-sm text-white/55">Showing official results for {seasons.find(season=>season.id===selectedSeason)?.name??'the selected season'}.</p></div><div ref={bandRef} className={`team-band mt-10 bg-[var(--c-band)] py-14 text-white ${bandInView?'is-visible':''}`}><div className="mx-auto max-w-[1440px] px-5 lg:px-8"><p className="band-item text-[11px] font-bold uppercase tracking-[.22em] text-white/55" style={{'--i':0} as React.CSSProperties}>Season summary</p><h2 className="band-item mt-2 text-[2.25rem] font-semibold uppercase leading-[.92] tracking-[-.035em] sm:text-[3.25rem]" style={{'--i':1} as React.CSSProperties}>On<br/>record</h2><div className="mt-10 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">{([['Status',profile.active?'Active':'Inactive',`${profile.currentSeasonEvents} current-season events`],['Season events',String(seasonEvents.length),'Official competitions'],['Season awards',String(seasonAwards.length),'Official award records'],['Seasons found',String(profile.seasons),'Complete team history']] as [string,string,string][]).map(([label,value,detail],index)=><div key={label} className="band-item border-t border-white/20 pt-3" style={{'--i':index+2} as React.CSSProperties}><p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/55">{label}</p><p className="mt-2 text-[2.5rem] font-semibold leading-none tracking-[-.03em]">{value}</p><p className="mt-2 text-xs text-white/55">{detail}</p></div>)}</div></div></div><SeasonRatingChart data={seasonTrend} onOpenEvent={(point)=>{const event=history.events.find((item:any)=>item.id===point.eventId);if(event)openEvent({...event,date:event.start,end:event.end?.slice(0,10),city:event.location})}}/><article className="scroll-reveal mt-6 border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Robot skills" title="Season best skills scores" /><div className="grid gap-3 p-5 sm:grid-cols-3"><Metric label="Driver skills" value={bestDriver?String(bestDriver):'—'} detail="Highest official driver score" /><Metric label="Programming skills" value={bestProgramming?String(bestProgramming):'—'} detail="Highest official autonomous score" /><Metric label="Combined skills" value={bestCombined?String(bestCombined):'—'} detail="Best driver + programming at one event" /></div></article><div className="scroll-reveal mt-6 grid gap-6 lg:grid-cols-[1.35fr_.65fr]"><article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Competition history" title="Events, qualification and finals" /><div className="max-h-[720px] overflow-auto">{seasonEvents.map((event:any)=>{const standings=history.rankings.filter((row:any)=>row.eventId===event.id);const eventSkills=history.skills.filter((skill:any)=>skill.eventId===event.id);const driver=Math.max(0,...eventSkills.filter((skill:any)=>skill.type==='driver').map((skill:any)=>Number(skill.score)));const programming=Math.max(0,...eventSkills.filter((skill:any)=>skill.type==='programming').map((skill:any)=>Number(skill.score)));return <div key={event.id} className="border-b border-white/[.07] p-5"><button onClick={()=>openEvent({...event,date:event.start,end:event.end?.slice(0,10),city:event.location})} className="flex w-full justify-between gap-4 text-left hover:text-[var(--c-accent)]"><b>{event.name}</b><small className="shrink-0 text-white/50">{event.start?.slice(0,10)}</small></button><p className="mt-1 text-xs text-white/55">{event.location||'Location not listed'}</p><p className="mt-3 text-sm font-bold text-[var(--c-accent)]">Finals: {event.elimination||'No elimination result available'}</p>{standings.map((standing:any,index:number)=><p key={`${standing.division}-${index}`} className="mt-2 text-sm">Qualification rank #{standing.rank} · {standing.wins}–{standing.losses}–{standing.ties}<span className="text-white/50">{standing.division?` · ${standing.division}`:''}</span></p>)}<p className="mt-2 text-xs text-white/45">Skills · Driver {driver||'—'} · Programming {programming||'—'} · Combined {driver||programming?driver+programming:'—'}</p>{(standings.length>0||event.elimination||Date.parse(event.start)<=Date.now())&&<button onClick={()=>openTeamAtEvent({...profile,seasonId:event.seasonId,season:event.season},{...event,date:event.start,end:event.end?.slice(0,10),city:event.location})} className="mt-3 inline-flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-xs font-semibold hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]">Matches and strengths <ChevronRight className="h-3.5 w-3.5" /></button>}</div>})}{!seasonEvents.length&&<Empty text="No official events are available for this season." />}</div></article><article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Official recognition" title="Awards" /><div className="max-h-[720px] overflow-auto">{seasonAwards.map((award:any,index:number)=><button onClick={()=>{const event=history.events.find((item:any)=>item.id===award.eventId);if(event)openEvent({...event,date:event.start,end:event.end?.slice(0,10),city:event.location})}} key={`${award.eventId}-${award.title}-${index}`} className="block w-full border-b border-white/[.07] p-5 text-left hover:bg-white/[.03]"><b>{award.title}</b><p className="mt-1 text-xs text-white/55">{award.event}</p></button>)}{!seasonAwards.length&&<Empty text="No official awards are listed for this season." />}</div></article></div></div>:team.rating?
    <div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8"><div className="scroll-reveal grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Season record" value={team.record} detail={`${team.matches ?? 0} scored matches`} /><Metric label="Events processed" value={String(team.events)} detail="Official current-season events" /><Metric label="Scoring estimate" value={team.opr.toFixed(1)} detail="Alliance score share" /><Metric label="Points allowed" value={team.dpr.toFixed(1)} detail="Opponent score share" /><Metric label="Win rate" value={`${winRate}%`} detail="Official scored matches" /></div>
      <div className="scroll-reveal mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]"><article className="overflow-hidden border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Verified identity" title="Official team information" /><dl className="space-y-4 p-5 text-sm">{[['Team number',team.number],['Official team name',team.name],['Organization',team.organization||'Not listed'],['Robot name',team.robot||'Not listed'],['Grade level',team.grade||'Not listed'],['Location',team.region],['Ranking season',team.season||'2026–27 Override']].map(([label,value])=><div key={label} className="flex justify-between gap-6 border-b border-white/[.07] pb-3"><dt className="text-white/55">{label}</dt><dd className="text-right font-bold">{value}</dd></div>)}</dl></article><article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Rating status" title="Provisional VCR coverage" /><div className="p-5 text-sm leading-relaxed text-white/45"><p>This profile is built from real Event.VEX match scores for the {team.season||'2026–27 Override'} season. The current rating applies opponent adjustment, margin of victory, chronological processing and a conservative confidence deduction.</p><p className="mt-4">Contribution, autonomous and finish components are not displayed until their source data is complete enough to avoid invented precision.</p><div className="mt-5 border-l-2 border-emerald-400 bg-emerald-400/[.06] p-4 text-emerald-100">{team.matches} official matches are currently included for this team.</div></div></article></div>
    </div>:historyError?<div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8"><div className="border border-rose-400/25 bg-rose-400/[.05] p-6"><p className="text-sm text-rose-200">{historyError}</p><button onClick={()=>{teamHistoryCache.delete(initialCacheKey);setRetry(value=>value+1)}} className="mt-4 border border-white/15 px-4 py-2 text-sm hover:bg-white hover:text-black">Retry</button></div></div>:<div className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8"><Empty text="Loading team history…" /></div>}</section>;
}

function TeamEventView({ event, team, backLabel, goBack, openEvent, openTeam }: { event:any; team:any; backLabel:string; goBack:()=>void; openEvent:(event:any)=>void; openTeam:(team:any)=>void }) {
  const key=String(event.id);
  const [details,setDetails]=useState<any>(()=>eventDetailCache.get(key)??null);
  const [error,setError]=useState('');
  const [refreshing,setRefreshing]=useState(false);
  const [reload,setReload]=useState(0);
  // A retry clears the error in the handler, not the effect: a synchronous
  // setState in an effect body re-renders before the fetch has even started.
  const retry=()=>{setError('');setRefreshing(true);setReload(value=>value+1)};
  useEffect(()=>{
    let active=true;
    if(reload)eventDetailCache.delete(key);
    cachedJson(eventDetailUrl(key),eventDetailCache,key).then((data:any)=>{if(active)setDetails(data)}).catch((failure:any)=>{if(active)setError(describeFetchError(failure,failure.message||'Event data could not be loaded.'))}).finally(()=>{if(active)setRefreshing(false)});
    return()=>{active=false};
  },[key,reload]);
  const number=String(team.number??'');
  const matches=useMemo(()=>details?teamMatches(details,number):[],[details,number]);
  const standing=useMemo(()=>details?teamStanding(details,number):null,[details,number]);
  const profile=useMemo(()=>details?strengthProfile(details,number):null,[details,number]);
  const check=standing?recordCheck(standing,matches):null;
  const played=matches.filter((match:any)=>match.played);
  const upcoming=matches.filter((match:any)=>!match.played);
  const points=teamMomentum(matches);
  const registered=(details?.teams??[]).find((entry:any)=>String(entry.number).toUpperCase()===number.toUpperCase());
  const teamName=team.name||registered?.name;
  const info=details?.event;
  const eventName=info?.name??event.name??'Event';
  const scored={wins:played.filter((m:any)=>m.outcome==='won').length,losses:played.filter((m:any)=>m.outcome==='lost').length,ties:played.filter((m:any)=>m.outcome==='tied').length};
  const openThisEvent=()=>openEvent({...event,...(info?{id:info.id,name:info.name,sku:info.sku}:{})});
  const outcomeLabel=(match:any)=>({won:'Won',lost:'Lost',tied:'Tied'} as Record<string,string>)[match.outcome]??'';
  const matchRow=(match:any)=><li key={match.id} className="border-b border-white/[.07] px-5 py-4 last:border-b-0">
    <div className="flex items-baseline justify-between gap-4"><b className="text-sm">{match.name}</b>
      {match.played?<span className={`text-[11px] font-bold uppercase tracking-wider ${check&&!check.agrees?'text-white/50':match.outcome==='won'?'text-emerald-400':match.outcome==='lost'?'text-rose-400':'text-white/60'}`}>{outcomeLabel(match)}{check&&!check.agrees?' on score':''}</span>
        :match.scheduled?<time className="font-mono text-xs text-white/55">{new Date(match.scheduled).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time>:<span className="text-xs text-white/40">Not scheduled</span>}</div>
    <div className="mt-2 flex flex-wrap items-center gap-2.5"><span className={`px-1.5 py-0.5 text-[9px] font-bold text-white ${match.colour==='red'?'bg-red-500':'bg-blue-500'}`}>{match.colour==='red'?'RED':'BLUE'}</span>
      {match.played&&<span className="font-mono text-sm font-semibold">{match.scoreFor} – {match.scoreAgainst}</span>}
      {match.field&&<span className="text-xs text-white/40">{match.field}</span>}{details?.divisions?.length>1&&<span className="text-xs text-white/40">{match.division}</span>}</div>
    {match.partners.length>0&&<p className="mt-1.5 text-xs text-white/55">with {match.partners.map((partner:string)=><button key={partner} onClick={()=>openTeam({number:partner,seasonId:info?.season?.id,season:info?.season?.name})} className="mr-1.5 hover:text-[var(--c-accent)]">{partner}</button>)}</p>}
    {match.opponents.length>0&&<p className="mt-0.5 text-xs text-white/75">vs {match.opponents.map((opponent:string)=><button key={opponent} onClick={()=>openTeam({number:opponent,seasonId:info?.season?.id,season:info?.season?.name})} className="mr-1.5 hover:text-[var(--c-accent)]">{opponent}</button>)}</p>}
  </li>;
  const stat=(label:string,value:any,title?:string)=>value==null?null:<div key={label} title={title}><p className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</p><p className="mt-1 font-mono text-[15px]">{value}</p></div>;
  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button onClick={goBack} className="flex items-center gap-2 text-sm font-bold text-white/50 hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to {backLabel}</button>
      {details&&<button onClick={retry} disabled={refreshing} className="border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:text-white disabled:opacity-50">{refreshing?'Refreshing…':'Refresh results'}</button>}
    </div>
    <div className="mt-6 border border-white/10 bg-[var(--c-hero)] p-6 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[.22em] text-white/50">Match history</p>
      <h1 className="font-display mt-2 text-[2.25rem] leading-none sm:text-[3rem]"><button onClick={()=>openTeam({...team,name:teamName,seasonId:info?.season?.id??team.seasonId,season:info?.season?.name??team.season})} className="hover:text-[var(--c-accent)]">{number}</button></h1>
      {teamName&&<p className="mt-2 text-sm uppercase tracking-tight text-white/60">{teamName}{registered?.organization?` · ${registered.organization}`:''}</p>}
      <button onClick={openThisEvent} className="mt-4 inline-flex max-w-full items-center gap-2 text-left text-sm text-white/55 hover:text-white"><CalendarDays className="h-4 w-4 shrink-0 text-[var(--c-accent)]" /><span className="truncate">{eventName}</span><ChevronRight className="h-4 w-4 shrink-0" /></button>
    </div>
    {error&&<LoadError message={error} retry={retry} />}
    {!details&&!error&&<article className="mt-4 border border-white/10 bg-[var(--c-surface)] p-8 text-sm text-white/55">Loading official match results…</article>}
    {details&&<div className="view-enter">
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.6fr]">
        <article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow={standing?standing.division||'Division':'Registered'} title="Where they stand" />
          <div className="p-5">{standing?<>
            <div className="flex items-end gap-4"><p className="font-mono text-5xl font-bold leading-none text-[var(--c-accent)]">#{standing.rank}</p><p className="pb-1 text-[11px] font-semibold uppercase tracking-[.16em] text-white/50">Qualification<br/>rank</p>
              <div className="ml-auto text-right"><p className="font-mono text-2xl font-semibold">{standing.wins}–{standing.losses}–{standing.ties}</p><p className="text-xs text-white/50">{upcoming.length?`${upcoming.length} still to play`:'Schedule complete'}</p></div></div>
            <div className="mt-5 grid grid-cols-4 gap-3 border-t border-white/10 pt-4">{[stat('WP',standing.wp,'Win points'),stat('AP',standing.ap,'Autonomous points'),stat('SP',standing.sp,'Strength of schedule points'),stat('High',standing.highScore,'Highest alliance score')]}</div>
            {standing.stats&&<div className="mt-4 grid grid-cols-4 gap-3">{[stat('OPR',standing.stats.opr.toFixed(1),'Offensive power rating'),stat('DPR',standing.stats.dpr.toFixed(1),'Defensive power rating - lower is better'),stat('CCWM',standing.stats.ccwm.toFixed(1),'Contribution to winning margin')]}</div>}
            {standing.stats&&standing.statsAreProvisional&&<p className="mt-3 text-xs text-white/40">Provisional: few matches played so far, so ratings will still move.</p>}
          </>:<div className="grid grid-cols-2 gap-4"><Metric label="Record" value={`${scored.wins}–${scored.losses}–${scored.ties}`} detail={`${played.length} played`} /><Metric label="Remaining" value={String(upcoming.length)} detail={upcoming.length?'Still to play':matches.length?'Schedule complete':'No schedule posted yet'} /></div>}</div>
        </article>
        <article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow={profile?`Against ${profile.teams} teams in ${profile.division||'the division'}`:'Strength profile'} title="Strengths" />
          {profile?<div className="grid items-center gap-x-6 gap-y-3 p-5 md:grid-cols-[1.5fr_1fr]">
            <StrengthHexagon axes={profile.axes} label={`${number} strengths at ${eventName}`} />
            <ul className="divide-y divide-white/[.07] text-sm">{profile.axes.map((axis:any)=><li key={axis.key} className="flex items-baseline justify-between gap-3 py-2" title={axis.title}><span className="text-white/60">{axis.label}{axis.better==='lower'&&<small className="ml-1 text-white/35">lower is better</small>}</span><span className="text-right"><b className="font-mono">{axis.display}</b><small className="ml-2 text-white/45">{axis.place?`${ordinal(axis.place)} of ${axis.of}`:'no data yet'}</small></span></li>)}</ul>
            <p className="text-xs leading-5 text-white/45 md:col-span-2">Each axis ranks the team against its division: the edge is the best team there, the dashed ring the middle of the field. AWP is autonomous win points per qualification match, worked out from win points. Skills is the best driver + programming total at this event.{profile.provisional?' Ratings are provisional until each team has played about four matches.':''}</p>
          </div>:<Empty text="Strengths appear once the team has been seeded in a division." />}
        </article>
      </div>
      {points.length>0&&<article className="mt-4 border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow="Running scoring margin" title="Tournament momentum" /><div className="p-5"><div className="h-[220px] w-full"><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{top:10,right:18,left:-12,bottom:4}}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false}/><XAxis dataKey="match" stroke="rgba(255,255,255,.3)" tickLine={false} axisLine={false}/><YAxis stroke="rgba(255,255,255,.3)" tickLine={false} axisLine={false}/><Tooltip cursor={{stroke:'rgba(255,255,255,.18)'}} content={({active,payload}:any)=>{const point=payload?.[0]?.payload;if(!active||!point)return null;return <div className="border border-white/15 bg-[var(--c-page)] p-3 text-xs shadow-2xl"><b className="block text-sm">{point.name}</b><span className={`mt-1 block font-mono ${point.margin>=0?'text-emerald-400':'text-rose-400'}`}>{point.margin>=0?'+':''}{point.margin} this match · {point.cumulative>=0?'+':''}{point.cumulative} total</span></div>}}/><Line type="monotone" dataKey="cumulative" stroke="var(--c-accent)" strokeWidth={3} dot={(props:any)=><circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill={props.payload.outcome==='won'?'#34d399':props.payload.outcome==='lost'?'#fb7185':'#cbd5e1'} stroke="var(--c-surface)" strokeWidth={2}/>} activeDot={false}/></LineChart></ResponsiveContainer></div><p className="mt-2 text-xs text-white/50">{points.at(-1)!.cumulative===0?`Level on points across ${points.length} matches.`:`${points.at(-1)!.cumulative>0?'+':''}${points.at(-1)!.cumulative} points across ${points.length} matches.`}</p></div></article>}
      <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
        <article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow={`${played.length} matches`} title="Played" />{played.length?<ul>{played.map(matchRow)}</ul>:<Empty text="No results have been posted for this team yet." />}
          {check&&!check.agrees&&<p className="border-t border-white/10 px-5 py-4 text-xs leading-5 text-white/50">{check.unexplainedWins>0?`The event credits ${check.officialSummary}. ${check.unexplainedWins===1?'One result does':`${check.unexplainedWins} results do`} not follow the scores, which is what a disqualification looks like - the marks above are from the scores alone.`:`The event credits ${check.officialSummary}, which does not follow the scores above.`}</p>}
        </article>
        <article className="border border-white/10 bg-[var(--c-surface)]"><SectionTitle eyebrow={`${upcoming.length} matches`} title="Scheduled" />{upcoming.length?<ul>{upcoming.map(matchRow)}</ul>:<Empty text={matches.length?'Nothing left to play.':`No matches are listed for ${number} at this event.`} />}</article>
      </div>
    </div>}
  </section>;
}

function PageHead({ eyebrow, title, copy }: {eyebrow:string;title:string;copy:string}) { return <div className="max-w-3xl border-b border-white/[.08] pb-6"><p className="text-[11px] italic text-white/45">{eyebrow}</p><h1 className="font-display mt-1.5 text-[2.6rem] leading-[1.05] sm:text-[3.4rem]">{title}</h1><p className="mt-4 max-w-xl text-sm leading-relaxed text-white/45">{copy}</p></div>; }
function SectionTitle({ eyebrow, title }: {eyebrow:string;title:string}) { return <div className="flex items-baseline justify-between gap-4 border-b border-white/[.08] px-5 pb-3 pt-5"><h2 className="font-display text-[1.35rem] leading-tight">{title}</h2><p className="shrink-0 text-[11px] italic text-white/45">{eyebrow}</p></div>; }
function Metric({ label, value, detail }: {label:string;value:string;detail:string}) { return <div className="border-t border-white/15 pt-3"><small className="text-[11px] text-white/50">{label}</small><p className="mt-1.5 font-display text-[1.75rem] leading-none">{value}</p><small className="mt-1.5 block text-xs text-white/45">{detail}</small></div>; }
function StatFeature({ icon, title, copy }: {icon:React.ReactNode;title:string;copy:string}) { return <article className="border-t border-white/15 pt-5"><span className="text-white/25 [&_svg]:h-4 [&_svg]:w-4">{icon}</span><h3 className="font-display mt-3 text-lg">{title}</h3><p className="mt-2 text-sm leading-relaxed text-white/55">{copy}</p></article>; }
function Empty({ text }: {text:string}) { return <p className="border-t border-white/[.08] px-1 py-10 text-sm italic leading-relaxed text-white/50">{text}</p>; }
function FilterInput({ value, onChange, placeholder, icon }: {value:string;onChange:(value:string)=>void;placeholder:string;icon?:React.ReactNode}) { return <label className="relative">{icon && <span className="absolute left-0 top-2.5 text-white/45 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}<input value={value} onChange={event=>onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} className={`h-9 w-full border-0 border-b border-white/15 bg-transparent pr-3 text-sm outline-none placeholder:text-white/45 focus:border-white/40 ${icon ? 'pl-6' : 'pl-0'}`} /></label>; }
function FilterSelect({ label, value, options, onChange, className='', allLabel, optionLabels={} }: {label:string;value:string;options:string[];onChange:(value:string)=>void;className?:string;allLabel?:string;optionLabels?:Record<string,string>}) { return <NativeSelect value={value} onChange={event=>onChange(event.target.value)} className={`w-full [&_select]:h-9 [&_select]:rounded-none [&_select]:border-0 [&_select]:border-b [&_select]:border-white/15 [&_select]:bg-transparent dark:[&_select]:bg-transparent dark:[&_select]:hover:bg-white/[.03] [&_select]:px-0 [&_select]:text-sm ${className}`} aria-label={label}>{options.map(option=><NativeSelectOption key={option} value={option}>{optionLabels[option]??(option === 'All' ? (allLabel ?? `All ${label.toLowerCase()}s`) : option)}</NativeSelectOption>)}</NativeSelect>; }

function seasonYearLabel(name:string='') { const match=name.match(/(20\d{2})\s*[-–]\s*(20\d{2}|\d{2})/);return match?`${match[1]}–${match[2].slice(-2)}`:'—'; }
function LoadError({message,retry}:{message:string;retry:()=>void}) {return <div role="alert" className="my-4 border border-rose-400/30 bg-rose-400/5 p-5"><p className="text-sm text-rose-200">{message}</p><button onClick={retry} className="mt-3 border border-white/20 px-4 py-2 text-sm font-bold hover:bg-white hover:text-black">Retry</button></div>;}

function finalistDivisions(division:any,divisions:any[]) {
  const first=(division.matches??[]).find((match:any)=>Number(match.round)===5);
  return [...(first?.alliances??[])].sort((a:any,b:any)=>(a.color==='red'?0:1)-(b.color==='red'?0:1)).map((alliance:any)=>{
    const ids=new Set((alliance.teams??[]).map((entry:any)=>entry.team?.id));
    return divisions.find((other:any)=>other.id!==division.id&&(other.matches??[]).some((match:any)=>(match.alliances??[]).some((entry:any)=>(entry.teams??[]).some((team:any)=>ids.has(team.team?.id)))))?.name??'';
  });
}


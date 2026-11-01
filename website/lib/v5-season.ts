// The V5 season ranking as rows: replay completed events with VCR 3, then
// shape the leaderboard. Pure - no network. Shared by the live route
// (app/api/rankings/route.ts), which samples recent events, and the weekly
// full-season build (scripts/build-v5-rankings.mjs), which replays them all.
import seasonGradeOverrides from './season-grade-overrides.json' with { type: 'json' };
import { processCompletedEvent } from './vcr3.mjs';
import { confidenceFor, decayedRating as computeRating } from './vcr-scoring.mjs';

/** The current season's full-season rankings, as published to archive-assets/. */
export const v5CurrentPath = '/rankings-current-v5.json';
/** Its replay state, which the live route continues with events finished since. */
export const v5StatePath = '/rankings-current-v5-state.json';

type TeamState={id:number;number:string;rating:number;matches:number;wins:number;losses:number;ties:number;pointsFor:number;pointsAgainst:number;events:Set<number>;middleGradeEvents:Set<number>;highGradeEvents:Set<number>};

export const gradeFromContext=(value:string)=>{const text=String(value??'').toLowerCase().replace(/[_/-]+/g,' ');const middle=/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bms\b/.test(text);const high=/\bhigh school\b|\bsenior high\b|\bhs\b/.test(text);return middle&&!high?'Middle School':high&&!middle?'High School':null};
const gradeFromOrganization=(value:string)=>/\bmiddle school\b|\bjunior high\b|\bjr\.? high\b|\bintermediate school\b|\belementary school\b/i.test(String(value??''))?'Middle School':/\bhigh school\b|\bsenior high\b|\bsecondary school\b/i.test(String(value??''))?'High School':null;

/**
 * A replay in progress: every team's VCR 3 state and history. Continuing it
 * with later events gives the same result as replaying from the start, because
 * an event reads only the states settled before it.
 */
export type V5Replay={states:Map<number,TeamState>;historyByTeam:Map<number,any[]>;processed:Set<number>};
export const emptyV5Replay=():V5Replay=>({states:new Map(),historyByTeam:new Map(),processed:new Set()});

/** Applies completed events, oldest first, with their matches. Mutates the replay. */
export function continueV5Replay(replay:V5Replay,{ completed, matches }:{ completed:any[]; matches:any[] }) {
  const { states, historyByTeam }=replay;
  const matchesByEvent=new Map<number,any[]>();for(const match of matches){if(!matchesByEvent.has(match.eventId))matchesByEvent.set(match.eventId,[]);matchesByEvent.get(match.eventId)!.push(match)}
  for(const event of completed){if(replay.processed.has(event.id))continue;replay.processed.add(event.id);const eventMatches=matchesByEvent.get(event.id)??[];processCompletedEvent({event,matches:eventMatches,states,historyByTeam});for(const match of eventMatches)for(const alliance of match.alliances??[])for(const entry of alliance.teams??[]){const team=states.get(entry.team?.id);if(!team)continue;if(match.gradeHint==='Middle School')team.middleGradeEvents.add(event.id);if(match.gradeHint==='High School')team.highGradeEvents.add(event.id)}}
  return replay;
}

/** Rated teams (4+ matches) as of `cutoff`: ratings decayed to that moment. */
export function ratedFromReplay({ states, historyByTeam }:V5Replay, cutoff:Date) {
  const rated=[...states.values()].filter(team=>team.matches>=4).map(team=>{const confidence=confidenceFor(team.matches);const history=historyByTeam.get(team.id)??[];const decayedRating=computeRating(history,cutoff);return{...team,rating:decayedRating,events:team.events.size,confidence,displayedStrength:decayedRating-confidence,form:history.slice(-5).map(row=>({event:row.event,change:row.change,tier:row.tier,champion:row.champion}))}}).sort((a,b)=>b.rating-a.rating||a.number.localeCompare(b.number));
  return rated;
}

/** Rated teams from completed events, oldest first, and their matches. */
export function replayV5Season({ completed, matches, cutoff }:{ completed:any[]; matches:any[]; cutoff:Date }) {
  return ratedFromReplay(continueV5Replay(emptyV5Replay(),{ completed, matches }),cutoff);
}

/** JSON-safe replay (Sets as arrays; history trimmed to what rows and decay read). */
export function serializeV5Replay({ states, historyByTeam, processed }:V5Replay) {
  return {
    processed:[...processed],
    states:[...states.values()].map(team=>({...team,events:[...team.events],middleGradeEvents:[...team.middleGradeEvents],highGradeEvents:[...team.highGradeEvents]})),
    history:Object.fromEntries([...historyByTeam].map(([id,rows])=>[id,rows.map(row=>({event:row.event,eventId:row.eventId,eventDate:row.eventDate,change:row.change,rawChange:row.rawChange,tier:row.tier,champion:row.champion}))])),
  };
}
// A restored replay owns all of its state: the Worker keeps one parsed
// snapshot per isolate and restores from it on every refresh, so anything
// shared with it (a history array) would carry one run's events into the next.
export function restoreV5Replay(saved:ReturnType<typeof serializeV5Replay>):V5Replay {
  return {
    processed:new Set(saved.processed),
    states:new Map(saved.states.map((team:any)=>[team.id,{...team,events:new Set(team.events),middleGradeEvents:new Set(team.middleGradeEvents),highGradeEvents:new Set(team.highGradeEvents)}])),
    historyByTeam:new Map(Object.entries(saved.history).map(([id,rows])=>[Number(id),[...(rows as any[])]])),
  };
}

/** Leaderboard rows from the rated teams and their official team records. */
export function v5RankingRows({ rated, official, seasonId, season }:{ rated:any[]; official:Map<number,any>; seasonId:string; season:{label:string} }) {
  const rankings=rated.map((team,index)=>{const info=official.get(team.id) as any;const games=Math.max(1,team.matches);const opr=team.pointsFor/games/2;const dpr=team.pointsAgainst/games/2;const eventGrade=team.middleGradeEvents.size===team.highGradeEvents.size?null:team.middleGradeEvents.size>team.highGradeEvents.size?'Middle School':'High School';const number=info?.number??team.number;const verifiedGrade=(seasonGradeOverrides as Record<string,Record<string,string>>)[seasonId]?.[number];const grade=verifiedGrade??eventGrade??gradeFromOrganization(info?.organization)??info?.grade??'Unknown';return{rank:index+1,id:team.id,number,name:info?.team_name??info?.organization??team.number,region:[info?.location?.region,info?.location?.country].filter(Boolean).join(', ')||'Unassigned',eventRegion:info?.location?.region||info?.location?.country||'Unassigned',country:info?.location?.country||'Unassigned',rating:Math.round(team.rating),confidence:team.confidence,change:team.form.at(-1)?.change??0,record:`${team.wins}–${team.losses}–${team.ties}`,events:team.events,opr:Number(opr.toFixed(1)),dpr:Number(dpr.toFixed(1)),ccwm:Number((opr-dpr).toFixed(1)),auto:0,ase:0,consistency:Math.max(0,Math.min(100,Math.round(100-team.confidence/2))),skills:0,form:team.form,seasonId:Number(seasonId),season:season.label,matches:team.matches,grade,organization:info?.organization??'',robot:info?.robot_name??''}});
  return rankings;
}

/**
 * Where the published replay comes from (the Worker reads it from its assets).
 * Returns the parsed state file, or null when none is published.
 */
let snapshotSource:(()=>Promise<any|null>)|null=null;
export function useV5SnapshotSource(source:(()=>Promise<any|null>)|null){snapshotSource=source}
export async function v5Snapshot(){if(!snapshotSource)return null;try{return await snapshotSource()}catch{return null}}

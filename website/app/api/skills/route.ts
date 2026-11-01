import { PROGRAMS, programCode } from '@/lib/programs.mjs';

const SKILLS_ROOT = 'https://events.vex.com/api/seasons';
// The endpoint answers the younger IQ grade as "Elementary"; teams carry
// "Elementary School", so rows are relabelled to match everything else.
const GRADE_LABELS: Record<string, string> = { Elementary: 'Elementary School' };
async function readCache(request:Request){try{return await (globalThis as any).caches?.default?.match(request)}catch{return undefined}}
async function writeCache(request:Request,response:Response){try{await (globalThis as any).caches?.default?.put(request,response.clone())}catch{}}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const program = PROGRAMS[programCode(params.get('program'))];
  const season = params.get('season') ?? String(program.currentSeason);
  if (!program.skillsSeasons.includes(season)) return Response.json({ error: 'Unsupported season.' }, { status: 400 });
  const cached=await readCache(request);if(cached)return cached;

  const payloads = await Promise.all(program.skillsGrades.map(async grade => {
    const url = `${SKILLS_ROOT}/${season}/skills?grade_level=${encodeURIComponent(grade)}`;
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return [];
    return response.json() as Promise<any[]>;
  }));

  const best = new Map<string, any>();
  for (const entry of payloads.flat()) {
    const number = entry.team?.team;
    const combined = Number(entry.scores?.score ?? 0);
    if (!number || combined <= 0) continue;
    if (!best.has(number) || combined > best.get(number).combinedSkills) {
      best.set(number, {
        id: entry.team?.id,
        number,
        name: entry.team?.teamName || entry.team?.organization || number,
        organization: entry.team?.organization || '',
        region: [entry.team?.region, entry.team?.country].filter(Boolean).join(', ') || 'Unassigned',
        country: entry.team?.country || 'Unassigned',
        grade: GRADE_LABELS[entry.team?.gradeLevel] ?? (entry.team?.gradeLevel || 'Unknown'),
        autoSkills: Number(entry.scores?.programming ?? 0),
        driverSkills: Number(entry.scores?.driver ?? 0),
        combinedSkills: combined,
      });
    }
  }

  const rankings = [...best.values()].sort((a, b) => b.combinedSkills - a.combinedSkills).map((team, index) => ({ ...team, skillsRank: index + 1 }));
  const response=Response.json({ rankings, season: (program.seasons as Record<string, { label: string }>)[season]?.label ?? season }, { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=1800, stale-while-revalidate=7200' } });
  await writeCache(request,response);return response;
}

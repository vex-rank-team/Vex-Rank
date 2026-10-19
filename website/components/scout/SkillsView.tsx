'use client';
/**
 * World skills leaderboard (#/skills): every team's best driver + programming
 * run this season, filterable by grade, country and region, exportable as CSV,
 * with a "Where would I place?" calculator against the filtered list.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useScout } from './ScoutProvider';
import { CsvButton, TeamTools } from './Widgets';
import { filterSkills, skillsFacets, wouldPlace } from '@/lib/scout/insights.mjs';
import { siteFetch } from '@/lib/client-fetch';

const SEASONS = [['204', '2026–27 Override'], ['197', '2025–26 Push Back']] as const;
const GRADES = [['All', 'All grades'], ['High School', 'High School'], ['Middle School', 'Middle School']] as const;
const PAGE = 100;
const select = 'h-10 w-full border-b border-white/15 bg-transparent text-sm text-white focus:border-[var(--c-accent)] focus:outline-none [&>option]:bg-[var(--c-surface-2)]';
const COLUMNS = [
  { key: 'place', label: 'Place' }, { key: 'skillsRank', label: 'World rank' }, { key: 'number', label: 'Team' },
  { key: 'name', label: 'Name' }, { key: 'organization', label: 'Organization' }, { key: 'region', label: 'Region' },
  { key: 'grade', label: 'Grade' }, { key: 'autoSkills', label: 'Programming' }, { key: 'driverSkills', label: 'Driver' },
  { key: 'combinedSkills', label: 'Total' },
];

export default function SkillsView() {
  const { openTeam, loadSkills, state } = useScout();
  const [season, setSeason] = useState('204');
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');
  const [grade, setGrade] = useState('All');
  const [country, setCountry] = useState('All');
  const [region, setRegion] = useState('All');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [auto, setAuto] = useState('');
  const [driver, setDriver] = useState('');

  useEffect(() => {
    let active = true;
    // The current season shares the provider's copy, so the compare tray and this page fetch it once.
    const request = season === '204' ? loadSkills()
      : siteFetch(`/api/skills?season=${season}`).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status)))).then((p: any) => p.rankings ?? []);
    request.then(data => { if (active) setRows(data); }).catch(() => { if (active) setError('World skills could not be loaded. Please retry in a moment.'); });
    return () => { active = false; };
  }, [season, loadSkills]);

  const all = useMemo(() => rows ?? [], [rows]);
  const facets = useMemo(() => skillsFacets(all, country), [all, country]);
  const filtered = useMemo(() => filterSkills(all, { grade, country, region, search }).map((row: any, index: number) => ({ ...row, place: index + 1 })), [all, grade, country, region, search]);
  const placed = auto !== '' || driver !== '' ? wouldPlace(filterSkills(all, { grade, country, region }), { auto: Number(auto) || 0, driver: Number(driver) || 0 }) : null;
  const scope = [grade !== 'All' ? grade : '', region !== 'All' ? region : country !== 'All' ? country : 'the world'].filter(Boolean).join(', ');
  const mine = state.myTeam;

  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <p className="mb-1.5 text-[11px] italic text-white/45">Robot skills</p>
    <h1 className="font-display text-3xl tracking-[-.04em] sm:text-5xl">World skills leaderboard</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">Every team&rsquo;s best programming and driver run this season. Filter by grade and place, or see where a score you&rsquo;re aiming for would land.</p>

    <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="border border-white/10 bg-[var(--c-surface)] p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-[11px] uppercase tracking-wider text-white/40">Season<select value={season} onChange={e => { setSeason(e.target.value); setShown(PAGE); setRows(null); setError(''); }} className={select}>{SEASONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="text-[11px] uppercase tracking-wider text-white/40">Grade<select value={grade} onChange={e => { setGrade(e.target.value); setShown(PAGE); }} className={select}>{GRADES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
          <label className="text-[11px] uppercase tracking-wider text-white/40">Country<select value={country} onChange={e => { setCountry(e.target.value); setRegion('All'); setShown(PAGE); }} className={select}><option value="All">All countries</option>{facets.countries.map(name => <option key={name}>{name}</option>)}</select></label>
          <label className="text-[11px] uppercase tracking-wider text-white/40">Region<select value={region} onChange={e => { setRegion(e.target.value); setShown(PAGE); }} className={select}><option value="All">All regions</option>{facets.regions.map(name => <option key={name}>{name}</option>)}</select></label>
        </div>
        <label className="mt-4 flex items-center gap-2 border-b border-white/15 focus-within:border-[var(--c-accent)]"><Search className="h-4 w-4 text-white/40" aria-hidden="true" />
          <input value={search} onChange={e => { setSearch(e.target.value); setShown(PAGE); }} placeholder="Search team, name, organization or region" aria-label="Search skills" className="h-10 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none" /></label>
      </div>

      <form onSubmit={e => e.preventDefault()} className="border border-white/10 bg-[var(--c-surface)] p-4" aria-labelledby="would-place">
        <h2 id="would-place" className="text-sm font-semibold">Where would I place?</h2>
        <p className="mt-1 text-xs text-white/45">Against {scope}, as filtered.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-[11px] uppercase tracking-wider text-white/40">Programming<input inputMode="numeric" value={auto} onChange={e => setAuto(e.target.value.replace(/\D/g, '').slice(0, 3))} className="mt-1 h-10 w-full border-b border-white/15 bg-transparent font-mono text-lg text-white focus:border-[var(--c-accent)] focus:outline-none" placeholder="0" /></label>
          <label className="text-[11px] uppercase tracking-wider text-white/40">Driver<input inputMode="numeric" value={driver} onChange={e => setDriver(e.target.value.replace(/\D/g, '').slice(0, 3))} className="mt-1 h-10 w-full border-b border-white/15 bg-transparent font-mono text-lg text-white focus:border-[var(--c-accent)] focus:outline-none" placeholder="0" /></label>
        </div>
        <div aria-live="polite" className="mt-4 min-h-14">
          {placed && rows && <><p className="text-sm text-white/60">A total of <b className="text-white">{placed.combined}</b> would place</p>
            <p className="mt-1 font-display text-4xl text-[var(--c-accent)]">#{placed.rank}<span className="ml-2 text-base text-white/45">of {placed.of}</span></p>
            <p className="mt-1 text-xs text-white/45">Top {Math.max(1, Math.ceil(placed.rank / placed.of * 100))}%{placed.above ? ` · just behind ${placed.above.number} (${placed.above.combinedSkills})` : ''}{placed.below ? ` · ahead of ${placed.below.number} (${placed.below.combinedSkills})` : ''}</p></>}
          {!placed && <p className="text-xs text-white/40">Enter a programming and a driver score.</p>}
        </div>
      </form>
    </div>

    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-white/45"><b className="text-white">{filtered.length}</b> teams{rows && ` of ${all.length}`}</p>
      <CsvButton columns={COLUMNS} rows={filtered} name={`world skills ${SEASONS.find(s => s[0] === season)?.[1]} ${scope}`} />
    </div>
    {error && <p role="alert" className="mt-4 border border-rose-400/25 bg-rose-400/[.05] p-4 text-sm text-rose-200">{error}</p>}
    {!rows && !error && <output className="mt-4 block text-sm text-white/55">Loading world skills…</output>}
    {rows && <div className="mt-3 overflow-x-auto border border-white/10 bg-[var(--c-surface)]">
      <table className="w-full min-w-[820px] text-sm">
        <thead><tr className="border-b border-white/10 text-left text-[10px] font-semibold uppercase tracking-wider text-white/45">
          <th className="px-4 py-3">#</th><th className="py-3">Team</th><th className="py-3">Region</th><th className="py-3 text-right">Programming</th><th className="py-3 text-right">Driver</th><th className="px-4 py-3 text-right">Total</th><th className="py-3 pr-3"><span className="sr-only">Tools</span></th></tr></thead>
        <tbody>{filtered.slice(0, shown).map((row: any) => <tr key={row.number} className={`border-b border-white/[.07] hover:bg-white/[.03] ${row.number === mine ? 'bg-[var(--c-accent)]/[.08]' : ''}`}>
          <td className="px-4 py-2.5 font-semibold text-white/80">{row.place}{row.place !== row.skillsRank && <span className="ml-1.5 text-[10px] font-normal text-white/35">#{row.skillsRank} world</span>}</td>
          <td className="py-2.5"><button onClick={() => openTeam({ number: row.number, name: row.name, id: row.id })} className="font-bold hover:text-[var(--c-accent)]">{row.number}</button><span className="ml-2 text-xs text-white/50">{row.name}</span><span className="block text-[11px] text-white/35">{row.organization} · {row.grade}</span></td>
          <td className="py-2.5 text-white/60">{row.region}</td>
          <td className="py-2.5 text-right font-mono text-white/70">{row.autoSkills}</td>
          <td className="py-2.5 text-right font-mono text-white/70">{row.driverSkills}</td>
          <td className="px-4 py-2.5 text-right font-mono text-base font-bold">{row.combinedSkills}</td>
          <td className="py-2.5 pr-3 text-right"><TeamTools number={row.number} name={row.name} /></td>
        </tr>)}</tbody>
      </table>
      {!filtered.length && <p className="p-6 text-sm text-white/50">No teams match these filters.</p>}
    </div>}
    {rows && shown < filtered.length && <button onClick={() => setShown(count => count + PAGE)} className="mt-3 w-full border border-white/10 bg-[var(--c-surface)] py-3 text-sm text-white/50 hover:border-white/30 hover:text-white">Show more · {filtered.length - shown} remaining</button>}
    <p className="mt-4 text-xs text-white/35">Best combined score per team from official skills results. Ties are broken by the programming score.</p>
  </section>;
}

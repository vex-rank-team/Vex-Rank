'use client';
/**
 * Page-wide scouting overlays: the compare tray and its table, the quick-look
 * card for any team, and the ⌘K search palette. Mounted once by page.tsx.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, GitCompareArrows, Search, Users, X, LayoutGrid } from 'lucide-react';
import { useScout } from './ScoutProvider';
import { FavoriteButton } from './Widgets';
import { compareProfile, compareTable, searchAll } from '@/lib/scout/insights.mjs';

const surface = 'border border-white/15 bg-[var(--c-surface-2)] shadow-2xl';
// A native <dialog open> inside our own overlay: undo the browser's centring and colours.
const dialogReset = 'relative inset-auto m-0 text-white';

/** Close on Escape and on a press outside `ref`. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onPointer = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer, true); };
  }, [open, close, ref]);
}

const formatValue = (value: number | null, format?: string) => value == null ? '—'
  : format === 'percent' ? `${Math.round(value * 100)}%`
  : format === 'decimal' ? value.toFixed(1)
  : String(value);

export function CompareTray() {
  const { compare, toggleCompare, clearCompare, compareOpen, setCompareOpen, teamRows, skillRows, loadSkills, openTeam } = useScout();
  const panel = useRef<HTMLDialogElement>(null);
  useDismiss(compareOpen, () => setCompareOpen(false), panel);
  useEffect(() => { if (compareOpen) loadSkills().catch(() => {}); }, [compareOpen, loadSkills]);
  const profiles = useMemo(() => compare.map(number => compareProfile(
    number,
    teamRows.find(row => String(row.number).toUpperCase() === number),
    skillRows.find(row => String(row.number).toUpperCase() === number),
  )), [compare, teamRows, skillRows]);
  const table = useMemo(() => compareTable(profiles), [profiles]);
  if (!compare.length) return null;

  return <>
    {!compareOpen && <section aria-label="Compare tray" className={`${surface} fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 px-3 py-2`}>
      <GitCompareArrows className="h-4 w-4 text-[var(--c-accent)]" aria-hidden="true" />
      <span className="flex flex-wrap gap-1.5">{compare.map(number => <span key={number} className="inline-flex items-center gap-1 border border-white/15 px-2 py-0.5 text-xs font-semibold">{number}
        <button onClick={() => toggleCompare(number)} aria-label={`Remove ${number} from compare`} className="text-white/40 hover:text-white"><X className="h-3 w-3" /></button></span>)}</span>
      <button onClick={() => setCompareOpen(true)} disabled={compare.length < 2} className="ml-1 bg-[var(--c-accent)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-40" title={compare.length < 2 ? 'Add at least two teams' : undefined}>Compare</button>
      <button onClick={clearCompare} className="text-xs text-white/45 hover:text-white">Clear</button>
    </section>}

    {compareOpen && <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4">
      <dialog open ref={panel} aria-modal="true" aria-label="Compare teams" className={`${surface} ${dialogReset} max-h-[90vh] w-full max-w-4xl overflow-auto p-5`}>
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Compare teams</h2>
          <button onClick={() => setCompareOpen(false)} aria-label="Close" className="text-white/50 hover:text-white"><X className="h-5 w-5" /></button></div>
        <table className="w-full text-sm">
          <thead><tr><th className="py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-white/40">Season 2026–27</th>
            {profiles.map(profile => <th key={profile.number} className="px-3 py-2 text-right align-bottom">
              <button onClick={() => { setCompareOpen(false); openTeam({ number: profile.number, name: profile.name }); }} className="text-lg font-bold hover:text-[var(--c-accent)]">{profile.number}</button>
              <span className="block truncate text-xs font-normal text-white/45">{profile.name || 'Not rated'}</span></th>)}</tr></thead>
          <tbody>{table.map(row => <tr key={row.key} className="border-t border-white/[.07]">
            <th scope="row" className="py-2.5 text-left font-normal text-white/55">{row.label}{row.better === 'lower' && <span className="ml-1 text-[10px] text-white/30">lower is better</span>}</th>
            {row.values.map((value: number | null, index: number) => <td key={index} className={`px-3 py-2.5 text-right font-mono ${row.best[index] ? 'font-bold text-[var(--c-accent)]' : 'text-white/80'}`}>{formatValue(value, row.format)}</td>)}
          </tr>)}</tbody>
        </table>
        <p className="mt-4 text-xs text-white/40">Highlighted: the best value in each row. Ratings and statistics are VEX-Rank&rsquo;s own calculations, not official.</p>
      </dialog>
    </div>}
  </>;
}

export function QuickLook() {
  const { quickLook, setQuickLook, teamRows, skillRows, loadSkills, openTeam, toggleCompare, compare } = useScout();
  const panel = useRef<HTMLDialogElement>(null);
  useDismiss(Boolean(quickLook), () => setQuickLook(null), panel);
  useEffect(() => { if (quickLook) loadSkills().catch(() => {}); }, [quickLook, loadSkills]);
  if (!quickLook) return null;
  const ranking = teamRows.find(row => String(row.number).toUpperCase() === quickLook);
  const skills = skillRows.find(row => String(row.number).toUpperCase() === quickLook);
  const facts: [string, string][] = [
    ['VCR rating', ranking ? `${ranking.rating} ±${ranking.confidence}` : 'Not rated yet'],
    ['World rank', ranking ? `#${ranking.rank}` : '—'],
    ['Record', ranking?.record ?? '—'],
    ['OPR / DPR', ranking ? `${Number(ranking.opr).toFixed(1)} / ${Number(ranking.dpr).toFixed(1)}` : '—'],
    ['Skills', skills ? `${skills.combinedSkills} (#${skills.skillsRank} world)` : '—'],
    ['Events', ranking ? String(ranking.events) : '—'],
  ];
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4">
    <dialog open ref={panel} aria-modal="true" aria-label={`Quick look at ${quickLook}`} className={`${surface} ${dialogReset} w-full max-w-sm p-5`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-3xl font-bold tracking-tight">{quickLook}</p>
          <p className="mt-0.5 text-sm text-white/55">{ranking?.name ?? skills?.name ?? ''}</p>
          <p className="text-xs text-white/40">{ranking?.region ?? skills?.region ?? ''}</p></div>
        <span className="flex items-center"><FavoriteButton kind="team" item={{ number: quickLook, name: ranking?.name }} />
          <button onClick={() => setQuickLook(null)} aria-label="Close" className="ml-1 text-white/50 hover:text-white"><X className="h-5 w-5" /></button></span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">{facts.map(([label, value]) => <div key={label}><dt className="text-[11px] uppercase tracking-wider text-white/40">{label}</dt><dd className="mt-0.5 font-semibold">{value}</dd></div>)}</dl>
      <div className="mt-5 flex gap-2">
        <button onClick={() => { setQuickLook(null); openTeam({ number: quickLook, name: ranking?.name }); }} className="flex flex-1 items-center justify-center gap-1.5 bg-[var(--c-accent)] px-3 py-2 text-sm font-semibold text-white">Open profile <ArrowRight className="h-4 w-4" /></button>
        <button onClick={() => toggleCompare(quickLook)} className="border border-white/15 px-3 py-2 text-sm text-white/75 hover:border-white/35">{compare.includes(quickLook) ? 'In compare' : 'Compare'}</button>
      </div>
    </dialog>
  </div>;
}

const PAGES = [
  { label: 'Home', view: 'home' }, { label: 'Events', view: 'events' }, { label: 'World ranking', view: 'rankings' },
  { label: 'World skills', view: 'skills' }, { label: 'Teams', view: 'teams' }, { label: 'Jumper: match livestreams', view: 'jumper' },
];

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, teamRows, eventRows, state, go, openTeam, openEvent } = useScout();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const panel = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { setPaletteOpen(false); setQuery(''); setActive(0); };
  useDismiss(paletteOpen, close, panel);
  useEffect(() => { if (paletteOpen) window.setTimeout(() => input.current?.focus(), 0); }, [paletteOpen]);

  const results = useMemo(() => {
    const favourites = state.favorites.teams.map(team => ({ type: 'team', ...team, label: team.number, detail: `★ ${team.name || 'Favourite'}`, score: 1 }));
    if (!query.trim()) return [...favourites.slice(0, 5), ...PAGES.map(page => ({ type: 'page', ...page, score: 1 }))];
    return searchAll(query, { pages: PAGES, teams: teamRows, events: eventRows });
  }, [query, teamRows, eventRows, state.favorites.teams]);

  if (!paletteOpen) return null;
  const choose = (result: any) => {
    close();
    if (result.type === 'page') go(result.view);
    else if (result.type === 'team') openTeam({ number: result.number, name: result.name, id: result.id, seasonId: result.seasonId });
    else openEvent(result);
  };
  const Icon = (type: string) => type === 'team' ? Users : type === 'event' ? CalendarDays : LayoutGrid;

  return <div className="fixed inset-0 z-[70] bg-black/60 p-4 pt-[12vh]">
    <dialog open ref={panel} aria-modal="true" aria-label="Search VEX-Rank" className={`${surface} relative inset-auto mx-auto w-full max-w-xl text-white`}>
      <div className="flex items-center gap-2 border-b border-white/10 px-4">
        <Search className="h-4 w-4 text-white/40" aria-hidden="true" />
        <input ref={input} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive(i => Math.min(results.length - 1, i + 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive(i => Math.max(0, i - 1)); }
            if (event.key === 'Enter' && results[active]) choose(results[active]);
          }}
          placeholder="Search teams, events and pages…" aria-label="Search" aria-describedby="scout-palette-hint"
          className="h-12 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none" />
        <kbd className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">Esc</kbd>
      </div>
      <p id="scout-palette-hint" className="sr-only">Use the up and down arrows to move through results and Enter to open one.</p>
      <ul className="max-h-[50vh] overflow-y-auto py-1">
        {results.length ? results.map((result: any, index: number) => { const ResultIcon = Icon(result.type); return <li key={`${result.type}-${result.view ?? result.number ?? result.id}`}>
          <button type="button" onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onClick={() => choose(result)} aria-current={index === active ? 'true' : undefined}
            className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${index === active ? 'bg-white/[.07]' : ''}`}>
            <ResultIcon className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{result.label}</span>{result.detail && <span className="block truncate text-xs text-white/45">{result.detail}</span>}</span>
            <span className="text-[10px] uppercase tracking-wider text-white/30">{result.type}</span>
          </button></li>; }) : <li className="px-4 py-6 text-center text-sm text-white/45">Nothing matches &ldquo;{query}&rdquo;.</li>}
      </ul>
    </dialog>
  </div>;
}

/** The header's search button; also opened with ⌘K, Ctrl-K or "/". */
export function SearchButton() {
  const { setPaletteOpen } = useScout();
  return <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Search teams, events and pages" title="Search (⌘K)"
    className="hidden h-9 items-center gap-2 rounded-full border border-white/15 px-3 text-xs text-white/55 hover:border-white/35 hover:text-white sm:inline-flex">
    <Search className="h-3.5 w-3.5" aria-hidden="true" />Search<kbd className="ml-1 text-[10px] text-white/35">⌘K</kbd>
  </button>;
}

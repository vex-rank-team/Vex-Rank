'use client';
/**
 * Shared state for the scouting tools: the reader's saved data (favourites,
 * notes, picklists, Jumper streams; lib/scout/store.mjs), the compare tray,
 * the quick-look card and the ⌘K palette, plus the page's navigation and data
 * so any component can open a team or look one up.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createScoutStore, emptyScout } from '@/lib/scout/store.mjs';
import { siteFetch } from '@/lib/client-fetch';

export type PickEntry = { number: string; tier: string; note: string; picked: boolean };
export type ScoutState = {
  v: number;
  favorites: { teams: { number: string; name: string }[]; events: { id: string; sku: string; name: string; date: string }[] };
  notes: Record<string, Record<string, { text: string; updatedAt: number }>>;
  picklists: Record<string, PickEntry[]>;
  streams: Record<string, { videoId: string; anchor: { matchId: string; seconds: number } | null }>;
  myTeam: string;
};
type Store = ReturnType<typeof createScoutStore>;
export type TeamRef = { number: string; name?: string; id?: number; seasonId?: number; season?: string };

type ScoutContext = {
  state: ScoutState;
  update: (change: (state: ScoutState) => ScoutState) => void;
  store: Store;
  compare: string[];
  toggleCompare: (number: string) => void;
  clearCompare: () => void;
  compareOpen: boolean;
  setCompareOpen: (open: boolean) => void;
  quickLook: string | null;
  setQuickLook: (number: string | null) => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  teamRows: any[];
  eventRows: any[];
  skillRows: any[];
  loadSkills: () => Promise<any[]>;
  openTeam: (team: TeamRef) => void;
  openEvent: (event: any) => void;
  go: (view: string) => void;
};

const Context = createContext<ScoutContext | null>(null);
export const MAX_COMPARE = 4;
let skillsRequest: Promise<any[]> | null = null;

/** Download text as a file: CSV exports and calendar entries. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ScoutProvider({ children, teamRows, eventRows, openTeam, openEvent, go }: {
  children: React.ReactNode; teamRows: any[]; eventRows: any[];
  openTeam: (team: TeamRef) => void; openEvent: (event: any) => void; go: (view: string) => void;
}) {
  // One store per page load; created lazily so the server render never touches storage.
  const [store] = useState(() => (typeof window === 'undefined' ? null : createScoutStore()) as Store);
  const fallback = useMemo(() => emptyScout() as ScoutState, []);
  const state = useSyncExternalStore(
    useCallback(listener => store?.subscribe(listener) ?? (() => {}), [store]),
    () => store?.get() ?? fallback,
    () => fallback,
  ) as ScoutState;
  const update = useCallback((change: (state: ScoutState) => ScoutState) => { store?.update(change as (state: any) => any); }, [store]);

  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [quickLook, setQuickLook] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [skillRows, setSkillRows] = useState<any[]>([]);

  const toggleCompare = useCallback((number: string) => {
    const key = number.toUpperCase();
    setCompare(list => list.includes(key) ? list.filter(entry => entry !== key) : list.length >= MAX_COMPARE ? list : [...list, key]);
  }, []);
  const clearCompare = useCallback(() => { setCompare([]); setCompareOpen(false); }, []);

  // The world skills list is ~1,200 rows, fetched once and only when something needs it.
  const loadSkills = useCallback(async () => {
    skillsRequest ??= siteFetch('/api/skills?season=204')
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`skills ${response.status}`)))
      .then((payload: any) => payload.rankings ?? [])
      .catch(error => { skillsRequest = null; throw error; });
    const rows = await skillsRequest;
    setSkillRows(rows);
    return rows;
  }, []);

  // ⌘K / Ctrl-K anywhere, or "/" when not typing, opens the palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = /^(input|textarea|select)$/i.test((event.target as HTMLElement)?.tagName ?? '') || (event.target as HTMLElement)?.isContentEditable;
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !typing)) {
        event.preventDefault();
        setPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<ScoutContext>(() => ({
    state, update, store, compare, toggleCompare, clearCompare, compareOpen, setCompareOpen,
    quickLook, setQuickLook, paletteOpen, setPaletteOpen, teamRows, eventRows, skillRows, loadSkills,
    openTeam, openEvent, go,
  }), [state, update, store, compare, toggleCompare, clearCompare, compareOpen, quickLook, paletteOpen, teamRows, eventRows, skillRows, loadSkills, openTeam, openEvent, go]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useScout() {
  const value = useContext(Context);
  if (!value) throw new Error('useScout must be used inside ScoutProvider');
  return value;
}

/** The current-season ranking row for a team, if it is rated. */
export function useRanking(number: string | undefined) {
  const { teamRows } = useScout();
  return useMemo(() => number ? teamRows.find(row => String(row.number).toUpperCase() === number.toUpperCase()) ?? null : null, [teamRows, number]);
}

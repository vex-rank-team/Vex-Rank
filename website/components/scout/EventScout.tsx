'use client';
/**
 * Scouting tools on an event page: the full sortable rankings table, a note
 * on any match, the alliance-selection picklist, and favourite / calendar
 * buttons. Notes and picklists live in the reader's scouting store.
 */
import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, NotebookPen, Plus, Trash2 } from 'lucide-react';
import { useScout, type PickEntry } from './ScoutProvider';
import { CalendarButton, CsvButton, FavoriteButton, TeamTools } from './Widgets';
import { EVENT_RANKING_COLUMNS, eventRankingRows, sortRows } from '@/lib/scout/tables.mjs';
import { addToPicklist, emptyScout, movePick, noteFor, picklistOf, removeFromPicklist, setNote, TIERS, updatePick } from '@/lib/scout/store.mjs';
import { ApiError, useAccount, useSharedEvent } from './AccountProvider';
import { VoteButtons } from './AccountMenu';
import { Users } from 'lucide-react';

type Change = (state: any) => any;

/** The event's picklist: the reader's own, or their active group's (shared, versioned). */
function usePicklist(eventId: string) {
  const { state, update } = useScout();
  const { api, shared, setNotice } = useAccount();
  const share = useSharedEvent(eventId);
  if (!share) return { list: picklistOf(state, eventId) as PickEntry[], apply: (change: Change) => update(change), share: null };
  const list = (share.data?.picklist ?? []) as PickEntry[];
  const apply = async (change: Change) => {
    const next = picklistOf(change({ ...emptyScout(), picklists: { [eventId]: list } }), eventId) as PickEntry[];
    const before = share.data;
    if (before) shared.set(share.key, { ...before, picklist: next });
    try {
      const saved = await api(`/api/groups/${share.group.id}/events/${eventId}/picklist`, { method: 'PUT', body: { list: next, version: before?.version ?? 0 } });
      shared.set(share.key, { ...(before ?? { notes: [], updatedAt: 0, updatedBy: null }), ...saved } as any);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        shared.set(share.key, { ...(before as any), picklist: error.body.picklist, version: error.body.version });
        setNotice('Someone in your group changed this picklist at the same time. You are now looking at their version; make your change again.');
      } else {
        if (before) shared.set(share.key, before);
        setNotice('The picklist could not be saved. Check your connection and try again.');
      }
    }
  };
  return { list, apply, share };
}

/** Match and team notes: the reader's own, or their active group's (one note per target, last edit wins). */
function useNotes(eventId: string) {
  const { state, update } = useScout();
  const { api, shared, setNotice } = useAccount();
  const share = useSharedEvent(eventId);
  if (!share) return { get: (target: string) => ({ text: noteFor(state, eventId, target), author: null as string | null }), set: (target: string, text: string) => update(s => setNote(s, eventId, target, text)), share: null };
  const notes = share.data?.notes ?? [];
  return {
    share,
    get: (target: string) => { const note = notes.find(n => n.target === target); return { text: note?.text ?? '', author: note?.author ?? null }; },
    set: async (target: string, text: string) => {
      const before = share.data;
      const rest = notes.filter(n => n.target !== target);
      if (before) shared.set(share.key, { ...before, notes: text.trim() ? [...rest, { target, text: text.trim(), author: 'You', updatedAt: Date.now() }] : rest });
      try { await api(`/api/groups/${share.group.id}/events/${eventId}/notes`, { method: 'PUT', body: { target, text } }); void share.reload(); }
      catch { if (before) shared.set(share.key, before); setNotice('The note could not be saved. Check your connection and try again.'); }
    },
  };
}

const fmt = (value: any) => value == null ? '—' : typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : String(value);

/** Every ranking column, sortable, with the reader's tools on each team. */
export function EventRankingsTable({ division, skills, name, onOpenTeam }: { division: any; skills: any[]; name: string; onOpenTeam: (team: any) => void }) {
  const [sort, setSort] = useState<{ key: string; dir: 'best' | 'worst' }>({ key: 'rank', dir: 'best' });
  const rows: any[] = useMemo(() => eventRankingRows(division, skills), [division, skills]);
  const sorted: any[] = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort]);
  const { state } = useScout();
  if (!rows.length) return null;
  const columns = EVENT_RANKING_COLUMNS.filter(col => col.key !== 'skills' || rows.some(row => row.skills != null));
  const csvColumns = columns.map(col => ({ key: col.key, label: col.label }));
  const pressSort = (key: string) => setSort(current => current.key === key ? { key, dir: current.dir === 'best' ? 'worst' : 'best' } : { key, dir: 'best' });
  return <div>
    <div className="mb-2 flex justify-end"><CsvButton columns={csvColumns} rows={sorted} name={`${name} ${division.name ?? ''} rankings`} /></div>
    <div className="overflow-x-auto border border-white/10">
      <table className="w-full min-w-[900px] text-sm">
        <thead><tr className="border-b border-white/10">{columns.map(col => {
          const active = sort.key === col.key;
          return <th key={col.key} scope="col" aria-sort={active ? (sort.dir === 'best' ? 'descending' : 'ascending') : 'none'}
            className={`py-2.5 text-[10px] font-semibold uppercase tracking-wider ${col.key === 'number' || col.key === 'record' ? 'text-left' : 'text-right'} ${col.key === 'rank' ? 'pl-4 text-left' : 'px-2'}`}>
            <button onClick={() => pressSort(col.key)} title={col.hint} className={`inline-flex items-center gap-0.5 ${active ? 'text-white' : 'text-white/45 hover:text-white'}`}>
              {col.label}{active && (sort.dir === 'best' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
            </button></th>;
        })}<th className="pr-3"><span className="sr-only">Tools</span></th></tr></thead>
        <tbody>{sorted.map(row => <tr key={row.number} className={`border-b border-white/[.07] hover:bg-white/[.03] ${row.number === state.myTeam ? 'bg-[var(--c-accent)]/[.08]' : ''}`}>
          {columns.map(col => col.key === 'rank' ? <td key={col.key} className="py-2 pl-4 font-semibold">#{row.rank}</td>
            : col.key === 'number' ? <td key={col.key} className="py-2"><button onClick={() => onOpenTeam({ id: row.id, number: row.number })} aria-label={`${row.number} match history`} className="inline-flex items-center font-bold hover:text-[var(--c-accent)]">{row.number}<ChevronRight className="ml-0.5 h-3.5 w-3.5 text-white/30" aria-hidden="true" /></button></td>
            : col.key === 'record' ? <td key={col.key} className="py-2 font-mono text-white/80">{row.record}</td>
            : <td key={col.key} className="px-2 py-2 text-right font-mono text-white/70">{fmt(row[col.key])}</td>)}
          <td className="py-2 pr-3 text-right"><TeamTools number={row.number} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-2 text-[11px] text-white/35">AWP, Avg, OPR, DPR and CCWM are worked out from the official qualification matches. Press a column to sort; press again to reverse.</p>
  </div>;
}

/** A note on one match, saved for this event. */
export function MatchNote({ eventId, match }: { eventId: string; match: any }) {
  const notes = useNotes(eventId);
  const target = `match:${match.id}`;
  const { text: saved, author } = notes.get(target);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(saved);
  if (!eventId || match.id == null) return null;
  if (!editing) return <div className="mt-3 border-t border-white/[.07] pt-2">
    {saved && <p className="mb-1.5 whitespace-pre-line text-xs text-white/70"><NotebookPen className="mr-1 inline h-3 w-3 text-[var(--c-accent)]" aria-hidden="true" />{saved}{author && <span className="ml-1.5 text-[10px] text-white/35">— {author}</span>}</p>}
    <button onClick={() => { setDraft(saved); setEditing(true); }} className="text-[11px] text-white/40 hover:text-white">{saved ? 'Edit note' : `Add note for ${match.name}`}</button>
  </div>;
  return <form className="mt-3 border-t border-white/[.07] pt-2" onSubmit={event => { event.preventDefault(); void notes.set(target, draft); setEditing(false); }}>
    <textarea ref={element => element?.focus({ preventScroll: true })} value={draft} onChange={event => setDraft(event.target.value)} rows={3} maxLength={2000} aria-label={`Note for ${match.name}`}
      placeholder="What did you see? Autonomous, driving, defence, breakdowns…" className="w-full resize-y border border-white/15 bg-black/30 p-2 text-xs text-white placeholder:text-white/30 focus:border-[var(--c-accent)] focus:outline-none" />
    <div className="mt-1.5 flex gap-2"><button type="submit" className="bg-[var(--c-accent)] px-3 py-1 text-xs font-semibold text-white">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-white/45 hover:text-white">Cancel</button>
      {saved && <button type="button" onClick={() => { void notes.set(target, ''); setEditing(false); }} className="ml-auto text-xs text-white/45 hover:text-rose-300">Delete</button>}</div>
  </form>;
}

const TIER_LABEL: Record<string, string> = { first: '1st pick', second: '2nd pick', maybe: 'Maybe', avoid: 'Avoid' };
const TIER_STYLE: Record<string, string> = { first: 'text-emerald-300 border-emerald-400/30', second: 'text-sky-300 border-sky-400/30', maybe: 'text-white/60 border-white/15', avoid: 'text-rose-300 border-rose-400/30' };

/**
 * Alliance-selection picklist: an ordered list of this event's teams, each
 * with a tier and a note, and "picked" to strike out teams as they go during
 * selection.
 */
export function PicklistTab({ eventId, eventName, teams, divisions, skills, onOpenTeam, cloudNote }: { eventId: string; eventName: string; teams: any[]; divisions: any[]; skills: any[]; onOpenTeam: (team: any) => void; cloudNote?: React.ReactNode }) {
  const { teamRows } = useScout();
  const { list, apply: update, share } = usePicklist(eventId);
  const [adding, setAdding] = useState('');
  const [hidePicked, setHidePicked] = useState(false);
  const standings = useMemo(() => new Map<string, any>(divisions.flatMap((division: any) => eventRankingRows(division, skills).map((row: any) => [row.number, { ...row, division: division.name }] as [string, any]))), [divisions, skills]);
  const rating = (number: string) => teamRows.find(row => String(row.number).toUpperCase() === number);
  const available = teams.map((team: any) => String(team.number).toUpperCase()).filter((number: string) => !list.some(entry => entry.number === number)).sort((a: string, b: string) => (standings.get(a)?.rank ?? 999) - (standings.get(b)?.rank ?? 999) || a.localeCompare(b, 'en', { numeric: true }));
  const shown = list.map((entry, index) => ({ ...entry, index })).filter(entry => !hidePicked || !entry.picked);
  const csvColumns = [
    { key: 'order', label: 'Order' }, { key: 'number', label: 'Team' }, { key: 'tier', label: 'Tier', value: (r: any) => TIER_LABEL[r.tier] },
    { key: 'rank', label: 'Event rank' }, { key: 'opr', label: 'OPR' }, { key: 'rating', label: 'VCR' }, { key: 'picked', label: 'Picked', value: (r: any) => r.picked ? 'yes' : '' }, { key: 'note', label: 'Note' },
  ];
  const csvRows = list.map((entry, index) => ({ ...entry, order: index + 1, rank: standings.get(entry.number)?.rank ?? '', opr: standings.get(entry.number)?.opr ?? '', rating: rating(entry.number)?.rating ?? '' }));
  const addTop = () => { void update(s => available.slice(0, 8).reduce((acc: any, number: string) => addToPicklist(acc, eventId, number), s)); };

  return <article className="border border-white/10 bg-[var(--c-surface)] p-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-[11px] italic text-white/45">Alliance selection</p><h2 className="font-display mt-1 text-2xl">Picklist</h2>
      <p className="mt-1 text-xs text-white/45">Order the teams you&rsquo;d pick, mark each one&rsquo;s tier, and strike them out as they&rsquo;re taken.</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-white/55"><input type="checkbox" checked={hidePicked} onChange={e => setHidePicked(e.target.checked)} className="accent-[var(--c-accent)]" />Hide picked</label>
        <CsvButton columns={csvColumns} rows={csvRows} name={`${eventName} picklist`} />
      </div>
    </div>
    {share ? <p className="mt-3 inline-flex items-center gap-1.5 border border-emerald-400/25 bg-emerald-400/[.06] px-2.5 py-1 text-xs text-emerald-200"><Users className="h-3.5 w-3.5" aria-hidden="true" />Shared with {share.group.name}{share.data?.updatedBy ? ` · last change by ${share.data.updatedBy}` : ''}</p>
      : <p className="mt-3 text-xs text-white/40">Saved in this browser. Sign in and pick a scouting group to share it with your team.</p>}
    {cloudNote}
    <form className="mt-4 flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); if (adding) { void update(s => addToPicklist(s, eventId, adding)); setAdding(''); } }}>
      <select value={adding} onChange={e => setAdding(e.target.value)} aria-label="Team to add" className="h-9 min-w-56 border border-white/15 bg-black/30 px-2 text-sm text-white [&>option]:bg-[var(--c-surface-2)]">
        <option value="">Add a team…</option>{available.map((number: string) => <option key={number} value={number}>{number}{standings.get(number) ? ` · #${standings.get(number)!.rank}` : ''}</option>)}
      </select>
      <button type="submit" disabled={!adding} className="inline-flex items-center gap-1 bg-[var(--c-accent)] px-3 text-sm font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />Add</button>
      {!list.length && available.length > 0 && <button type="button" onClick={addTop} className="border border-white/15 px-3 text-sm text-white/65 hover:border-white/35">Start with the top 8</button>}
    </form>
    {list.length ? <ol className="mt-4 space-y-1.5">{shown.map(entry => {
      const stand = standings.get(entry.number); const vcr = rating(entry.number);
      return <li key={entry.number} className={`grid grid-cols-[2rem_1fr] gap-3 border border-white/10 p-3 sm:grid-cols-[2rem_8rem_1fr_auto] sm:items-center ${entry.picked ? 'opacity-45' : ''}`}>
        <span className="font-mono text-sm text-white/45">{entry.index + 1}</span>
        <div><button onClick={() => onOpenTeam({ number: entry.number })} className={`font-bold hover:text-[var(--c-accent)] ${entry.picked ? 'line-through' : ''}`}>{entry.number}</button>
          <p className="text-[11px] text-white/40">{stand ? `#${stand.rank} · ${stand.record} · OPR ${stand.opr ?? '—'}` : 'Not ranked here yet'}{vcr ? ` · VCR ${vcr.rating}` : ''}</p></div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1">
          <select value={entry.tier} onChange={e => update(s => updatePick(s, eventId, entry.number, { tier: e.target.value }))} aria-label={`Tier for ${entry.number}`} className={`h-8 border bg-transparent px-1.5 text-xs [&>option]:bg-[var(--c-surface-2)] ${TIER_STYLE[entry.tier]}`}>{TIERS.map(tier => <option key={tier} value={tier}>{TIER_LABEL[tier]}</option>)}</select>
          <input defaultValue={entry.note} onBlur={e => update(s => updatePick(s, eventId, entry.number, { note: e.target.value }))} maxLength={300} placeholder="Note" aria-label={`Note for ${entry.number}`} className="h-8 min-w-0 flex-1 border-b border-white/10 bg-transparent px-1 text-xs text-white placeholder:text-white/25 focus:border-[var(--c-accent)] focus:outline-none" />
        </div>
        <div className="col-span-2 flex items-center justify-end gap-1 sm:col-span-1">
          <label className="mr-2 flex items-center gap-1 text-[11px] text-white/50"><input type="checkbox" checked={entry.picked} onChange={e => update(s => updatePick(s, eventId, entry.number, { picked: e.target.checked }))} className="accent-[var(--c-accent)]" />Picked</label>
          <button onClick={() => update(s => movePick(s, eventId, entry.index, entry.index - 1))} disabled={entry.index === 0} aria-label={`Move ${entry.number} up`} className="grid h-7 w-7 place-items-center text-white/45 hover:text-white disabled:opacity-25"><ArrowUp className="h-4 w-4" /></button>
          <button onClick={() => update(s => movePick(s, eventId, entry.index, entry.index + 1))} disabled={entry.index === list.length - 1} aria-label={`Move ${entry.number} down`} className="grid h-7 w-7 place-items-center text-white/45 hover:text-white disabled:opacity-25"><ArrowDown className="h-4 w-4" /></button>
          <TeamTools number={entry.number} />
          <button onClick={() => update(s => removeFromPicklist(s, eventId, entry.number))} aria-label={`Remove ${entry.number}`} className="grid h-7 w-7 place-items-center text-white/40 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
        </div>
      </li>;
    })}</ol> : <p className="mt-6 text-sm text-white/45">Your picklist is empty. Add teams from this event to start ranking who you&rsquo;d want on your alliance.</p>}
  </article>;
}

/** Favourite and calendar buttons for the event header. */
export function EventActions({ event, info, location }: { event: any; info: any; location: string }) {
  const start = info?.start ?? event.date;
  if (!start) return null;
  return <div className="mt-4 flex flex-wrap items-center gap-2">
    <span className="inline-flex items-center border border-white/15 pr-3 text-xs text-white/65"><FavoriteButton kind="event" item={{ id: event.id, sku: event.sku ?? info?.sku, name: info?.name ?? event.name, date: String(start).slice(0, 10) }} />Favourite</span>
    <CalendarButton event={{ id: event.id, sku: event.sku ?? info?.sku, name: info?.name ?? event.name, start, end: info?.end ?? start, location, url: info?.officialUrl }} />
    <VoteButtons target={`event:${event.id}`} />
  </div>;
}

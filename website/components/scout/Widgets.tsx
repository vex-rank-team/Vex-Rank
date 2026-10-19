'use client';
/** Small buttons the scouting tools add to existing pages. */
import { CalendarPlus, Download, Eye, GitCompareArrows, Star } from 'lucide-react';
import { download, MAX_COMPARE, useScout } from './ScoutProvider';
import { isFavorite, toggleFavorite } from '@/lib/scout/store.mjs';
import { toCsv, fileName, eventIcs } from '@/lib/scout/tables.mjs';

const iconButton = 'inline-grid h-7 w-7 shrink-0 place-items-center rounded border border-transparent text-white/40 transition hover:border-white/15 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--c-accent)]';

/** A star that saves a team or event to the reader's favourites. */
export function FavoriteButton({ kind, item, className = '' }: { kind: 'team' | 'event'; item: any; className?: string }) {
  const { state, update } = useScout();
  const key = kind === 'team' ? String(item.number ?? '') : String(item.id ?? '');
  if (!key) return null;
  const on = isFavorite(state, kind, key);
  const label = `${on ? 'Remove' : 'Add'} ${kind === 'team' ? key : 'this event'} ${on ? 'from' : 'to'} favourites`;
  return <button type="button" aria-pressed={on} aria-label={label} title={label}
    onClick={event => { event.stopPropagation(); update(s => toggleFavorite(s, kind, item)); }}
    className={`${iconButton} ${on ? 'text-amber-300 hover:text-amber-200' : ''} ${className}`}>
    <Star className="h-4 w-4" fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
  </button>;
}

/** Star, compare and quick look for one team: what a team row offers. */
export function TeamTools({ number, name }: { number: string; name?: string }) {
  const { compare, toggleCompare, setQuickLook } = useScout();
  const key = String(number).toUpperCase();
  const comparing = compare.includes(key);
  const full = !comparing && compare.length >= MAX_COMPARE;
  return <span className="inline-flex items-center">
    <FavoriteButton kind="team" item={{ number: key, name }} />
    <button type="button" aria-pressed={comparing} disabled={full}
      aria-label={full ? `Compare holds ${MAX_COMPARE} teams` : `${comparing ? 'Remove' : 'Add'} ${key} ${comparing ? 'from' : 'to'} compare`}
      title={full ? `Compare holds ${MAX_COMPARE} teams` : comparing ? 'In compare' : 'Add to compare'}
      onClick={event => { event.stopPropagation(); toggleCompare(key); }}
      className={`${iconButton} ${comparing ? 'text-[var(--c-accent)]' : ''} disabled:opacity-30`}>
      <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
    </button>
    <button type="button" aria-label={`Quick look at ${key}`} title="Quick look" onClick={event => { event.stopPropagation(); setQuickLook(key); }} className={iconButton}>
      <Eye className="h-4 w-4" aria-hidden="true" />
    </button>
  </span>;
}

const pill = 'inline-flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-xs text-white/65 hover:border-white/35 hover:text-white';

/** Export a table as CSV. `columns` take `key`, `label` and an optional `value(row)`. */
export function CsvButton({ columns, rows, name, label = 'CSV' }: { columns: any[]; rows: any[]; name: string; label?: string }) {
  return <button type="button" disabled={!rows.length} onClick={() => download(`${fileName(name)}.csv`, toCsv(columns, rows), 'text/csv;charset=utf-8')}
    className={`${pill} disabled:opacity-40`} title="Download as a spreadsheet (CSV)">
    <Download className="h-3.5 w-3.5" aria-hidden="true" />{label}
  </button>;
}

/** Add an event to the reader's calendar as an all-day entry. */
export function CalendarButton({ event }: { event: { id: any; sku?: string; name: string; start: string; end?: string; location?: string; url?: string } }) {
  return <button type="button" onClick={() => download(`${fileName(event.sku ?? '', event.name)}.ics`, eventIcs(event), 'text/calendar;charset=utf-8')} className={pill}>
    <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />Add to calendar
  </button>;
}

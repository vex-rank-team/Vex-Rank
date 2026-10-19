'use client';
/**
 * Home page scouting section: the reader's team, their favourite teams and
 * events, and the world skills leaders for each grade.
 */
import { useEffect, useState } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import { useScout } from './ScoutProvider';
import { FavoriteButton } from './Widgets';
import { filterSkills } from '@/lib/scout/insights.mjs';
import { setMyTeam } from '@/lib/scout/store.mjs';

const card = 'border border-white/10 bg-[var(--c-surface)] p-5';

export default function HomeScout() {
  const { state, update, teamRows, skillRows, loadSkills, openTeam, openEvent, go } = useScout();
  const [draft, setDraft] = useState('');
  useEffect(() => { loadSkills().catch(() => {}); }, [loadSkills]);
  const rated = (number: string) => teamRows.find(row => String(row.number).toUpperCase() === number);
  const skilled = (number: string) => skillRows.find(row => String(row.number).toUpperCase() === number);
  const mine = state.myTeam;
  const myRating = mine ? rated(mine) : null;
  const mySkills = mine ? skilled(mine) : null;
  const today = new Date().toISOString().slice(0, 10);
  const events = [...state.favorites.events].sort((a, b) => (a.date < today ? 1 : 0) - (b.date < today ? 1 : 0) || a.date.localeCompare(b.date));

  return <section aria-label="Your scouting" className="mx-auto max-w-[1440px] px-5 pb-8 lg:px-8">
    <div className="grid gap-4 lg:grid-cols-3">
      <div className={card}>
        <p className="text-[11px] italic text-white/45">My team</p>
        {mine ? <>
          <div className="mt-1 flex items-start justify-between"><button onClick={() => openTeam({ number: mine, name: myRating?.name })} className="text-3xl font-bold hover:text-[var(--c-accent)]">{mine}</button>
            <button onClick={() => update(s => setMyTeam(s, ''))} className="text-xs text-white/40 hover:text-white">Change</button></div>
          <p className="text-sm text-white/55">{myRating?.name ?? mySkills?.name ?? ''}</p>
          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-[11px] text-white/40">VCR</dt><dd className="font-semibold">{myRating ? myRating.rating : '—'}</dd></div>
            <div><dt className="text-[11px] text-white/40">World rank</dt><dd className="font-semibold">{myRating ? `#${myRating.rank}` : '—'}</dd></div>
            <div><dt className="text-[11px] text-white/40">Skills</dt><dd className="font-semibold">{mySkills ? `${mySkills.combinedSkills} · #${mySkills.skillsRank}` : '—'}</dd></div>
          </dl>
          <p className="mt-3 text-[11px] text-white/35">Your team is highlighted in rankings and skills tables.</p>
        </> : <form className="mt-2" onSubmit={event => { event.preventDefault(); update(s => setMyTeam(s, draft)); }}>
          <p className="text-sm text-white/55">Which team are you on? We&rsquo;ll highlight it everywhere.</p>
          <div className="mt-3 flex gap-2"><input value={draft} onChange={e => setDraft(e.target.value.toUpperCase().slice(0, 8))} placeholder="e.g. 55288A" aria-label="Your team number" className="h-10 flex-1 border-b border-white/15 bg-transparent font-mono text-white placeholder:text-white/30 focus:border-[var(--c-accent)] focus:outline-none" />
            <button type="submit" disabled={!/^\d{1,6}[A-Z]{0,2}$/.test(draft)} className="bg-[var(--c-accent)] px-4 text-sm font-semibold text-white disabled:opacity-40">Save</button></div>
        </form>}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between"><p className="text-[11px] italic text-white/45">Your favourites</p><Star className="h-4 w-4 text-amber-300" aria-hidden="true" /></div>
        {state.favorites.teams.length || events.length ? <ul className="mt-2 divide-y divide-white/[.07]">
          {state.favorites.teams.slice(0, 6).map(team => { const row = rated(team.number); return <li key={team.number} className="flex items-center gap-2 py-2">
            <button onClick={() => openTeam({ number: team.number, name: team.name })} className="font-bold hover:text-[var(--c-accent)]">{team.number}</button>
            <span className="min-w-0 flex-1 truncate text-xs text-white/45">{row?.name ?? team.name}</span>
            <span className="font-mono text-sm">{row ? row.rating : ''}</span><FavoriteButton kind="team" item={team} /></li>; })}
          {events.slice(0, 4).map(event => <li key={event.id} className="flex items-center gap-2 py-2">
            <button onClick={() => openEvent({ id: event.id, sku: event.sku, name: event.name, date: event.date })} className="min-w-0 flex-1 truncate text-left text-sm hover:text-[var(--c-accent)]">{event.name}</button>
            <span className={`text-xs ${event.date >= today ? 'text-[var(--c-accent)]' : 'text-white/35'}`}>{event.date ? new Date(`${event.date}T12:00:00`).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : ''}</span>
            <FavoriteButton kind="event" item={event} /></li>)}
        </ul> : <p className="mt-3 text-sm text-white/45">Press the ☆ on any team or event to pin it here.</p>}
      </div>

      <div className={card}>
        <div className="flex items-center justify-between"><p className="text-[11px] italic text-white/45">World skills leaders</p>
          <button onClick={() => go('skills')} className="inline-flex items-center gap-1 text-xs font-semibold text-white/55 hover:text-white">Leaderboard <ArrowUpRight className="h-3.5 w-3.5" /></button></div>
        {skillRows.length ? <div className="mt-2 space-y-3">{['High School', 'Middle School'].map(grade => <div key={grade}>
          <p className="text-[11px] uppercase tracking-wider text-white/35">{grade}</p>
          <ol className="mt-1">{filterSkills(skillRows, { grade }).slice(0, 3).map((row: any, index: number) => <li key={row.number} className="flex items-center gap-2 py-1 text-sm">
            <span className="w-4 text-white/35">{index + 1}</span><button onClick={() => openTeam({ number: row.number, name: row.name, id: row.id })} className="font-bold hover:text-[var(--c-accent)]">{row.number}</button>
            <span className="min-w-0 flex-1 truncate text-xs text-white/45">{row.name}</span><span className="font-mono font-semibold">{row.combinedSkills}</span></li>)}</ol>
        </div>)}</div> : <p className="mt-3 text-sm text-white/45">Loading skills…</p>}
      </div>
    </div>
  </section>;
}

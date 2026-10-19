'use client';
/**
 * Jumper (#/jumper): watch an event's livestream and jump straight to any
 * match. The reader syncs once ("this match starts at 1:02:03 in the video")
 * and every other match is placed from its official start time. The stream
 * link and sync are saved per event in the scouting store.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Play, Search } from 'lucide-react';
import { useScout } from './ScoutProvider';
import { siteFetch } from '@/lib/client-fetch';
import { eventSku, formatTimestamp, parseTimestamp, searchAll, streamTimes, youTubeId } from '@/lib/scout/insights.mjs';
import { setStream } from '@/lib/scout/store.mjs';
import { allianceNumbers } from '@/lib/team-event.mjs';

declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }
let youTubeApi: Promise<any> | null = null;
/** YouTube's player API, loaded once and only on this page. */
function loadYouTube() {
  youTubeApi ??= new Promise(resolve => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { previous?.(); resolve(window.YT); };
    const script = Object.assign(document.createElement('script'), { src: 'https://www.youtube.com/iframe_api', async: true });
    document.head.appendChild(script);
  });
  return youTubeApi;
}

const field = 'h-10 w-full border-b border-white/15 bg-transparent text-sm text-white placeholder:text-white/35 focus:border-[var(--c-accent)] focus:outline-none';

export default function JumperView() {
  const { eventRows, state, update } = useScout();
  const [query, setQuery] = useState('');
  const [event, setEvent] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [error, setError] = useState('');
  const [link, setLink] = useState('');
  const [team, setTeam] = useState('');
  const [syncMatch, setSyncMatch] = useState('');
  const [syncTime, setSyncTime] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);

  const eventId = event ? String(event.id) : '';
  const stream = eventId ? state.streams[eventId] : undefined;
  const candidates = useMemo(() => {
    const sku = eventSku(query);
    if (sku) return eventRows.filter((row: any) => row.sku === sku);
    const favourites = state.favorites.events;
    if (!query.trim()) return [...favourites, ...eventRows.filter((row: any) => /signature|world/i.test(`${row.class} ${row.tier}`)).slice(0, 8)];
    return searchAll(query, { events: eventRows }, 10);
  }, [query, eventRows, state.favorites.events]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    siteFetch(`/api/events/${eventId}`).then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then(data => { if (active) setDetail(data); }).catch(() => { if (active) setError('This event could not be loaded. Please retry.'); });
    return () => { active = false; };
  }, [eventId]);

  // Build (or switch) the player when the stream changes.
  useEffect(() => {
    if (!stream?.videoId || !host.current) return;
    let cancelled = false;
    void loadYouTube().then(YT => {
      if (cancelled || !host.current) return;
      if (player.current?.loadVideoById) { player.current.cueVideoById(stream.videoId); return; }
      const mount = document.createElement('div');
      host.current.replaceChildren(mount);
      player.current = new YT.Player(mount, { videoId: stream.videoId, host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', playerVars: { rel: 0, playsinline: 1 } });
    });
    return () => { cancelled = true; };
  }, [stream?.videoId]);
  useEffect(() => () => { player.current?.destroy?.(); player.current = null; }, []);

  const matches = useMemo(() => (detail?.divisions ?? []).flatMap((division: any) => (division.matches ?? []).map((match: any) => ({ ...match, division: division.name })))
    .sort((a: any, b: any) => Date.parse(a.started || a.scheduled || '') - Date.parse(b.started || b.scheduled || '')), [detail]);
  const times = useMemo(() => streamTimes(matches, stream?.anchor), [matches, stream?.anchor]);
  const wanted = team.trim().toUpperCase();
  const shown = matches.filter((match: any) => !wanted || (match.alliances ?? []).some((alliance: any) => allianceNumbers(alliance).some((n: string) => String(n).toUpperCase() === wanted)));

  const jump = (seconds: number) => { player.current?.seekTo?.(seconds, true); player.current?.playVideo?.(); };
  const saveLink = () => { const videoId = youTubeId(link); if (videoId) { update(s => setStream(s, eventId, { videoId, anchor: stream?.anchor ?? null })); setLink(''); } };
  const useCurrentTime = () => { const now = player.current?.getCurrentTime?.(); if (Number.isFinite(now)) setSyncTime(formatTimestamp(now)); };
  const saveSync = () => {
    const seconds = parseTimestamp(syncTime);
    if (stream && syncMatch && seconds != null) update(s => setStream(s, eventId, { videoId: stream.videoId, anchor: { matchId: syncMatch, seconds } }));
  };

  return <section className="mx-auto max-w-[1440px] px-5 py-10 lg:px-8">
    <p className="mb-1.5 text-[11px] italic text-white/45">Livestreams</p>
    <h1 className="font-display text-3xl tracking-[-.04em] sm:text-5xl">Jumper</h1>
    <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55">Load an event and its YouTube stream, sync one match, then jump straight to any match, or to every match a team played.</p>

    {!event && <div className="mt-8 max-w-2xl border border-white/10 bg-[var(--c-surface)] p-5">
      <label className="flex items-center gap-2 border-b border-white/15 focus-within:border-[var(--c-accent)]"><Search className="h-4 w-4 text-white/40" aria-hidden="true" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events by name, or paste an events.vex.com link" aria-label="Find an event" className="h-11 flex-1 bg-transparent text-sm text-white placeholder:text-white/35 focus:outline-none" /></label>
      <p className="mt-4 text-[11px] uppercase tracking-wider text-white/40">{query.trim() ? 'Matching events' : 'Favourites and signature events'}</p>
      <ul className="mt-2 divide-y divide-white/[.07]">{candidates.map((row: any) => <li key={row.id}><button onClick={() => { setDetail(null); setError(''); setEvent(row); }} className="w-full py-2.5 text-left hover:text-[var(--c-accent)]"><span className="block text-sm font-semibold">{row.name}</span><span className="text-xs text-white/40">{[row.date, row.city, row.sku].filter(Boolean).join(' · ')}</span></button></li>)}
        {!candidates.length && <li className="py-3 text-sm text-white/45">No current-season event matches. Try its name or SKU (RE-V5RC-…).</li>}</ul>
    </div>}

    {event && <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-white/45">{event.sku}</p><h2 className="text-xl font-semibold">{detail?.event?.name ?? event.name}</h2></div>
        <button onClick={() => { player.current?.destroy?.(); player.current = null; setEvent(null); setDetail(null); }} className="text-sm text-white/50 hover:text-white">Choose another event</button></div>
      {error && <p role="alert" className="mt-4 text-sm text-rose-200">{error}</p>}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <div className="aspect-video w-full border border-white/10 bg-black">{stream ? <div ref={host} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" /> : <div className="grid h-full place-items-center p-6 text-center text-sm text-white/45">Paste the event&rsquo;s YouTube stream link to start.</div>}</div>
          <form onSubmit={e => { e.preventDefault(); saveLink(); }} className="mt-3 flex gap-2">
            <input value={link} onChange={e => setLink(e.target.value)} placeholder={stream ? 'Replace the stream: paste another YouTube link' : 'Paste a YouTube link'} aria-label="YouTube link" className={field} />
            <button type="submit" disabled={!youTubeId(link)} className="bg-[var(--c-accent)] px-4 text-sm font-semibold text-white disabled:opacity-40">Load</button>
          </form>
          {stream && <form onSubmit={e => { e.preventDefault(); saveSync(); }} className="mt-4 border border-white/10 bg-[var(--c-surface)] p-4">
            <p className="text-sm font-semibold">Sync the stream {stream.anchor ? <span className="ml-1 text-xs font-normal text-emerald-300">● synced</span> : <span className="ml-1 text-xs font-normal text-amber-300">● not synced yet</span>}</p>
            <p className="mt-1 text-xs text-white/45">Play the video to the start of any match, choose that match, and press “Use current time”.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto_auto]">
              <select value={syncMatch} onChange={e => setSyncMatch(e.target.value)} aria-label="Match on screen" className={`${field} [&>option]:bg-[var(--c-surface-2)]`}><option value="">Match on screen…</option>{matches.filter((m: any) => m.started || m.scheduled).map((m: any) => <option key={m.id} value={m.id}>{m.name}{m.division && detail?.divisions?.length > 1 ? ` · ${m.division}` : ''}</option>)}</select>
              <input value={syncTime} onChange={e => setSyncTime(e.target.value)} placeholder="1:02:03" aria-label="Time in the video" className={`${field} font-mono`} />
              <button type="button" onClick={useCurrentTime} className="inline-flex items-center gap-1 border border-white/15 px-3 text-xs text-white/70 hover:border-white/35"><Crosshair className="h-3.5 w-3.5" />Use current time</button>
              <button type="submit" disabled={!syncMatch || parseTimestamp(syncTime) == null} className="bg-white px-3 text-xs font-semibold text-black disabled:opacity-40">Sync</button>
            </div>
          </form>}
        </div>
        <div className="border border-white/10 bg-[var(--c-surface)]">
          <div className="border-b border-white/10 p-3"><input value={team} onChange={e => setTeam(e.target.value)} placeholder="Filter by team, e.g. 1698Z" aria-label="Filter matches by team" className={field} /></div>
          <ol className="max-h-[560px] overflow-y-auto">{!detail && !error && <li className="p-4 text-sm text-white/45">Loading matches…</li>}
            {shown.map((match: any) => { const seconds = times.get(String(match.id)); const red = (match.alliances ?? []).find((a: any) => a.color === 'red'); const blue = (match.alliances ?? []).find((a: any) => a.color === 'blue');
              return <li key={match.id} className="border-b border-white/[.06]"><button disabled={seconds == null || !stream} onClick={() => seconds != null && jump(seconds)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left enabled:hover:bg-white/[.04] disabled:cursor-default">
                <Play className={`h-3.5 w-3.5 shrink-0 ${seconds != null && stream ? 'text-[var(--c-accent)]' : 'text-white/15'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{match.name}</span>
                  <span className="block truncate text-xs"><span className="text-rose-300/80">{allianceNumbers(red).join(' ')}</span> <span className="text-white/30">vs</span> <span className="text-sky-300/80">{allianceNumbers(blue).join(' ')}</span></span></span>
                <span className="font-mono text-xs text-white/50">{seconds != null ? formatTimestamp(seconds) : stream?.anchor ? 'no time' : ''}</span>
              </button></li>; })}
            {detail && !shown.length && <li className="p-4 text-sm text-white/45">{wanted ? `${wanted} has no matches here.` : 'No matches have been scheduled yet.'}</li>}
          </ol>
        </div>
      </div>
      <p className="mt-3 text-xs text-white/35">Times come from each match&rsquo;s official start time, so they&rsquo;re only as accurate as the event&rsquo;s scoring system clock. Videos play through YouTube&rsquo;s privacy-enhanced mode.</p>
    </div>}
  </section>;
}

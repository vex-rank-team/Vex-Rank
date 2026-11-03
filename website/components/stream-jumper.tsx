'use client';
// The jumper (lib/stream-jumper.mjs): an event's livestream on a page of its
// own, the controls and the match list wrapped around it, and a jump from any
// played match to the moment it started. The timing - dropouts, missing start
// times, matches played out of order, viewers' corrections - is all in
// lib/stream-jumper.mjs.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, Play, Search } from 'lucide-react';
import { siteFetch } from '@/lib/client-fetch';
import { buildJumper, eventStreams, videoTime, youtubeId } from '@/lib/stream-jumper.mjs';

type Jump = { videoId: string; seconds: number; estimated?: boolean };

const NUDGES = [-60, -30, -10, -5, 5, 10, 30, 60];
const nudgeLabel = (delta: number) => `${delta < 0 ? '−' : '+'}${Math.abs(delta) >= 60 ? `${Math.abs(delta) / 60}m` : `${Math.abs(delta)}s`}`;
const storageKey = (event: string | number) => `vexrank-jumper-${event}`;
function readLocal(event: string | number) { try { return JSON.parse(localStorage.getItem(storageKey(event)) ?? 'null') ?? {}; } catch { return {}; } }
function writeLocal(event: string | number, value: any) { try { localStorage.setItem(storageKey(event), JSON.stringify(value)); } catch { /* private window: this visit only */ } }
const watchUrl = (videoId: string, seconds = 0) => `https://www.youtube.com/watch?v=${videoId}${seconds > 0 ? `&t=${Math.round(seconds)}s` : ''}`;

/**
 * An event's streams and where each match sits on them: the organizer's
 * webcast links and the broadcasts on the channels it links, then streams
 * viewers added - each with YouTube's facts and everyone's corrections, plus
 * this viewer's own unsaved corrections.
 */
export function useJumperState(eventId: string | number, divisions: any[], webcast?: string, info?: { start?: string; end?: string }) {
  const [shared, setShared] = useState<any[]>([]);
  const [local, setLocal] = useState<any>({});
  const listed = useMemo(() => eventStreams(webcast) as any, [webcast]);
  const query = useMemo(() => {
    const params = new URLSearchParams({ event: String(eventId) });
    const videos = listed.streams.map((stream: any) => stream.videoId);
    if (videos.length) params.set('videos', videos.join(','));
    if (listed.channels.length) params.set('channels', listed.channels.join(','));
    // The event's days: where the Worker looks for broadcasts on linked channels, and
    // for the other days' streams on the listed videos' channels.
    if (info?.start) { params.set('from', info.start); params.set('to', info.end ?? info.start); }
    return params.toString();
  }, [eventId, listed, info?.start, info?.end]);

  useEffect(() => { setLocal(readLocal(eventId)); }, [eventId]);
  const refresh = useCallback(() => {
    siteFetch(`/api/streams?${query}`).then(response => response.ok ? response.json() : null).then((body: any) => { if (body?.streams) setShared(body.streams); }).catch(() => {});
  }, [query]);
  useEffect(() => { refresh(); }, [refresh]);
  // While the event runs, a stream that is still live gets its end and length later.
  useEffect(() => { const timer = setInterval(refresh, 5 * 60000); return () => clearInterval(timer); }, [refresh]);

  const streams = useMemo(() => (eventStreams(webcast, [...shared, ...(local.added ?? [])]) as any).streams
    .filter((stream: any) => !stream.notLive || stream.source === 'event' || stream.addedAt || stream.source === 'viewer')
    .map((stream: any) => {
      const saved = shared.find(entry => entry.videoId === stream.videoId) ?? {};
      // Corrections: everyone's, then this device's own. (Single "syncs" saved
      // before timing was automatic are left out: they were set without it.)
      const mine = local.anchors?.[stream.videoId] ?? [];
      const theirs = [...(saved.anchors ?? []), ...(saved.sync ? [saved.sync] : [])].filter((anchor: any) => !mine.some((own: any) => own.matchId === anchor.matchId));
      return { ...stream, ...saved, source: stream.source, sync: null, anchors: local.cleared?.[stream.videoId] ? mine : [...theirs, ...mine] };
    }), [webcast, shared, local]);
  // Where matches sit comes from YouTube and saved corrections only: skipping
  // through the video never moves them. (Per-viewer offsets saved by earlier
  // versions are ignored.)
  const jumper = useMemo(() => buildJumper({ divisions, streams, eventStart: info?.start, eventEnd: info?.end }), [divisions, streams, info?.start, info?.end]);
  const jumpFor = useCallback((match: any): Jump | null => jumper.jumpFor(match), [jumper]);
  const update = useCallback((change: (value: any) => any) => setLocal((previous: any) => { const next = change(previous); writeLocal(eventId, next); return next; }), [eventId]);

  const add = useCallback(async (url: string): Promise<{ videoId?: string; problem?: string }> => {
    const videoId = youtubeId(url);
    if (!videoId) return { problem: 'Paste a YouTube video or live link - a channel page cannot be jumped in.' };
    const response = await siteFetch('/api/streams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: Number(eventId), url }) }).catch(() => null);
    if (response?.ok) refresh();
    else update(value => ({ ...value, added: [...(value.added ?? []).filter((entry: any) => entry.videoId !== videoId), { videoId, url, source: 'viewer' }] }));
    return { videoId };
  }, [eventId, refresh, update]);
  // A correction - "this match starts here" - saved for everyone, and kept on
  // this device until the save is confirmed.
  const correct = useCallback(async (videoId: string, matchId: number, seconds: number) => {
    update(value => ({ ...value, anchors: { ...value.anchors, [videoId]: [...(value.anchors?.[videoId] ?? []).filter((entry: any) => entry.matchId !== matchId), { matchId, seconds }] }}));
    const response = await siteFetch('/api/streams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: Number(eventId), videoId, anchor: { matchId, seconds } }) }).catch(() => null);
    if (!response?.ok) return false;
    const body: any = await response.json().catch(() => null);
    if (body?.streams) {
      setShared(body.streams);
      update(value => ({ ...value, anchors: { ...value.anchors, [videoId]: (value.anchors?.[videoId] ?? []).filter((entry: any) => entry.matchId !== matchId) }, syncs: { ...value.syncs, [videoId]: undefined } }));
    }
    return true;
  }, [eventId, update]);
  // Back to YouTube's own timing: everyone's corrections, and this device's.
  const reset = useCallback(async (videoId: string) => {
    update(value => ({ ...value, anchors: { ...value.anchors, [videoId]: [] }, syncs: { ...value.syncs, [videoId]: undefined }, cleared: { ...value.cleared, [videoId]: true } }));
    const response = await siteFetch('/api/streams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event: Number(eventId), videoId, clearAnchors: true }) }).catch(() => null);
    const body: any = response?.ok ? await response.json().catch(() => null) : null;
    if (body?.streams) { setShared(body.streams); update(value => ({ ...value, cleared: { ...value.cleared, [videoId]: undefined } })); }
    return Boolean(body);
  }, [eventId, update]);

  return { streams, others: listed.others as string[], byId: jumper.byId, times: jumper.times, timelineOf: jumper.timelineOf, jumpFor, add, correct, reset };
}

// The match lists elsewhere on the site: a ▶ where a match can be placed on
// the stream, opening the livestream page at it.
type Jumper = { streams: any[]; jumpFor: (match: any) => Jump | null; watch: (match?: any) => void };
const JumperContext = createContext<Jumper | null>(null);
export const useJumper = () => useContext(JumperContext);

export function JumperProvider({ eventId, divisions, webcast, info, onWatch, children }: { eventId: string | number; divisions: any[]; webcast?: string; info?: { start?: string; end?: string }; onWatch?: (match?: any) => void; children: React.ReactNode }) {
  const { streams, jumpFor } = useJumperState(eventId, divisions, webcast, info);
  const value = useMemo(() => (onWatch ? { streams, jumpFor, watch: onWatch } : null), [streams, jumpFor, onWatch]);
  return <JumperContext.Provider value={value}>{children}</JumperContext.Provider>;
}

/** ▶ beside a match: opens the livestream at it, when it can be placed. */
export function JumpButton({ match }: { match: any }) {
  const jumper = useJumper();
  const target = jumper?.jumpFor(match);
  if (!jumper || !target) return null;
  return <button onClick={() => jumper.watch(match)} title={`Watch ${match.name} on the livestream (${videoTime(target.seconds)})`} aria-label={`Watch ${match.name} on the livestream`}
    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/60 transition-colors hover:border-[var(--c-accent)] hover:text-[var(--c-accent)]"><Play className="h-3 w-3 fill-current" /></button>;
}

/** "Watch livestream" - or "Add livestream" where none is listed yet. */
export function WatchButton({ className = '' }: { className?: string }) {
  const jumper = useJumper();
  if (!jumper) return null;
  return <button onClick={() => jumper.watch()} className={`inline-flex items-center gap-2 border border-white/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/70 hover:border-[var(--c-accent)] hover:text-white ${className}`}>
    <Play className="h-3.5 w-3.5 fill-current" />{jumper.streams.length ? 'Watch livestream' : 'Add livestream'}</button>;
}

// The YouTube IFrame API, loaded once and only when a stream is opened.
let youtubeReady: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  youtubeReady ??= new Promise(resolve => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { previous?.(); resolve(w.YT); };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });
  return youtubeReady;
}

/** "Day 2" when the title says so, else the day it went live, else "Stream 2". */
export function streamLabel(stream: any, index: number, all: any[]) {
  const day = /\bday\s*(\d+)\b/i.exec(stream.title ?? '')?.[1];
  if (day) return `Day ${day}`;
  const start = Date.parse(stream.startTime ?? '');
  const days = new Set(all.map(entry => entry.startTime && new Date(entry.startTime).toDateString()).filter(Boolean));
  if (Number.isFinite(start) && days.size > 1) return new Date(start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `Stream ${index + 1}`;
}

const side = (match: any, color: string) => (match.alliances ?? []).find((alliance: any) => alliance.color === color);
const teamsOf = (alliance: any): string[] => (alliance?.teams ?? []).map((entry: any) => entry.team?.name).filter(Boolean);
const isElimination = (match: any) => [3, 4, 5, 6, 15].includes(Number(match.round));

/**
 * The livestream page: the player, with the timing controls and now-playing
 * bar beneath it and every match beside it (below it on a phone).
 */
export function LivestreamPage({ event, details, initialMatchId, initialTeam, goBack, backLabel = 'event' }: {
  event: any; details: any; initialMatchId?: number | null; initialTeam?: string; goBack: () => void; backLabel?: string;
}) {
  const divisions = details?.divisions ?? [];
  const { streams, others, byId, times, timelineOf, jumpFor, add, correct, reset } = useJumperState(event.id, divisions, details?.organizer?.webcast, details?.event);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(initialMatchId ?? null);
  const [command, setCommand] = useState<{ seconds: number; at: number } | null>(null);
  const [position, setPosition] = useState(0);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [team, setTeam] = useState(initialTeam ?? '');
  const [division, setDivision] = useState<string>('all');
  const [playedOnly, setPlayedOnly] = useState(false);
  const [link, setLink] = useState('');
  const [markMatch, setMarkMatch] = useState('');
  const [message, setMessage] = useState('');
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const loaded = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  const timeline = videoId ? timelineOf(videoId) : null;
  const automatic = Boolean(timeline?.automatic);
  const timed = Boolean(timeline);

  // Every match in the order it was played (not the schedule's), with where it sits on the stream.
  const matches = useMemo(() => [...byId.values()]
    .map((match: any) => ({ match, jump: jumpFor(match), when: times.get(Number(match.id)) ?? null }))
    .sort((a: any, b: any) => (a.when?.time ?? Date.parse(a.match.scheduled ?? '') ?? Infinity) - (b.when?.time ?? Date.parse(b.match.scheduled ?? '') ?? Infinity) || Number(a.match.matchnum) - Number(b.match.matchnum)),
  [byId, jumpFor, times]);
  // On the video, in the video's order: what Prev/Next and "now playing" walk.
  const onThisStream = useMemo(() => matches.filter((entry: any) => entry.jump && entry.jump.videoId === videoId).sort((a: any, b: any) => a.jump.seconds - b.jump.seconds), [matches, videoId]);
  // The match playing now: the last to start at or before the video's position,
  // if it started within the last four minutes (otherwise it is between matches).
  const nowIndex = useMemo(() => {
    let found = -1;
    onThisStream.forEach((entry: any, index: number) => { if (entry.jump.seconds <= position + 2) found = index; });
    return found;
  }, [onThisStream, position]);
  const now = nowIndex >= 0 ? onThisStream[nowIndex] : null;
  const live = now && position - (now.jump?.seconds ?? 0) < 240;

  // Open the stream: the first one, or the one the requested match is on.
  useEffect(() => {
    if (opened.current || !streams.length) return;
    const target = initialMatchId != null ? jumpFor(byId.get(Number(initialMatchId)) ?? { id: initialMatchId }) : null;
    if (initialMatchId != null && !target && !streams.some((entry: any) => timelineOf(entry.videoId))) { setVideoId(streams[0].videoId); opened.current = true; return; }
    if (initialMatchId != null && !target) return; // wait until the timing arrives
    opened.current = true;
    setVideoId(target?.videoId ?? streams[0].videoId);
    if (target) setCommand({ seconds: target.seconds, at: Date.now() });
  }, [streams, initialMatchId, jumpFor, byId, timelineOf]);

  // One player for the page's life: a new video loads into it, a jump seeks.
  useEffect(() => {
    if (!videoId || !host.current || blocked) return;
    let cancelled = false;
    loadYouTube().then(YT => {
      if (cancelled) return;
      const start = Math.max(0, command?.seconds ?? 0);
      if (!player.current) {
        const element = document.createElement('div');
        host.current!.replaceChildren(element);
        player.current = new YT.Player(element, {
          videoId, host: 'https://www.youtube.com',
          playerVars: { start, autoplay: command ? 1 : 0, playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
          events: {
            // 101 and 150: the owner allows the video on YouTube only. 2, 5, 100: missing, private or unplayable.
            onError: (event: any) => setBlocked([101, 150].includes(event.data) ? 'embed' : 'unavailable'),
          },
        });
        loaded.current = videoId;
      } else if (loaded.current !== videoId) {
        if (command) player.current.loadVideoById({ videoId, startSeconds: start }); else player.current.cueVideoById({ videoId });
        loaded.current = videoId;
      } else if (command) { player.current.seekTo(start, true); player.current.playVideo?.(); }
    });
    return () => { cancelled = true; };
  }, [videoId, command?.at, blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  const dropPlayer = () => { player.current?.destroy?.(); player.current = null; loaded.current = null; host.current?.replaceChildren(); };
  useEffect(() => () => { player.current?.destroy?.(); }, []);
  // A blocked video leaves no player behind to seek.
  useEffect(() => { if (blocked) dropPlayer(); }, [blocked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const timer = setInterval(() => setPosition(Number(player.current?.getCurrentTime?.() ?? 0)), 1000); return () => clearInterval(timer); }, []);
  // Keep the playing match in view in the list, without moving the page.
  useEffect(() => {
    const row = now ? listRef.current?.querySelector(`[data-match="${now.match.id}"]`) as HTMLElement | null : null;
    const list = listRef.current;
    if (row && list) { const top = row.offsetTop - list.offsetTop; if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - row.clientHeight) list.scrollTo({ top: top - 40, behavior: 'smooth' }); }
  }, [now?.match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchStream = (id: string) => {
    if (id === videoId) return;
    dropPlayer();
    setBlocked(null); setCommand(null); setVideoId(id);
  };
  const jump = (match: any) => {
    const target = jumpFor(match);
    setSelected(Number(match.id));
    if (!target) return;
    if (target.videoId !== videoId) {
      dropPlayer();
      setBlocked(null); setVideoId(target.videoId);
    }
    // A stream its owner keeps on YouTube: one companion tab, re-aimed at each jump.
    if (blocked === 'embed' && target.videoId === videoId) window.open(watchUrl(target.videoId, target.seconds), 'vexrank-livestream');
    setCommand({ seconds: target.seconds, at: Date.now() });
  };
  // Skip back or forward through the video. Only the video moves: every
  // match stays where it is placed.
  const skip = (delta: number) => {
    if (player.current?.seekTo) player.current.seekTo(Math.max(0, position + delta), true);
  };
  // Previous/next in play order across every stream, so the last match of
  // day 1 steps into day 2's video.
  const watchable = useMemo(() => matches.filter((entry: any) => entry.jump), [matches]);
  const step = (direction: number) => {
    if (!watchable.length) return;
    const from = now ? watchable.findIndex((entry: any) => entry.match.id === now.match.id) : selected ? watchable.findIndex((entry: any) => Number(entry.match.id) === selected) : -1;
    const index = from < 0 ? (direction > 0 ? 0 : -1) : Math.min(watchable.length - 1, Math.max(0, from + direction));
    if (index >= 0) jump(watchable[index].match);
  };

  // The list: by team and division, played only if asked.
  const query = team.trim().toUpperCase();
  const divisionsWithMatches = divisions.filter((entry: any) => (entry.matches ?? []).length);
  const shown = matches.filter(({ match, jump: target }: any) =>
    (division === 'all' || String(match.division?.id) === division)
    && (!playedOnly || target)
    && (!query || [...teamsOf(side(match, 'red')), ...teamsOf(side(match, 'blue'))].some(number => number.toUpperCase().includes(query))));
  const groups = [['Qualification', shown.filter(({ match }: any) => !isElimination(match))], ['Elimination', shown.filter(({ match }: any) => isElimination(match))]] as const;
  const multipleDivisions = divisionsWithMatches.length > 1;

  return <section className="mx-auto max-w-[1440px] px-5 py-8 lg:px-8">
    <button onClick={goBack} className="-ml-1 mb-3 flex min-h-11 items-center gap-2 px-1 text-sm font-bold text-white/50 transition-colors hover:text-white"><ArrowLeft className="h-4 w-4" /> Back to {backLabel}</button>
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-[11px] italic text-white/45">Livestream</p><h1 className="font-display mt-1 text-[1.6rem] leading-tight sm:text-[2.1rem]">{details?.event?.name ?? event.name ?? 'Event'}</h1></div>
      {streams.length > 1 && <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Streams">{streams.map((entry: any, index: number) => <button key={entry.videoId} role="tab" aria-selected={entry.videoId === videoId} onClick={() => switchStream(entry.videoId)} className={`border px-3 py-1.5 text-xs font-semibold ${entry.videoId === videoId ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-[var(--c-on-accent)]' : 'border-white/15 text-white/60 hover:text-white'}`}>{streamLabel(entry, index, streams)}</button>)}</div>}
    </div>

    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-3">
        {/* The player, kept in view on a phone while the list scrolls beneath. */}
        <div className="sticky top-16 z-20 -mx-5 bg-[var(--c-page)] sm:mx-0 lg:static">
          <div className="relative aspect-video w-full overflow-hidden bg-black sm:border sm:border-white/10">
            {/* React owns only this wrapper: YouTube replaces the element it is given with its iframe. */}
            <div ref={host} className={`absolute inset-0 h-full w-full [&>*]:h-full [&>*]:w-full ${videoId && !blocked ? '' : 'hidden'}`} />
            {videoId && blocked && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="max-w-md text-sm text-white/75">{blocked === 'embed' ? 'This stream’s owner only lets it be watched on YouTube.' : 'YouTube says this video is unavailable - it may be private or removed.'}</p>
              {blocked === 'embed' && <><a href={watchUrl(videoId, command?.seconds ?? 0)} target="vexrank-livestream" rel="noreferrer" className="inline-flex items-center gap-2 bg-[var(--c-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--c-on-accent)]">Open on YouTube{command ? ` at ${videoTime(command.seconds)}` : ''} <ArrowUpRight className="h-4 w-4" /></a>
                <p className="max-w-md text-xs text-white/50">Matches you pick here open in that same YouTube tab, at the moment they started.</p></>}
            </div>}
            {!videoId && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/55">{streams.length ? 'Loading the stream…' : 'No livestream is listed for this event yet. Add its YouTube link below.'}</div>}
          </div>
          {/* Now playing, and the matches either side of it. */}
          {videoId && <div className="flex items-center gap-2 border-x border-b border-white/10 bg-[var(--c-surface)] px-3 py-2">
            <button onClick={() => step(-1)} disabled={!watchable.length} aria-label="Previous match" className="flex h-9 items-center gap-1 border border-white/10 px-2 text-xs text-white/70 hover:text-white disabled:opacity-30"><ChevronLeft className="h-4 w-4" /><span className="hidden sm:inline">Prev</span></button>
            <div className="min-w-0 flex-1 text-center">
              {now ? <>
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">{live ? 'Now playing' : 'After'}</p>
                <p className="truncate text-sm font-semibold">{now.match.name}{multipleDivisions ? ` · ${now.match.division?.name}` : ''} <span className="font-mono text-xs font-normal text-red-300">{teamsOf(side(now.match, 'red')).join(' ')}</span> <span className="text-white/40">vs</span> <span className="font-mono text-xs font-normal text-blue-300">{teamsOf(side(now.match, 'blue')).join(' ')}</span></p>
              </> : <p className="text-xs text-white/50">{timed ? 'Pick a match to jump to it' : 'Matches get jumps once this stream is synced'}</p>}
            </div>
            <button onClick={() => step(1)} disabled={!watchable.length} aria-label="Next match" className="flex h-9 items-center gap-1 border border-white/10 px-2 text-xs text-white/70 hover:text-white disabled:opacity-30"><span className="hidden sm:inline">Next</span><ChevronRight className="h-4 w-4" /></button>
          </div>}
        </div>

        {videoId && <div className="border border-white/10 bg-[var(--c-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-white/50">Timing</p>
            <p className="text-xs text-white/55">{automatic ? 'Synced automatically' : timed ? 'Synced by viewers' : 'Not synced yet'}{timeline?.corrections ? ` · ${timeline.corrections} correction${timeline.corrections === 1 ? '' : 's'}` : ''}</p>
          </div>
          {timeline?.gaps?.length > 0 && <p className="mt-2 border-l-2 border-amber-400/60 pl-2 text-xs leading-5 text-white/60">
            {(() => { const minutes = Math.round(timeline.gaps.reduce((sum: number, gap: any) => sum + gap.seconds, 0) / 60); const when = new Date(timeline.gaps[0].at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              return timeline.gaps[0].confirmed
                ? `The stream was down for ${minutes} min before the match at ${when} (placed by viewers’ corrections) - YouTube’s video leaves that out, and the jumps allow for it.`
                : `The stream was down for ${minutes} min, which YouTube’s video leaves out. When is not known: it is taken to be the pause before the match at ${when}. If a match lands about ${minutes} min off, mark where it really starts below - that places the dropout for every match.`; })()}
          </p>}
          <div className="mt-3 grid grid-cols-8 gap-1">{NUDGES.map(delta => <button key={delta} onClick={() => skip(delta)} aria-label={`Skip ${delta < 0 ? 'back' : 'forward'} ${Math.abs(delta)} seconds`} className={`h-9 border font-mono text-[11px] text-white/70 hover:border-white/30 hover:text-white sm:text-xs ${delta < 0 ? 'border-white/10' : 'border-white/10 bg-white/[.03]'}`}>{nudgeLabel(delta)}</button>)}</div>
          <div className="mt-1 flex justify-between text-[10px] text-white/35"><span>← back</span><span>skip through the video</span><span>forward →</span></div>
          <p className="mt-2 text-xs leading-5 text-white/50">{timed ? 'Each match opens when it actually started, whatever order it was played in. Skipping only moves the video. If a match itself is placed wrong, play to where it really starts and mark it below: that fixes it and every match after it, for everyone, and leaves the ones before alone.' : 'Play to the start of any match, pick it and press “Starts at”. Every match then gets a jump, for everyone.'}</p>
          <div className="mt-3 flex gap-1.5">
            <select value={markMatch || (selected ? String(selected) : '')} onChange={event => setMarkMatch(event.target.value)} aria-label="Match on screen" className="min-w-0 flex-1 border border-white/15 bg-black/30 px-2 py-2 text-xs">
              <option value="">{timed ? 'Or mark a match on screen…' : 'Match on screen…'}</option>
              {matches.filter(({ when }: any) => when).map(({ match }: any) => <option key={match.id} value={match.id}>{match.name}{multipleDivisions ? ` · ${match.division?.name}` : ''}</option>)}
            </select>
            <button disabled={!(markMatch || selected) || position < 1} title={position < 1 ? 'Play the video to the start of a match first' : undefined}
              onClick={async () => { const id = Number(markMatch || selected); const ok = await correct(videoId, id, Math.round(position)); setMessage(ok ? 'Saved for everyone.' : 'Saved on this device - it could not be saved for others.'); setMarkMatch(''); }}
              className="whitespace-nowrap border border-[var(--c-accent)] px-3 py-2 text-xs font-semibold text-[var(--c-accent)] disabled:opacity-40">Starts at {videoTime(position)}</button>
          </div>
          {automatic && (timeline?.corrections ?? 0) > 0 && <button onClick={async () => { const ok = await reset(videoId); setMessage(ok ? 'Back to YouTube’s own timing, for everyone.' : 'Back to YouTube’s timing on this device.'); }} className="mt-2 text-xs text-white/50 underline-offset-2 hover:text-white hover:underline">Remove corrections and use YouTube’s timing</button>}
          {message && <p className="mt-2 text-xs text-white/60" role="status">{message}</p>}
        </div>}

        <details className="border border-white/10 bg-[var(--c-surface)] px-4 py-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[.16em] text-white/50">Stream links</summary>
          <div className="mt-3 space-y-2 text-xs">
            {streams.map((entry: any, index: number) => <a key={entry.videoId} href={watchUrl(entry.videoId)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-white/65 hover:text-white">{streamLabel(entry, index, streams)} on YouTube <ArrowUpRight className="h-3.5 w-3.5" /></a>)}
            {others.map(url => <a key={url} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 break-all text-white/65 hover:text-white">{url} <ArrowUpRight className="h-3.5 w-3.5 shrink-0" /></a>)}
            <form onSubmit={async event => { event.preventDefault(); if (!link.trim()) return; const result = await add(link.trim()); setMessage(result.problem ?? 'Stream added.'); if (result.videoId) { setLink(''); switchStream(result.videoId); } }} className="flex gap-1.5 pt-1">
              <input value={link} onChange={event => setLink(event.target.value)} placeholder="Add a YouTube stream link" aria-label="Add a YouTube stream link" className="min-w-0 flex-1 border border-white/15 bg-black/30 px-2 py-2 placeholder:text-white/40" />
              <button className="border border-white/15 px-3 py-2 font-semibold text-white/70 hover:text-white">Add</button>
            </form>
          </div>
        </details>
      </div>

      {/* Every match, beside the stream. */}
      <aside className="border border-white/10 bg-[var(--c-surface)]" aria-label="Matches">
        <div className="space-y-2 border-b border-white/10 p-3">
          <label className="relative block"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-white/40" aria-hidden="true" />
            <input value={team} onChange={event => setTeam(event.target.value)} placeholder="Filter by team number" aria-label="Filter matches by team" className="h-9 w-full border border-white/15 bg-black/30 pl-8 pr-2 text-sm placeholder:text-white/40" /></label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {multipleDivisions && <select value={division} onChange={event => setDivision(event.target.value)} aria-label="Division" className="border border-white/15 bg-black/30 px-2 py-1.5"><option value="all">All divisions</option>{divisionsWithMatches.map((entry: any) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>}
            <label className="flex items-center gap-1.5 text-white/60"><input type="checkbox" checked={playedOnly} onChange={event => setPlayedOnly(event.target.checked)} /> Watchable only</label>
            <span className="ml-auto text-white/40">{shown.length} matches</span>
          </div>
        </div>
        <div ref={listRef} className="max-h-[70vh] overflow-y-auto lg:max-h-[calc(100vh-12rem)]">
          {groups.map(([label, entries]) => entries.length > 0 && <div key={label}>
            <p className="sticky top-0 z-10 border-b border-white/10 bg-[var(--c-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[.16em] text-white/45">{label}</p>
            {entries.map(({ match, jump: target }: any) => {
              const red = side(match, 'red'), blue = side(match, 'blue');
              const playing = now?.match.id === match.id && live;
              const focus = (number: string) => query && number.toUpperCase().includes(query);
              const played = Number(red?.score) > 0 || Number(blue?.score) > 0;
              return <button key={match.id} data-match={match.id} onClick={() => jump(match)} disabled={!target}
                className={`flex w-full items-center gap-3 border-b border-white/[.06] px-3 py-2.5 text-left transition-colors ${playing ? 'bg-[var(--c-accent)]/15' : selected === Number(match.id) ? 'bg-white/[.06]' : 'hover:bg-white/[.04]'} disabled:cursor-default disabled:opacity-45`}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${playing ? 'border-[var(--c-accent)] bg-[var(--c-accent)] text-[var(--c-on-accent)]' : 'border-white/15 text-white/55'}`}>{target ? <Play className="h-3 w-3 fill-current" /> : <span className="text-[9px]">—</span>}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><b className="truncate text-[13px]">{match.name}{multipleDivisions && division === 'all' ? <span className="font-normal text-white/45"> · {match.division?.name}</span> : null}</b>
                    <span className="shrink-0 font-mono text-[11px] text-white/45">{target ? `${target.estimated ? '≈' : ''}${videoTime(target.seconds)}` : times.get(Number(match.id)) ? 'not on stream' : 'not played'}</span></span>
                  <span className="mt-0.5 flex items-center gap-2 font-mono text-[12px]">
                    <span className="text-red-300">{teamsOf(red).map(number => <span key={number} className={focus(number) ? 'font-bold text-[var(--c-accent)]' : ''}>{number} </span>)}</span>
                    {played && <span className="text-white/60">{red?.score}–{blue?.score}</span>}
                    <span className="text-blue-300">{teamsOf(blue).map(number => <span key={number} className={focus(number) ? 'font-bold text-[var(--c-accent)]' : ''}>{number} </span>)}</span>
                  </span>
                </span>
              </button>;
            })}
          </div>)}
          {!shown.length && <p className="p-5 text-sm text-white/50">{matches.length ? 'No matches fit these filters.' : 'The match schedule has not been posted yet.'}</p>}
        </div>
      </aside>
    </div>
  </section>;
}

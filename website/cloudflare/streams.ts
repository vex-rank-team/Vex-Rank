// The jumper's shared state (lib/stream-jumper.mjs), one small JSON row per
// event in api_cache - no schema change:
//   - each stream's YouTube facts: when the broadcast went live and ended, how
//     long the saved video is (the difference is time the stream was down),
//     and its title (which can name a division);
//   - broadcasts found on the YouTube channels an event's webcast notes link,
//     and on the channels of the videos it lists - organizers post day 1's
//     link and not day 2's (Speedway 2026), and the channel has both;
//   - streams viewers added, and their corrections ("this match starts
//     here"), which apply from their match on.
//
//   GET  /api/streams?event=64234[&videos=id,id][&channels=@x,UC…][&from=ISO&to=ISO]
//   POST /api/streams  {event, url}                                  add a YouTube link
//   POST /api/streams  {event, videoId, anchor:{matchId, seconds}}   a correction
//   POST /api/streams  {event, videoId, clearAnchors:true}           back to automatic
import { youtubeId } from '../lib/stream-jumper.mjs';

type Anchor = { matchId: number; seconds: number };
type Stream = {
  videoId: string; url?: string; divisionId?: number | null; title?: string; channel?: string; channelId?: string;
  startTime?: string | null; endTime?: string | null; duration?: number | null;
  anchors?: Anchor[]; sync?: Anchor | null; checkedAt?: number; notLive?: boolean; listed?: boolean; addedAt?: string;
};
type ChannelState = { id?: string; uploads?: string; checkedAt?: number; missing?: boolean };
type Row = { streams: Stream[]; channels?: Record<string, ChannelState> };
interface StreamEnv { DB: D1Database; YOUTUBE_API_KEY?: string }

const MAX_STREAMS = 8;
const MAX_ANCHORS = 30;
const KEEP_FOR = 3 * 365 * 86400000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL = /^(@[\w.-]{3,40}|UC[\w-]{22}|user:[\w.-]{2,40})$/;
const key = (event: number) => `streams:${event}`;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function load(env: StreamEnv, event: number): Promise<Row> {
  const row = await env.DB.prepare('SELECT body FROM api_cache WHERE key=?').bind(key(event)).first<{ body: string }>().catch(() => null);
  try { const body = row ? JSON.parse(row.body) : {}; return { streams: body.streams ?? [], channels: body.channels ?? {} }; } catch { return { streams: [], channels: {} }; }
}
async function save(env: StreamEnv, event: number, row: Row) {
  await env.DB.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at')
    .bind(key(event), JSON.stringify(row), Date.now() + KEEP_FOR).run();
}

// YouTube, only with an API key. The free allowance is 10,000 units a day and
// every call here costs one, so:
//   - facts that cannot change (a start time; a finished broadcast's end and
//     length) are kept for good, and a video that is not a live broadcast is
//     marked and never asked about again;
//   - a broadcast still live, or not yet started, is asked about at most every
//     RECHECK; a channel at most every CHANNEL_RECHECK, and only around the event;
//   - a few calls per request, and a daily ceiling (DAILY_CALLS, half the
//     allowance) that even deliberate abuse cannot pass. Past it, streams keep
//     what they have and fall back to viewers' corrections until tomorrow.
const RECHECK = 5 * 60000;
const CHANNEL_RECHECK = 10 * 60000;
const VIDEOS_PER_REQUEST = 4;
const CHANNELS_PER_REQUEST = 2;
const DAILY_CALLS = 5000;
type Facts = { live: boolean; startTime?: string; endTime?: string; duration?: number; title?: string; scheduled?: string; channelId?: string };

async function spend(env: StreamEnv): Promise<boolean> {
  // YouTube's quota day runs on Pacific time; UTC dates are close enough for a ceiling at half.
  const day = `youtube-lookups:${new Date().toISOString().slice(0, 10)}`;
  const row = await env.DB.prepare('SELECT body FROM api_cache WHERE key=?').bind(day).first<{ body: string }>().catch(() => null);
  const used = Number(row?.body ?? 0);
  if (used >= DAILY_CALLS) return false;
  await env.DB.prepare('INSERT INTO api_cache(key,body,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,expires_at=excluded.expires_at')
    .bind(day, String(used + 1), Date.now() + 2 * 86400000).run().catch(() => {});
  return true;
}

async function youtube(env: StreamEnv, path: string, params: Record<string, string>): Promise<any | null> {
  if (!env.YOUTUBE_API_KEY || !(await spend(env))) return null;
  try {
    const query = new URLSearchParams({ ...params, key: env.YOUTUBE_API_KEY });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${query}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) { console.error('YouTube call failed', path, response.status); return null; }
    return await response.json();
  } catch { return null; }
}

/** "PT10H39M59S" → seconds. */
function isoSeconds(value?: string): number | undefined {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value ?? '');
  if (!match) return undefined;
  const [, d, h, m, s] = match.map(part => Number(part ?? 0));
  const total = d * 86400 + h * 3600 + m * 60 + s;
  return total > 0 ? total : undefined;
}

async function videoFacts(env: StreamEnv, ids: string[]): Promise<Record<string, Facts> | null> {
  if (!ids.length) return {};
  const body = await youtube(env, 'videos', { part: 'snippet,liveStreamingDetails,contentDetails', id: ids.join(','), maxResults: '50' });
  if (!body) return null;
  const found: Record<string, Facts> = Object.fromEntries(ids.map(id => [id, { live: false }]));
  for (const item of body.items ?? []) {
    const live = item.liveStreamingDetails;
    found[item.id] = {
      live: Boolean(live), startTime: live?.actualStartTime, endTime: live?.actualEndTime, scheduled: live?.scheduledStartTime,
      duration: live?.actualEndTime ? isoSeconds(item.contentDetails?.duration) : undefined, title: item.snippet?.title, channelId: item.snippet?.channelId,
    };
  }
  return found;
}

function apply(stream: Stream, facts: Facts, now: number) {
  stream.checkedAt = now;
  if (!facts.live) { stream.notLive = true; return; }
  if (facts.startTime) stream.startTime = facts.startTime;
  if (facts.endTime) stream.endTime = facts.endTime;
  if (facts.duration) stream.duration = facts.duration;
  if (facts.title) stream.title = facts.title;
  if (facts.channelId) stream.channelId = facts.channelId;
}

// Words that say which event a broadcast is of - not the ones every VEX stream shares.
const COMMON = new Set(['vex', 'robotics', 'competition', 'live', 'stream', 'livestream', 'day', 'event', 'events', 'tournament', 'field', 'match', 'matches', 'presented', 'the', 'and', 'for', 'with', 'v5rc', 'viqrc', 'override', 'level', 'push', 'back', 'high', 'school', 'middle', 'part', 'session', 'qualifier', 'signature']);
const words = (text?: string) => new Set((text ?? '').toLowerCase().normalize('NFKD').split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !COMMON.has(word) && !/^\d+$/.test(word)));
/** A broadcast found on a listed video's channel belongs to the event if its title shares a telling word with the event's streams. */
function sameEvent(title: string | undefined, known: Stream[]) {
  const mine = words(title);
  return known.some(stream => [...words(stream.title)].some(word => mine.has(word)));
}

// Whether YouTube could still tell us something new about a stream.
const unsettled = (stream: Stream) => !stream.notLive && (!stream.startTime || !stream.endTime || !stream.duration || !stream.channelId);

/**
 * Broadcasts on a channel around the event: the channel's uploads (live
 * broadcasts are among them), kept if they went live, or were set to, between
 * half a day before the event and a day and a half after it.
 */
async function channelBroadcasts(env: StreamEnv, ref: string, state: ChannelState, from: number, to: number): Promise<{ state: ChannelState; videos: Record<string, Facts> } | null> {
  // A channel id gives its uploads playlist directly: "UC…" → "UU…".
  if (!state.uploads && ref.startsWith('UC')) state = { ...state, id: ref, uploads: `UU${ref.slice(2)}` };
  if (!state.uploads) {
    const lookup: Record<string, string> = ref.startsWith('UC') ? { id: ref } : ref.startsWith('user:') ? { forUsername: ref.slice(5) } : { forHandle: ref };
    const body = await youtube(env, 'channels', { part: 'contentDetails', ...lookup });
    if (!body) return null;
    const channel = body.items?.[0];
    if (!channel) return { state: { ...state, missing: true, checkedAt: Date.now() }, videos: {} };
    state = { ...state, id: channel.id, uploads: channel.contentDetails?.relatedPlaylists?.uploads };
    if (!state.uploads) return { state: { ...state, missing: true, checkedAt: Date.now() }, videos: {} };
  }
  // Newest first: page back (at most four pages, a unit each) until past the
  // event, so an event weeks ago on a busy channel is still reached.
  const ids: string[] = [];
  let page: string | undefined;
  for (let pages = 0; pages < 4; pages++) {
    const items = await youtube(env, 'playlistItems', { part: 'contentDetails', playlistId: state.uploads!, maxResults: '50', ...(page ? { pageToken: page } : {}) });
    if (!items) return null;
    let older = false;
    for (const item of items.items ?? []) {
      const published = Date.parse(item.contentDetails?.videoPublishedAt ?? '');
      if (Number.isFinite(published) && published < from - 14 * 86400000) { older = true; continue; }
      if (Number.isFinite(published) && published > to + 14 * 86400000) continue;
      if (VIDEO_ID.test(item.contentDetails?.videoId ?? '')) ids.push(item.contentDetails.videoId);
    }
    page = items.nextPageToken;
    if (older || !page) break;
  }
  const facts: Record<string, Facts> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const batch = await videoFacts(env, ids.slice(i, i + 50));
    if (!batch) return null;
    Object.assign(facts, batch);
  }
  const videos = Object.fromEntries(Object.entries(facts).filter(([, entry]) => {
    const when = Date.parse(entry.startTime ?? entry.scheduled ?? '');
    return entry.live && Number.isFinite(when) && when >= from - 12 * 3600000 && when <= to + 36 * 3600000;
  }));
  return { state: { ...state, checkedAt: Date.now() }, videos };
}

export async function streamsRoute(request: Request, env: StreamEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const event = Number(url.searchParams.get('event'));
    if (!Number.isInteger(event) || event <= 0) return json({ error: 'event is required.' }, 400);
    const row = await load(env, event);
    const { streams } = row;
    const known = new Map(streams.map(stream => [stream.videoId, stream]));
    const now = Date.now();
    let changed = false;

    // Videos the event lists, and any whose facts could still change.
    const listed = (url.searchParams.get('videos') ?? '').split(',').filter(id => VIDEO_ID.test(id));
    const due = [...new Set([...known.keys(), ...listed])]
      .filter(id => { const stream = known.get(id); return (!stream || unsettled(stream)) && now - (stream?.checkedAt ?? 0) > RECHECK; })
      .filter(id => known.has(id) || known.size < MAX_STREAMS * 2)
      .slice(0, VIDEOS_PER_REQUEST);
    const facts = due.length ? await videoFacts(env, due) : null;
    if (facts) {
      for (const videoId of due) {
        let stream = known.get(videoId);
        if (!stream) { stream = { videoId, listed: true }; streams.push(stream); known.set(videoId, stream); }
        apply(stream, facts[videoId], now);
      }
      changed = true;
    }
    // Broadcasts on the channels the webcast notes link, and on the listed
    // videos' channels, around the event's days.
    const from = Date.parse(url.searchParams.get('from') ?? ''), to = Date.parse(url.searchParams.get('to') ?? '');
    const linked = (url.searchParams.get('channels') ?? '').split(',').filter(ref => CHANNEL.test(ref)).slice(0, 4);
    // The channels of the videos the event lists: where its other days' broadcasts are.
    const listedStreams = streams.filter(stream => !stream.channel && !stream.notLive && stream.startTime);
    const ofVideos = [...new Set(listedStreams.map(stream => stream.channelId).filter((id): id is string => Boolean(id && CHANNEL.test(id))))].filter(id => !linked.includes(id)).slice(0, 2);
    const channels = [...linked, ...ofVideos];
    if (channels.length && Number.isFinite(from) && Number.isFinite(to)) {
      // Around the event, look again now and then; long after it, once is enough.
      const settled = now > to + 2 * 86400000;
      const due = channels.filter(ref => { const state = row.channels![ref]; return !state || (!state.missing && !settled && now - (state.checkedAt ?? 0) > CHANNEL_RECHECK); }).slice(0, CHANNELS_PER_REQUEST);
      for (const ref of due) {
        const result = await channelBroadcasts(env, ref, row.channels![ref] ?? {}, from, to);
        if (!result) break;
        row.channels![ref] = result.state; changed = true;
        for (const [videoId, facts] of Object.entries(result.videos)) {
          let stream = known.get(videoId);
          // From a listed video's channel (not one the notes link), only broadcasts titled like the event's.
          if (!stream && !linked.includes(ref) && !sameEvent(facts.title, listedStreams)) continue;
          if (!stream) { if (streams.length >= MAX_STREAMS * 2) break; stream = { videoId, channel: ref, listed: true }; streams.push(stream); known.set(videoId, stream); }
          apply(stream, facts, now);
        }
      }
    }

    if (changed) await save(env, event, row).catch(() => {});
    return json({ event, streams });
  }

  if (request.method !== 'POST') return json({ error: 'GET or POST.' }, 405);
  const text = await request.text();
  if (text.length > 2000) return json({ error: 'Too large.' }, 413);
  let body: any;
  try { body = JSON.parse(text); } catch { return json({ error: 'JSON body required.' }, 400); }
  const event = Number(body?.event);
  if (!Number.isInteger(event) || event <= 0) return json({ error: 'event is required.' }, 400);
  const row = await load(env, event);
  const { streams } = row;
  if (body.url !== undefined) {
    const videoId = youtubeId(String(body.url));
    if (!videoId) return json({ error: 'Only YouTube video and live links can be jumped in.' }, 400);
    if (!streams.some(stream => stream.videoId === videoId)) {
      if (streams.filter(stream => stream.addedAt).length >= MAX_STREAMS) return json({ error: 'This event already has the most streams allowed.' }, 409);
      const divisionId = Number.isInteger(Number(body.divisionId)) && Number(body.divisionId) > 0 ? Number(body.divisionId) : null;
      streams.push({ videoId, url: `https://www.youtube.com/watch?v=${videoId}`, divisionId, addedAt: new Date().toISOString() });
    }
  } else if (body.videoId !== undefined) {
    const videoId = String(body.videoId);
    if (!VIDEO_ID.test(videoId)) return json({ error: 'videoId is required.' }, 400);
    let stream = streams.find(entry => entry.videoId === videoId);
    if (!stream) {
      if (streams.length >= MAX_STREAMS * 2) return json({ error: 'Too many streams.' }, 409);
      stream = { videoId, listed: true }; streams.push(stream);
    }
    if (body.clearAnchors === true) { stream.anchors = []; stream.sync = null; }
    else {
      // A correction; `sync` is the older name for the same thing.
      const anchor = body.anchor ?? body.sync;
      const matchId = Number(anchor?.matchId), seconds = Number(anchor?.seconds);
      if (!Number.isInteger(matchId) || matchId <= 0 || !Number.isFinite(seconds) || seconds < 0 || seconds > 7 * 86400)
        return json({ error: 'anchor {matchId, seconds} is required.' }, 400);
      const anchors = [...(stream.anchors ?? []), ...(stream.sync ? [stream.sync] : [])].filter(entry => entry.matchId !== matchId);
      stream.anchors = [...anchors, { matchId, seconds: Math.round(seconds) }].slice(-MAX_ANCHORS);
      stream.sync = null;
    }
  } else return json({ error: 'url or videoId is required.' }, 400);
  await save(env, event, row);
  return json({ event, streams });
}

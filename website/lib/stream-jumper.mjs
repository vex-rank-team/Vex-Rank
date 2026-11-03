/**
 * The jumper, after OpenScout's: an event's livestream beside its schedule,
 * and a jump from any match to the moment it was played. Mirrored by
 * VEXRankKit's StreamJumper.swift.
 *
 * WHEN A MATCH WAS PLAYED. Never the schedule: events run late (Caution Tape's
 * Q1, scheduled 9:00, started 9:33), and after technical trouble matches are
 * played out of order. Each match's own `started` time is used, so order never
 * matters. Where an event recorded none (scores typed in later), a played
 * match is estimated from its scheduled time plus the delay its neighbours ran
 * at, and marked as estimated. Start times that cannot be real - outside the
 * event's days, or one timestamp stamped on many matches by a batch upload -
 * are treated as missing.
 *
 * WHERE THAT IS IN THE VIDEO. YouTube says when the broadcast went live (S),
 * when it ended (E) and how long the saved video is (D). With no interruption,
 * a match at time t is (t - S) into the video. But YouTube's archive leaves out
 * any stretch the stream was down - a dropped connection, the encoder paused
 * over lunch - so after a dropout everything sits earlier than the clock says.
 * The total missing, (E - S) - D, is known; where it went is not, so it is
 * placed where a stream is most likely to have been down: the event's longest
 * pauses between matches (lunch, a delay), then before the first match or
 * after the last. Matches before the dropout stay lined up from the start,
 * matches after it from the end. If more is missing than any pause can hold,
 * the start of the archive is gone (YouTube keeps at most 12 hours).
 *
 * CORRECTIONS. A viewer who sees a jump land off can mark "this match starts
 * here" for everyone. A correction applies from its match onward, up to the
 * next one, so fixing the second half leaves a perfect first half alone; one
 * far from YouTube's own timing (more than 20 minutes - dropouts are already
 * allowed for, so a real correction is a clock off by a few minutes) is taken
 * for a mistake and ignored. A stream YouTube has no times for (an upload) is timed from
 * corrections alone. A per-viewer nudge takes up the last few seconds.
 */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MATCH_MS = 150000; // a match and its reset: a dropout cannot hide inside one
const DAY = 86400000;
const CORRECTION_LIMIT = 20 * 60; // seconds a correction may differ from YouTube's timing
const BATCH_STAMP = 4; // this many matches on one exact timestamp is a batch upload, not play

/** The YouTube video id in a link, or null. Channel and playlist links have none. */
export function youtubeId(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { return null; }
  const host = parsed.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = parsed.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, value] = parsed.pathname.split('/');
    id = kind === 'watch' ? parsed.searchParams.get('v') : ['live', 'embed', 'shorts', 'v'].includes(kind) ? value : null;
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/**
 * A YouTube channel in a link - "@handle", "UC…" id, or "user:Name" - for the
 * Worker to find the channel's broadcasts during the event. Null otherwise.
 */
export function youtubeChannel(url) {
  let parsed;
  try { parsed = new URL(String(url).trim()); } catch { return null; }
  const host = parsed.hostname.replace(/^(www|m)\./, '');
  if (host !== 'youtube.com') return null;
  const [, first, second] = parsed.pathname.split('/');
  if (/^@[\w.-]{3,30}$/.test(decodeURIComponent(first ?? ''))) return decodeURIComponent(first);
  if (first === 'channel' && /^UC[\w-]{22}$/.test(second ?? '')) return second;
  if ((first === 'c' || first === 'user') && /^[\w.-]{2,40}$/.test(second ?? '')) return first === 'user' ? `user:${second}` : `@${second}`;
  return null;
}

/** Every link in a block of text (the organizer's webcast notes). */
export function linksIn(text) {
  return [...new Set((String(text ?? '').match(/https?:\/\/[^\s<>"')\]]+/g) ?? []).map(link => link.replace(/[.,;:!?]+$/, '')))];
}

/**
 * Streams an event lists: the YouTube videos in the organizer's webcast notes,
 * then found or added ones, one entry per video. Channel links come back as
 * `channels` (the Worker finds their broadcasts); anything else as `others`,
 * to open as a plain link.
 */
export function eventStreams(webcastText, added = []) {
  const streams = [], seen = new Set(), others = [], channels = [];
  const push = (stream) => { if (!seen.has(stream.videoId)) { seen.add(stream.videoId); streams.push(stream); } };
  for (const url of linksIn(webcastText)) {
    const videoId = youtubeId(url), channel = videoId ? null : youtubeChannel(url);
    if (videoId) push({ videoId, url, source: 'event' });
    else { others.push(url); if (channel && !channels.includes(channel)) channels.push(channel); }
  }
  for (const stream of added) if (stream?.videoId && YOUTUBE_ID.test(stream.videoId)) push({ ...stream, source: stream.source ?? 'viewer' });
  return { streams, others, channels };
}

/** Every match at an event by id, with its division. */
export function matchesById(divisions) {
  const map = new Map();
  for (const division of divisions ?? []) for (const match of division.matches ?? []) map.set(Number(match.id), { ...match, division: { id: division.id, name: division.name } });
  return map;
}

const parse = (value) => { const time = Date.parse(value ?? ''); return Number.isFinite(time) ? time : null; };
const isPlayed = (match) => (match.alliances ?? []).some(alliance => Number(alliance.score) > 0);

/**
 * When each played match was played: { time, estimated } by match id.
 * Recorded start times where they can be real; otherwise, for a match that
 * has scores, its scheduled time plus the delay its nearest timed neighbours
 * (by schedule) ran at.
 */
export function matchTimes(byId, { eventStart, eventEnd } = {}) {
  const from = parse(eventStart), to = parse(eventEnd);
  const low = from === null ? -Infinity : from - DAY, high = to === null ? Infinity : to + 2 * DAY;
  const stamps = new Map();
  for (const match of byId.values()) { const t = parse(match.started); if (t !== null) stamps.set(t, (stamps.get(t) ?? 0) + 1); }
  const times = new Map(), delays = [];
  for (const match of byId.values()) {
    const t = parse(match.started);
    if (t === null || t < low || t > high || stamps.get(t) >= BATCH_STAMP) continue;
    times.set(Number(match.id), { time: t, estimated: false });
    const scheduled = parse(match.scheduled);
    if (scheduled !== null) delays.push({ scheduled, delay: t - scheduled });
  }
  delays.sort((a, b) => a.scheduled - b.scheduled);
  for (const match of byId.values()) {
    if (times.has(Number(match.id)) || !isPlayed(match)) continue;
    const scheduled = parse(match.scheduled);
    if (scheduled === null || !delays.length) continue;
    let before = null, after = null;
    for (const entry of delays) { if (entry.scheduled <= scheduled) before = entry; else { after = entry; break; } }
    const delay = before && after
      ? before.delay + (after.delay - before.delay) * (scheduled - before.scheduled) / Math.max(1, after.scheduled - before.scheduled)
      : (before ?? after).delay;
    times.set(Number(match.id), { time: scheduled + delay, estimated: true });
  }
  return times;
}

/**
 * Where YouTube's archive left out time the stream was down: [{ at, seconds }],
 * each shifting every match from `at` on. See the note at the top.
 *
 * Without evidence, the missing time goes in the longest pauses. With
 * corrections (`marks`, [{ t, seconds }] - a match's clock time and where a
 * viewer saw it start), each pause that could hold all of it is tried, and the
 * one that agrees with the marks wins: one mark after the true dropout moves
 * it there for every match. (Caution Tape, 2026: 14 minutes missing; the
 * longest pause was lunch, but the stream was down during alliance selection.)
 */
export function placeDropouts(start, end, duration, times, marks = []) {
  const missing = (end - start) / 1000 - duration;
  if (!(missing > 20)) return [];
  const played = times.filter(t => t >= start && t <= end).sort((a, b) => a - b);
  if (!played.length) return [];
  const slots = [{ at: played[0], room: (played[0] - start) / 1000, weight: 0.5 }];
  for (let i = 0; i + 1 < played.length; i++) {
    const room = (played[i + 1] - played[i] - MATCH_MS) / 1000;
    if (room > 0) slots.push({ at: played[i + 1], room, weight: 1 });
  }
  slots.push({ at: Infinity, room: (end - played.at(-1) - MATCH_MS) / 1000, weight: 0.5 });
  slots.sort((a, b) => b.room * b.weight - a.room * a.weight);

  const useful = marks.filter(mark => mark.t >= start && mark.t <= end);
  if (useful.length) {
    const misfit = (at) => useful.reduce((sum, mark) => sum + Math.min(600, Math.abs(mark.seconds - ((mark.t - start) / 1000 - (at <= mark.t ? missing : 0)))), 0);
    let best = null;
    for (const slot of slots) {
      if (slot.room < missing * 0.9) continue;
      const score = misfit(slot.at);
      if (!best || score < best.score - 1) best = { slot, score }; // ties keep the likelier pause
    }
    if (best) return best.slot.at === Infinity ? [] : [{ at: best.slot.at, seconds: missing, confirmed: true }];
  }

  const gaps = [];
  let left = missing;
  for (const slot of slots) {
    if (left <= 0) break;
    const take = Math.min(Math.max(0, slot.room), left);
    if (take > 0) { gaps.push({ at: slot.at, seconds: take }); left -= take; }
  }
  // More missing than any pause holds: the start of the archive is gone.
  if (left > 1) gaps.push({ at: played[0], seconds: left });
  return gaps.filter(gap => gap.at !== Infinity);
}

/**
 * One stream's timeline: wall-clock ms → seconds into the video, or null.
 * `times` is every match's { time } by id; `anchors` the corrections,
 * [{ matchId, seconds }].
 */
export function streamTimeline(stream, times, anchors = []) {
  const start = parse(stream.startTime), end = parse(stream.endTime);
  const duration = Number(stream.duration);
  const all = [...times.values()].map(entry => entry.time);
  const raw = anchors
    .map(anchor => ({ t: times.get(Number(anchor.matchId))?.time, seconds: Number(anchor.seconds) }))
    .filter(mark => Number.isFinite(mark.t) && Number.isFinite(mark.seconds) && mark.seconds >= 0);
  // Corrections first say where the dropout was; what they still disagree by is a correction proper.
  const gaps = start !== null && end !== null && duration > 0 ? placeDropouts(start, end, duration, all, raw) : [];
  const base = start === null ? null : (t) => (t - start) / 1000 - gaps.reduce((sum, gap) => sum + (gap.at <= t ? gap.seconds : 0), 0);
  const marks = raw
    .filter(mark => !base || Math.abs(mark.seconds - base(mark.t)) <= CORRECTION_LIMIT)
    .sort((a, b) => a.t - b.t);
  if (!base && !marks.length) return null;
  const at = (t) => {
    let mark = null;
    for (const entry of marks) { if (entry.t <= t) mark = entry; else break; }
    if (base) return base(t) + (mark ? mark.seconds - base(mark.t) : 0);
    mark ??= marks[0];
    return mark.seconds + (t - mark.t) / 1000;
  };
  const origin = base ? start : marks[0].t - marks[0].seconds * 1000;
  return { at, origin, end: end ?? null, duration: duration > 0 ? duration : null, gaps, corrections: marks.length, automatic: Boolean(base) };
}

/**
 * Everything the pages need: for each match, which stream it is on and where.
 * A match is on the stream for its division (or for every division) that was
 * running when it was played; failing that, the one that began most recently
 * before it.
 */
export function buildJumper({ divisions, streams, nudges = {}, eventStart, eventEnd }) {
  const byId = matchesById(divisions);
  const times = matchTimes(byId, { eventStart, eventEnd });
  const multiple = (divisions ?? []).filter(division => (division.matches ?? []).length).length > 1;
  const timelines = streams.map(stream => {
    // A stream titled with a division's name is that division's.
    const titled = multiple && !stream.divisionId && stream.title
      ? (divisions ?? []).find(division => division.name && String(stream.title).toLowerCase().includes(String(division.name).toLowerCase()))?.id
      : null;
    const anchors = [...(stream.anchors ?? []), ...(stream.sync ? [stream.sync] : [])];
    return { stream, divisionId: stream.divisionId ?? titled ?? null, timeline: streamTimeline(stream, times, anchors) };
  }).filter(entry => entry.timeline);

  const jumpFor = (matchOrId) => {
    const id = Number(typeof matchOrId === 'object' ? matchOrId?.id : matchOrId);
    const when = times.get(id), match = byId.get(id);
    if (!when || !match) return null;
    const fits = timelines.filter(entry => !entry.divisionId || Number(entry.divisionId) === Number(match.division?.id));
    if (!fits.length) return null;
    const running = fits.filter(entry => entry.timeline.origin <= when.time && (entry.timeline.end === null || when.time <= entry.timeline.end + MATCH_MS));
    const earlier = fits.filter(entry => entry.timeline.origin <= when.time);
    const pool = running.length ? running : earlier;
    if (!pool.length) return null;
    const pick = pool.reduce((a, b) => (b.timeline.origin > a.timeline.origin ? b : a));
    const seconds = Math.round(pick.timeline.at(when.time) + Number(nudges[pick.stream.videoId] ?? 0));
    if (seconds < 0 || (pick.timeline.duration && seconds > pick.timeline.duration + 60)) return null;
    return { videoId: pick.stream.videoId, seconds, estimated: when.estimated };
  };
  const timeOf = (id) => times.get(Number(id)) ?? null;
  const timelineOf = (videoId) => timelines.find(entry => entry.stream.videoId === videoId)?.timeline ?? null;
  return { byId, times, jumpFor, timeOf, timelineOf };
}

/** One match's jump, for callers with a single match in hand. */
export function matchJump(streams, match, byId, nudges = {}, options = {}) {
  const divisions = [...new Map([...byId.values()].map(entry => [entry.division?.id, { id: entry.division?.id, name: entry.division?.name, matches: [] }])).values()];
  for (const entry of byId.values()) divisions.find(division => division.id === entry.division?.id).matches.push(entry);
  return buildJumper({ divisions, streams, nudges, ...options }).jumpFor(match);
}

/** "1:02:03" / "4:05" for a video position. */
export function videoTime(seconds) {
  const s = Math.max(0, Math.round(seconds)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * The reader's scouting data: favourites, match and team notes, picklists,
 * Jumper stream links and "my team". Each change is a pure function of the
 * old state, so tests cover the rules; createScoutStore keeps the result in
 * localStorage and tells subscribers. Signed-in syncing builds on top of this.
 */

export const SCOUT_KEY = 'vexrank-scout';
export const TIERS = ['first', 'second', 'maybe', 'avoid'];
const TEAM = /^\d{1,6}[A-Z]{0,2}$/;
const MAX_NOTE = 2000;

export function emptyScout() {
  return { v: 1, favorites: { teams: [], events: [] }, notes: {}, picklists: {}, streams: {}, myTeam: '' };
}

const clip = (value, max) => String(value ?? '').slice(0, max);
const isObject = value => value && typeof value === 'object' && !Array.isArray(value);

/** Keep only well-formed data; anything else is dropped rather than trusted. */
export function sanitizeScout(raw) {
  const base = emptyScout();
  if (!isObject(raw)) return base;
  const teams = Array.isArray(raw.favorites?.teams) ? raw.favorites.teams : [];
  const events = Array.isArray(raw.favorites?.events) ? raw.favorites.events : [];
  base.favorites.teams = teams.filter(t => TEAM.test(String(t?.number))).slice(0, 200)
    .map(t => ({ number: String(t.number), name: clip(t.name, 80) }));
  base.favorites.events = events.filter(e => /^\d{1,10}$/.test(String(e?.id))).slice(0, 200)
    .map(e => ({ id: String(e.id), sku: clip(e.sku, 30), name: clip(e.name, 200), date: clip(e.date, 10) }));
  if (isObject(raw.notes)) {
    for (const [eventId, targets] of Object.entries(raw.notes)) {
      if (!/^\d{1,10}$/.test(eventId) || !isObject(targets)) continue;
      for (const [target, note] of Object.entries(targets)) {
        if (!/^(match:[\w.-]{1,40}|team:\d{1,6}[A-Z]{0,2})$/.test(target) || !isObject(note) || !note.text) continue;
        (base.notes[eventId] ??= {})[target] = { text: clip(note.text, MAX_NOTE), updatedAt: Number(note.updatedAt) || 0 };
      }
    }
  }
  if (isObject(raw.picklists)) {
    for (const [eventId, list] of Object.entries(raw.picklists)) {
      if (!/^\d{1,10}$/.test(eventId) || !Array.isArray(list)) continue;
      const seen = new Set();
      base.picklists[eventId] = list.filter(entry => TEAM.test(String(entry?.number)) && !seen.has(entry.number) && seen.add(entry.number))
        .slice(0, 120)
        .map(entry => ({ number: String(entry.number), tier: TIERS.includes(entry.tier) ? entry.tier : 'maybe', note: clip(entry.note, 300), picked: entry.picked === true }));
    }
  }
  if (isObject(raw.streams)) {
    for (const [eventId, stream] of Object.entries(raw.streams)) {
      if (!/^\d{1,10}$/.test(eventId) || !/^[\w-]{11}$/.test(String(stream?.videoId))) continue;
      const anchor = isObject(stream.anchor) && Number.isFinite(stream.anchor.seconds) ? { matchId: clip(stream.anchor.matchId, 20), seconds: Math.max(0, Math.round(stream.anchor.seconds)) } : null;
      base.streams[eventId] = { videoId: stream.videoId, anchor };
    }
  }
  base.myTeam = TEAM.test(String(raw.myTeam)) ? String(raw.myTeam) : '';
  return base;
}

// --- Changes (each returns a new state) -----------------------------------------

export function isFavorite(state, kind, key) {
  return kind === 'team'
    ? state.favorites.teams.some(t => t.number === String(key).toUpperCase())
    : state.favorites.events.some(e => e.id === String(key));
}

export function toggleFavorite(state, kind, item) {
  const favorites = { teams: [...state.favorites.teams], events: [...state.favorites.events] };
  if (kind === 'team') {
    const number = String(item.number).toUpperCase();
    favorites.teams = isFavorite(state, 'team', number)
      ? favorites.teams.filter(t => t.number !== number)
      : [...favorites.teams, { number, name: clip(item.name, 80) }];
  } else {
    const id = String(item.id);
    favorites.events = isFavorite(state, 'event', id)
      ? favorites.events.filter(e => e.id !== id)
      : [...favorites.events, { id, sku: clip(item.sku, 30), name: clip(item.name, 200), date: clip(item.date, 10) }];
  }
  return { ...state, favorites };
}

/** An empty note removes it. */
export function setNote(state, eventId, target, text, now = Date.now()) {
  const notes = { ...state.notes, [eventId]: { ...state.notes[eventId] } };
  const value = clip(text, MAX_NOTE).trim();
  if (value) notes[eventId][target] = { text: value, updatedAt: now };
  else delete notes[eventId][target];
  if (!Object.keys(notes[eventId]).length) delete notes[eventId];
  return { ...state, notes };
}

export function noteFor(state, eventId, target) {
  return state.notes[eventId]?.[target]?.text ?? '';
}

const withList = (state, eventId, list) => ({ ...state, picklists: { ...state.picklists, [eventId]: list } });
export const picklistOf = (state, eventId) => state.picklists[eventId] ?? [];

export function addToPicklist(state, eventId, number, tier = 'maybe') {
  const list = picklistOf(state, eventId);
  const key = String(number).toUpperCase();
  if (!TEAM.test(key) || list.some(entry => entry.number === key)) return state;
  return withList(state, eventId, [...list, { number: key, tier: TIERS.includes(tier) ? tier : 'maybe', note: '', picked: false }]);
}

export function removeFromPicklist(state, eventId, number) {
  return withList(state, eventId, picklistOf(state, eventId).filter(entry => entry.number !== number));
}

/** Move an entry from one position to another (both clamped to the list). */
export function movePick(state, eventId, from, to) {
  const list = [...picklistOf(state, eventId)];
  if (from < 0 || from >= list.length) return state;
  const [entry] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, entry);
  return withList(state, eventId, list);
}

export function updatePick(state, eventId, number, patch) {
  return withList(state, eventId, picklistOf(state, eventId).map(entry => entry.number !== number ? entry : {
    ...entry,
    ...(patch.tier && TIERS.includes(patch.tier) ? { tier: patch.tier } : {}),
    ...(patch.note != null ? { note: clip(patch.note, 300) } : {}),
    ...(patch.picked != null ? { picked: Boolean(patch.picked) } : {}),
  }));
}

export function setStream(state, eventId, stream) {
  const streams = { ...state.streams };
  if (stream) streams[eventId] = { videoId: stream.videoId, anchor: stream.anchor ?? null };
  else delete streams[eventId];
  return { ...state, streams };
}

export function setMyTeam(state, number) {
  const value = String(number ?? '').trim().toUpperCase();
  return { ...state, myTeam: TEAM.test(value) ? value : '' };
}

// --- The live store ------------------------------------------------------------------

/**
 * Storage can be missing or throw (private windows, blocked site data); the
 * store then keeps working for the visit and simply doesn't persist.
 */
export function createScoutStore(storage = globalThis.localStorage, target = globalThis) {
  let state;
  try { state = sanitizeScout(JSON.parse(storage?.getItem(SCOUT_KEY) ?? 'null')); } catch { state = emptyScout(); }
  const listeners = new Set();
  const emit = () => listeners.forEach(listener => listener(state));
  const store = {
    get: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** Apply a change; `change` is one of the functions above, partially applied. */
    update(change) {
      const next = change(state);
      if (next === state) return state;
      state = next;
      try { storage?.setItem(SCOUT_KEY, JSON.stringify(state)); } catch { /* kept for this visit */ }
      emit();
      return state;
    },
    /** Replace everything, e.g. with data synced from the reader's account. */
    replace(raw) { state = sanitizeScout(raw); try { storage?.setItem(SCOUT_KEY, JSON.stringify(state)); } catch {} emit(); },
  };
  // Another tab changed it: follow along.
  target?.addEventListener?.('storage', event => {
    if (event.key !== SCOUT_KEY) return;
    try { state = sanitizeScout(JSON.parse(event.newValue ?? 'null')); emit(); } catch {}
  });
  return store;
}

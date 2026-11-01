/**
 * Paka's memory, kept in this browser only. Storage can be missing or throw
 * (private windows, blocked site data), so every read falls back to a fresh
 * cat and every write is best-effort: Paka still works, it just forgets.
 */
import { moodAfterAway } from './brain.mjs';

export const STORAGE_KEY = 'vexrank-paka';
export const PALETTES = ['grey', 'orange', 'black', 'white', 'cream'];
export const PATTERNS = ['solid', 'tabby', 'tuxedo'];

const pick = (list, random) => list[Math.floor(random() * list.length) % list.length];

/** A new cat, with a coat picked at random so every visitor's Paka is their own. */
export function freshState(now = Date.now(), random = Math.random) {
  return {
    name: 'Paka',
    coat: { palette: pick(PALETTES, random), pattern: pick(PATTERNS, random) },
    mood: 75,
    pets: 0,
    firstSeen: now,
    lastSeen: now,
    hidden: false,
    reactions: true,
    following: [],
    // Distance from the bottom-right corner; the widget keeps it on screen.
    pos: { x: 0, y: 0 },
  };
}

/** Accept only the shapes this file writes; anything else becomes a fresh cat. */
export function sanitize(raw, now = Date.now(), random = Math.random) {
  const base = freshState(now, random);
  if (!raw || typeof raw !== 'object') return base;
  const coat = raw.coat ?? {};
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 20) : base.name,
    coat: {
      palette: PALETTES.includes(coat.palette) ? coat.palette : base.coat.palette,
      pattern: PATTERNS.includes(coat.pattern) ? coat.pattern : base.coat.pattern,
    },
    mood: Number.isFinite(raw.mood) ? Math.max(0, Math.min(100, raw.mood)) : base.mood,
    pets: Number.isFinite(raw.pets) && raw.pets >= 0 ? Math.floor(raw.pets) : 0,
    firstSeen: Number.isFinite(raw.firstSeen) ? raw.firstSeen : now,
    lastSeen: Number.isFinite(raw.lastSeen) ? raw.lastSeen : now,
    hidden: raw.hidden === true,
    reactions: raw.reactions !== false,
    following: Array.isArray(raw.following)
      ? raw.following
        .filter(entry => entry && typeof entry.number === 'string' && /^\d{1,6}[A-Z]{0,2}$/.test(entry.number))
        .slice(0, 50)
        .map(entry => ({ number: entry.number, matches: Number.isFinite(entry.matches) ? entry.matches : 0 }))
      : [],
    pos: {
      x: Number.isFinite(raw.pos?.x) ? Math.max(0, Math.min(10000, raw.pos.x)) : 0,
      y: Number.isFinite(raw.pos?.y) ? Math.max(0, Math.min(10000, raw.pos.y)) : 0,
    },
  };
}

/** Read the cat, letting its mood settle for the time the reader was away. */
export function loadState(storage = globalThis.localStorage, now = Date.now(), random = Math.random) {
  let raw = null;
  try { raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null'); } catch { raw = null; }
  const state = sanitize(raw, now, random);
  const hoursAway = (now - state.lastSeen) / 3600000;
  return { ...state, mood: moodAfterAway(state.mood, hoursAway), lastSeen: now };
}

export function saveState(state, storage = globalThis.localStorage) {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}

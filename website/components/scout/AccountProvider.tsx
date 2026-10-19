'use client';
/**
 * Signed-in state for the scouting tools: the session, syncing the reader's
 * scouting data to their account, their scouting groups, and the shared
 * picklist / notes of the active group for an event.
 *
 * Signed out, everything keeps working from this browser (ScoutProvider).
 * Signed in, the same data follows the reader across devices; with a group
 * selected, picklists and match notes are the group's, shared live.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { siteFetch, apiUrl } from '@/lib/client-fetch';
import { mergeScout, parseSignIn, sameScout } from '@/lib/scout/account.mjs';
import { useScout, type PickEntry } from './ScoutProvider';

const SESSION_KEY = 'vexrank-session';
const GROUP_KEY = 'vexrank-group';
const POLL_MS = 20_000;
const SYNC_DELAY_MS = 1500;

export type User = { id: string; name: string; avatar: string | null };
export type Group = { id: string; name: string; role: string; members?: number };
type Shared = { picklist: PickEntry[]; version: number; updatedBy: string | null; updatedAt: number; notes: { target: string; text: string; author: string; updatedAt: number }[] };

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string | null) => { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* this visit only */ } };

/**
 * Live cache of each group-and-event's shared data. However many components
 * watch one event (a page of match notes), there is one request in flight
 * and one 20-second refresh.
 */
class SharedEvents {
  data = new Map<string, Shared>();
  listeners = new Set<() => void>();
  inflight = new Map<string, Promise<void>>();
  watchers = new Map<string, { count: number; timer: number; loader: () => Promise<Shared> }>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  get = (key: string) => this.data.get(key);
  set(key: string, value: Shared) { this.data.set(key, value); this.listeners.forEach(listener => listener()); }
  fetch(key: string, loader: () => Promise<Shared>) {
    const running = this.inflight.get(key);
    if (running) return running;
    const request = loader().then(value => this.set(key, value)).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }
  watch(key: string, loader: () => Promise<Shared>) {
    let watcher = this.watchers.get(key);
    if (!watcher) {
      const entry = { count: 0, loader, timer: 0 };
      entry.timer = window.setInterval(() => { if (document.visibilityState === 'visible') this.fetch(key, entry.loader).catch(() => {}); }, POLL_MS);
      this.watchers.set(key, entry);
      watcher = entry;
      this.fetch(key, loader).catch(() => {});
    }
    watcher.count += 1;
    watcher.loader = loader;
    return () => {
      watcher.count -= 1;
      if (!watcher.count) { window.clearInterval(watcher.timer); this.watchers.delete(key); }
    };
  }
}

type AccountContext = {
  user: User | null;
  loading: boolean;
  groups: Group[];
  group: Group | null;
  setGroup: (id: string | null) => void;
  signIn: () => void;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  api: (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;
  refresh: () => Promise<void>;
  shared: SharedEvents;
  syncState: 'off' | 'saving' | 'saved' | 'error';
  notice: string;
  setNotice: (text: string) => void;
};
const Context = createContext<AccountContext | null>(null);

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) { super(message); }
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { store } = useScout();
  const [token, setToken] = useState<string | null>(() => typeof window === 'undefined' ? null : read(SESSION_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState<string | null>(() => typeof window === 'undefined' ? null : read(GROUP_KEY));
  const [syncState, setSyncState] = useState<AccountContext['syncState']>('off');
  // Discord sends a reader who cancelled back to #/?signin=failed.
  const [notice, setNotice] = useState(() => typeof window !== 'undefined' && window.location.hash.startsWith('#/?signin=failed') ? 'Sign-in did not complete. Please try again.' : '');
  const [shared] = useState(() => new SharedEvents());
  const lastSynced = useRef<any>(null);

  const api = useCallback(async (path: string, init: { method?: string; body?: unknown } = {}) => {
    const response = await siteFetch(path, {
      method: init.method ?? 'GET',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const body: any = await response.json().catch(() => ({}));
    if (response.status === 401 && token) { write(SESSION_KEY, null); setToken(null); setUser(null); }
    if (!response.ok) throw new ApiError(response.status, body.error ?? `Request failed (${response.status})`, body);
    return body;
  }, [token]);

  // Coming back from Discord: #/signed-in/<code>?return=… Runs before the page's
  // router reads the address, so the reader lands where they started.
  useEffect(() => {
    const signIn = parseSignIn(window.location.hash);
    if (window.location.hash.startsWith('#/?signin=failed')) window.history.replaceState(null, '', '#/');
    if (!signIn) return;
    window.history.replaceState(null, '', signIn.returnTo);
    siteFetch('/api/auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: signIn.code }) })
      .then(r => r.json().then((body: any) => r.ok ? body : Promise.reject(new Error(body.error))))
      .then(({ token: session }: any) => { write(SESSION_KEY, session); setToken(session); setLoading(true); })
      .catch(error => setNotice(error.message || 'Sign-in failed. Please try again.'));
  }, []);

  const refresh = useCallback(async () => {
    if (!token) return;
    const me = await api('/api/me');
    setUser(me.user);
    setGroups(me.groups);
  }, [api, token]);

  // Who is signed in, then merge this browser's scouting data with the account's.
  useEffect(() => {
    // Signing out, deleting and an expired session each clear the account state themselves.
    if (!token) return;
    let active = true;
    void (async () => {
      try {
        const me = await api('/api/me');
        if (!active) return;
        setUser(me.user); setGroups(me.groups);
        const remote = await api('/api/me/data');
        const merged = mergeScout(store.get(), remote.data);
        store.replace(merged);
        lastSynced.current = merged;
        if (!remote.data || !sameScout(merged, remote.data)) await api('/api/me/data', { method: 'PUT', body: { data: merged } });
        if (active) setSyncState('saved');
      } catch {
        if (active) setSyncState('error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [token, api, store]);

  // Keep the account up to date as the reader changes things (debounced).
  useEffect(() => {
    if (!user) return;
    let timer = 0;
    const stop = store.subscribe((state: any) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (lastSynced.current && sameScout(state, lastSynced.current)) return;
        setSyncState('saving');
        api('/api/me/data', { method: 'PUT', body: { data: state } })
          .then(() => { lastSynced.current = state; setSyncState('saved'); })
          .catch(() => setSyncState('error'));
      }, SYNC_DELAY_MS);
    });
    return () => { stop(); window.clearTimeout(timer); };
  }, [user, store, api]);

  const group = groups.find(g => g.id === groupId) ?? null;
  const setGroup = useCallback((id: string | null) => { write(GROUP_KEY, id); setGroupId(id); }, []);

  const signIn = useCallback(() => {
    window.location.assign(apiUrl(`/api/auth/discord?return=${encodeURIComponent(window.location.hash || '#/')}`));
  }, []);
  const signOut = useCallback(async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* signed out locally either way */ }
    write(SESSION_KEY, null); setToken(null); setUser(null); setGroups([]); setGroup(null); setSyncState('off');
  }, [api, setGroup]);
  const deleteAccount = useCallback(async () => {
    await api('/api/me', { method: 'DELETE' });
    write(SESSION_KEY, null); setToken(null); setUser(null); setGroups([]); setGroup(null); setSyncState('off');
    setNotice('Your account and everything saved to it have been deleted. Data in this browser is untouched.');
  }, [api, setGroup]);

  const value = useMemo<AccountContext>(() => ({
    user, loading, groups, group, setGroup, signIn, signOut, deleteAccount, api, refresh, shared, syncState, notice, setNotice,
  }), [user, loading, groups, group, setGroup, signIn, signOut, deleteAccount, api, refresh, shared, syncState, notice]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAccount() {
  const value = useContext(Context);
  if (!value) throw new Error('useAccount must be used inside AccountProvider');
  return value;
}

/**
 * The active group's picklist and notes for one event, refreshed every 20
 * seconds while the page is visible. Null when no group is selected.
 */
export function useSharedEvent(eventId: string) {
  const { group, api, shared, user } = useAccount();
  const key = group && user ? `${group.id}:${eventId}` : '';
  const data = useSyncExternalStore(shared.subscribe, () => key ? shared.get(key) : undefined, () => undefined);
  const loader = useCallback(() => api(`/api/groups/${group?.id}/events/${eventId}`) as Promise<Shared>, [api, group?.id, eventId]);
  const load = useCallback(() => key ? shared.fetch(key, loader) : Promise.resolve(), [key, loader, shared]);
  useEffect(() => key ? shared.watch(key, loader) : undefined, [key, loader, shared]);
  if (!key || !group) return null;
  return { group, data: data ?? null, reload: load, key };
}

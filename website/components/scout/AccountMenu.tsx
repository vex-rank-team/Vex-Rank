'use client';
/**
 * The header's account control: "Sign in with Discord" when signed out;
 * otherwise a menu with the reader's scouting groups (choose, create, join,
 * invite code, leave), sync status, privacy, sign out and delete account.
 * Also the up/down vote buttons used on team and event pages.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LogOut, RefreshCw, ThumbsDown, ThumbsUp, Trash2, Users, X } from 'lucide-react';
import { useAccount, type Group } from './AccountProvider';
import { assetUrl } from '@/lib/client-fetch';

const DISCORD_PATH = 'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';
const avatarUrl = (user: { id: string; avatar: string | null }) => user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
/** A Discord avatar, or the first letter of the name. Decorative: the name is always beside it. */
function Avatar({ user, size }: { user: { id: string; name: string; avatar: string | null }; size: number }) {
  const url = avatarUrl(user);
  return <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-[var(--c-accent)] bg-cover bg-center text-[11px] font-bold text-white"
    style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined }}>{url ? '' : user.name[0]}</span>;
}

const field = 'h-9 min-w-0 flex-1 border-b border-white/15 bg-transparent text-sm text-white placeholder:text-white/30 focus:border-[var(--c-accent)] focus:outline-none';

function GroupDetails({ group }: { group: Group }) {
  const { api, refresh, setGroup, setNotice } = useAccount();
  const [details, setDetails] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    api(`/api/groups/${group.id}`).then(data => { if (active) setDetails(data); }).catch(() => {});
    return () => { active = false; };
  }, [api, group.id]);
  const copy = async () => { try { await navigator.clipboard.writeText(details.inviteCode); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* shown on screen anyway */ } };
  return <div className="mt-2 border border-white/10 p-3 text-xs">
    {details ? <>
      <p className="text-white/45">Invite code: share it with your team</p>
      <div className="mt-1 flex items-center gap-2"><code className="font-mono text-base tracking-[.2em] text-white">{details.inviteCode}</code>
        <button onClick={copy} aria-label="Copy invite code" className="text-white/50 hover:text-white">{copied ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}</button>
        {details.role === 'owner' && <button onClick={async () => { const r = await api(`/api/groups/${group.id}/rotate`, { method: 'POST' }); setDetails({ ...details, inviteCode: r.inviteCode }); }} title="Make a new code; the old one stops working" aria-label="New invite code" className="text-white/50 hover:text-white"><RefreshCw className="h-3.5 w-3.5" /></button>}</div>
      <p className="mt-3 text-white/45">{details.members.length} member{details.members.length === 1 ? '' : 's'}</p>
      <ul className="mt-1 space-y-1">{details.members.map((m: any) => <li key={m.id} className="flex items-center gap-2"><Avatar user={m} size={18} /><span className="text-white/80">{m.name}</span>{m.role === 'owner' && <span className="text-[10px] text-white/35">owner</span>}</li>)}</ul>
      <button onClick={async () => { await api(`/api/groups/${group.id}/leave`, { method: 'POST' }); setGroup(null); await refresh(); setNotice(`You left ${group.name}.`); }} className="mt-3 text-white/45 hover:text-rose-300">Leave group</button>
    </> : <p className="text-white/40">Loading…</p>}
  </div>;
}

export function AccountMenu() {
  const { user, loading, groups, group, setGroup, signIn, signOut, deleteAccount, api, refresh, syncState, notice, setNotice } = useAccount();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer, true); window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer, true); window.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 7000); return () => window.clearTimeout(timer); }, [notice, setNotice]);

  const toast = notice ? <div role="alert" className="fixed left-1/2 top-20 z-[80] w-[min(92vw,30rem)] -translate-x-1/2 border border-white/15 bg-[var(--c-surface-2)] px-4 py-3 text-sm shadow-2xl"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss" className="float-right ml-3 text-white/45 hover:text-white"><X className="h-4 w-4" /></button></div> : null;

  if (!user) return <>{toast}<button type="button" onClick={signIn} disabled={loading} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-[#5865F2] px-3.5 text-xs font-semibold text-white hover:bg-[#4752c4] disabled:opacity-50">
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="currentColor"><path d={DISCORD_PATH} /></svg>{loading ? 'Signing in…' : 'Sign in'}
  </button></>;

  const act = async (work: () => Promise<void>) => { setError(''); try { await work(); } catch (e: any) { setError(e.message || 'Something went wrong.'); } };
  return <div ref={panel} className="relative">
    {toast}
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} aria-haspopup="menu" aria-label={`Account: ${user.name}`} className="flex h-9 items-center gap-2 rounded-full border border-white/15 pl-1 pr-2.5 text-xs text-white/75 hover:border-white/35">
      <Avatar user={user} size={26} />
      <span className="hidden max-w-28 truncate sm:inline">{group ? group.name : user.name}</span><ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-80 border border-white/15 bg-[var(--c-surface-2)] p-4 text-sm shadow-2xl">
      <p className="font-semibold">{user.name}</p>
      <p className="text-xs text-white/45">Signed in with Discord · {syncState === 'saving' ? 'saving…' : syncState === 'saved' ? 'synced' : syncState === 'error' ? 'sync failed, retrying on your next change' : ''}</p>

      <p className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/45"><Users className="h-3.5 w-3.5" />Scouting group</p>
      <p className="mt-1 text-xs text-white/40">Picklists and match notes are shared with the group you choose.</p>
      <div className="mt-2 space-y-1">
        <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="scout-group" checked={!group} onChange={() => setGroup(null)} className="accent-[var(--c-accent)]" />Just me</label>
        {groups.map(g => <label key={g.id} className="flex cursor-pointer items-center gap-2"><input type="radio" name="scout-group" checked={group?.id === g.id} onChange={() => setGroup(g.id)} className="accent-[var(--c-accent)]" />{g.name}<span className="text-xs text-white/35">{g.members} member{g.members === 1 ? '' : 's'}</span></label>)}
      </div>
      {group && <GroupDetails key={group.id} group={group} />}
      <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); void act(async () => { const g = await api('/api/groups', { method: 'POST', body: { name } }); setName(''); await refresh(); setGroup(g.id); }); }}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={40} placeholder="New group, e.g. 55288A scouts" aria-label="New group name" className={field} />
        <button type="submit" disabled={!name.trim()} className="bg-[var(--c-accent)] px-3 text-xs font-semibold text-white disabled:opacity-40">Create</button>
      </form>
      <form className="mt-2 flex gap-2" onSubmit={event => { event.preventDefault(); void act(async () => { const g = await api('/api/groups/join', { method: 'POST', body: { code } }); setCode(''); await refresh(); setGroup(g.id); }); }}>
        <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={9} placeholder="Invite code" aria-label="Invite code" className={`${field} font-mono tracking-widest`} />
        <button type="submit" disabled={code.replace(/[^A-Z0-9]/g, '').length !== 8} className="border border-white/20 px-3 text-xs font-semibold text-white/80 disabled:opacity-40">Join</button>
      </form>
      {error && <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p>}

      <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-xs">
        <a href={assetUrl('/privacy.html')} className="text-white/45 hover:text-white">Privacy</a>
        <button onClick={() => { setOpen(false); void signOut(); }} className="inline-flex items-center gap-1 text-white/60 hover:text-white"><LogOut className="h-3.5 w-3.5" />Sign out</button>
      </div>
      {!confirmDelete ? <button onClick={() => setConfirmDelete(true)} className="mt-2 inline-flex items-center gap-1 text-xs text-white/35 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" />Delete my account</button>
        : <div className="mt-2 border border-rose-400/30 p-2 text-xs"><p className="text-rose-200">Delete your account, synced data, votes and group memberships? Groups you own pass to another member. This can&rsquo;t be undone.</p>
          <div className="mt-2 flex gap-3"><button onClick={() => void act(async () => { await deleteAccount(); setOpen(false); })} className="font-semibold text-rose-300">Delete everything</button><button onClick={() => setConfirmDelete(false)} className="text-white/50">Cancel</button></div></div>}
    </div>}
  </div>;
}

/** Up and down votes on a team or event; signed-out readers see the score and a prompt. */
export function VoteButtons({ target }: { target: string }) {
  const { user, api, signIn } = useAccount();
  const [votes, setVotes] = useState<{ score: number; mine: number } | null>(null);
  useEffect(() => {
    let active = true;
    api(`/api/votes?target=${encodeURIComponent(target)}`).then(v => { if (active) setVotes(v); }).catch(() => {});
    return () => { active = false; };
  }, [api, target, user]);
  const vote = async (value: number) => {
    if (!user) { signIn(); return; }
    const next = votes?.mine === value ? 0 : value;
    try { setVotes(await api('/api/votes', { method: 'PUT', body: { target, value: next } })); } catch { /* unchanged */ }
  };
  const button = (value: number, Icon: typeof ThumbsUp, label: string) => <button type="button" onClick={() => void vote(value)} aria-pressed={votes?.mine === value} aria-label={user ? label : `Sign in to ${label.toLowerCase()}`} title={user ? label : 'Sign in to vote'}
    className={`grid h-7 w-7 place-items-center rounded ${votes?.mine === value ? 'text-[var(--c-accent)]' : 'text-white/45 hover:text-white'}`}><Icon className="h-4 w-4" aria-hidden="true" /></button>;
  return <span className="inline-flex items-center border border-white/15">{button(1, ThumbsUp, 'Upvote')}<span className="min-w-6 text-center font-mono text-xs text-white/75" aria-label="Score">{votes ? votes.score : '·'}</span>{button(-1, ThumbsDown, 'Downvote')}</span>;
}

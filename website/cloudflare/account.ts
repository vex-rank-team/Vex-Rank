/**
 * Accounts for vex-rank.com: Discord sign-in, the reader's synced scouting
 * data, scouting groups that share picklists and match notes, and votes.
 *
 * Sign-in: /api/auth/discord sends the reader to Discord (scope `identify`
 * only: id, name, avatar, no email). The callback swaps Discord's code for a
 * one-time login code and sends the reader back to the site, which trades
 * that code for a session token (POST /api/auth/exchange). The site and API
 * are on different origins, so the token is sent as a Bearer header rather
 * than a cookie. Tokens and codes are stored only as SHA-256 hashes.
 */

export interface AccountEnv {
  DB: D1Database;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  /** Where readers are sent back to after signing in. */
  SITE_ORIGIN?: string;
}

const SESSION_DAYS = 30;
const STATE_MINUTES = 10;
const CODE_MINUTES = 2;
const MAX_BODY = 200_000;
const MAX_GROUPS = 10;
const TEAM = /^\d{1,6}[A-Z]{0,2}$/;
const EVENT_ID = /^\d{1,10}$/;
const NOTE_TARGET = /^(match:[\w.-]{1,40}|team:\d{1,6}[A-Z]{0,2})$/;
const VOTE_TARGET = /^(team:\d{1,6}[A-Z]{0,2}|event:\d{1,10})$/;
const TIERS = new Set(['first', 'second', 'maybe', 'avoid']);

// --- Helpers -----------------------------------------------------------------------

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const fail = (status: number, error: string) => json({ error }, status);

function randomToken(bytes = 32) {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** An invite code people can read out loud: no 0/O or 1/I/L. */
export function inviteCode(random = (n: number) => crypto.getRandomValues(new Uint8Array(n))) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return [...random(8)].map(b => alphabet[b % alphabet.length]).join('');
}

/** Only same-site hash routes may be returned to after sign-in: no open redirects. */
export function safeReturn(value: string | null) {
  return value && /^#\/[\w/.-]{0,200}$/.test(value) ? value : '#/';
}

async function readJson(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too large');
  return text ? JSON.parse(text) : {};
}

type User = { id: string; name: string; avatar: string | null };

async function currentUser(request: Request, env: AccountEnv): Promise<User | null> {
  const header = request.headers.get('Authorization') ?? '';
  const token = header.match(/^Bearer ([\w-]{20,100})$/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare('SELECT u.id, u.name, u.avatar, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(await sha256(token)).first<{ id: string; name: string; avatar: string | null; expires_at: number }>();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, name: row.name, avatar: row.avatar };
}

async function membership(env: AccountEnv, groupId: string, userId: string) {
  return env.DB.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, userId).first<{ role: string }>();
}

// --- Validation of what readers send -----------------------------------------------------

/** A picklist from the client, cleaned the same way the browser store cleans it. */
export function cleanPicklist(list: unknown) {
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  return list.filter((entry: any) => TEAM.test(String(entry?.number)) && !seen.has(entry.number) && seen.add(entry.number))
    .slice(0, 120)
    .map((entry: any) => ({ number: String(entry.number), tier: TIERS.has(entry.tier) ? entry.tier : 'maybe', note: String(entry.note ?? '').slice(0, 300), picked: entry.picked === true }));
}

// --- Routes ------------------------------------------------------------------------------------

/**
 * Handle an account route, or return null if `path` isn't one. Routes:
 *   GET  /api/auth/discord?return=#/...        start sign-in
 *   GET  /api/auth/discord/callback            Discord sends the reader here
 *   POST /api/auth/exchange {code}             login code → session token
 *   POST /api/auth/logout
 *   GET  /api/me                               the reader and their groups
 *   DELETE /api/me                             delete the account and everything in it
 *   GET/PUT /api/me/data                       the reader's synced scouting data
 *   POST /api/groups {name}                    create a scouting group
 *   POST /api/groups/join {code}
 *   GET  /api/groups/:id                       members and invite code
 *   POST /api/groups/:id/leave
 *   POST /api/groups/:id/rotate                new invite code (owner)
 *   GET  /api/groups/:id/events/:event         the group's picklist and notes
 *   PUT  /api/groups/:id/events/:event/picklist {list, version}
 *   PUT  /api/groups/:id/events/:event/notes {target, text}
 *   GET  /api/votes?target=team:1A             score, and the reader's own vote
 *   PUT  /api/votes {target, value}
 */
export async function handleAccount(request: Request, env: AccountEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!/^\/api\/(auth|me|groups|votes)(\/|$)/.test(path)) return null;
  const method = request.method;
  const now = Date.now();
  try {
    // --- Sign-in ---
    if (path === '/api/auth/discord' && method === 'GET') {
      if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) return fail(503, 'Sign-in is not set up yet.');
      const state = randomToken(24);
      await env.DB.prepare('INSERT INTO oauth_states(state, return_to, expires_at) VALUES(?,?,?)').bind(state, safeReturn(url.searchParams.get('return')), now + STATE_MINUTES * 60_000).run();
      const authorize = new URL('https://discord.com/oauth2/authorize');
      authorize.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', scope: 'identify', state, redirect_uri: `${url.origin}/api/auth/discord/callback`, prompt: 'none' }).toString();
      return Response.redirect(authorize.toString(), 302);
    }
    if (path === '/api/auth/discord/callback' && method === 'GET') {
      const site = env.SITE_ORIGIN ?? 'https://vex-rank.com';
      const back = (hash: string) => Response.redirect(`${site}/${hash}`, 302);
      const state = url.searchParams.get('state') ?? '';
      const saved = await env.DB.prepare('SELECT return_to, expires_at FROM oauth_states WHERE state = ?').bind(state).first<{ return_to: string; expires_at: number }>();
      if (saved) await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?').bind(state).run();
      const code = url.searchParams.get('code');
      if (!saved || saved.expires_at < now || !code) return back('#/?signin=failed');
      const token = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID!, client_secret: env.DISCORD_CLIENT_SECRET!, grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/api/auth/discord/callback` }),
      });
      if (!token.ok) return back('#/?signin=failed');
      const { access_token } = await token.json() as { access_token: string };
      const me = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
      if (!me.ok) return back('#/?signin=failed');
      const discord = await me.json() as { id: string; username: string; global_name?: string | null; avatar?: string | null };
      if (!/^\d{5,25}$/.test(discord.id)) return back('#/?signin=failed');
      const name = String(discord.global_name || discord.username || 'Scout').slice(0, 40);
      await env.DB.prepare('INSERT INTO users(id, name, avatar, created_at, seen_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, seen_at=excluded.seen_at')
        .bind(discord.id, name, discord.avatar && /^(a_)?[0-9a-f]{32}$/.test(discord.avatar) ? discord.avatar : null, now, now).run();
      const login = randomToken(24);
      await env.DB.prepare('INSERT INTO login_codes(code_hash, user_id, expires_at) VALUES(?,?,?)').bind(await sha256(login), discord.id, now + CODE_MINUTES * 60_000).run();
      // The code rides in the URL fragment, which browsers never send to a server.
      return back(`#/signed-in/${login}?return=${encodeURIComponent(saved.return_to)}`);
    }
    if (path === '/api/auth/exchange' && method === 'POST') {
      const { code } = await readJson(request);
      if (typeof code !== 'string' || !/^[\w-]{20,60}$/.test(code)) return fail(400, 'Invalid sign-in code.');
      const hash = await sha256(code);
      const row = await env.DB.prepare('SELECT user_id, expires_at FROM login_codes WHERE code_hash = ?').bind(hash).first<{ user_id: string; expires_at: number }>();
      await env.DB.prepare('DELETE FROM login_codes WHERE code_hash = ? OR expires_at < ?').bind(hash, now).run();
      if (!row || row.expires_at < now) return fail(400, 'This sign-in link has expired. Please sign in again.');
      const session = randomToken(32);
      await env.DB.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?,?,?)').bind(await sha256(session), row.user_id, now + SESSION_DAYS * 86_400_000).run();
      const user = await env.DB.prepare('SELECT id, name, avatar FROM users WHERE id = ?').bind(row.user_id).first<User>();
      return json({ token: session, user });
    }

    // Everything below needs a signed-in reader, except reading vote totals.
    const user = await currentUser(request, env);
    if (path === '/api/votes' && method === 'GET') {
      const target = url.searchParams.get('target') ?? '';
      if (!VOTE_TARGET.test(target)) return fail(400, 'Unknown vote target.');
      const total = await env.DB.prepare('SELECT COALESCE(SUM(value), 0) AS score, COUNT(*) AS count FROM votes WHERE target = ?').bind(target).first<{ score: number; count: number }>();
      const mine = user ? await env.DB.prepare('SELECT value FROM votes WHERE user_id = ? AND target = ?').bind(user.id, target).first<{ value: number }>() : null;
      return json({ target, score: Number(total?.score ?? 0), count: Number(total?.count ?? 0), mine: mine?.value ?? 0 });
    }
    if (!user) return fail(401, 'Please sign in.');

    if (path === '/api/auth/logout' && method === 'POST') {
      const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at < ?').bind(await sha256(token), now).run();
      return json({ ok: true });
    }
    if (path === '/api/me' && method === 'GET') {
      const groups = await env.DB.prepare('SELECT g.id, g.name, m.role, (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) AS members FROM group_members m JOIN scout_groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY m.joined_at').bind(user.id).all();
      return json({ user, groups: groups.results });
    }
    if (path === '/api/me' && method === 'DELETE') {
      // Groups the reader owns pass to the longest-standing other member, or go if empty.
      const owned = (await env.DB.prepare('SELECT group_id FROM group_members WHERE user_id = ? AND role = ?').bind(user.id, 'owner').all<{ group_id: string }>()).results;
      for (const { group_id } of owned) await handOver(env, group_id, user.id);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM group_members WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM votes WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM user_data WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM login_codes WHERE user_id = ?').bind(user.id),
        env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      ]);
      return json({ deleted: true });
    }
    if (path === '/api/me/data' && method === 'GET') {
      const row = await env.DB.prepare('SELECT body, updated_at FROM user_data WHERE user_id = ?').bind(user.id).first<{ body: string; updated_at: number }>();
      return json({ data: row ? JSON.parse(row.body) : null, updatedAt: row?.updated_at ?? 0 });
    }
    if (path === '/api/me/data' && method === 'PUT') {
      const { data } = await readJson(request);
      if (!data || typeof data !== 'object') return fail(400, 'Expected scouting data.');
      // The browser sanitises it before every use; here we bound what we keep.
      const body = JSON.stringify(data);
      if (body.length > MAX_BODY) return fail(413, 'Scouting data is too large to sync.');
      await env.DB.prepare('INSERT INTO user_data(user_id, body, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET body=excluded.body, updated_at=excluded.updated_at').bind(user.id, body, now).run();
      return json({ updatedAt: now });
    }

    if (path === '/api/votes' && method === 'PUT') {
      const { target, value } = await readJson(request);
      if (!VOTE_TARGET.test(String(target)) || ![-1, 0, 1].includes(value)) return fail(400, 'A vote is -1, 0 or 1 on a team or event.');
      if (value === 0) await env.DB.prepare('DELETE FROM votes WHERE user_id = ? AND target = ?').bind(user.id, target).run();
      else await env.DB.prepare('INSERT INTO votes(user_id, target, value) VALUES(?,?,?) ON CONFLICT(user_id, target) DO UPDATE SET value=excluded.value').bind(user.id, target, value).run();
      const total = await env.DB.prepare('SELECT COALESCE(SUM(value), 0) AS score, COUNT(*) AS count FROM votes WHERE target = ?').bind(target).first<{ score: number; count: number }>();
      return json({ target, score: Number(total?.score ?? 0), count: Number(total?.count ?? 0), mine: value });
    }

    // --- Scouting groups ---
    if (path === '/api/groups' && method === 'POST') {
      const { name } = await readJson(request);
      const clean = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      if (!clean) return fail(400, 'Give the group a name.');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?').bind(user.id).first<{ n: number }>();
      if (Number(count?.n ?? 0) >= MAX_GROUPS) return fail(409, `You can be in at most ${MAX_GROUPS} groups.`);
      const id = randomToken(12);
      const code = inviteCode();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO scout_groups(id, name, invite_code, created_by, created_at) VALUES(?,?,?,?,?)').bind(id, clean, code, user.id, now),
        env.DB.prepare('INSERT INTO group_members(group_id, user_id, role, joined_at) VALUES(?,?,?,?)').bind(id, user.id, 'owner', now),
      ]);
      return json({ id, name: clean, inviteCode: code, role: 'owner' }, 201);
    }
    if (path === '/api/groups/join' && method === 'POST') {
      const { code } = await readJson(request);
      const wanted = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const group = /^[A-Z0-9]{8}$/.test(wanted) ? await env.DB.prepare('SELECT id, name FROM scout_groups WHERE invite_code = ?').bind(wanted).first<{ id: string; name: string }>() : null;
      if (!group) return fail(404, 'No group has that invite code.');
      const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE user_id = ?').bind(user.id).first<{ n: number }>();
      if (!(await membership(env, group.id, user.id)) && Number(count?.n ?? 0) >= MAX_GROUPS) return fail(409, `You can be in at most ${MAX_GROUPS} groups.`);
      await env.DB.prepare('INSERT INTO group_members(group_id, user_id, role, joined_at) VALUES(?,?,?,?) ON CONFLICT(group_id, user_id) DO NOTHING').bind(group.id, user.id, 'member', now).run();
      return json({ id: group.id, name: group.name, role: (await membership(env, group.id, user.id))?.role });
    }

    const match = path.match(/^\/api\/groups\/([\w-]{8,40})(\/.*)?$/);
    if (!match) return fail(404, 'Unknown account route.');
    const [, groupId, rest = ''] = match;
    const role = (await membership(env, groupId, user.id))?.role;
    // Not a member: the same answer whether or not the group exists.
    if (!role) return fail(404, 'Group not found.');

    if (rest === '' && method === 'GET') {
      const group = await env.DB.prepare('SELECT id, name, invite_code AS inviteCode, created_at AS createdAt FROM scout_groups WHERE id = ?').bind(groupId).first();
      const members = await env.DB.prepare('SELECT u.id, u.name, u.avatar, m.role FROM group_members m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.joined_at').bind(groupId).all();
      return json({ ...group, role, members: members.results });
    }
    if (rest === '/leave' && method === 'POST') {
      if (role === 'owner') await handOver(env, groupId, user.id);
      await env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, user.id).run();
      return json({ left: true });
    }
    if (rest === '/rotate' && method === 'POST') {
      if (role !== 'owner') return fail(403, 'Only the group owner can change the invite code.');
      const code = inviteCode();
      await env.DB.prepare('UPDATE scout_groups SET invite_code = ? WHERE id = ?').bind(code, groupId).run();
      return json({ inviteCode: code });
    }

    const eventMatch = rest.match(/^\/events\/(\d{1,10})(\/picklist|\/notes)?$/);
    if (!eventMatch || !EVENT_ID.test(eventMatch[1])) return fail(404, 'Unknown group route.');
    const [, eventId, part] = eventMatch;
    if (!part && method === 'GET') {
      const pick = await env.DB.prepare('SELECT p.body, p.version, p.updated_at AS updatedAt, u.name AS updatedBy FROM group_picklists p LEFT JOIN users u ON u.id = p.updated_by WHERE p.group_id = ? AND p.event_id = ?').bind(groupId, eventId).first<{ body: string; version: number; updatedAt: number; updatedBy: string }>();
      const notes = await env.DB.prepare('SELECT n.target, n.body AS text, n.updated_at AS updatedAt, u.name AS author FROM group_notes n LEFT JOIN users u ON u.id = n.updated_by WHERE n.group_id = ? AND n.event_id = ?').bind(groupId, eventId).all();
      return json({ picklist: pick ? JSON.parse(pick.body) : [], version: pick?.version ?? 0, updatedAt: pick?.updatedAt ?? 0, updatedBy: pick?.updatedBy ?? null, notes: notes.results });
    }
    if (part === '/picklist' && method === 'PUT') {
      const { list, version } = await readJson(request);
      const clean = cleanPicklist(list);
      if (!clean || !Number.isInteger(version)) return fail(400, 'Expected a picklist and the version it was based on.');
      // Optimistic concurrency: write only if nobody else changed it since the reader loaded it.
      const result = version === 0
        ? await env.DB.prepare('INSERT INTO group_picklists(group_id, event_id, body, version, updated_by, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(group_id, event_id) DO NOTHING').bind(groupId, eventId, JSON.stringify(clean), 1, user.id, now).run()
        : await env.DB.prepare('UPDATE group_picklists SET body = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE group_id = ? AND event_id = ? AND version = ?').bind(JSON.stringify(clean), user.id, now, groupId, eventId, version).run();
      const current = await env.DB.prepare('SELECT body, version FROM group_picklists WHERE group_id = ? AND event_id = ?').bind(groupId, eventId).first<{ body: string; version: number }>();
      if (!result.meta.changes) return json({ error: 'Someone else changed the picklist. Here is the latest.', picklist: JSON.parse(current?.body ?? '[]'), version: current?.version ?? 0 }, 409);
      return json({ picklist: clean, version: current?.version ?? version + 1, updatedAt: now, updatedBy: user.name });
    }
    if (part === '/notes' && method === 'PUT') {
      const { target, text } = await readJson(request);
      if (!NOTE_TARGET.test(String(target))) return fail(400, 'Unknown note target.');
      const value = String(text ?? '').slice(0, 2000).trim();
      if (!value) await env.DB.prepare('DELETE FROM group_notes WHERE group_id = ? AND event_id = ? AND target = ?').bind(groupId, eventId, target).run();
      else await env.DB.prepare('INSERT INTO group_notes(group_id, event_id, target, body, updated_by, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(group_id, event_id, target) DO UPDATE SET body=excluded.body, updated_by=excluded.updated_by, updated_at=excluded.updated_at').bind(groupId, eventId, target, value, user.id, now).run();
      return json({ target, text: value, updatedAt: now, author: user.name });
    }
    return fail(405, 'Method not allowed.');
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === 'too large')) return fail(400, 'The request body could not be read.');
    console.error('account route failed', error instanceof Error ? error.message : 'unknown');
    return fail(500, 'Something went wrong. Please retry.');
  }
}

/** Give an owner's group to its longest-standing other member, or delete it if there is none. */
async function handOver(env: AccountEnv, groupId: string, ownerId: string) {
  const next = await env.DB.prepare('SELECT user_id FROM group_members WHERE group_id = ? AND user_id != ? ORDER BY joined_at LIMIT 1').bind(groupId, ownerId).first<{ user_id: string }>();
  if (next) {
    await env.DB.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').bind('owner', groupId, next.user_id).run();
    return;
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM group_picklists WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM group_notes WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(groupId),
    env.DB.prepare('DELETE FROM scout_groups WHERE id = ?').bind(groupId),
  ]);
}

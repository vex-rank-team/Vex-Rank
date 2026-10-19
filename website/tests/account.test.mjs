import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAccount, safeReturn, inviteCode, cleanPicklist, sha256 } from '../cloudflare/account.ts';

// A Cloudflare D1 stand-in over Node's built-in SQLite, with the real schema.
class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes) } }; }
}
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  return { prepare: sql => new Statement(db, sql), batch: async statements => { for (const s of statements) await s.run(); }, raw: db };
}

const API = 'https://api.example.workers.dev';
function setup() {
  const env = { DB: database(), DISCORD_CLIENT_ID: 'client-1', DISCORD_CLIENT_SECRET: 'secret-1', SITE_ORIGIN: 'https://vex-rank.com' };
  const call = (method, path, { token, body } = {}) => handleAccount(new Request(API + path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, redirect: 'manual',
  }), env);
  return { env, call };
}

/** Run the whole Discord flow for one Discord account; returns its session token. */
async function signIn(call, discordUser, returnTo = '#/events') {
  const start = await call('GET', `/api/auth/discord?return=${encodeURIComponent(returnTo)}`);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/oauth2/token')
    ? Response.json({ access_token: 'discord-access' })
    : Response.json(discordUser);
  try {
    const back = await call('GET', `/api/auth/discord/callback?code=abc&state=${state}`);
    const fragment = new URL(back.headers.get('Location')).hash;
    const code = fragment.match(/^#\/signed-in\/([\w-]+)/)[1];
    const exchanged = await call('POST', '/api/auth/exchange', { body: { code } });
    return { ...(await exchanged.json()), fragment, code };
  } finally { globalThis.fetch = realFetch; }
}

test('sign-in starts at Discord with the identify scope only', async () => {
  const { call, env } = setup();
  const response = await call('GET', '/api/auth/discord?return=%23%2Fteams%2F1698Z');
  assert.equal(response.status, 302);
  const to = new URL(response.headers.get('Location'));
  assert.equal(to.origin + to.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(to.searchParams.get('scope'), 'identify');
  assert.equal(to.searchParams.get('redirect_uri'), `${API}/api/auth/discord/callback`);
  const saved = env.DB.raw.prepare('SELECT return_to FROM oauth_states').get();
  assert.equal(saved.return_to, '#/teams/1698Z');
  delete env.DISCORD_CLIENT_SECRET;
  assert.equal((await call('GET', '/api/auth/discord')).status, 503, 'refuses until configured');
});

test('the full sign-in flow, and codes work once', async () => {
  const { call, env } = setup();
  const { token, user, fragment, code } = await signIn(call, { id: '123456789', username: 'steven', global_name: 'Steven', avatar: 'a'.repeat(32) });
  assert.match(fragment, /^#\/signed-in\/[\w-]+\?return=%23%2Fevents$/);
  assert.ok(token.length >= 40);
  assert.deepEqual(user, { id: '123456789', name: 'Steven', avatar: 'a'.repeat(32) });
  assert.equal((await call('POST', '/api/auth/exchange', { body: { code } })).status, 400, 'a login code is single-use');
  const stored = env.DB.raw.prepare('SELECT token_hash FROM sessions').get();
  assert.equal(stored.token_hash, await sha256(token), 'only the hash is stored');
  const me = await (await call('GET', '/api/me', { token })).json();
  assert.equal(me.user.name, 'Steven');
  assert.deepEqual(me.groups, []);
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
  assert.equal((await call('POST', '/api/auth/logout', { token })).status, 200);
  assert.equal((await call('GET', '/api/me', { token })).status, 401, 'signed out');
});

test('a forged or reused state is turned away', async () => {
  const { call } = setup();
  const response = await call('GET', '/api/auth/discord/callback?code=abc&state=forged');
  assert.equal(response.headers.get('Location'), 'https://vex-rank.com/#/?signin=failed');
});

test('return paths cannot leave the site', () => {
  assert.equal(safeReturn('#/teams/1698Z'), '#/teams/1698Z');
  assert.equal(safeReturn('https://evil.example'), '#/');
  assert.equal(safeReturn('//evil.example'), '#/');
  assert.equal(safeReturn('#/x"><script>'), '#/');
  assert.equal(safeReturn(null), '#/');
  assert.match(inviteCode(), /^[A-HJ-KM-NP-Z2-9]{8}$/);
});

test('synced scouting data round-trips per user', async () => {
  const { call } = setup();
  const { token } = await signIn(call, { id: '1000001', username: 'a' });
  const empty = await (await call('GET', '/api/me/data', { token })).json();
  assert.equal(empty.data, null);
  await call('PUT', '/api/me/data', { token, body: { data: { favorites: { teams: [{ number: '1A' }] } } } });
  const saved = await (await call('GET', '/api/me/data', { token })).json();
  assert.equal(saved.data.favorites.teams[0].number, '1A');
  assert.ok(saved.updatedAt > 0);
  assert.equal((await call('PUT', '/api/me/data', { token, body: { data: { big: 'x'.repeat(250_000) } } })).status, 400);
});

test('scouting groups: create, join, share a picklist safely, and keep strangers out', async () => {
  const { call } = setup();
  const owner = (await signIn(call, { id: '2000001', username: 'owner' })).token;
  const friend = (await signIn(call, { id: '2000002', username: 'friend' })).token;
  const stranger = (await signIn(call, { id: '2000003', username: 'stranger' })).token;

  const created = await (await call('POST', '/api/groups', { token: owner, body: { name: '  55288A   scouts ' } })).json();
  assert.equal(created.name, '55288A scouts');
  const joinCode = `${created.inviteCode.slice(0, 4).toLowerCase()}-${created.inviteCode.slice(4)}`;
  const joined = await (await call('POST', '/api/groups/join', { token: friend, body: { code: joinCode } })).json();
  assert.equal(joined.role, 'member');
  assert.equal((await call('POST', '/api/groups/join', { token: friend, body: { code: 'NOTACODE' } })).status, 404);

  const base = `/api/groups/${created.id}/events/64244`;
  assert.equal((await call('GET', base, { token: stranger })).status, 404, 'non-members see nothing');
  assert.equal((await call('GET', `/api/groups/${created.id}`, { token: stranger })).status, 404);

  const first = await (await call('PUT', `${base}/picklist`, { token: owner, body: { list: [{ number: '10102A', tier: 'first' }, { number: 'bad' }], version: 0 } })).json();
  assert.equal(first.version, 1);
  assert.deepEqual(first.picklist.map(e => e.number), ['10102A']);
  const second = await (await call('PUT', `${base}/picklist`, { token: friend, body: { list: [{ number: '471B' }], version: 1 } })).json();
  assert.equal(second.version, 2);
  const stale = await call('PUT', `${base}/picklist`, { token: owner, body: { list: [{ number: '96Z' }], version: 1 } });
  assert.equal(stale.status, 409, 'an edit based on an old version is refused');
  assert.deepEqual((await stale.json()).picklist.map(e => e.number), ['471B'], 'and the latest comes back');

  await call('PUT', `${base}/notes`, { token: friend, body: { target: 'match:123', text: ' fast intake ' } });
  await call('PUT', `${base}/notes`, { token: owner, body: { target: 'team:471B', text: 'great auton' } });
  assert.equal((await call('PUT', `${base}/notes`, { token: owner, body: { target: 'bad target', text: 'x' } })).status, 400);
  const shared = await (await call('GET', base, { token: owner })).json();
  assert.equal(shared.version, 2);
  assert.equal(shared.updatedBy, 'friend');
  assert.deepEqual(shared.notes.map(n => [n.target, n.text, n.author]).sort(), [['match:123', 'fast intake', 'friend'], ['team:471B', 'great auton', 'owner']]);
  await call('PUT', `${base}/notes`, { token: friend, body: { target: 'match:123', text: '' } });
  assert.equal((await (await call('GET', base, { token: friend })).json()).notes.length, 1, 'an empty note deletes it');

  const group = await (await call('GET', `/api/groups/${created.id}`, { token: friend })).json();
  assert.deepEqual(group.members.map(m => [m.name, m.role]), [['owner', 'owner'], ['friend', 'member']]);
  assert.equal((await call('POST', `/api/groups/${created.id}/rotate`, { token: friend })).status, 403, 'only the owner rotates the code');
  const rotated = await (await call('POST', `/api/groups/${created.id}/rotate`, { token: owner })).json();
  assert.notEqual(rotated.inviteCode, created.inviteCode);
  assert.equal((await call('POST', '/api/groups/join', { token: stranger, body: { code: created.inviteCode } })).status, 404, 'the old code stops working');

  // The owner leaves: the group passes to the friend. The friend leaves: it is gone.
  await call('POST', `/api/groups/${created.id}/leave`, { token: owner });
  assert.equal((await (await call('GET', `/api/groups/${created.id}`, { token: friend })).json()).role, 'owner');
  await call('POST', `/api/groups/${created.id}/leave`, { token: friend });
  assert.equal((await (await call('GET', '/api/me', { token: friend })).json()).groups.length, 0);
});

test('votes: anyone sees totals, only signed-in readers vote, once each', async () => {
  const { call } = setup();
  const a = (await signIn(call, { id: '3000001', username: 'a' })).token;
  const b = (await signIn(call, { id: '3000002', username: 'b' })).token;
  assert.equal((await call('PUT', '/api/votes', { body: { target: 'team:1698Z', value: 1 } })).status, 401);
  await call('PUT', '/api/votes', { token: a, body: { target: 'team:1698Z', value: 1 } });
  await call('PUT', '/api/votes', { token: a, body: { target: 'team:1698Z', value: 1 } });
  await call('PUT', '/api/votes', { token: b, body: { target: 'team:1698Z', value: -1 } });
  const anonymous = await (await call('GET', '/api/votes?target=team:1698Z')).json();
  assert.deepEqual([anonymous.score, anonymous.count, anonymous.mine], [0, 2, 0]);
  await call('PUT', '/api/votes', { token: b, body: { target: 'team:1698Z', value: 0 } });
  const mine = await (await call('GET', '/api/votes?target=team:1698Z', { token: a })).json();
  assert.deepEqual([mine.score, mine.count, mine.mine], [1, 1, 1]);
  assert.equal((await call('PUT', '/api/votes', { token: a, body: { target: 'team:1698Z', value: 5 } })).status, 400);
  assert.equal((await call('GET', '/api/votes?target=user:1')).status, 400);
});

test('deleting an account removes everything about the reader', async () => {
  const { call, env } = setup();
  const { token } = await signIn(call, { id: '4000001', username: 'gone' });
  await call('PUT', '/api/me/data', { token, body: { data: { myTeam: '55288A' } } });
  await call('PUT', '/api/votes', { token, body: { target: 'event:64244', value: 1 } });
  const group = await (await call('POST', '/api/groups', { token, body: { name: 'Solo' } })).json();
  await call('PUT', `/api/groups/${group.id}/events/64244/notes`, { token, body: { target: 'match:1', text: 'x' } });
  assert.equal((await call('DELETE', '/api/me', { token })).status, 200);
  for (const table of ['users', 'sessions', 'user_data', 'votes', 'group_members', 'scout_groups', 'group_notes']) {
    assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.equal((await call('GET', '/api/me', { token })).status, 401);
});

test('picklists from the network are cleaned like local ones', () => {
  assert.deepEqual(cleanPicklist([{ number: '1A', tier: 'first', note: 'x'.repeat(400), picked: 'yes' }, { number: '1A' }, { number: '<b>' }]),
    [{ number: '1A', tier: 'first', note: 'x'.repeat(300), picked: false }]);
  assert.equal(cleanPicklist('nope'), null);
});

test('non-account paths are left to the rest of the worker', async () => {
  const { call } = setup();
  assert.equal(await call('GET', '/api/rankings'), null);
  assert.equal(await call('GET', '/api/teams/1698Z'), null);
});

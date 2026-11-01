import test from 'node:test';
import assert from 'node:assert/strict';
import { vexJson, vexCollection, usePageStore, FetchBudgetExhausted } from '../lib/vex-api.ts';

// Each test uses a distinct URL: vexJson keeps a process-local cache of
// successful pages, and sharing a URL would let one test answer another.
// Takes factories, not responses: a Response body can only be read once, and a
// retry test needs a fresh one each time round.
function stub(make) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, redirect: init?.redirect });
    return make(calls.length - 1);
  };
  return calls;
}

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const status = (code, headers) => new Response('', { status: code, headers });

test('a redirect to sign-in is reported as credentials, not as an outage', async () => {
  // Official data answers an expired token with a 302 to its login page. Left
  // to follow it, fetch lands on HTML, fails to parse, and the failure is
  // retried three times - so the one problem a person could actually fix reads
  // as "temporarily unavailable, please retry".
  const calls = stub(() => status(302, { Location: '/auth/login' }));
  await assert.rejects(
    () => vexJson('https://events.vex.com/api/v2/events?redirect-case', {}),
    /credentials/i
  );
  assert.equal(calls.length, 1, 'a rejected token must not be retried');
  assert.equal(calls[0].redirect, 'manual', 'the redirect has to be visible to be recognised');
});

test('401 and 403 are terminal too', async () => {
  for (const code of [401, 403]) {
    const calls = stub(() => status(code));
    await assert.rejects(
      () => vexJson(`https://events.vex.com/api/v2/events?auth-${code}`, {}),
      /credentials/i
    );
    assert.equal(calls.length, 1, `${code} must not be retried`);
  }
});

test('a genuine server error is still retried', async () => {
  const calls = stub(() => status(500));
  await assert.rejects(() => vexJson('https://events.vex.com/api/v2/events?five-hundred', {}), /unavailable/i);
  assert.equal(calls.length, 3, 'transient failures are worth another go');
});

test('a success is returned and served from cache the second time', async () => {
  const calls = stub(() => json({ data: [{ id: 1 }] }));
  const url = 'https://events.vex.com/api/v2/events?cache-case';
  assert.deepEqual(await vexJson(url, {}), { data: [{ id: 1 }] });
  assert.deepEqual(await vexJson(url, {}), { data: [{ id: 1 }] });
  assert.equal(calls.length, 1, 'the second read should not reach the network');
});

test('a build that runs out of requests stops, keeping what it fetched', async () => {
  // The free plan allows 50 outbound requests per invocation. A collection
  // longer than the budget stops partway; what it fetched must survive, or
  // every retry spends its budget on the same first pages and never finishes.
  const kept = new Map();
  usePageStore({ get: async key => kept.get(key), put: async (key, data) => { kept.set(key, data); } });
  try {
    const url = 'https://events.vex.com/api/v2/events?budget-case';
    const calls = stub(index => json({ data: [index], meta: { last_page: 4 } }));
    await assert.rejects(() => vexCollection(url, {}, { keepFor: 60000, budget: { left: 2 } }), FetchBudgetExhausted);
    assert.equal(calls.length, 2, 'no request past the budget');
    assert.equal(kept.size, 2, 'both fetched pages are stored');
  } finally {
    usePageStore(undefined);
  }
});

test('a stored page is served without a request or any budget', async () => {
  // What the next invocation sees: an empty process cache, a full store.
  const url = 'https://events.vex.com/api/v2/events?stored-case';
  usePageStore({ get: async key => (key === url ? { data: ['kept'] } : undefined), put: async () => {} });
  try {
    const calls = stub(() => json({ data: ['live'] }));
    const budget = { left: 0 };
    assert.deepEqual(await vexJson(url, {}, { keepFor: 60000, budget }), { data: ['kept'] });
    assert.equal(calls.length, 0);
  } finally {
    usePageStore(undefined);
  }
});

test('calls without keepFor never touch the store', async () => {
  let touched = false;
  usePageStore({ get: async () => { touched = true; }, put: async () => { touched = true; } });
  try {
    stub(() => json({ ok: true }));
    await vexJson('https://events.vex.com/api/v2/events?no-store-case', {});
    assert.equal(touched, false);
  } finally {
    usePageStore(undefined);
  }
});

test('out of budget, a page falls back to its last stored copy instead of failing', async () => {
  const url = 'https://events.vex.com/api/v2/events?stale-case';
  usePageStore({ get: async (key, options) => (key === url && options?.stale ? { data: ['last week'] } : undefined), put: async () => {} });
  try {
    const calls = stub(() => json({ data: ['fresh'] }));
    assert.deepEqual(await vexJson(url, {}, { keepFor: 60000, budget: { left: 0 } }), { data: ['last week'] });
    assert.equal(calls.length, 0);
    await assert.rejects(() => vexJson(`${url}-never-seen`, {}, { keepFor: 60000, budget: { left: 0 } }), FetchBudgetExhausted);
  } finally {
    usePageStore(undefined);
  }
});

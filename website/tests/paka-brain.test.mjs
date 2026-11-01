import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommand, needs, runCommand, reactionFor, newResults, shortName, countReversals, isStroke, isTripleClick,
  pickTrick, TRICKS, CALM_TRICKS, clampPosition, placement,
  moodAfterPet, moodAfterAway, moodWord, MOOD_FLOOR,
} from '../components/paka/brain.mjs';
import { loadState, saveState, sanitize, freshState, STORAGE_KEY, PALETTES, PATTERNS } from '../components/paka/store.mjs';
import { frame, EYES, PALETTE_COLOURS } from '../components/paka/pixels.mjs';

const teams = [
  { rank: 1, id: 1, number: '3946E', name: 'Enigma', rating: 1582, confidence: 64, change: 93, record: '14–0–0', matches: 14, region: 'Colorado, United States', country: 'United States', eventRegion: 'Colorado', organization: 'KENT DENVER SCHOOL', seasonId: 204 },
  { rank: 2, id: 2, number: '471B', name: 'Moonshot', rating: 1577, confidence: 49, change: -4, record: '21–3–0', matches: 24, region: 'California, United States', country: 'United States', eventRegion: 'California - Region 4', organization: 'Robotics Club', seasonId: 204 },
  { rank: 3, id: 3, number: '1698Z', name: 'No Way', rating: 1567, confidence: 55, change: 0, record: '18–1–0', matches: 19, region: 'California, United States', country: 'United States', eventRegion: 'California - Region 4', organization: 'Robotics Club', seasonId: 204 },
  { rank: 40, id: 4, number: '252H', name: 'HOLY COW', rating: 1482, confidence: 80, change: 12, record: '5–4–0', matches: 9, region: 'Ontario, Canada', country: 'Canada', eventRegion: 'Ontario', organization: 'I Wonder Nexus', seasonId: 204 },
];
const events = [
  { id: '1', date: '2026-09-20', name: 'Past Event: VEX V5 Robotics Competition', city: 'Toronto', region: 'Ontario', status: 'Completed', teams: 30 },
  { id: '2', date: '2026-10-05', name: 'Ontario Classic: VEX V5 Robotics Competition', city: 'Toronto', region: 'Ontario', status: 'Upcoming', teams: 40, tier: 'Official' },
  { id: '3', date: '2026-10-02', name: 'Highlander Summit Signature 2026: VEX V5', city: 'Newark', region: 'New Jersey', status: 'Upcoming', teams: 103, tier: 'Gold S' },
  { id: '4', date: '2026-10-03', name: 'CANCELED: Something', city: 'Toronto', region: 'Ontario', status: 'Cancelled', teams: 0 },
];
const ctx = { teams, events, following: [], name: 'Paka', today: '2026-10-01' };

test('commands are recognised', () => {
  assert.deepEqual(parseCommand('55288a'), { type: 'team', number: '55288A' });
  assert.deepEqual(parseCommand('#1698z'), { type: 'team', number: '1698Z' });
  assert.deepEqual(parseCommand('find moonshot'), { type: 'search', query: 'moonshot' });
  assert.deepEqual(parseCommand('compare 1698Z vs 471b'), { type: 'compare', numbers: ['1698Z', '471B'] });
  assert.deepEqual(parseCommand('compare 1698Z 471B'), { type: 'compare', numbers: ['1698Z', '471B'] });
  assert.deepEqual(parseCommand('top 5 in ontario'), { type: 'top', count: 5, place: 'ontario' });
  assert.deepEqual(parseCommand('top'), { type: 'top', count: 5, place: null });
  assert.deepEqual(parseCommand('top 99'), { type: 'top', count: 10, place: null });
  assert.deepEqual(parseCommand('next event near ontario'), { type: 'nextEvents', place: 'ontario' });
  assert.deepEqual(parseCommand('upcoming events'), { type: 'nextEvents', place: null });
  assert.deepEqual(parseCommand('follow 1698z'), { type: 'follow', number: '1698Z' });
  assert.deepEqual(parseCommand('unfollow 1698Z'), { type: 'unfollow', number: '1698Z' });
  assert.deepEqual(parseCommand('theme Ember'), { type: 'theme', theme: 'ember' });
  assert.deepEqual(parseCommand('name Mochi'), { type: 'rename', name: 'Mochi' });
  assert.deepEqual(parseCommand('rankings'), { type: 'go', view: 'rankings' });
  for (const text of ['help', '?', 'pet', 'random', 'what is vcr', 'vcr', 'following', 'hide', '']) {
    assert.notEqual(parseCommand(text).type, 'search', text);
  }
});

test('commands say which data they need', () => {
  assert.deepEqual(needs({ type: 'team' }), ['teams']);
  assert.deepEqual(needs({ type: 'nextEvents' }), ['events']);
  assert.deepEqual(needs({ type: 'help' }), []);
});

test('a team number opens the team, rated or not', () => {
  const rated = runCommand(parseCommand('1698z'), ctx);
  assert.match(rated.text, /#3 in the world with 1567/);
  assert.equal(rated.effects[0].type, 'openTeam');
  assert.equal(rated.effects[0].team.number, '1698Z');
  const unrated = runCommand(parseCommand('55288A'), ctx);
  assert.match(unrated.text, /isn't in this season's ranking/);
  assert.deepEqual(unrated.effects[0], { type: 'openTeam', team: { number: '55288A', name: '' } });
});

test('search matches names and organisations', () => {
  const one = runCommand(parseCommand('find moonshot'), ctx);
  assert.equal(one.effects[0].team.number, '471B');
  const many = runCommand(parseCommand('robotics club'), ctx);
  assert.equal(many.actions.length, 2);
  assert.match(runCommand(parseCommand('zzzz qqq'), ctx).text, /found no team/);
});

test('compare names the leader, or calls it close inside the ± range', () => {
  const close = runCommand(parseCommand('compare 1698Z 471B'), ctx);
  assert.match(close.text, /Too close to call/);
  assert.equal(close.actions.length, 2);
  const clear = runCommand(parseCommand('compare 3946E 252H'), ctx);
  assert.match(clear.text, /3946E is ahead by 100 points/);
  assert.match(runCommand(parseCommand('compare 3946E 99999Z'), ctx).text, /99999Z isn't in this season's ranking/);
  assert.match(runCommand(parseCommand('compare 3946E 3946E'), ctx).text, /same team twice/);
});

test('top N filters by place and keeps rank order', () => {
  const world = runCommand(parseCommand('top 2'), ctx);
  assert.deepEqual(world.actions.map(action => action.run.team.number), ['3946E', '471B']);
  const california = runCommand(parseCommand('top 5 in california'), ctx);
  assert.deepEqual(california.actions.map(action => action.run.team.number), ['471B', '1698Z']);
  assert.match(runCommand(parseCommand('top 5 in narnia'), ctx).text, /No rated teams/);
});

test('next events skips past and cancelled events and sorts by date', () => {
  const next = runCommand(parseCommand('next event'), ctx);
  assert.deepEqual(next.actions.map(action => action.run.event.id), ['3', '2']);
  const ontario = runCommand(parseCommand('next event in ontario'), ctx);
  assert.deepEqual(ontario.actions.map(action => action.run.event.id), ['2']);
  assert.match(ontario.actions[0].label, /Ontario Classic$/);
});

test('follow, unfollow and following', () => {
  const follow = runCommand(parseCommand('follow 471B'), ctx);
  assert.deepEqual(follow.effects[0], { type: 'follow', number: '471B', matches: 24 });
  const watching = { ...ctx, following: [{ number: '471B', matches: 24 }] };
  assert.match(runCommand(parseCommand('follow 471B'), watching).text, /already watching/);
  assert.equal(runCommand(parseCommand('unfollow 471B'), watching).effects[0].type, 'unfollow');
  assert.match(runCommand(parseCommand('unfollow 471B'), ctx).text, /wasn't watching/);
  assert.equal(runCommand(parseCommand('following'), watching).actions[0].run.team.number, '471B');
});

test('theme and rename are validated', () => {
  assert.deepEqual(runCommand(parseCommand('theme moss'), ctx).effects, [{ type: 'theme', theme: 'moss' }]);
  assert.equal(runCommand(parseCommand('theme pink'), ctx).effects, undefined);
  assert.deepEqual(runCommand(parseCommand('name Mochi <3'), ctx).effects, [{ type: 'rename', name: 'Mochi 3' }]);
});

test('random picks with the injected random source', () => {
  const pick = runCommand(parseCommand('random'), { ...ctx, random: () => 0.99 });
  assert.equal(pick.effects[0].team.number, '252H');
});

test('page reactions', () => {
  const team = reactionFor({ ...ctx, view: 'team', selectedTeam: { number: '3946e' } });
  assert.match(team.text, /3946E is #1 in the world at 1582, up 93 lately/);
  assert.match(reactionFor({ ...ctx, view: 'team', selectedTeam: { number: '55288A' } }).text, /isn't rated this season/);
  assert.equal(team.actions[0].label, 'Follow 3946E');
  assert.deepEqual(reactionFor({ ...ctx, following: [{ number: '3946E', matches: 14 }], view: 'team', selectedTeam: { number: '3946E' } }).actions, []);
  assert.match(reactionFor({ ...ctx, view: 'event', selectedEvent: { id: '3' } }).text, /^Gold S: 103 teams, starts tomorrow\.$/);
  assert.match(reactionFor({ ...ctx, view: 'event', selectedEvent: { id: '2' } }).text, /^40 teams, starts in 4 days\.$/);
  assert.match(reactionFor({ ...ctx, view: 'event', selectedEvent: { id: '1' } }).text, /wrapped up/);
  assert.equal(reactionFor({ ...ctx, view: 'event', selectedEvent: { id: '999' } }), null);
  assert.match(reactionFor({ ...ctx, view: 'home', name: 'Mochi' }).text, /I'm Mochi/);
  assert.equal(reactionFor({ ...ctx, view: 'teamEvent' }), null);
});

test('new results since last visit', () => {
  assert.deepEqual(newResults([{ number: '471B', matches: 20 }, { number: '1698Z', matches: 19 }, { number: '55288A', matches: 0 }], teams),
    [{ number: '471B', played: 4, matches: 24 }]);
});

test('mood rises with pets, sinks while away, never below the floor', () => {
  assert.equal(moodAfterPet(70), 78);
  assert.equal(moodAfterPet(97), 100);
  assert.equal(moodAfterAway(80, 10), 75);
  assert.equal(moodAfterAway(80, 10_000), MOOD_FLOOR);
  assert.equal(moodWord(95), 'Ecstatic');
});

test('event names are shortened to the part before the program title', () => {
  assert.equal(shortName('Highlander Summit Signature 2026: VEX V5 Robotics Competition High School'), 'Highlander Summit Signature 2026');
});

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, data };
}

test('storage round-trips and survives garbage', () => {
  const storage = memoryStorage();
  const fresh = loadState(storage, 1000, () => 0);
  assert.equal(fresh.name, 'Paka');
  assert.deepEqual(fresh.coat, { palette: PALETTES[0], pattern: PATTERNS[0] });
  assert.ok(saveState({ ...fresh, name: 'Mochi', pets: 3 }, storage));
  assert.equal(loadState(storage, 2000).name, 'Mochi');

  const junk = memoryStorage({ [STORAGE_KEY]: '{"name":42,"coat":{"palette":"neon"},"mood":"x","following":[{"number":"<script>"},{"number":"1698Z","matches":5}]}' });
  const cleaned = loadState(junk, 1000, () => 0);
  assert.equal(cleaned.name, 'Paka');
  assert.equal(cleaned.coat.palette, PALETTES[0]);
  assert.deepEqual(cleaned.following, [{ number: '1698Z', matches: 5 }]);
  assert.equal(loadState(memoryStorage({ [STORAGE_KEY]: 'not json' }), 1000).name, 'Paka');
});

test('storage that throws never breaks Paka', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadState(broken).name, 'Paka');
  assert.equal(saveState(freshState(), broken), false);
  assert.equal(loadState(undefined).name, 'Paka');
});

test('mood settles for time away when loading', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ ...sanitize({}), mood: 90, lastSeen: 0 }) });
  assert.equal(loadState(storage, 20 * 3600000).mood, 80);
});

test('every sprite frame is a 16×16 grid using only known colours', () => {
  const letters = new Set(['.', ...Object.keys(PALETTE_COLOURS.grey)]);
  for (const eyes of Object.keys(EYES)) for (const tailUp of [false, true]) for (const pattern of PATTERNS) for (const tongue of [false, true]) {
    const rows = frame(eyes, tailUp, pattern, tongue);
    assert.equal(rows.length, 16, `${eyes}/${tailUp}/${pattern}`);
    for (const row of rows) {
      assert.equal(row.length, 16, `${eyes}/${tailUp}/${pattern}: ${row}`);
      for (const letter of row) assert.ok(letters.has(letter), `unknown pixel ${letter}`);
    }
  }
  for (const palette of PALETTES) assert.deepEqual(Object.keys(PALETTE_COLOURS[palette]).sort(), [...Object.keys(PALETTE_COLOURS.grey)].sort(), palette);
});

test('a stroke is the pointer going back and forth, not jitter', () => {
  assert.equal(countReversals([0, 20, 0, 20, 0, 20]), 4);
  assert.ok(isStroke([0, 20, 0, 20, 0, 20]));
  assert.equal(countReversals([0, 2, 0, 3, 1, 2, 0]), 0, 'jitter under 6px is ignored');
  assert.ok(!isStroke([0, 10, 20, 30, 40, 50]), 'a straight pass is not a stroke');
  assert.ok(!isStroke([0, 20, 0, 20]), 'two reversals are not enough');
});

test('three quick clicks are zoomies', () => {
  assert.ok(isTripleClick([1000, 1300, 1600], 1600));
  assert.ok(!isTripleClick([1000, 1600], 1600));
  assert.ok(!isTripleClick([0, 1300, 1600], 1600), 'the first click is too old');
});

test('click tricks are random, never repeat back to back, and stay calm when asked', () => {
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 400; i += 1) {
    const trick = pickTrick(last, false, Math.random);
    assert.notEqual(trick, last);
    assert.ok(TRICKS.includes(trick));
    seen.add(trick);
    last = trick;
  }
  assert.equal(seen.size, TRICKS.length, 'every trick turns up');
  for (let i = 0; i < 50; i += 1) assert.ok(CALM_TRICKS.includes(pickTrick(null, true)));
  assert.equal(pickTrick('hop', false, () => 0.999999), TRICKS.filter(t => t !== 'hop').at(-1));
});

test('Paka stays fully on screen wherever it is dropped', () => {
  const viewport = { width: 1280, height: 800 };
  assert.deepEqual(clampPosition({ x: -50, y: -10 }, viewport), { x: 0, y: 0 });
  assert.deepEqual(clampPosition({ x: 5000, y: 5000 }, viewport), { x: 1196, y: 724 });
  assert.deepEqual(clampPosition({ x: 300.4, y: 200.6 }, viewport), { x: 300, y: 201 });
  assert.deepEqual(clampPosition({ x: 10, y: 10 }, { width: 20, height: 20 }), { x: 0, y: 0 });
  assert.deepEqual(clampPosition({ x: 0, y: 5000 }, viewport, 64, { right: 20, bottom: 12, top: 72 }), { x: 0, y: 652 }, 'never under the header');
});

test('boxes open where there is room', () => {
  const viewport = { width: 1280, height: 800 };
  assert.deepEqual(placement({ left: 1100, top: 700, width: 64 }, viewport), { above: true, alignLeft: false, askOnRight: false });
  assert.deepEqual(placement({ left: 10, top: 40, width: 64 }, viewport), { above: false, alignLeft: true, askOnRight: true });
});

test('a blep shows the tongue under the muzzle, and a wink shuts one eye', () => {
  assert.equal(frame('open', false, 'solid', true)[10].slice(6, 8), 'tt');
  assert.ok(!frame('open', false, 'solid', false).join('').includes('t'));
  const wink = frame('wink', false, 'solid');
  assert.equal(wink[7].slice(3, 5), 'ee');
  assert.equal(wink[7].slice(9, 11), 'oo');
});

test('a stored position is kept, and nonsense is reset to the corner', () => {
  assert.deepEqual(sanitize({ pos: { x: 120, y: 340 } }).pos, { x: 120, y: 340 });
  assert.deepEqual(sanitize({ pos: { x: 'a', y: -5 } }).pos, { x: 0, y: 0 });
  assert.deepEqual(sanitize({}).pos, { x: 0, y: 0 });
});

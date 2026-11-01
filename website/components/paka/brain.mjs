/**
 * Paka's brain: what a typed command means, what to say about the page the
 * reader is on, and how happy the cat is. No React and no storage here, so
 * every rule can be tested directly (tests/paka-brain.test.mjs).
 *
 * A reply is { text, actions?, effects? }:
 *   actions  buttons under the speech bubble, each { label, run }
 *   effects  things to do straight away, e.g. { type: 'openTeam', team }
 * `run` and `effects` use the same shapes; the widget performs them.
 */

export const THEME_IDS = ['midnight', 'ember', 'abyss', 'moss'];
const TEAM_NUMBER = /^\d{1,6}[A-Z]{0,2}$/i;
const MAX_LIST = 10;

const clean = value => String(value ?? '').trim();
const lower = value => clean(value).toLowerCase();
const teamNumber = value => clean(value).replace(/^#/, '').toUpperCase();

/** Turn what the reader typed into a command. Never throws. */
export function parseCommand(input) {
  const text = clean(input).replace(/\s+/g, ' ');
  const words = text.toLowerCase();
  if (!text) return { type: 'empty' };
  if (/^(help|\?|what can you do\??|commands)$/.test(words)) return { type: 'help' };
  if (/^(pet|pat|scratch|purr)( paka)?!*$/.test(words)) return { type: 'pet' };
  if (/^(hide|go away|bye|sleep)( paka)?$/.test(words)) return { type: 'hide' };
  if (/^(what('?s| is) )?(vcr|the rating|rating)\??$/.test(words) || /^how (do|does) (the )?ratings? work/.test(words)) return { type: 'vcr' };
  if (/^random( team)?$/.test(words)) return { type: 'random' };
  if (/^(following|followed|my teams|favou?rites)$/.test(words)) return { type: 'following' };

  let match;
  if ((match = words.match(/^(?:theme|colou?r) (\w+)$/))) return { type: 'theme', theme: match[1] };
  if ((match = text.match(/^(?:name|rename|call you) (.{1,20})$/i))) return { type: 'rename', name: match[1].trim() };
  if ((match = text.match(/^(un)?follow #?(\w+)$/i))) {
    return { type: match[1] ? 'unfollow' : 'follow', number: teamNumber(match[2]) };
  }
  if ((match = text.match(/^compare #?(\w+)(?: (?:and|vs\.?|with|to))? #?(\w+)$/i))) {
    return { type: 'compare', numbers: [teamNumber(match[1]), teamNumber(match[2])] };
  }
  if ((match = words.match(/^top(?: (\d{1,2}))?(?: teams?)?(?: (?:in|from) (.+))?$/))) {
    return { type: 'top', count: Math.min(Number(match[1] ?? 5) || 5, MAX_LIST), place: match[2] ?? null };
  }
  if ((match = words.match(/^(?:next|upcoming) events?(?: (?:in|near|at) (.+))?$/))) {
    return { type: 'nextEvents', place: match[1] ?? null };
  }
  if ((match = words.match(/^(?:go to |open |show )?(home|events|rankings|teams|world ranking)$/))) {
    return { type: 'go', view: match[1] === 'world ranking' ? 'rankings' : match[1] };
  }
  if ((match = text.match(/^(?:find|search|look ?up|open|show) (.+)$/i))) return lookupOrSearch(match[1]);
  return lookupOrSearch(text);
}

function lookupOrSearch(query) {
  const value = teamNumber(query);
  if (TEAM_NUMBER.test(value)) return { type: 'team', number: value };
  return { type: 'search', query: clean(query) };
}

/** Which data a command needs, so the widget can load it first. */
export function needs(command) {
  if (['team', 'search', 'compare', 'top', 'random', 'follow', 'following'].includes(command.type)) return ['teams'];
  if (command.type === 'nextEvents') return ['events'];
  return [];
}

const findTeam = (teams, number) => teams.find(team => String(team.number).toUpperCase() === number);
const teamLine = team => `#${team.rank} ${team.number}${team.name ? ` ${team.name}` : ''} · ${team.rating}`;
const openTeamAction = team => ({ label: `${team.number}${team.name ? ` · ${team.name}` : ''}`, run: { type: 'openTeam', team: { number: team.number, name: team.name ?? '', id: team.id, seasonId: team.seasonId } } });
const matchesPlace = (row, place) => !place || [row.region, row.country, row.eventRegion, row.city]
  .some(field => lower(field).includes(lower(place)));

/**
 * Carry out a command against the data the page has.
 * ctx: { teams, events, following, name, today, random }
 */
export function runCommand(command, ctx) {
  const teams = ctx.teams ?? [];
  const events = ctx.events ?? [];
  const name = ctx.name || 'Paka';
  switch (command.type) {
    case 'empty':
      return { text: 'Type a team number like 55288A, or try "help".' };
    case 'help':
      return {
        text: 'Here are my tricks: a team number, "compare 1698Z 471B", "top 5 in ontario", "next event", "follow 1698Z", "random", "theme ember", or "what is vcr".',
        actions: [
          { label: 'Top 5 teams', run: { type: 'command', text: 'top 5' } },
          { label: 'Next events', run: { type: 'command', text: 'next event' } },
          { label: 'Random team', run: { type: 'command', text: 'random' } },
        ],
      };
    case 'pet':
      return { text: 'Purrrr. ♥', effects: [{ type: 'pet' }] };
    case 'hide':
      return { text: 'Okay, I\'ll nap out of sight. Click the paw to bring me back.', effects: [{ type: 'hide' }] };
    case 'vcr':
      return {
        text: 'VCR is VEX-Rank\'s team rating. Every match moves a team up or down depending on the result and how strong the opponents were. The ± number is how unsure the rating still is: fewer matches, bigger ±.',
        actions: [{ label: 'World ranking', run: { type: 'go', view: 'rankings' } }],
      };
    case 'theme': {
      if (!THEME_IDS.includes(command.theme)) return { text: `I know these themes: ${THEME_IDS.join(', ')}.` };
      return { text: `Ooh, ${command.theme}. Fancy.`, effects: [{ type: 'theme', theme: command.theme }] };
    }
    case 'rename': {
      const next = command.name.replace(/[^\p{L}\p{N} '-]/gu, '').trim().slice(0, 20);
      if (!next) return { text: 'That name doesn\'t fit on my collar.' };
      return { text: `${next}? I like it.`, effects: [{ type: 'rename', name: next }] };
    }
    case 'go':
      return { text: `To ${command.view === 'home' ? 'the start' : command.view} we go!`, effects: [{ type: 'go', view: command.view }] };
    case 'team': {
      const team = findTeam(teams, command.number);
      if (team) {
        return { text: `Here's ${team.number}${team.name ? ` (${team.name})` : ''}: #${team.rank} in the world with ${team.rating}.`, effects: [{ type: 'openTeam', team: openTeamAction(team).run.team }] };
      }
      // Not rated this season isn't the same as not existing: the profile page
      // looks the team up on its own.
      return { text: `${command.number} isn't in this season's ranking yet. Opening their profile anyway.`, effects: [{ type: 'openTeam', team: { number: command.number, name: '' } }] };
    }
    case 'search': {
      const query = lower(command.query);
      const hits = teams.filter(team => [team.number, team.name, team.organization].some(field => lower(field).includes(query))).slice(0, 5);
      if (!hits.length) return { text: `I sniffed around but found no team matching "${command.query}". Try a team number, or "help".` };
      if (hits.length === 1) return runCommand({ type: 'team', number: String(hits[0].number).toUpperCase() }, ctx);
      return { text: `I found ${hits.length} teams for "${command.query}":`, actions: hits.map(openTeamAction) };
    }
    case 'compare': {
      const [a, b] = command.numbers.map(number => findTeam(teams, number));
      const missing = command.numbers.filter((number, index) => ![a, b][index]);
      if (missing.length) return { text: `${missing.join(' and ')} ${missing.length > 1 ? 'aren\'t' : 'isn\'t'} in this season's ranking, so I can't compare.` };
      if (a.number === b.number) return { text: 'That\'s the same team twice. They tie!' };
      const [high, low] = a.rating >= b.rating ? [a, b] : [b, a];
      const gap = high.rating - low.rating;
      const verdict = gap <= Math.max(high.confidence ?? 0, low.confidence ?? 0)
        ? 'Too close to call: the gap is inside the ± range.'
        : `${high.number} is ahead by ${gap} points.`;
      return {
        text: `${teamLine(a)} (${a.record})\n${teamLine(b)} (${b.record})\n${verdict}`,
        actions: [openTeamAction(a), openTeamAction(b)],
      };
    }
    case 'top': {
      const rows = teams.filter(team => matchesPlace(team, command.place)).slice(0, command.count);
      if (!rows.length) return { text: `No rated teams in "${command.place}" yet. Try a country or state.` };
      return { text: `Top ${rows.length}${command.place ? ` in ${command.place}` : ' in the world'}:`, actions: rows.map(team => ({ ...openTeamAction(team), label: `#${team.rank} ${team.number} · ${team.rating}` })) };
    }
    case 'random': {
      if (!teams.length) return { text: 'No teams to pick from yet.' };
      const pick = teams[Math.floor((ctx.random ?? Math.random)() * teams.length)];
      return { text: `*spins in a circle* ...${pick.number}!`, effects: [{ type: 'openTeam', team: openTeamAction(pick).run.team }] };
    }
    case 'nextEvents': {
      const today = ctx.today ?? new Date().toISOString().slice(0, 10);
      const rows = events
        .filter(event => event.date >= today && !/cancell?ed/i.test(`${event.status} ${event.name}`) && matchesPlace(event, command.place))
        .sort((x, y) => String(x.date).localeCompare(String(y.date)))
        .slice(0, 5);
      if (!rows.length) return { text: `No upcoming events${command.place ? ` near ${command.place}` : ''} that I can see.` };
      return {
        text: `Next up${command.place ? ` near ${command.place}` : ''}:`,
        actions: rows.map(event => ({ label: `${shortDate(event.date)} · ${shortName(event.name)}`, run: { type: 'openEvent', event } })),
      };
    }
    case 'follow': {
      const team = findTeam(teams, command.number);
      if ((ctx.following ?? []).some(entry => entry.number === command.number)) return { text: `I'm already watching ${command.number}.` };
      return {
        text: `Watching ${command.number}. I'll tell you when they play new matches.`,
        effects: [{ type: 'follow', number: command.number, matches: team?.matches ?? 0 }],
      };
    }
    case 'unfollow':
      if (!(ctx.following ?? []).some(entry => entry.number === command.number)) return { text: `I wasn't watching ${command.number}.` };
      return { text: `Stopped watching ${command.number}.`, effects: [{ type: 'unfollow', number: command.number }] };
    case 'following': {
      const list = ctx.following ?? [];
      if (!list.length) return { text: 'You aren\'t following any teams. Try "follow 55288A".' };
      return { text: `${name} is watching:`, actions: list.map(entry => openTeamAction(findTeam(teams, entry.number) ?? { number: entry.number })) };
    }
    default:
      return { text: 'Mrow? Try "help".' };
  }
}

function shortDate(date) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? String(date) : parsed.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

/** Event names carry the whole program title; the part before the colon is the event. */
export function shortName(name) {
  const head = clean(name).split(/:| - /)[0].trim();
  return head.length > 42 ? `${head.slice(0, 41)}…` : head;
}

function daysUntil(date, today) {
  return Math.round((new Date(`${date}T12:00:00`) - new Date(`${today}T12:00:00`)) / 86400000);
}

/**
 * Something to say about the page the reader just opened, or null.
 * ctx: { view, selectedTeam, selectedEvent, teams, events, following, name, today }
 */
export function reactionFor(ctx) {
  const today = ctx.today ?? new Date().toISOString().slice(0, 10);
  const teams = ctx.teams ?? [];
  if (ctx.view === 'team' && ctx.selectedTeam?.number) {
    const team = findTeam(teams, String(ctx.selectedTeam.number).toUpperCase());
    if (!team) return { text: `${ctx.selectedTeam.number} isn't rated this season yet. Every team starts somewhere!` };
    const trend = team.change > 0 ? `, up ${team.change} lately` : team.change < 0 ? `, down ${-team.change} lately` : '';
    const followed = (ctx.following ?? []).some(entry => entry.number === team.number);
    return {
      text: `${team.number} is #${team.rank} in the world at ${team.rating}${trend}.`,
      actions: followed ? [] : [{ label: `Follow ${team.number}`, run: { type: 'command', text: `follow ${team.number}` } }],
    };
  }
  if (ctx.view === 'event' && ctx.selectedEvent?.id) {
    const event = (ctx.events ?? []).find(entry => String(entry.id) === String(ctx.selectedEvent.id)) ?? ctx.selectedEvent;
    if (!event.date) return null;
    const days = daysUntil(event.date, today);
    const when = days > 1 ? `starts in ${days} days` : days === 1 ? 'starts tomorrow' : days === 0 ? 'is today' : 'has wrapped up';
    const size = event.teams ? `${event.teams} teams, ` : '';
    const tier = event.tier && event.tier !== 'Official' ? `${event.tier}: ` : '';
    return { text: `${tier}${size}${when}.` };
  }
  const tips = {
    home: `Hi, I'm ${ctx.name || 'Paka'}! Boop me, stroke me, or press the speech bubble beside me to ask about teams and events.`,
    rankings: 'Tip: click me and try "compare 1698Z 471B".',
    events: 'Tip: click me and try "next event near ontario".',
    teams: 'Tip: "follow" a team and I\'ll keep an eye on their results.',
  };
  return tips[ctx.view] ? { text: tips[ctx.view] } : null;
}

/** Followed teams that played since they were last seen, as { number, played }. */
export function newResults(following, teams) {
  return (following ?? []).flatMap(entry => {
    const team = findTeam(teams ?? [], entry.number);
    const played = (team?.matches ?? 0) - (entry.matches ?? 0);
    return team && played > 0 ? [{ number: entry.number, played, matches: team.matches }] : [];
  });
}

// Mood: petting raises it, time away lowers it, but never below a content cat.
export const MOOD_FLOOR = 40;
export function moodAfterPet(mood) { return Math.min(100, (mood ?? 70) + 8); }
export function moodAfterAway(mood, hoursAway) {
  return Math.max(MOOD_FLOOR, Math.round((mood ?? 70) - Math.max(0, hoursAway) / 2));
}
export function moodWord(mood) {
  return mood >= 90 ? 'Ecstatic' : mood >= 75 ? 'Happy' : mood >= 55 ? 'Content' : 'A bit lonely';
}

// Gestures. The widget feeds in raw pointer samples; these decide what they meant.

/** How often a horizontal stroke changed direction, ignoring jitter under `minTravel` px. */
export function countReversals(xs, minTravel = 6) {
  let reversals = 0;
  let direction = 0;
  let anchor = xs[0];
  for (const x of xs.slice(1)) {
    const travel = x - anchor;
    if (Math.abs(travel) < minTravel) continue;
    const next = Math.sign(travel);
    if (direction && next !== direction) reversals += 1;
    direction = next;
    anchor = x;
  }
  return reversals;
}

/** Stroking: the pointer went back and forth across the cat at least four times. */
export const isStroke = xs => countReversals(xs) >= 4;

/** Three clicks inside `windowMs` are zoomies; anything less is a boop. */
export function isTripleClick(times, now, windowMs = 900) {
  return times.filter(time => now - time <= windowMs).length >= 3;
}

// Click tricks. Each click picks one at random, never the same twice running.
// The calm set changes only the face, for readers who asked for reduced motion.
export const TRICKS = ['hop', 'spin', 'roll', 'stretch', 'meow', 'blep', 'wink', 'lookAround', 'sneeze', 'chaseTail'];
export const CALM_TRICKS = ['meow', 'blep', 'wink'];
export const MEOWS = ['Mrrp!', 'Meow!', 'Nya~', 'Mew?', 'Prrt!', 'Mrow.'];

export function pickTrick(last, calm = false, random = Math.random) {
  const pool = (calm ? CALM_TRICKS : TRICKS).filter(trick => trick !== last);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/**
 * Where Paka may sit: `x` and `y` are its distance from the right and bottom
 * edges. It must stay fully on screen and below the sticky header (`top`),
 * which is drawn in front of it and would leave it impossible to grab.
 */
export function clampPosition(pos, viewport, size = 64, margin = { right: 20, bottom: 12, top: 0 }) {
  const maxX = Math.max(0, viewport.width - size - margin.right);
  const maxY = Math.max(0, viewport.height - size - margin.bottom - (margin.top ?? 0));
  return {
    x: Math.round(Math.max(0, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(0, Math.min(maxY, pos.y))),
  };
}

/** Open boxes on the side with room: above unless near the top, leftward unless near the left edge. */
export function placement(cat, viewport, box = { width: 320, height: 360 }) {
  return {
    above: cat.top >= box.height,
    alignLeft: cat.left + cat.width < box.width,
    askOnRight: cat.left < 40,
  };
}

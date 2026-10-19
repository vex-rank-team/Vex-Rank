/**
 * Hash routing for the single-page app.
 *
 * Hash rather than path: the static build is served from GitHub Pages under
 * /Vex-Rank/, which has no SPA fallback, so a cold load of
 * /Vex-Rank/teams/31260X would 404. A hash survives any static host.
 *
 * Routes: #/  #/events  #/events/:id  #/events/:id/teams/:number  #/rankings
 *         #/stats  #/teams  #/teams/:number  #/skills  #/jumper
 */

/** Build the address-bar hash for the current view and selection. */
export function routeToHash(view, team, event) {
  if (view === 'team') return team?.number ? `#/teams/${encodeURIComponent(team.number)}` : '#/teams';
  if (view === 'teamEvent') {
    // One team's matches at one event needs both halves; without either it is
    // the event (or the event list), never a page with nothing to show.
    if (!event?.id) return '#/events';
    if (!team?.number) return `#/events/${encodeURIComponent(String(event.id))}`;
    return `#/events/${encodeURIComponent(String(event.id))}/teams/${encodeURIComponent(team.number)}`;
  }
  if (view === 'event') return event?.id ? `#/events/${encodeURIComponent(String(event.id))}` : '#/events';
  if (view === 'home') return '#/';
  if (view === 'stats') return '#/rankings'; // Stat leaders is hidden until its data is ready.
  return `#/${view}`;
}

/**
 * Parse a hash into a view plus any identifier it carries.
 * Returns null for anything unrecognised so the caller can ignore it rather
 * than navigating somewhere arbitrary.
 */
export function hashToRoute(hash) {
  const parts = String(hash ?? '').replace(/^#\/?/, '').split('/').filter(Boolean);
  if (!parts.length) return { view: 'home' };
  let head, param, sub, subParam;
  try {
    head = decodeURIComponent(parts[0]);
    param = parts[1] ? decodeURIComponent(parts[1]) : undefined;
    sub = parts[2] ? decodeURIComponent(parts[2]) : undefined;
    subParam = parts[3] ? decodeURIComponent(parts[3]) : undefined;
  } catch {
    return null; // malformed percent-encoding
  }
  if (head === 'events' && param && sub === 'teams' && subParam) return { view: 'teamEvent', eventId: param, teamNumber: subParam };
  if (head === 'events') return param ? { view: 'event', eventId: param } : { view: 'events' };
  if (head === 'teams') return param ? { view: 'team', teamNumber: param } : { view: 'teams' };
  if (head === 'rankings' || head === 'stats') return { view: 'rankings' };
  if (head === 'skills' || head === 'jumper') return { view: head };
  return null;
}

/**
 * Scouting logic for the skills leaderboard, team comparison, "near me" and
 * date filters, the ⌘K search and the livestream Jumper. Pure functions,
 * tested in tests/scout.test.mjs.
 */

const lower = value => String(value ?? '').toLowerCase();

// --- World skills -----------------------------------------------------------

/**
 * Filter the world skills list the way the leaderboard's controls do.
 * @param {any[]} rows
 * @param {{ grade?: string, country?: string, region?: string, search?: string }} [filters]
 * @returns {any[]}
 */
export function filterSkills(rows, { grade = 'All', country = 'All', region = 'All', search = '' } = {}) {
  const query = lower(search).trim();
  return rows.filter(row =>
    (grade === 'All' || row.grade === grade)
    && (country === 'All' || row.country === country)
    && (region === 'All' || String(row.region).split(',')[0].trim() === region)
    && (!query || [row.number, row.name, row.organization, row.region].some(field => lower(field).includes(query))));
}

/**
 * "Where would I place?": the rank a combined score would take in `rows`
 * (already filtered), with the teams just above and below it. Ties go to the
 * team with the higher programming score, as in the official skills ranking.
 */
export function wouldPlace(rows, { auto = 0, driver = 0 } = {}) {
  const combined = Number(auto) + Number(driver);
  const ahead = rows.filter(row => row.combinedSkills > combined
    || (row.combinedSkills === combined && row.autoSkills > Number(auto)));
  const rank = ahead.length + 1;
  const sorted = [...rows].sort((a, b) => b.combinedSkills - a.combinedSkills || b.autoSkills - a.autoSkills);
  return {
    combined,
    rank,
    of: rows.length + 1,
    percentile: rows.length ? Math.round((1 - ahead.length / (rows.length + 1)) * 100) : 100,
    above: sorted[ahead.length - 1] ?? null,
    below: sorted[ahead.length] ?? null,
  };
}

/** Countries and regions present in the list, for the filter menus. */
export function skillsFacets(rows, country = 'All') {
  const countries = [...new Set(rows.map(row => row.country).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const regions = [...new Set(rows.filter(row => country === 'All' || row.country === country)
    .map(row => String(row.region).split(',')[0].trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return { countries, regions };
}

// --- Compare ----------------------------------------------------------------

/** Rows of the comparison table; `best` marks the leading column(s). */
export const COMPARE_METRICS = [
  { key: 'rating', label: 'VCR rating', better: 'higher' },
  { key: 'rank', label: 'World rank', better: 'lower' },
  { key: 'winRate', label: 'Win rate', better: 'higher', format: 'percent' },
  { key: 'matches', label: 'Matches', better: 'higher' },
  { key: 'events', label: 'Events', better: 'higher' },
  { key: 'opr', label: 'OPR', better: 'higher', format: 'decimal' },
  { key: 'dpr', label: 'DPR', better: 'lower', format: 'decimal' },
  { key: 'ccwm', label: 'CCWM', better: 'higher', format: 'decimal' },
  { key: 'combinedSkills', label: 'Skills (best)', better: 'higher' },
  { key: 'skillsRank', label: 'World skills rank', better: 'lower' },
];

/** Merge a ranking row and a skills row into one comparable team. */
export function compareProfile(number, ranking, skills) {
  const record = String(ranking?.record ?? '').split(/[–-]/).map(Number);
  const played = ranking?.matches ?? (record.length === 3 ? record[0] + record[1] + record[2] : null);
  return {
    number,
    name: ranking?.name ?? skills?.name ?? '',
    region: ranking?.region ?? skills?.region ?? '',
    rating: ranking?.rating ?? null,
    confidence: ranking?.confidence ?? null,
    rank: ranking?.rank ?? null,
    record: ranking?.record ?? null,
    winRate: played && record.length === 3 ? (record[0] + 0.5 * record[2]) / played : null,
    matches: played ?? null,
    events: ranking?.events ?? null,
    opr: ranking?.opr ?? null,
    dpr: ranking?.dpr ?? null,
    ccwm: ranking?.ccwm ?? null,
    combinedSkills: skills?.combinedSkills ?? null,
    skillsRank: skills?.skillsRank ?? null,
  };
}

export function compareTable(profiles, metrics = COMPARE_METRICS) {
  return metrics.map(metric => {
    const values = profiles.map(profile => profile[metric.key] ?? null);
    const present = values.filter(value => value != null);
    const target = present.length < 2 ? null : metric.better === 'lower' ? Math.min(...present) : Math.max(...present);
    return { ...metric, values, best: values.map(value => target != null && value === target) };
  });
}

// --- Events: near me and dates ------------------------------------------------

/** Great-circle distance in kilometres. */
export function distanceKm(a, b) {
  const rad = degrees => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Events within `radiusKm` of `here`, nearest first, each with its distance. */
export function nearby(events, here, radiusKm = 300) {
  return events
    .filter(event => Number.isFinite(event.lat) && Number.isFinite(event.lon))
    .map(event => ({ ...event, distanceKm: Math.round(distanceKm(here, { lat: event.lat, lon: event.lon })) }))
    .filter(event => event.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

const day = iso => String(iso ?? '').slice(0, 10);
const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
/** Whether an event (start `date`, optional `endDate`) is on today, or within three days of it. */
export function onDay(event, today, window = 0) {
  const start = day(event.date), end = day(event.endDate || event.date);
  return start <= addDays(today, window) && end >= addDays(today, -window);
}

// --- ⌘K search ------------------------------------------------------------------

/** How well `text` matches `query`: 0 for no match, higher is better. */
export function matchScore(query, text) {
  const q = lower(query).trim(), t = lower(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.split(/[\s·,:()-]+/).some(word => word.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  return 0;
}

/**
 * Results for the command palette: pages, teams and events, best first.
 * Team numbers win over everything when the query looks like one.
 * @param {string} query
 * @param {{ pages?: any[], teams?: any[], events?: any[] }} [index]
 * @param {number} [limit]
 * @returns {any[]}
 */
export function searchAll(query, { pages = [], teams = [], events = [] } = {}, limit = 12) {
  const q = String(query ?? '').trim();
  if (!q) return pages.slice(0, limit).map(page => ({ type: 'page', ...page, score: 1 }));
  const looksLikeTeam = /^\d{1,6}[a-z]{0,2}$/i.test(q);
  const results = [
    ...pages.map(page => ({ type: 'page', ...page, score: matchScore(q, page.label) * 0.9 })),
    ...teams.map(team => ({ type: 'team', ...team, label: team.number, detail: [team.name, team.region].filter(Boolean).join(' · '),
      score: Math.max(matchScore(q, team.number) * (looksLikeTeam ? 1.5 : 1.2), matchScore(q, team.name) * 0.8, matchScore(q, team.organization) * 0.5) })),
    ...events.map(event => ({ type: 'event', ...event, label: event.name, detail: [event.date, event.city].filter(Boolean).join(' · '),
      score: Math.max(matchScore(q, event.name) * 0.7, matchScore(q, event.sku), matchScore(q, event.city) * 0.4) })),
  ];
  return results.filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// --- Jumper -------------------------------------------------------------------------

/** The video id from any YouTube link shape, or null. */
export function youTubeId(input) {
  const text = String(input ?? '').trim();
  if (/^[\w-]{11}$/.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^[\w-]{11}$/.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:live|embed|shorts|v)\/([\w-]{11})/)?.[1];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }
  } catch { /* not a URL */ }
  return null;
}

/** "1:02:03", "62:03", "3723" or "1h2m3s" → seconds, or null. */
export function parseTimestamp(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return Number(text);
  const hms = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i);
  if (hms && hms[0]) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d+$/.test(part))) return null;
  return parts.map(Number).reduce((total, part) => total * 60 + part, 0);
}

export function formatTimestamp(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** The SKU in an events.vex.com / robotevents link or typed on its own, or null. */
export function eventSku(input) {
  return String(input ?? '').toUpperCase().match(/RE-[A-Z0-9]+-\d{2}-\d{3,5}/)?.[0] ?? null;
}

/**
 * Where each match sits in the stream. The reader syncs once ("Q12 starts at
 * 1:02:03"); every other match is placed by its official start time relative
 * to that one. Matches without a start time, or before the stream began,
 * are left out.
 */
export function streamTimes(matches, anchor) {
  const at = match => Date.parse(match.started || match.scheduled || '');
  const reference = matches.find(match => String(match.id) === String(anchor?.matchId));
  if (!reference || !Number.isFinite(at(reference)) || !Number.isFinite(anchor?.seconds)) return new Map();
  const zero = at(reference) - anchor.seconds * 1000;
  const times = new Map();
  for (const match of matches) {
    const when = at(match);
    if (!Number.isFinite(when)) continue;
    const seconds = Math.round((when - zero) / 1000);
    if (seconds >= 0) times.set(String(match.id), seconds);
  }
  return times;
}

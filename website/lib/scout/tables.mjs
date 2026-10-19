/**
 * Scouting tables: the full event rankings, sorting any column, and the CSV
 * and calendar files the pages offer for download. No React or browser APIs,
 * so tests/scout.test.mjs runs every rule directly.
 */
import { powerRatings, awpCount, eventSkillTotals, allianceNumbers, isPlayed, isQualification } from '../team-event.mjs';

const upper = value => String(value ?? '').toUpperCase();
const round1 = value => value == null || !Number.isFinite(value) ? null : Math.round(value * 10) / 10;

/** Column definitions shared by the table, its sort and its CSV export. */
export const EVENT_RANKING_COLUMNS = [
  { key: 'rank', label: 'Rank', better: 'lower' },
  { key: 'number', label: 'Team', text: true },
  { key: 'record', label: 'Record', text: true, sortKey: 'winRate' },
  { key: 'wp', label: 'WP', better: 'higher', hint: 'Win points' },
  { key: 'ap', label: 'AP', better: 'higher', hint: 'Autonomous points' },
  { key: 'sp', label: 'SP', better: 'higher', hint: 'Strength of schedule points' },
  { key: 'awp', label: 'AWP', better: 'higher', hint: 'Autonomous win points earned' },
  { key: 'high', label: 'High', better: 'higher', hint: 'Highest alliance score' },
  { key: 'avg', label: 'Avg', better: 'higher', hint: 'Average alliance score in qualification matches' },
  { key: 'opr', label: 'OPR', better: 'higher', hint: 'Offensive power rating' },
  { key: 'dpr', label: 'DPR', better: 'lower', hint: 'Defensive power rating: points conceded, lower is better' },
  { key: 'ccwm', label: 'CCWM', better: 'higher', hint: 'Calculated contribution to winning margin' },
  { key: 'skills', label: 'Skills', better: 'higher', hint: 'Best driver + programming at this event' },
];

/**
 * One row per ranked team in a division, with the official ranking numbers
 * and the ones worked out from its matches.
 */
export function eventRankingRows(division, skills = []) {
  const ratings = powerRatings(division);
  const skillTotals = eventSkillTotals(skills);
  const anySkills = skillTotals.size > 0;
  const scores = new Map();
  for (const match of division?.matches ?? []) {
    if (!isQualification(match) || !isPlayed(match)) continue;
    for (const alliance of match.alliances ?? []) {
      for (const team of allianceNumbers(alliance).map(upper)) {
        const list = scores.get(team) ?? [];
        list.push(Number(alliance.score));
        scores.set(team, list);
      }
    }
  }
  return (division?.rankings ?? []).map(row => {
    const number = upper(row.team?.name ?? row.team?.number);
    const played = Number(row.wins ?? 0) + Number(row.losses ?? 0) + Number(row.ties ?? 0);
    const mine = scores.get(number) ?? [];
    const stats = ratings.stats.get(number);
    return {
      rank: Number(row.rank),
      id: row.team?.id,
      number,
      wins: Number(row.wins ?? 0),
      losses: Number(row.losses ?? 0),
      ties: Number(row.ties ?? 0),
      record: `${row.wins ?? 0}-${row.losses ?? 0}-${row.ties ?? 0}`,
      winRate: played ? (Number(row.wins ?? 0) + 0.5 * Number(row.ties ?? 0)) / played : null,
      wp: row.wp ?? null,
      ap: row.ap ?? null,
      sp: row.sp ?? null,
      awp: awpCount(row),
      high: row.highScore ?? (mine.length ? Math.max(...mine) : null),
      avg: mine.length ? round1(mine.reduce((sum, score) => sum + score, 0) / mine.length) : null,
      opr: round1(stats?.opr),
      dpr: round1(stats?.dpr),
      ccwm: round1(stats?.ccwm),
      skills: anySkills ? skillTotals.get(number) ?? 0 : null,
    };
  }).sort((a, b) => a.rank - b.rank);
}

/**
 * Sort by any column. `dir` 'best' puts the best value first (per the column's
 * `better`), 'worst' the reverse. Missing values always sink to the bottom.
 */
export function sortRows(rows, key, dir = 'best', columns = EVENT_RANKING_COLUMNS) {
  const column = columns.find(col => col.key === key);
  const field = column?.sortKey ?? key;
  const higherFirst = (column?.better ?? 'higher') === 'higher';
  const descending = dir === 'best' ? higherFirst : !higherFirst;
  return [...rows].sort((a, b) => {
    const x = a[field], y = b[field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string' || typeof y === 'string') {
      const order = String(x).localeCompare(String(y), 'en', { numeric: true });
      return dir === 'best' ? order : -order;
    }
    return descending ? y - x : x - y;
  });
}

/**
 * A CSV file (RFC 4180). Cells that a spreadsheet would run as a formula are
 * prefixed with an apostrophe, so a team name can never execute in Excel.
 */
export function toCsv(columns, rows) {
  const cell = value => {
    let text = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [columns.map(col => cell(col.label)).join(',')];
  for (const row of rows) lines.push(columns.map(col => cell(typeof col.value === 'function' ? col.value(row) : row[col.key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** A safe file name from free text: "RE-V5RC-26-4244 rankings.csv". */
export function fileName(...parts) {
  // Trim after cutting, so a name cut mid-phrase doesn't end in a space before the extension.
  return parts.filter(Boolean).join(' ').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || 'vex-rank';
}

const icsText = value => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = date => date.toISOString().slice(0, 10).replace(/-/g, '');
/** Lines over 75 octets are folded with CRLF + space, as RFC 5545 requires. */
function fold(line) {
  const out = [];
  let rest = line;
  while (new TextEncoder().encode(rest).length > 75) {
    let cut = 74;
    while (new TextEncoder().encode(rest.slice(0, cut)).length > 74) cut -= 1;
    out.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * An all-day calendar entry for an event (.ics), so it lands on the right
 * days in any time zone. `now` is injectable for tests.
 * @param {{ id?: any, sku?: string, name: string, start: string, end?: string, location?: string, url?: string }} event
 * @param {Date} [now]
 */
export function eventIcs({ id, sku, name, start, end, location, url }, now = new Date()) {
  const first = new Date(String(start).slice(0, 10) + 'T12:00:00Z');
  const last = new Date(String(end || start).slice(0, 10) + 'T12:00:00Z');
  const after = new Date(last.getTime() + 86400000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//VEX-Rank//Events//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${icsText(sku || id)}@vex-rank.com`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART;VALUE=DATE:${icsDate(first)}`,
    `DTEND;VALUE=DATE:${icsDate(after)}`,
    `SUMMARY:${icsText(name)}`,
    ...(location ? [`LOCATION:${icsText(location)}`] : []),
    ...(url ? [`URL:${icsText(url)}`, `DESCRIPTION:${icsText(`${sku ? `${sku}\n` : ''}${url}`)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

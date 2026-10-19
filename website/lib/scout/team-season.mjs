/**
 * A team's season at a glance, from the team endpoint's history: totals for
 * the stat tiles and one point per event for the over-time charts.
 */
import { awpCount } from '../team-event.mjs';

/**
 * Per-event points for one season, oldest first. Each point carries that
 * event's record and WP, the running win rate up to and including it, and the
 * best skills runs there.
 */
export function seasonSeries(history, seasonId) {
  const events = new Map((history?.events ?? []).filter(e => e.seasonId === seasonId).map(e => [e.id, e]));
  const skills = new Map();
  for (const run of history?.skills ?? []) {
    if (run.seasonId !== seasonId) continue;
    const best = skills.get(run.eventId) ?? { driver: 0, programming: 0 };
    if (run.type === 'driver') best.driver = Math.max(best.driver, Number(run.score) || 0);
    if (run.type === 'programming') best.programming = Math.max(best.programming, Number(run.score) || 0);
    skills.set(run.eventId, best);
  }
  // A team can rank in more than one division of an event (e.g. Worlds round robin);
  // their rows are combined into one point for the event.
  const byEvent = new Map();
  for (const row of history?.rankings ?? []) {
    if (row.seasonId !== seasonId) continue;
    const point = byEvent.get(row.eventId) ?? { wins: 0, losses: 0, ties: 0, wp: 0, awp: 0, awpKnown: false };
    point.wins += Number(row.wins ?? 0); point.losses += Number(row.losses ?? 0); point.ties += Number(row.ties ?? 0);
    point.wp += Number(row.wp ?? 0);
    const awp = awpCount(row);
    if (awp != null) { point.awp += awp; point.awpKnown = true; }
    byEvent.set(row.eventId, point);
  }
  const ids = new Set([...byEvent.keys(), ...skills.keys()]);
  const dated = [...ids].map(id => ({ id, event: events.get(id), date: String(events.get(id)?.start ?? '').slice(0, 10) }))
    .filter(entry => entry.date).sort((a, b) => a.date.localeCompare(b.date));
  let wins = 0, ties = 0, played = 0;
  return dated.map(({ id, event, date }) => {
    const r = byEvent.get(id);
    const matches = r ? r.wins + r.losses + r.ties : 0;
    if (r) { wins += r.wins; ties += r.ties; played += matches; }
    const s = skills.get(id);
    return {
      eventId: id,
      date,
      label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      event: event?.name ?? '',
      record: r ? `${r.wins}-${r.losses}-${r.ties}` : null,
      winRate: played ? Math.round(((wins + 0.5 * ties) / played) * 1000) / 10 : null,
      wpPerMatch: r && matches ? Math.round((r.wp / matches) * 100) / 100 : null,
      awp: r?.awpKnown ? r.awp : null,
      driver: s?.driver ?? null,
      programming: s?.programming ?? null,
      skills: s ? s.driver + s.programming : null,
    };
  });
}

/** Totals across the season for the stat tiles. */
export function seasonTotals(series) {
  const ranked = series.filter(point => point.record);
  const [wins, losses, ties] = ranked.reduce((sum, point) => point.record.split('-').map((n, i) => sum[i] + Number(n)), [0, 0, 0]);
  const matches = wins + losses + ties;
  const skills = series.filter(point => point.skills != null);
  const awpPoints = ranked.filter(point => point.awp != null);
  return {
    events: series.length,
    record: `${wins}-${losses}-${ties}`,
    matches,
    winRate: matches ? Math.round(((wins + 0.5 * ties) / matches) * 1000) / 10 : null,
    wpPerMatch: matches ? Math.round((ranked.reduce((sum, point) => sum + (point.wpPerMatch ?? 0) * point.record.split('-').reduce((a, n) => a + Number(n), 0), 0) / matches) * 100) / 100 : null,
    awp: awpPoints.length ? awpPoints.reduce((sum, point) => sum + point.awp, 0) : null,
    bestSkills: skills.length ? Math.max(...skills.map(point => point.skills)) : null,
  };
}

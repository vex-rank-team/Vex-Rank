'use client';
/**
 * The team page's season panel: stat tiles, four over-time charts and a
 * downloadable team card image, for the season the reader has selected.
 */
import { useEffect, useMemo } from 'react';
import { ImageDown } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useScout } from './ScoutProvider';
import { TeamTools } from './Widgets';
import { VoteButtons } from './AccountMenu';
import { seasonSeries, seasonTotals } from '@/lib/scout/team-season.mjs';

const tile = 'border border-white/10 bg-[var(--c-surface)] p-4';

function Chart({ title, data, lines, unit = '', domain }: { title: string; data: any[]; lines: { key: string; name: string; color: string }[]; unit?: string; domain?: [number, number] }) {
  const usable = data.filter(point => lines.some(line => point[line.key] != null));
  return <figure className={tile}>
    <figcaption className="mb-2 text-sm font-semibold">{title}</figcaption>
    {usable.length ? <div className="h-40"><ResponsiveContainer width="100%" height="100%">
      <LineChart data={usable} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: 'rgba(255,255,255,.45)', fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis domain={domain ?? ['auto', 'auto']} tick={{ fill: 'rgba(255,255,255,.45)', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: 'var(--c-surface-2)', border: '1px solid rgba(255,255,255,.15)', fontSize: 12 }} labelFormatter={(_, payload) => payload?.[0]?.payload?.event ?? ''} formatter={(value: any, name: any) => [`${value}${unit}`, name]} />
        {lines.map(line => <Line key={line.key} type="monotone" dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer></div> : <p className="py-10 text-center text-xs text-white/40">No data this season yet.</p>}
  </figure>;
}

/** A 1200×630 share image of the team's season, drawn in VEX-Rank's colours. */
function drawCard({ number, name, region, season, totals, ranking, skillsRank }: any) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext('2d')!;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--c-accent').trim() || '#ee3240';
  const page = css.getPropertyValue('--c-page').trim() || '#0b0d11';
  const font = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  ctx.fillStyle = page; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 1200, 10);
  ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.font = `600 24px ${font}`; ctx.fillText(`V5RC · ${season}`, 70, 90);
  ctx.fillStyle = '#fff'; ctx.font = `700 150px ${font}`;
  const digits = number.match(/^\d*/)[0];
  ctx.fillText(digits, 64, 250);
  ctx.fillStyle = accent; ctx.fillText(number.slice(digits.length), 64 + ctx.measureText(digits).width, 250);
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = `600 38px ${font}`; ctx.fillText(name || '', 70, 315);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = `400 26px ${font}`; ctx.fillText(region || '', 70, 358);
  const stats: [string, string][] = [
    ['VCR', ranking ? `${ranking.rating}` : '—'], ['World rank', ranking ? `#${ranking.rank}` : '—'],
    ['Record', totals.record], ['Win rate', totals.winRate != null ? `${totals.winRate}%` : '—'],
    ['Best skills', totals.bestSkills != null ? String(totals.bestSkills) : '—'], ['Skills rank', skillsRank ? `#${skillsRank}` : '—'],
  ];
  stats.forEach(([label, value], i) => {
    const x = 70 + i * 178;
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = `600 18px ${font}`; ctx.fillText(label.toUpperCase(), x, 450);
    ctx.fillStyle = '#fff'; ctx.font = `700 40px ${font}`; ctx.fillText(value, x, 500);
  });
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = `400 18px ${font}`;
  ctx.fillText('vex-rank.com · Not affiliated with VEX Robotics. Ratings are VEX-Rank calculations, not official.', 70, 585);
  return canvas;
}

export default function TeamScout({ history, seasonId, seasonName, number, name, region }: { history: any; seasonId: number | undefined; seasonName: string; number: string; name: string; region: string }) {
  const { teamRows, skillRows, loadSkills } = useScout();
  useEffect(() => { loadSkills().catch(() => {}); }, [loadSkills]);
  const series = useMemo(() => seasonId ? seasonSeries(history, seasonId) : [], [history, seasonId]);
  const totals = useMemo(() => seasonTotals(series), [series]);
  const current = seasonId === 204;
  const ranking = current ? teamRows.find(row => String(row.number).toUpperCase() === number.toUpperCase()) : null;
  const skills = current ? skillRows.find(row => String(row.number).toUpperCase() === number.toUpperCase()) : null;
  const save = () => {
    const canvas = drawCard({ number, name, region, season: seasonName, totals, ranking, skillsRank: skills?.skillsRank });
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement('a'), { href: url, download: `${number} ${seasonName}.png` });
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');
  };
  const tiles: [string, string, string][] = [
    ['Record', totals.matches ? totals.record : '—', `${totals.matches} matches · ${totals.events} events`],
    ['Win rate', totals.winRate != null ? `${totals.winRate}%` : '—', 'Ties count as half'],
    ['WP per match', totals.wpPerMatch != null ? String(totals.wpPerMatch) : '—', 'Average win points'],
    ['Autonomous WP', totals.awp != null ? String(totals.awp) : '—', 'Earned this season'],
    ['Best skills', totals.bestSkills != null ? String(totals.bestSkills) : '—', 'Driver + programming, one event'],
    ['World skills', skills ? `#${skills.skillsRank}` : current ? '—' : 'Current season only', skills ? `${skills.combinedSkills} points` : ''],
  ];
  return <section aria-labelledby="season-at-a-glance" className="mt-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 id="season-at-a-glance" className="font-display text-2xl">Season at a glance <span className="text-base text-white/45">{seasonName}</span></h2>
      <div className="flex items-center gap-2"><VoteButtons target={`team:${number.toUpperCase()}`} /><TeamTools number={number} name={name} />
        <button onClick={save} className="inline-flex items-center gap-1.5 border border-white/15 px-3 py-1.5 text-xs text-white/65 hover:border-white/35 hover:text-white"><ImageDown className="h-3.5 w-3.5" aria-hidden="true" />Download team card</button></div>
    </div>
    <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{tiles.map(([label, value, detail]) => <div key={label} className={tile}>
      <p className="text-[11px] uppercase tracking-wider text-white/45">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p><p className="mt-0.5 text-[11px] text-white/40">{detail}</p></div>)}</div>
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <Chart title="Win rate over time" data={series} unit="%" domain={[0, 100]} lines={[{ key: 'winRate', name: 'Win rate', color: 'var(--c-accent)' }]} />
      <Chart title="Skills scores" data={series} lines={[{ key: 'driver', name: 'Driver', color: '#38bdf8' }, { key: 'programming', name: 'Programming', color: '#a3e635' }]} />
      <Chart title="Win points per match" data={series} lines={[{ key: 'wpPerMatch', name: 'WP / match', color: '#f5a524' }]} />
      <Chart title="Autonomous win points per event" data={series} lines={[{ key: 'awp', name: 'AWP', color: '#c084fc' }]} />
    </div>
  </section>;
}

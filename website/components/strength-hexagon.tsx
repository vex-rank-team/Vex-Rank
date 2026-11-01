'use client';
import { useEffect, useId, useState } from 'react';

export type StrengthAxis = {
  key: string;
  label: string;
  title: string;
  /** 'higher' or 'lower': which way is better. */
  better: string;
  display: string;
  /** 0 (bottom of the division) to 1 (top); null when there is no data yet. */
  score: number | null;
  place: number | null;
  of: number;
};

const SIZE = 360;
const CENTRE = SIZE / 2;
const RADIUS = 118;
const RINGS = [0.25, 0.5, 0.75, 1];

/** Axis i of n, clockwise from the top. */
function point(index: number, count: number, fraction: number) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return [CENTRE + Math.cos(angle) * RADIUS * fraction, CENTRE + Math.sin(angle) * RADIUS * fraction] as const;
}
const outline = (count: number, fraction: (i: number) => number) =>
  Array.from({ length: count }, (_, i) => point(i, count, fraction(i)).map(v => v.toFixed(1)).join(',')).join(' ');

/**
 * A team's strengths at one event, one axis per measure, each placed against
 * the rest of its division: the outer edge is the best team there, the centre
 * the worst, and the dashed ring the middle of the field. Placing rather than
 * plotting raw values is what lets points, ratings and rates share one shape.
 */
export default function StrengthHexagon({ axes, label }: { axes: StrengthAxis[]; label: string }) {
  const id = useId();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    // Grows out from the centre once; reduced motion gets the final shape.
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const n = axes.length;
  const summary = axes.map(axis => `${axis.label} ${axis.display}${axis.place ? `, ${ordinal(axis.place)} of ${axis.of}` : ''}`).join('; ');
  return <figure className="m-0">
    <svg viewBox={`-46 -6 ${SIZE + 92} ${SIZE + 12}`} className="mx-auto block w-full max-w-[480px]" aria-labelledby={id}>
      <title id={id}>{`${label}: ${summary}`}</title>
      {RINGS.map(ring => <polygon key={ring} points={outline(n, () => ring)} fill="none"
        stroke={ring === 0.5 ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.1)'} strokeDasharray={ring === 0.5 ? '4 4' : undefined} />)}
      {axes.map((axis, i) => { const [x, y] = point(i, n, 1); return <line key={axis.key} x1={CENTRE} y1={CENTRE} x2={x} y2={y} stroke="rgba(255,255,255,.1)" />; })}
      <g className="strength-shape" style={{ transformOrigin: `${CENTRE}px ${CENTRE}px`, transform: `scale(${grown ? 1 : 0.02})` }}>
        <polygon points={outline(n, i => axes[i].score ?? 0)} fill="var(--c-accent)" fillOpacity={0.22} stroke="var(--c-accent)" strokeWidth={2.5} strokeLinejoin="round" />
        {axes.map((axis, i) => { if (axis.score == null) return null; const [x, y] = point(i, n, axis.score); return <circle key={axis.key} cx={x} cy={y} r={4} fill="var(--c-accent)" stroke="var(--c-surface)" strokeWidth={2} />; })}
      </g>
      {axes.map((axis, i) => {
        const [x, y] = point(i, n, 1.2);
        const anchor = Math.abs(x - CENTRE) < 4 ? 'middle' : x > CENTRE ? 'start' : 'end';
        const missing = axis.score == null;
        return <g key={axis.key}>
          <title>{`${axis.title}${axis.better === 'lower' ? ' - lower is better' : ''}`}</title>
          <text x={x} y={y - 5} textAnchor={anchor} className="fill-white/60 text-[14px] font-semibold uppercase tracking-wider">{axis.label}</text>
          <text x={x} y={y + 14} textAnchor={anchor} className={`font-mono text-[15px] ${missing ? 'fill-white/35' : 'fill-white'}`}>{axis.display}</text>
        </g>;
      })}
    </svg>
  </figure>;
}

export function ordinal(n: number) {
  const tail = n % 100;
  const suffix = tail >= 11 && tail <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

/* Paths render solid until the dash properties are applied, so this has to run
   before paint or the finished number flashes for a frame. useLayoutEffect has
   no server equivalent, hence the guard. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;
import { strokesFor, canDraw, GLYPH_ADVANCE, GLYPH_HEIGHT } from '@/lib/stroke-glyphs.mjs';

/**
 * Draws a team number the way a person writes it: one stroke at a time, in
 * order, at a constant pen speed.
 *
 * Each stroke is traced with stroke-dashoffset. Duration is proportional to the
 * stroke's own length, so a long diagonal takes longer than a short crossbar -
 * a fixed duration per stroke is what makes this kind of animation read as
 * mechanical rather than handwritten.
 */
const STROKE_WIDTH = 7;

export default function SignedNumber({ value, accentFrom, className = '' }: { value: string; accentFrom?: number; className?: string }) {
  const root = useRef<SVGSVGElement | null>(null);
  const text = String(value ?? '');

  useBeforePaint(() => {
    const svg = root.current;
    if (!svg) return;
    const paths = [...svg.querySelectorAll('path')];
    const characterCount = Array.from(text).length;
    if (!paths.length) return;

    // Reduced motion: leave it fully written rather than animating or hiding.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      paths.forEach(path => { path.style.strokeDasharray = 'none'; path.style.strokeDashoffset = '0'; });
      return;
    }

    const PEN_SPEED = 0.92;   // ms per user unit, at the start of the signature
    const PEN_LIFT = 56;      // pause between strokes, as the hand repositions
    const FINAL_DRAG = 1.35;  // extra slowness by the last character (2.35x total)
    const animations: Animation[] = [];
    let at = 180;             // let the profile header settle first

    // Deceleration is keyed to the character, not the stroke: a hand eases off
    // through the whole final character rather than only its last stroke.
    const lastCharacter = Math.max(1, characterCount - 1);

    for (const path of paths) {
      const characterIndex = Number(path.dataset.character ?? 0);
      const through = characterIndex / lastCharacter;          // 0 -> 1
      // Pow > 1 keeps the early characters near full speed and concentrates the
      // slowdown at the end, which is where it reads as deliberate rather than
      // as the whole thing simply being sluggish.
      const drag = 1 + FINAL_DRAG * through ** 1.7;

      const length = path.getTotalLength();
      // The gap must be longer than the path, not merely equal to it.
      // A one-value stroke-dasharray of L expands to [L, L] - a pattern of
      // period 2L that repeats - so an offset of exactly L leaves a zero-length
      // dash at position 0, which stroke-linecap: round paints as a dot, and
      // merely pushing the offset past that just wraps the dash back in at the
      // far end of the path as a short stub. Giving the gap L + 2*strokeWidth
      // makes the period long enough that the dash re-enters beyond the path
      // end, so an undrawn stroke paints nothing at all.
      const parked = length + STROKE_WIDTH;
      path.style.strokeDasharray = `${length} ${length + STROKE_WIDTH * 2}`;
      path.style.strokeDashoffset = String(parked);
      const duration = Math.max(120, length * PEN_SPEED * drag);
      animations.push(path.animate(
        [{ strokeDashoffset: parked }, { strokeDashoffset: 0 }],
        { duration, delay: at, easing: 'cubic-bezier(0.32, 0, 0.35, 1)', fill: 'both' },
      ));
      at += duration + PEN_LIFT * drag;
    }
    return () => animations.forEach(animation => animation.cancel());
  }, [text]);

  // Anything outside the glyph set (unexpected punctuation) falls back to text
  // rather than rendering a gap.
  if (!canDraw(text)) return <span className={className}>{text}</span>;

  const characters = Array.from(text);
  const width = characters.length * GLYPH_ADVANCE;
  return (
    <svg
      ref={root}
      className={className}
      viewBox={`-6 -6 ${width + 12} ${GLYPH_HEIGHT + 24}`}
      aria-hidden="true"
      preserveAspectRatio="xMinYMid meet"
      style={{ overflow: 'visible' }}
    >
      {characters.map((character, index) => (
        <g key={`${character}-${index}`} transform={`translate(${index * GLYPH_ADVANCE} 0)`}>
          {(strokesFor(character) as string[]).map((d, stroke) => (
            <path
              key={stroke}
              d={d}
              fill="none"
              stroke={accentFrom !== undefined && index >= accentFrom ? 'var(--c-accent)' : 'currentColor'}
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-character={index}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

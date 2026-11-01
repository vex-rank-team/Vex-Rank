/** Draws Paka's frames (pixels.mjs) as crisp SVG. */
import { frame, PALETTE_COLOURS } from './pixels.mjs';

export type Eyes = 'open' | 'closed' | 'wide' | 'happy' | 'wink';
export type Coat = { palette: string; pattern: string };

/** One rect per horizontal run of a colour: ~60 rects instead of ~200. */
function runs(rows: string[]) {
  const rects: { x: number; y: number; w: number; c: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === c) end += 1;
      if (c !== '.') rects.push({ x, y, w: end - x, c });
      x = end;
    }
  });
  return rects;
}

export function PakaSprite({ coat, eyes, tailUp, tongue = false, size = 64 }: { coat: Coat; eyes: Eyes; tailUp: boolean; tongue?: boolean; size?: number }) {
  const colours = (PALETTE_COLOURS as Record<string, Record<string, string>>)[coat.palette] ?? PALETTE_COLOURS.grey;
  return <svg viewBox="0 0 16 16" width={size} height={size} shapeRendering="crispEdges" aria-hidden="true" style={{ imageRendering: 'pixelated', display: 'block' }}>
    {runs(frame(eyes, tailUp, coat.pattern, tongue) as string[]).map(({ x, y, w, c }) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height={1} fill={colours[c]} />)}
  </svg>;
}

const HEART = ['.oo.oo.', 'ohhohho', 'ohhhhho', '.ohhho.', '..oho..', '...o...'];

export function PixelHeart({ size = 14 }: { size?: number }) {
  return <svg viewBox="0 0 7 6" width={size} height={size * 6 / 7} shapeRendering="crispEdges" aria-hidden="true">
    {HEART.flatMap((row, y) => row.split('').map((c, x) => c === '.' ? null
      : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={c === 'o' ? '#5b1020' : 'var(--c-accent)'} />))}
  </svg>;
}

/** The paw shown in place of a hidden Paka. */
export function PixelPaw({ size = 18 }: { size?: number }) {
  const rows = ['.o.o.', 'o.o.o', '.....', '.ooo.', 'ooooo', '.ooo.'];
  return <svg viewBox="0 0 5 6" width={size} height={size * 6 / 5} shapeRendering="crispEdges" aria-hidden="true">
    {rows.flatMap((row, y) => row.split('').map((c, x) => c === 'o' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null))}
  </svg>;
}

/** The speech bubble on the Ask button. */
export function PixelChat({ size = 18 }: { size?: number }) {
  const rows = ['.oooooo.', 'o......o', 'o.o.o..o', 'o......o', '.oo.ooo.', '..oo....'];
  return <svg viewBox="0 0 8 6" width={size} height={size * 6 / 8} shapeRendering="crispEdges" aria-hidden="true">
    {rows.flatMap((row, y) => row.split('').map((c, x) => c === 'o' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null))}
  </svg>;
}

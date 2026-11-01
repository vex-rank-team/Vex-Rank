/**
 * Single-stroke (centreline) glyph paths, for tracing text the way a pen draws
 * it rather than revealing a filled typeface.
 *
 * A normal font stores the *outline* of a glyph - the boundary of the filled
 * shape - so animating it traces the edge of each letter, drawing both sides of
 * every stem at once. Handwriting follows the pen's centreline instead, in
 * stroke order, which is what plotter/engraving fonts encode. These are
 * authored in that form.
 *
 * Coordinate space: each glyph occupies x 0..60, y 0..100, cap height at y=6
 * and baseline at y=95. Every entry is an ordered list of strokes, and every
 * stroke is drawn in the direction a right-handed writer would move.
 */

export const GLYPH_ADVANCE = 68;
export const GLYPH_HEIGHT = 100;

const G = {
  '0': ['M30,6 C13,6 5,27 5,50 C5,73 13,95 30,95 C47,95 55,73 55,50 C55,27 47,6 30,6'],
  '1': ['M12,24 L30,6 L30,95'],
  '2': ['M7,26 C7,10 22,3 35,8 C51,15 43,33.7 34,49 L7,95 L54,95'],
  '3': ['M8,18 C15,6 35,2 45,13 C55,24 46,41 30,46 C48,46 59,61 52,77 C45,93 21,98 7,86'],
  '4': ['M41,6 L5,67 L55,67', 'M41,6 L41,95'],
  '5': ['M49,6 L16,6 L12,43 C25,34 45,39 51,55 C57,73 44,93 24,94 C16,95 10,92 6,86'],
  '6': ['M47,11 C31,2 12,19 8,45 C4,73 13,95 30,95 C47,95 55,80 50,66 C45,52 27,46 15,57'],
  '7': ['M6,7 L54,7 L23,95'],
  '8': ['M30,48 C13,44 8,30 12,18 C17,5 44,5 49,18 C53,30 47,44 30,48 C11,53 3,69 10,83 C17,97 44,97 51,83 C58,69 49,53 30,48'],
  '9': ['M51,53 C43,63 22,65 14,52 C6,39 11,20 27,10 C43,0 55,15 55,41 C55,71 46,89 25,95'],
  A: ['M5,95 L30,6 L55,95', 'M15,63 L45,63'],
  B: ['M11,6 L11,95', 'M11,6 L36,6 C53,6 53,45 36,48 L11,48', 'M11,48 L40,48 C59,48 59,95 38,95 L11,95'],
  C: ['M52,20 C44,8 26,2 16,14 C4,28 4,72 16,86 C26,98 44,92 52,80'],
  D: ['M11,6 L11,95', 'M11,6 L30,6 C55,6 59,95 28,95 L11,95'],
  E: ['M12,6 L12,95', 'M12,6 L51,6', 'M12,50 L42,50', 'M12,95 L51,95'],
  F: ['M12,95 L12,6 L51,6', 'M12,50 L42,50'],
  G: ['M52,20 C44,8 26,2 16,14 C4,28 4,72 16,86 C28,98 49,92 52,74 L52,56 L34,56'],
  H: ['M10,6 L10,95', 'M10,50 L50,50', 'M50,6 L50,95'],   // left stem, crossbar, right stem
  I: ['M14,6 L46,6', 'M30,6 L30,95', 'M14,95 L46,95'],
  J: ['M46,6 L46,72 C46,92 25,99 13,86'],
  K: ['M12,6 L12,95', 'M51,6 L12,53', 'M25,42 L53,95'],
  L: ['M12,6 L12,95 L51,95'],
  M: ['M7,95 L7,6 L30,58 L53,6 L53,95'],
  N: ['M10,95 L10,6 L50,95 L50,6'],
  O: ['M30,6 C12,6 4,28 4,50 C4,72 12,95 30,95 C48,95 56,72 56,50 C56,28 48,6 30,6'],
  P: ['M12,95 L12,6', 'M12,6 L36,6 C56,6 56,52 34,52 L12,52'],
  Q: ['M30,6 C12,6 4,28 4,50 C4,72 12,95 30,95 C48,95 56,72 56,50 C56,28 48,6 30,6', 'M36,73 L57,99'],
  R: ['M12,95 L12,6', 'M12,6 L36,6 C54,6 54,48 34,48 L12,48', 'M31,48 L53,95'],
  S: ['M51,18 C44,6 22,2 14,14 C6,27 15,41 30,48 C46,56 55,69 48,82 C41,96 17,96 7,84'],
  T: ['M7,6 L53,6', 'M30,6 L30,95'],
  U: ['M10,6 L10,66 C10,88 24,96 30,96 C36,96 50,88 50,66 L50,6'],
  V: ['M7,6 L30,95 L53,6'],
  W: ['M3,6 L16,95 L30,36 L44,95 L57,6'],
  X: ['M10,6 L50,95', 'M50,6 L10,95'],
  Y: ['M10,6 L30,50 L50,6', 'M30,50 L30,95'],
  Z: ['M10,6 L50,6 L10,95 L50,95'],
};

/** Ordered strokes for one character, or null when it has no glyph. */
export function strokesFor(character) {
  return G[String(character).toUpperCase()] ?? null;
}

/** Every character this set can draw; anything else should fall back to text. */
export function canDraw(text) {
  return String(text).length > 0 && Array.from(String(text)).every(c => strokesFor(c) !== null);
}

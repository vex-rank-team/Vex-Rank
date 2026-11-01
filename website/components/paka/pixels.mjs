/**
 * Paka as 16×16 pixel art. Each frame is a grid of letters, one per pixel:
 *   o outline   b body   s stripe/shade   w light fur (muzzle, belly)
 *   p pink (inner ear, blush)   n nose   e eye   g eye highlight   t tongue   . clear
 * Rows are assembled from parts so the eyes and tail animate independently.
 * Plain JS so the tests can check every frame (tests/paka-brain.test.mjs).
 */

export const HEAD = [
  '................',
  '.oo........oo...',
  '.opo......opo...',
  '.opbo....obpo...',
  '.obbboooobbbo...',
  '.obbbbbbbbbbo...',
];

export const EYES = {
  open: ['.obegbbbbegbo...', '.obeebbbbeebo...'],
  wide: ['.obgebbbbgebo...', '.obeebbbbeebo...'],
  closed: ['.obbbbbbbbbbo...', '.oboobbbboobo...'],
  happy: ['.obbbbbbbbbbo...', '.oboobbbboobo...'],
  wink: ['.obegbbbbbbbo...', '.obeebbbboobo...'],
};

const MUZZLE = { plain: '.obbbbnnbbbbo...', blush: '.opbbbnnbbbpo...' };

// Rows 9-15: the body, with the tail resting or flicked up.
export const TAIL_DOWN = [
  '.obbbwwwwbbbo...',
  '..obbbbbbbbo....',
  '..obbbwwbbbo....',
  '..obbbwwbbbo....',
  '..obbbwwbbbbooo.',
  '..obbbbbbbbbbbo.',
  '..ooooooooooooo.',
];
export const TAIL_UP = [
  '.obbbwwwwbbbo.o.',
  '..obbbbbbbbo.obo',
  '..obbbwwbbbo.obo',
  '..obbbwwbbbo.obo',
  '..obbbwwbbbooobo',
  '..obbbbbbbbbbbo.',
  '..ooooooooooooo.',
];

/** Pixels a pattern repaints, as [row, col, letter]. */
export const PATTERN_PIXELS = {
  solid: [],
  tabby: [[4, 4, 's'], [5, 5, 's'], [5, 8, 's'], [4, 9, 's'], [11, 3, 's'], [12, 4, 's'], [11, 10, 's'], [12, 9, 's'], [14, 5, 's'], [14, 9, 's']],
  tuxedo: [[10, 5, 'w'], [10, 6, 'w'], [10, 7, 'w'], [10, 8, 'w'], [11, 5, 'w'], [11, 8, 'w'], [12, 5, 'w'], [12, 8, 'w'], [13, 5, 'w'], [13, 8, 'w'], [14, 3, 'w'], [14, 4, 'w'], [14, 9, 'w'], [14, 10, 'w']],
};

export const PALETTE_COLOURS = {
  grey: { o: '#1d1c22', b: '#8d909a', s: '#62656f', w: '#ece8df', p: '#f2a7b5', n: '#e57b8b', e: '#1d1c22', g: '#ffffff', t: '#e05a72' },
  orange: { o: '#2a1a10', b: '#e9953c', s: '#b8621b', w: '#fbe9d0', p: '#f6a9a0', n: '#d9645a', e: '#2a1a10', g: '#ffffff', t: '#d9506a' },
  black: { o: '#08080a', b: '#34343d', s: '#22222a', w: '#e9e6df', p: '#c9808f', n: '#c9808f', e: '#f5d547', g: '#fffbe0', t: '#d9667e' },
  white: { o: '#4a4a55', b: '#f3f1ec', s: '#cfc9bd', w: '#ffffff', p: '#f4b2bf', n: '#e8899a', e: '#3b82f6', g: '#ffffff', t: '#e2607a' },
  cream: { o: '#3a2c1c', b: '#e8d5b0', s: '#c4a675', w: '#fbf6ea', p: '#f2b0b4', n: '#dd8a8f', e: '#3a2c1c', g: '#ffffff', t: '#d85a70' },
};

/** `tongue` sticks the tip out under the muzzle: a blep. */
export function frame(eyes, tailUp, pattern, tongue = false) {
  const rows = [
    ...HEAD,
    ...EYES[eyes],
    eyes === 'happy' ? MUZZLE.blush : MUZZLE.plain,
    ...(tailUp ? TAIL_UP : TAIL_DOWN),
  ].map(row => row.split(''));
  for (const [row, col, letter] of PATTERN_PIXELS[pattern] ?? []) {
    // Only repaint fur, so a pattern can never draw over an outline or an eye.
    if (rows[row]?.[col] === 'b') rows[row][col] = letter;
  }
  if (tongue) { rows[10][6] = 't'; rows[10][7] = 't'; }
  return rows.map(row => row.join(''));
}

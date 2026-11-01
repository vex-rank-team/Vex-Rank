/**
 * The two competition programs the site covers, and everything that differs
 * between them at the data layer. Routes, the Worker and the scripts read from
 * here instead of hard-coding V5 (program id 1, its seasons, its grades).
 *
 * Every VIQRC value below was checked against live responses on 2026-11-01;
 * see tests/fixtures/viqrc/README.md. V5 values are the ones the routes used
 * before this table existed, unchanged.
 */

/** Season windows: an event belongs to a season if it ends inside it. */
const season = (label, start, end) => Object.freeze({ label, start, end });

export const PROGRAMS = Object.freeze({
  V5RC: Object.freeze({
    code: 'V5RC',
    id: 1,
    name: 'VEX V5 Robotics Competition',
    short: 'V5',
    currentSeason: 204,
    seasons: Object.freeze({
      204: season('2026–27 Override', '2026-04-01T00:00:00Z', '2027-06-01T00:00:00Z'),
      197: season('2025–26 Push Back', '2025-04-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      190: season('2024–25 High Stakes', '2024-04-01T00:00:00Z', '2025-06-01T00:00:00Z'),
      181: season('2023–24 Over Under', '2023-04-01T00:00:00Z', '2024-06-01T00:00:00Z'),
      173: season('2022–23 Spin Up', '2022-04-01T00:00:00Z', '2023-06-01T00:00:00Z'),
    }),
    /** Seasons the world skills feed is served for. */
    skillsSeasons: Object.freeze(['197', '204']),
    grades: Object.freeze(['High School', 'Middle School']),
    /**
     * Grade names the public skills endpoint accepts, in request order. The
     * third is rejected by the endpoint ("Invalid Grade Level") and has always
     * contributed nothing; it stays so V5 requests are exactly as before.
     */
    skillsGrades: Object.freeze(['High School', 'Middle School', 'Elementary School']),
    /** Path segment of an event page on events.vex.com. */
    eventPath: 'vex-robotics-competition',
    /** Whether the published rating exists yet. */
    rated: true,
  }),
  VIQRC: Object.freeze({
    code: 'VIQRC',
    id: 41,
    name: 'VEX IQ Robotics Competition',
    short: 'IQ',
    currentSeason: 203,
    seasons: Object.freeze({
      203: season('2026–27 Level Up', '2026-04-01T00:00:00Z', '2027-06-01T00:00:00Z'),
      196: season('2025–26 Mix & Match', '2025-04-01T00:00:00Z', '2026-06-01T00:00:00Z'),
      189: season('2024–25 Rapid Relay', '2024-04-01T00:00:00Z', '2025-06-01T00:00:00Z'),
    }),
    skillsSeasons: Object.freeze(['189', '196', '203']),
    grades: Object.freeze(['Middle School', 'Elementary School']),
    // The skills endpoint names the younger grade "Elementary"; "Elementary
    // School" is rejected. Teams themselves carry "Elementary School".
    skillsGrades: Object.freeze(['Middle School', 'Elementary']),
    // Assumed from the site's naming (V5 events use vex-robotics-competition).
    // Not checkable from a script: events.vex.com answers every path with 403.
    eventPath: 'vex-iq-robotics-competition',
    // The IQ rating is VIQCR 1.1 (lib/viqcr.mjs), published by scripts/build-iq-ratings.mjs; see lib/vcr-iq.mjs.
    rated: false,
  }),
});

export const DEFAULT_PROGRAM = 'V5RC';

/** True only for the exact codes above. */
export function isProgram(value) {
  return value === 'V5RC' || value === 'VIQRC';
}

/** A request's program: VIQRC only when asked for by name, otherwise V5RC. */
export function programCode(value) {
  return value === 'VIQRC' ? 'VIQRC' : DEFAULT_PROGRAM;
}

/** Which program an upstream event, team or match belongs to, by its program id. */
export function programOf(record) {
  return Number(record?.program?.id) === PROGRAMS.VIQRC.id ? 'VIQRC' : 'V5RC';
}

/** The season id to use for a request: the requested one if the program has it. */
export function seasonFor(program, requested) {
  const table = PROGRAMS[programCode(program)];
  const key = String(requested ?? '');
  return table.seasons[key] ? key : String(table.currentSeason);
}

/** The official event page, built from the SKU the API supplies. */
export function officialEventUrl(program, sku) {
  return `https://events.vex.com/robot-competitions/${PROGRAMS[programCode(program)].eventPath}/${sku}.html`;
}

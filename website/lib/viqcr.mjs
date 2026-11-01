/**
 * VIQCR 1.1 - the VEX IQ competitive rating.
 *
 * Implements output/pdf/vex_iq_competitive_rating_full_algorithm.pdf
 * (VIQCR-1.1-candidate.1, November 1, 2026). Section names below follow the
 * specification. Four components, each a mean m and variance v in standardized
 * ability units:
 *
 *   Combined = 0.55 teamwork + 0.175 driving + 0.175 coding + 0.10 consistency
 *
 * There is no opponent anywhere in this file. The two one-team "stations" an IQ
 * match arrives as are partners sharing one score, never red against blue, and
 * nothing here may be fed V5 data (lib/vcr3.mjs is that model).
 *
 * Pure: every function returns new state and leaves its input intact. The
 * importer that turns official records into sessions is lib/viqcr-import.mjs.
 */

export const VIQCR_VERSION = 'VIQCR-1.1-candidate.1';
export const WEIGHTS = Object.freeze({ teamwork: 0.55, driving: 0.175, coding: 0.175, consistency: 0.10 });
const COMPONENTS = Object.keys(WEIGHTS);
const SKILL_MODES = ['driving', 'coding'];

const DAY = 86400000;
const STEP_CAP = 0.6;            // per component, per session
const TARGET_CLAMP = 3;          // bound on a target's distance from its frozen prior
const INACTIVITY_PER_DAY = 0.0025;
const VARIANCE_CEILING = 1.5;
const MAX_SESSION_TEAMS = 512;   // dense covariance fit
const FINALS_BUDGET = 0.35;
const CONSISTENCY = Object.freeze({ window: 24, days: 90, halfLife: 45, minRows: 6, minPartners: 3, minMass: 2 });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new Error(`VIQCR: ${message}`); };

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/* ------------------------------------------------------------------ *
 * State, units and season normalization
 * ------------------------------------------------------------------ */

const freshComponent = () => ({ m: 0, v: 1 });

function newTeam(id, identity = {}) {
  return {
    id,
    number: identity.number ?? null,
    grade: identity.grade ?? 'Unknown',
    region: identity.region ?? null,
    components: Object.fromEntries(COMPONENTS.map(name => [name, freshComponent()])),
    varianceAt: null,
    partners: [],
    teamworkSessions: 0,
    skillsSessions: { driving: 0, coding: 0 },
    teamworkMatches: 0,
    events: 0,
    consistencyRows: [],
    consistencyEvidence: 0,
    history: [],
  };
}

export function createIQReplay(seasonId) {
  return {
    program: 'VIQRC',
    seasonId: String(seasonId),
    modelVersion: VIQCR_VERSION,
    normalization: null,
    teams: new Map(),
    processed: [],
    lastOrder: null,
  };
}

function normalizationSignature(profile) {
  if (profile?.program !== 'VIQRC') fail('normalization must be for program VIQRC.');
  if (typeof profile.seasonId !== 'string' || !profile.seasonId) fail('normalization needs a string seasonId.');
  if (typeof profile.version !== 'string' || !profile.version) fail('normalization needs a version.');
  if (Number.isNaN(Date.parse(profile.trainedThrough))) fail('normalization needs a trainedThrough date.');
  for (const mode of ['teamwork', 'driving', 'coding']) {
    const entry = profile[mode];
    if (!finite(entry?.center) || !finite(entry?.scale) || entry.scale <= 0) fail(`normalization.${mode} needs a finite center and a positive scale.`);
  }
  return JSON.stringify([profile.program, profile.seasonId, profile.version, profile.rulesVersion ?? null, profile.trainedThrough,
    profile.teamwork.center, profile.teamwork.scale, profile.driving.center, profile.driving.scale, profile.coding.center, profile.coding.scale]);
}

/**
 * The statistic a team/session contributes to a skills mode: the same
 * peak-and-repeatability value the rating uses. Best-only rows are the peak.
 */
export function skillsPerformance(rows) {
  const scored = rows.filter(row => row.status === 'scored');
  if (!scored.length) return null;
  const bestOnly = scored.filter(row => row.detail === 'best-only');
  if (bestOnly.length && bestOnly.length !== scored.length) fail(`skills rows for ${scored[0].teamId}/${scored[0].mode} mix best-only and individual attempts.`);
  if (bestOnly.length) {
    return { performance: Math.max(...bestOnly.map(row => row.score)), reliability: 0.5, attempts: null, bestOnly: true };
  }
  // A fourth or later attempt needs explicit official verification.
  if (scored.slice(3).some(row => row.verifiedExtraAttempt !== true)) {
    fail(`more than three ${scored[0].mode} attempts for ${scored[0].teamId} without verification.`);
  }
  const scores = scored.map(row => row.score);
  return { performance: 0.7 * Math.max(...scores) + 0.3 * median(scores), reliability: Math.min(1, scores.length / 3), attempts: scores.length, bestOnly: false };
}

/**
 * Fits a season profile from a calibration window: median for the center and
 * max(minimum, 1.4826 x MAD) for the scale. Each team/session counts once per
 * mode, so a long schedule does not outweigh a short one. The sessions used
 * here must not then be replayed as rated evidence (start after trainedThrough).
 */
export function fitIQNormalization({ seasonId, sessions, trainedThrough, version = 'iq-season-calibration-v1', rulesVersion = null,
  minimumScale = { teamwork: 10, driving: 5, coding: 5 } }) {
  const teamwork = [], skills = { driving: [], coding: [] };
  const sessionKeys = new Set(), teamsSeen = new Set();
  let first = null, last = null;
  for (const session of sessions) {
    if (Date.parse(session.end) > Date.parse(trainedThrough)) fail(`calibration session ${session.id} ends after trainedThrough.`);
    sessionKeys.add(JSON.stringify([session.id, session.sessionId]));
    first = first === null || session.end < first ? session.end : first;
    last = last === null || session.end > last ? session.end : last;
    // Teamwork: one observation per team/session, that team's median shared score.
    const byTeam = new Map();
    for (const row of session.teamwork ?? []) {
      if (!eligibleTeamwork(row).ok || row.stage !== 'qualification') continue;
      for (const id of row.teamIds) { if (!byTeam.has(id)) byTeam.set(id, []); byTeam.get(id).push(row.score); }
    }
    for (const [id, scores] of byTeam) { teamwork.push(median(scores)); teamsSeen.add(id); }
    for (const mode of SKILL_MODES) {
      const byTeamMode = new Map();
      for (const row of session.skills ?? []) {
        if (row.mode !== mode) continue;
        if (!byTeamMode.has(row.teamId)) byTeamMode.set(row.teamId, []);
        byTeamMode.get(row.teamId).push(row);
      }
      for (const rows of byTeamMode.values()) {
        const stat = skillsPerformance(rows);
        if (stat) skills[mode].push(stat.performance);
      }
    }
  }
  const fit = (values, minimum) => {
    if (!values.length) fail('calibration window has no observations for a mode.');
    const center = median(values);
    const mad = median(values.map(value => Math.abs(value - center)));
    return { center, scale: Math.max(minimum, 1.4826 * mad) };
  };
  return {
    program: 'VIQRC',
    seasonId: String(seasonId),
    version,
    rulesVersion,
    trainedThrough,
    teamwork: fit(teamwork, minimumScale.teamwork),
    driving: fit(skills.driving, minimumScale.driving),
    coding: fit(skills.coding, minimumScale.coding),
    cohort: { sessions: sessionKeys.size, teams: teamsSeen.size, teamwork: teamwork.length, driving: skills.driving.length, coding: skills.coding.length, from: first, through: last },
  };
}

/* ------------------------------------------------------------------ *
 * Validation (throws before any state changes)
 * ------------------------------------------------------------------ */

const TEAMWORK_STAGES = new Set(['qualification', 'finals', 'practice']);
const RESULT_STATUSES = new Set(['scored', 'unplayed', 'void', 'superseded']);
const SKILL_STATUSES = new Set(['scored', 'unplayed', 'void']);
const FORMATS = new Set(['tournament', 'league-session', 'skills-only']);

function orderKey(event) { return [Date.parse(event.end), JSON.stringify([String(event.id), String(event.sessionId ?? 'main')])]; }
function compareOrder(a, b) { return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0); }

function validateEvent(replay, event) {
  if (event?.program !== 'VIQRC') fail(`event ${event?.id} is not a VIQRC event.`);
  if (String(event.seasonId) !== replay.seasonId) fail(`event ${event.id} is season ${event.seasonId}, replay is ${replay.seasonId}.`);
  if (!FORMATS.has(event.format)) fail(`event ${event.id} has an unknown format.`);
  if (event.completed !== true) fail(`event ${event.id} is not marked completed.`);
  if (typeof event.coverage?.teamwork !== 'boolean' || typeof event.coverage?.skills !== 'boolean') fail(`event ${event.id} must state its coverage.`);
  if (Number.isNaN(Date.parse(event.end))) fail(`event ${event.id} has no valid end.`);
  if (!Array.isArray(event.teamwork) || !Array.isArray(event.skills)) fail(`event ${event.id} needs teamwork and skills collections.`);
  if (!event.coverage.teamwork && event.teamwork.length) fail(`event ${event.id} has teamwork rows but no teamwork coverage.`);
  if (!event.coverage.skills && event.skills.length) fail(`event ${event.id} has skills rows but no skills coverage.`);
  const ids = new Set();
  for (const row of event.teamwork) {
    if (typeof row.id !== 'string' || ids.has(row.id)) fail(`event ${event.id}: duplicate or missing result id ${row.id}.`);
    ids.add(row.id);
    if (!TEAMWORK_STAGES.has(row.stage)) fail(`event ${event.id} match ${row.id}: unknown stage.`);
    if (!RESULT_STATUSES.has(row.status)) fail(`event ${event.id} match ${row.id}: missing or unknown status.`);
    if (!Array.isArray(row.teamIds) || row.teamIds.length < 1 || row.teamIds.length > 2 || new Set(row.teamIds).size !== row.teamIds.length || !row.teamIds.every(id => typeof id === 'string' && id)) {
      fail(`event ${event.id} match ${row.id}: teamIds must be one or two distinct string ids.`);
    }
    if (row.status === 'scored' && (!finite(row.score) || row.score < 0)) fail(`event ${event.id} match ${row.id}: invalid score.`);
    if (row.reliability !== undefined && (!finite(row.reliability) || row.reliability < 0 || row.reliability > 1)) fail(`event ${event.id} match ${row.id}: reliability must be 0..1.`);
  }
  for (const row of event.skills) {
    if (typeof row.id !== 'string' || ids.has(row.id)) fail(`event ${event.id}: duplicate or missing result id ${row.id}.`);
    ids.add(row.id);
    if (typeof row.teamId !== 'string' || !row.teamId) fail(`event ${event.id} skills ${row.id}: missing teamId.`);
    if (!SKILL_MODES.includes(row.mode)) fail(`event ${event.id} skills ${row.id}: mode must be driving or coding.`);
    if (!SKILL_STATUSES.has(row.status)) fail(`event ${event.id} skills ${row.id}: missing or unknown status.`);
    if (row.status === 'scored' && (!finite(row.score) || row.score < 0)) fail(`event ${event.id} skills ${row.id}: invalid score.`);
    if (row.detail !== 'attempts' && row.detail !== 'best-only') fail(`event ${event.id} skills ${row.id}: detail must be attempts or best-only.`);
  }
}

/* ------------------------------------------------------------------ *
 * Inactivity
 * ------------------------------------------------------------------ */

function inflated(variance, from, to) {
  if (from === null || to <= from) return variance;
  if (variance >= VARIANCE_CEILING) return variance;
  return Math.min(VARIANCE_CEILING, variance + INACTIVITY_PER_DAY * (to - from) / DAY);
}

function applyInactivity(team, at) {
  for (const name of COMPONENTS) team.components[name].v = inflated(team.components[name].v, team.varianceAt, at);
  team.varianceAt = at;
}

/* ------------------------------------------------------------------ *
 * Cooperative teamwork estimate
 * ------------------------------------------------------------------ */

function eligibleTeamwork(row) {
  if (row.stage === 'practice') return { ok: false, reason: 'practice' };
  if (row.status !== 'scored') return { ok: false, reason: row.status };
  if ((row.reliability ?? 1) <= 0) return { ok: false, reason: 'zero-reliability' };
  if (row.noShowIds?.length) return { ok: false, reason: 'no-show' };
  if (row.dqIds?.length) return { ok: false, reason: 'disqualification' };
  // A team-specific zero (DQ or no-show; the record does not say which).
  if (row.zeroedIds?.length) return { ok: false, reason: 'team-specific-zero' };
  // One team is an officially scheduled solo appearance only in finals; in a
  // qualification it means a missing partner, not solo evidence.
  if (row.teamIds.length === 1 && row.stage !== 'finals') return { ok: false, reason: 'missing-partner' };
  return { ok: true };
}

function fittedTarget(score, priorSum, size, normalization) {
  const baseline = normalization.teamwork.center * size / 2;
  const raw = (score - baseline) / normalization.teamwork.scale;
  return priorSum + clamp(raw - priorSum, -TARGET_CLAMP, TARGET_CLAMP);
}

function teamworkWeights(rows) {
  const appearances = new Map(), pairs = new Map(), finals = new Map();
  const pairKey = row => [...row.teamIds].sort().join('|');
  for (const row of rows) {
    for (const id of row.teamIds) {
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
      if (row.stage === 'finals') finals.set(id, (finals.get(id) ?? 0) + 1);
    }
    pairs.set(pairKey(row), (pairs.get(pairKey(row)) ?? 0) + 1);
  }
  return row => {
    const schedule = Math.min(...row.teamIds.map(id => Math.min(1, 6 / appearances.get(id))));
    const pair = Math.min(1, 2 / pairs.get(pairKey(row)));
    const stage = row.stage === 'finals' ? FINALS_BUDGET / Math.max(...row.teamIds.map(id => finals.get(id))) : 1;
    return Math.min(schedule, pair, stage) * (row.reliability ?? 1);
  };
}

/**
 * The joint Gaussian fit for one session. Starts from diagonal frozen priors,
 * keeps the partner correlations it induces while fitting, and returns each
 * participant's capped change and new variance. Targets are bounded against
 * the frozen priors, so the posterior does not depend on match order.
 */
function fitTeamwork(rows, priors, normalization) {
  const ids = [...new Set(rows.flatMap(row => row.teamIds))].sort();
  if (ids.length > MAX_SESSION_TEAMS) fail(`a session with ${ids.length} teamwork teams exceeds the ${MAX_SESSION_TEAMS}-team dense fit.`);
  const n = ids.length, index = new Map(ids.map((id, i) => [id, i]));
  const mean = Float64Array.from(ids, id => priors.get(id).m);
  const cov = new Float64Array(n * n);
  ids.forEach((id, i) => { cov[i * n + i] = priors.get(id).v; });
  const weightOf = teamworkWeights(rows);
  const observations = [];
  for (const row of rows) {
    const weight = weightOf(row);
    if (weight <= 0) continue;
    const at = row.teamIds.map(id => index.get(id));
    const priorSum = row.teamIds.reduce((sum, id) => sum + priors.get(id).m, 0);
    const target = fittedTarget(row.score, priorSum, row.teamIds.length, normalization);
    observations.push({ row, weight, target });
    // Px = P x; xPx = x^T P x
    const px = new Float64Array(n);
    for (let k = 0; k < n; k++) for (const j of at) px[k] += cov[k * n + j];
    const xpx = at.reduce((sum, j) => sum + px[j], 0);
    const denominator = 1 / weight + xpx;
    const residual = target - at.reduce((sum, j) => sum + mean[j], 0);
    for (let k = 0; k < n; k++) mean[k] += px[k] * residual / denominator;
    for (let a = 0; a < n; a++) {
      const scaled = px[a] / denominator;
      if (scaled === 0) continue;
      for (let b = 0; b < n; b++) cov[a * n + b] -= scaled * px[b];
    }
  }
  const result = new Map();
  ids.forEach((id, i) => result.set(id, { m: mean[i], v: cov[i * n + i] }));
  return { posterior: result, observations };
}

/* ------------------------------------------------------------------ *
 * Partner-adjusted consistency
 * ------------------------------------------------------------------ */

// A row's time: an ISO string, or epoch milliseconds in a packed snapshot.
const timeOf = row => (typeof row.time === 'number' ? row.time : Date.parse(row.time));

/** The rolling window as of `asOf`, recomputed from stored rows every time. */
export function consistencyWindow(rows, asOf) {
  const now = Date.parse(asOf);
  const recent = rows
    .filter(row => { const age = (now - timeOf(row)) / DAY; return age >= 0 && age <= CONSISTENCY.days; })
    .sort((a, b) => timeOf(b) - timeOf(a) || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .slice(0, CONSISTENCY.window);
  let mass = 0, sum = 0, partnerSum = 0;
  const used = [];
  for (const row of recent) {
    const age = (now - timeOf(row)) / DAY;
    const weight = row.weight / (1 + row.partnerVariance) * 2 ** (-age / CONSISTENCY.halfLife);
    if (weight <= 0) continue;
    used.push({ row, weight });
    mass += weight; sum += weight * row.contribution; partnerSum += weight * row.partnerMean;
  }
  const partners = new Set(used.map(entry => entry.row.partnerId)).size;
  const A = mass > 0 ? sum / mass : 0;
  const S = mass > 0 ? Math.sqrt(used.reduce((total, entry) => total + entry.weight * (entry.row.contribution - A) ** 2, 0) / mass) : 0;
  const eligible = used.length >= CONSISTENCY.minRows && partners >= CONSISTENCY.minPartners && mass >= CONSISTENCY.minMass;
  return { eligible, rows: used.length, partners, mass, A, S, repeatability: 1 / (1 + S * S), partnerStrength: mass > 0 ? partnerSum / mass : 0 };
}

/** Recomputed from a fixed neutral prior, never from yesterday's snapshot. */
export function consistencySnapshot(window) {
  const reliability = Math.min(1, window.mass / 6) * Math.min(1, window.partners / 4);
  const supported = clamp(window.A - 0.5 * window.S, -3, 3);
  const observationVariance = 0.75 / reliability;
  return {
    reliability,
    supported,
    mean: supported / (1 + observationVariance),
    variance: Math.max(0.15, observationVariance / (1 + observationVariance)),
  };
}

/** Descriptive, explicitly uncertain; never a claim that a team was carried. */
export function consistencySignal(window) {
  if (!window.eligible) return 'insufficient-evidence';
  if (window.A > 0.25 && window.S <= 0.5) return 'repeatable-positive';
  if (window.partnerStrength > 0.25 && window.A <= 0.25) return 'partner-explained-upside';
  if (window.S > 0.75) return 'variable';
  return 'mixed';
}

/* ------------------------------------------------------------------ *
 * Driving and autonomous coding skills
 * ------------------------------------------------------------------ */

function updateSkill(component, stat, scale) {
  const prior = component.m;
  const raw = (stat.performance - scale.center) / scale.scale;
  const target = prior + clamp(raw - prior, -TARGET_CLAMP, TARGET_CLAMP);
  const observationVariance = 0.5 / stat.reliability;
  const gain = component.v / (component.v + observationVariance);
  return { m: prior + clamp(gain * (target - prior), -STEP_CAP, STEP_CAP), v: Math.max(0.1, (1 - gain) * component.v) };
}

/* ------------------------------------------------------------------ *
 * Public score, confidence, provisional status
 * ------------------------------------------------------------------ */

function blend(components, field) {
  return COMPONENTS.reduce((sum, name) => sum + WEIGHTS[name] * field(components[name]), 0);
}

/** mu, RD and VIQCR from component states. Full precision; round for display only. */
export function publicScore(components) {
  const M = blend(components, c => c.m);
  const mu = 1500 + 200 * M;
  const rd = 200 * blend(components, c => Math.sqrt(c.v));
  return { M, mu, rd, viqcr: clamp(500 + 1.25 * (mu - 0.75 * rd - 1500), 0, 1000) };
}

/** A team as of `asOf`. Reading never changes state. */
export function teamRating(team, asOf) {
  const at = Date.parse(asOf);
  const components = Object.fromEntries(COMPONENTS.map(name => {
    const c = team.components[name];
    return [name, { m: c.m, v: inflated(c.v, team.varianceAt, at) }];
  }));
  const score = publicScore(components);
  const window = consistencyWindow(team.consistencyRows, asOf);
  const reasons = [];
  if (team.teamworkSessions < 2) reasons.push('needs two teamwork sessions');
  if (team.partners.length < 3) reasons.push('needs three distinct partners');
  if (team.skillsSessions.driving < 1) reasons.push('no driving skills recorded');
  if (team.skillsSessions.coding < 1) reasons.push('no coding skills recorded');
  if (!window.eligible) reasons.push('consistency evidence insufficient');
  return {
    teamId: team.id,
    number: team.number,
    grade: team.grade,
    region: team.region,
    ...score,
    components: Object.fromEntries(COMPONENTS.map(name => [name, { mean: components[name].m, sd: Math.sqrt(components[name].v), points: 1500 + 200 * components[name].m }])),
    provisional: reasons.length > 0,
    provisionalReasons: reasons,
    consistency: { signal: consistencySignal(window), eligible: window.eligible, rows: window.rows, partners: window.partners, mass: window.mass, A: window.A, S: window.S },
    evidence: { teamworkSessions: team.teamworkSessions, partners: team.partners.length, drivingSessions: team.skillsSessions.driving, codingSessions: team.skillsSessions.coding, teamworkMatches: team.teamworkMatches, events: team.events },
  };
}

/**
 * Model order, not official order. Confirmed teams only unless asked; exact
 * ties fall back to a stable id order, never an implied official tiebreak.
 */
export function rankIQTeams(replay, { asOf, grade = null, region = null, includeProvisional = false } = {}) {
  if (!asOf) fail('rankIQTeams needs asOf.');
  return [...replay.teams.values()]
    .filter(team => (!grade || team.grade === grade) && (!region || team.region === region))
    .map(team => teamRating(team, asOf))
    .filter(row => includeProvisional || !row.provisional)
    .sort((a, b) => b.viqcr - a.viqcr || (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));
}

/* ------------------------------------------------------------------ *
 * Import and replay contract
 * ------------------------------------------------------------------ */

/**
 * Applies one completed event/session. Returns { replay, ledger, diagnostics }
 * and leaves the input replay untouched; any invalid input throws first.
 *
 * `mutate: true` updates the given replay in place instead of copying it: for
 * a caller that owns a throwaway copy (the live route continues a freshly
 * restored snapshot) and discards it on any error.
 */
export function processIQEvent({ replay, event, normalization, mutate = false }) {
  validateEvent(replay, event);
  const signature = normalizationSignature(normalization);
  if (normalization.seasonId !== replay.seasonId) fail('normalization is for a different season.');
  if (replay.normalization && replay.normalization !== signature) fail('normalization changed inside an existing replay; rebuild instead.');
  if (replay.modelVersion !== VIQCR_VERSION) fail(`replay was built by ${replay.modelVersion}; rebuild for ${VIQCR_VERSION}.`);
  if (Date.parse(event.end) <= Date.parse(normalization.trainedThrough)) fail(`event ${event.id} is inside the calibration window.`);
  const order = orderKey(event);
  const key = order[1];
  if (replay.processed.includes(key)) fail(`event ${event.id} was already processed.`);
  if (replay.lastOrder && compareOrder(order, replay.lastOrder) <= 0) fail(`event ${event.id} is out of order.`);

  const next = mutate ? replay : structuredClone(replay);
  next.normalization = signature;
  const at = Date.parse(event.end);
  const identities = new Map((event.teams ?? []).map(team => [String(team.id), team]));
  const ensure = id => {
    if (!next.teams.has(id)) next.teams.set(id, newTeam(id, identities.get(id)));
    const team = next.teams.get(id);
    const identity = identities.get(id);
    if (identity) { team.number = identity.number ?? team.number; if (identity.grade) team.grade = identity.grade; if (identity.region) team.region = identity.region; }
    return team;
  };

  const ledger = { event: String(event.id), sessionId: String(event.sessionId ?? 'main'), excluded: [], teams: {} };
  const eligible = [];
  for (const row of event.teamwork) {
    const check = eligibleTeamwork(row);
    if (check.ok) eligible.push(row); else ledger.excluded.push({ id: row.id, reason: check.reason });
  }
  const participants = new Set([...eligible.flatMap(row => row.teamIds), ...event.skills.filter(row => row.status === 'scored').map(row => row.teamId)]);
  for (const id of participants) applyInactivity(ensure(id), at);
  const before = new Map([...participants].map(id => [id, structuredClone(next.teams.get(id).components)]));

  // Teamwork: joint fit against frozen priors.
  const priors = new Map([...participants].map(id => [id, { ...next.teams.get(id).components.teamwork }]));
  const { posterior, observations } = eligible.length ? fitTeamwork(eligible, priors, normalization) : { posterior: new Map(), observations: [] };
  const sessionPartners = new Map();
  for (const { row } of observations) for (const id of row.teamIds) {
    if (!sessionPartners.has(id)) sessionPartners.set(id, new Set());
    for (const other of row.teamIds) if (other !== id) sessionPartners.get(id).add(other);
  }
  for (const [id, fitted] of posterior) {
    const team = next.teams.get(id);
    const prior = priors.get(id);
    team.partners = [...new Set([...team.partners, ...(sessionPartners.get(id) ?? [])])].sort();
    const floor = team.partners.length >= 3 ? 0.15 : 0.5;
    team.components.teamwork = { m: prior.m + clamp(fitted.m - prior.m, -STEP_CAP, STEP_CAP), v: Math.max(floor, fitted.v) };
    team.teamworkSessions += 1;
    team.teamworkMatches += observations.filter(entry => entry.row.teamIds.includes(id)).length;
  }

  // Consistency: rows from valid two-team qualifications, attributed against
  // the same frozen priors.
  const withNewRows = new Set();
  for (const { row, weight, target } of observations) {
    if (row.stage !== 'qualification' || row.teamIds.length !== 2) continue;
    const [i, j] = row.teamIds;
    const residual = target - priors.get(i).m - priors.get(j).m;
    for (const [self, partner] of [[i, j], [j, i]]) {
      const share = priors.get(self).v / (priors.get(self).v + priors.get(partner).v);
      next.teams.get(self).consistencyRows.push({
        key: `${event.id}|${event.sessionId ?? 'main'}|${row.id}`,
        time: row.time && !Number.isNaN(Date.parse(row.time)) ? new Date(row.time).toISOString() : new Date(at).toISOString(),
        partnerId: partner,
        partnerMean: priors.get(partner).m,
        partnerVariance: priors.get(partner).v,
        contribution: priors.get(self).m + share * residual,
        weight,
      });
      withNewRows.add(self);
    }
  }
  const insufficient = [];
  for (const id of withNewRows) {
    const team = next.teams.get(id);
    // Rows older than the window can never re-enter it: time only moves forward.
    team.consistencyRows = team.consistencyRows.filter(row => (at - timeOf(row)) / DAY <= CONSISTENCY.days);
    const window = consistencyWindow(team.consistencyRows, new Date(at).toISOString());
    if (!window.eligible) { insufficient.push(id); continue; }
    const snapshot = consistencySnapshot(window);
    const current = team.components.consistency;
    team.components.consistency = { m: current.m + clamp(snapshot.mean - current.m, -STEP_CAP, STEP_CAP), v: snapshot.variance };
    team.consistencyEvidence = window.mass;
  }

  // Skills: each mode independently, once per team/session.
  for (const mode of SKILL_MODES) {
    const byTeam = new Map();
    for (const row of event.skills) {
      if (row.mode !== mode || row.status !== 'scored') continue;
      if (!byTeam.has(row.teamId)) byTeam.set(row.teamId, []);
      byTeam.get(row.teamId).push(row);
    }
    for (const [id, rows] of byTeam) {
      const stat = skillsPerformance(rows);
      if (!stat) continue;
      const team = next.teams.get(id);
      team.components[mode] = updateSkill(team.components[mode], stat, normalization[mode]);
      team.skillsSessions[mode] += 1;
    }
  }

  // Audit: exact component changes, and the state they produce.
  const asOf = new Date(at).toISOString();
  for (const id of participants) {
    const team = next.teams.get(id);
    team.events += 1;
    const changes = Object.fromEntries(COMPONENTS.map(name => [name, team.components[name].m - before.get(id)[name].m]));
    const internalChange = 200 * COMPONENTS.reduce((sum, name) => sum + WEIGHTS[name] * changes[name], 0);
    const rating = teamRating(team, asOf);
    const entry = {
      eventId: String(event.id), sessionId: String(event.sessionId ?? 'main'), event: event.name ?? String(event.id), date: asOf,
      changes, internalChange, mu: rating.mu, rd: rating.rd, viqcr: rating.viqcr,
      matches: observations.filter(o => o.row.teamIds.includes(id)).length, signal: rating.consistency.signal,
    };
    team.history.push(entry);
    ledger.teams[id] = entry;
  }

  next.processed = [...next.processed, key];
  next.lastOrder = order;
  return { replay: next, ledger, diagnostics: { observations: observations.length, excluded: ledger.excluded.length, participants: participants.size, insufficientConsistency: insufficient } };
}

/**
 * Between games: a weak prior for a confirmed same identity. Everything else
 * - evidence, partners, history, consistency - starts again.
 */
export function carryIQSeason(team, { sameIdentity }) {
  const fresh = newTeam(team.id, team);
  if (!sameIdentity) return fresh;
  for (const name of ['teamwork', 'driving', 'coding']) fresh.components[name] = { m: clamp(0.25 * team.components[name].m, -0.5, 0.5), v: 1 };
  return fresh;
}

/** Persistence: the replay's Map as entries, and back. */
export function serializeIQReplay(replay) { return { ...replay, teams: [...replay.teams.entries()] }; }
export function restoreIQReplay(saved) { return { ...saved, teams: new Map(saved.teams) }; }

/* ------------------------------------------------------------------ *
 * Official-record helpers (descriptive; not rating inputs)
 * ------------------------------------------------------------------ */

/** Mode peaks and an official-style total; a missing mode stays null but counts as zero in the total. */
export function summarizeIQSkills(rows) {
  const peak = mode => {
    const scored = rows.filter(row => row.mode === mode && row.status === 'scored');
    return scored.length ? Math.max(...scored.map(row => row.score)) : null;
  };
  const driving = peak('driving'), coding = peak('coding');
  return { driving, coding, total: driving === null && coding === null ? null : (driving ?? 0) + (coding ?? 0) };
}

/** One session's combined total - never one session's driving with another's coding. */
export function bestIQSkillsSession(sessions) {
  let best = null, tied = false;
  for (const session of sessions) {
    const { total } = summarizeIQSkills(session.rows);
    if (total === null) continue;
    if (!best || total > best.total) { best = { sessionKey: session.key, total }; tied = false; }
    else if (total === best.total) tied = true;
  }
  return best && { ...best, unresolvedTie: tied };
}

/**
 * The two one-team stations an IQ result API reports for one teamwork match.
 * Returns the partner ids; throws on any other shape.
 */
export function iqStationTeamIds(match) {
  const alliances = match?.alliances;
  if (!Array.isArray(alliances) || alliances.length !== 2) fail(`match ${match?.id}: expected two stations.`);
  const ids = alliances.map(alliance => {
    const teams = alliance.teams ?? [];
    if (teams.length > 1) fail(`match ${match.id}: a station lists more than one team.`);
    return teams.length ? String(teams[0].team?.id ?? '') : null;
  }).filter(id => id !== null);
  if (!ids.length || ids.some(id => !id)) fail(`match ${match.id}: station without a team id.`);
  if (new Set(ids).size !== ids.length) fail(`match ${match.id}: the same team in both stations.`);
  return ids;
}

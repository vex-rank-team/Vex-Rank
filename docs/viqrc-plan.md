# VEX IQ (VIQRC) support: plan

Status: **approved 2026-11-01 and built** for the website, Worker code and iOS. Android was left
for later. Not deployed. The rating handoff is in `docs/viqrc-vcr-handoff.md`.

Built differently from this draft:
- The team route answers IQ with `ratingHistory: []` plus `ratingStatus: "pending"` (not `null`),
  because the iOS decoder requires the array.
- IQ Rankings and Stat leaders are separate components on the website (`IQRankingsView`,
  `IQStatLeadersView`) and iOS (`IQRankingsView`). Their data (skills feed, no V5 archives) has
  nothing in common with the V5 versions beyond the table styling, which they reuse.
- The IQ hexagon was adapted with measured axes, the default from open question 4.
- Debug iOS builds accept `-api-base <url>` to point at a local server; release builds compile it out.

Goal: add VIQRC as a second program next to V5RC on the website and iOS app (Android to be decided,
see open questions). Every feature ships except the IQ rating (VCR), which {{PARTNER_NAME}} will
write. The plan leaves one documented place for it.

---

## 0. What the investigation found

### Where data comes from today

```
RobotEvents API v2 ──► website/app/api/*/route.ts ──► cloudflare/worker.ts ──► website, iOS, Android
(token, server only)    (shape + compute VCR)           (D1 cache, archives)     (display only)
```

- **All rating maths is server-side.** `/api/rankings` replays the last 36 completed V5 events through
  `lib/vcr3.mjs`; `/api/teams/:number` replays the team's matches for its rating graph; past seasons
  are static archives built by `scripts/build-historical-ranking.mjs`. The clients only display it.
  The one exception is on-device OPR/DPR/CCWM (`lib/team-event.mjs` `powerRatings`, iOS
  `PowerRatings.swift`, Android `PowerRatings.kt`), which are least-squares fits, not VCR.
- **V5 is hard-coded in six places:** `program?.id===1` in the events and rankings routes,
  `program[]=1` in the team lookup, `ALLOWED_SEASONS` and `GRADES` in the skills route, season tables
  in the rankings route and `lib/ranking-seasons.mjs`, the V5 official-URL path in the event route,
  and `program[]=1` in `scripts/build-team-directory.mjs` (the Teams tab's 11 MB snapshot).
- **The `program` app-config field** (Worker default `'V5RC'`) is only used by the iOS
  "View on events.vex.com" link. It is free to repurpose as the default program.
- **Routes and saved state:** the website uses hash routes (`lib/routes.mjs`) plus
  `sessionStorage['vexrank-navigation']`; iOS uses one `NavigationPath` per tab, `@AppStorage` for
  settings and on-disk response snapshots (`Snapshots.swift`).
- **The Worker caches by URL** after allow-listing query fields in `canonicalUrl`. A new parameter
  must be added there or two programs will share cached responses.

### What the live VIQRC data actually looks like (fixtures in `website/tests/fixtures/viqrc/`)

| Fact | Evidence | Status |
|---|---|---|
| Program id **41**, code `VIQRC` | `event.program` in both event fixtures | Confirmed |
| Seasons since 2024: **189** 2024–25 Rapid Relay, **196** 2025–26 Mix & Match, **203** 2026–27 Level Up | public skills endpoint `seasonName`, event fixtures | Confirmed |
| Grades are `Elementary School` and `Middle School` on teams | event team lists | Confirmed |
| The public skills endpoint wants `grade_level=Elementary` (not `Elementary School`) | `{"error":"Invalid Grade Level"}` otherwise | Confirmed |
| A teamwork match is **two one-team "alliances", red and blue, with the same score** (e.g. 314/314) | `event-65767` match 1 | Confirmed. V5 logic reads every IQ match as a tie between opponents |
| IQ ranking rows have `wins/losses/ties/wp/ap/sp = 0`; only `high_score` is filled in our route's output | both event fixtures | Confirmed for our output. The route drops RobotEvents' `average_points`/`total_points`, which IQ ranks by — **unconfirmed without a token** |
| Teamwork finals are **not** in rounds 2–6, so the event route never returns them; a two-division event has an empty `Final` division | `event-61958` | Confirmed missing. The finals round number and the `finalistRankings` endpoint **need confirming with a token** |
| Skills are `driver` and `programming` (shown to readers as "Autonomous coding") | event skills, public skills `scores` | Confirmed |
| Award names end in `(IQ)` (Teamwork Champion, Teamwork 2nd Place, Excellence…) | event awards | Confirmed |
| IQ team pages are `events.vex.com/teams/VIQRC/<number>` | `team.link` in skills rows | Confirmed. Event pages use `/vex-iq-robotics-competition/` — **assumed from the site's naming, check in a browser** |

### Leaks to close

- **The V5 VCR already runs on IQ data.** `/api/teams/86995D?teamId=186306` (an IQ team) returns a
  `ratingHistory` with two points: the V5 model replayed over teamwork matches as if they were
  opponents. The `teamId` path skips the `program[]=1` check. This is precisely the "fake IQ rating"
  the brief forbids, and it is reachable today on the test Worker.
- The event route builds every official link with the V5 path, so IQ events link to the wrong page.

---

## 1. V5 to IQ: concepts and screens

**KEEP** = same component, data swapped by program. **ADAPT** = same component, different fields or
wording. **HIDE** = not rendered for IQ at all (removed from layout, no gaps or "N/A").

### Concepts

| V5 concept | IQ | Why |
|---|---|---|
| Red vs blue alliances | **HIDE** | Two teams cooperate; the API's colours are bookkeeping. No colour badges, no colour-coded scores |
| Win / loss / tie, records, "won/lost" colouring | **HIDE** | There is no opponent. A shared score is the result |
| WP / AP / SP | **HIDE** | Always 0 for IQ |
| OPR / DPR / CCWM | **HIDE** | Fitted against opponents; DPR and CCWM have no meaning without one |
| Qualification rank | **KEEP** | RobotEvents ranks IQ teams; we show its rank as-is |
| Average / high teamwork score | **ADAPT** (new columns) | What IQ ranks by. High score is in our output today; average needs the route to pass `average_points` through (confirm) |
| Elimination bracket, round of 16, QF/SF | **HIDE** | IQ finals are a ranked list of teamwork pairs, not a bracket |
| Finals | **ADAPT** → "Teamwork finals": a ranked list of pairs and their score | Pending confirmation of how the API encodes them |
| Skills (driver, auto) | **KEEP**, relabel auto as "Autonomous coding" | Same structure |
| VCR rating, ±, rating graph, rating leader | **ADAPT** → "Rating coming soon" state | Partner's algorithm (section 4) |
| Grades HS / MS | **ADAPT** → Elementary School / Middle School | |
| Signature events, tiers | **KEEP** | IQ has Signature events; classification is by name and level, worth checking on IQ names in tests |

### Website screens

| Screen / part | IQ | Notes |
|---|---|---|
| Header, theme picker, footer | KEEP + program switch | Section 2 |
| Home: featured Signature event, upcoming list | KEEP | Program-filtered events |
| Home: "World ranking" panel | ADAPT | Top 5 of **world skills standings**, labelled as such, until IQ VCR exists |
| Home: three feature tiles | ADAPT copy | "VCR team rating" tile says the IQ rating is coming |
| Events list and filters | KEEP; ADAPT grade options; HIDE V5-only filters if they never match IQ | Season list per program |
| Event: General / Agenda / Travel / Webcast | KEEP | Organizer text is program-agnostic |
| Event: Results → Qualification rankings table | ADAPT | Rank, Team, Avg score, High score. No Record, no WP/AP/SP |
| Event: Results → Match results | ADAPT | Teamwork card: both teams, one shared score, no colours, no "Final/Not played" colour logic |
| Event: Results → Elimination (classic + bracket) | HIDE → replaced by "Teamwork finals" list | Hidden entirely until finals data is confirmed |
| Event: Results → Skills ranking | KEEP, relabel | |
| Event: Awards, Teams | KEEP | |
| Team-at-event: "Where they stand" | ADAPT | Rank, avg/high score, matches left. No WP/AP/SP/OPR/DPR/CCWM, no provisional-stats note |
| Team-at-event: Strengths hexagon | ADAPT | Same component, measured axes only: avg teamwork score, high score, driver, coding, combined skills, each placed within the division. No model involved, so not a rating |
| Team-at-event: Momentum chart | ADAPT | Same chart, plots the shared score per match instead of a running margin |
| Team-at-event: Played / Scheduled lists | ADAPT | "Scored 314 with 50380B". No won/lost, no "vs", no RED/BLUE tag |
| Team-at-event: disqualification check | HIDE | It compares wins to scores; IQ has no wins |
| Rankings page | ADAPT | "Rating coming soon" panel on top; below it the world skills standings table, labelled. Season select lists IQ seasons |
| Stat leaders: Offense, Defense, Picking, Consistency | HIDE | All four are derived from V5 VCR rows |
| Stat leaders: Driver / Auto / Combined skills | KEEP, relabel auto | Real data |
| Teams directory | KEEP | Needs an IQ snapshot asset (section 3). Grade filter offers ES/MS |
| Team profile: signed number, location, name | KEEP | |
| Team profile: Live VCR figure + ± | ADAPT | "Rating coming soon" in the same slot |
| Team profile: season summary band | KEEP | |
| Team profile: rating movement chart | ADAPT | Empty state "Rating coming soon", same box height |
| Team profile: skills, awards | KEEP | |
| Team profile: competition history | ADAPT | Qual line shows rank and high/avg score, finals line shows the teamwork finals rank, never "Quarterfinalist" etc. |

### iOS screens

| Screen / part | IQ |
|---|---|
| Rankings tab | ADAPT: "Rating coming soon" header, then world skills standings (real), labelled |
| Events tab, event header, Teams, Awards, Skills sections | KEEP |
| Event → Rankings section (`EventSection.rankings`) | ADAPT: rank, avg/high score; standing sort menu offers seeding rank only (OPR/DPR/CCWM sorts hidden) |
| Event → Bracket section, `BracketView` | HIDE |
| Event → Matches section | ADAPT: teamwork rows, finals as a ranked list once confirmed |
| `MatchDetailView` | ADAPT: two teams, one score, no colours or winner |
| `TeamEventMatchesView` | ADAPT, same rules as the website team-at-event view |
| `StrengthHexagon`, `MomentumChart` | ADAPT as on the website |
| Stats tab | ADAPT: skills categories only |
| Teams tab (favourites + directory) | KEEP; favourites store the program |
| Team profile: VCR figure, rating chart | ADAPT to "Rating coming soon" |
| Team profile: up next, history, skills, awards | ADAPT/KEEP as on the website |

---

## 2. The program switch

| | Website | iOS | Android (if in scope) |
|---|---|---|---|
| Where | Header, a pill next to the theme picker, same component style (`V5RC` / `VIQRC`) | Toolbar menu (`circle.lefthalf.filled`), new "Program" section above the theme picker | Top-bar menu, new section above themes |
| Stored | `localStorage['vexrank-program']`, restored before first paint like the theme | `@AppStorage("vexrank-program")` | `Favourites` prefs, next to the theme |
| Default | V5RC. A new install takes the app-config `program` value if valid, else V5RC | same | same |
| Deep links | IQ routes get an `iq/` prefix: `#/iq/events/65767`, `#/iq/teams/86995D`. V5 links stay unprefixed, so every existing link keeps working | `-program VIQRC` launch argument (no URL scheme exists yet) | none today |
| On change | Same view kept (Events stays Events). Detail views go back to their list. Filters reset to "All". Navigation history saved per program | Every tab's `NavigationPath` is reset to its root; filters reset | Each tab's back stack popped to root |

The switch is only shown once (no per-screen toggles). Every screen reads the program from one place:
React context on the web, an environment value on iOS, a `CompositionLocal` on Android.

---

## 3. API changes

**One new query parameter, `program`, values `V5RC` | `VIQRC`, default `V5RC`.** Omitting it gives
exactly today's V5 responses, so old app builds are unaffected.

- `cloudflare/worker.ts` `canonicalUrl`: allow-list `program` (exact match on the two values), so it
  becomes part of every D1 cache key. V5 requests keep their current keys because the default is
  not written into the key.
- `lib/programs.mjs` (new, shared by routes): program → RobotEvents id (1 / 41), season table
  (V5 173–204, IQ 189 / 196 / 203), grade lists (`High School`, `Middle School` / `Middle School`,
  `Elementary School`), the public-skills grade names (`Elementary` for IQ), and the official URL
  path segment. Replaces the six hard-coded spots.
- `/api/events?program=VIQRC&season=203` — filter on program id 41.
- `/api/events/:id` — official URL by `event.program.id`; pass through `average_points` and
  `total_points` on ranking rows; fetch the IQ finals round and finalist rankings once their encoding
  is confirmed (open question 3). V5 output unchanged.
- `/api/teams/:number?program=VIQRC` — look up with `program[]=41`. **The `teamId` shortcut checks
  the program too**, closing the leak. For IQ, the V5 replay is skipped; the response carries
  `ratingHistory: null` and `ratingStatus: "pending"` from the hook.
- `/api/rankings?program=VIQRC&season=203` — calls the IQ hook. While it returns `null`, the
  response is `200 { rankings: [], ratingStatus: "pending", season, updatedAt }`. Historical IQ
  archives do not exist yet and are left to the partner (the archive path is V5-only by name).
- `/api/skills?program=VIQRC&season=203` — IQ seasons allowed, grades `Middle School` and
  `Elementary`. Output shape unchanged.
- `/api/team-directory?program=VIQRC` — serves a second static asset, `team-directory-viqrc.json`,
  built by `scripts/build-team-directory.mjs --program 41`. Building it needs the RobotEvents token
  (open question 3).
- `/api/app-config` — adds `programs: { V5RC: { currentSeason: 204 }, VIQRC: { currentSeason: 203 } }`.
  `currentSeason` stays for older builds.

Client-side caches separate naturally: website caches key on the full URL; iOS snapshot names gain a
program suffix (`rankings-VIQRC`, `team-VIQRC-86995D-203`), because team numbers are not guaranteed
unique across programs.

No new dependencies.

---

## 4. The VCR handoff

**One hook, server-side**, because that is where V5 VCR lives and every client only displays it.
No per-platform algorithm code is needed; iOS and the website consume the same fields.

`website/lib/vcr-iq.mjs` (new):

```js
/**
 * TODO({{PARTNER_NAME}}): the VIQRC rating. Return null until it is implemented.
 *
 * input:  { season, events: CompletedEvent[], matches: TeamworkMatch[] }
 *         TeamworkMatch = { eventId, divisionId, matchId, round, scheduled, score, teams: [teamIdA, teamIdB] }
 *         (built by lib/viqrc.mjs teamworkMatches(), tested against the fixtures)
 * output: IqRating[] | null
 *         IqRating = { teamId, rating, confidence, matches, events, change? }
 *         rating and confidence are integers in the same units, shown as "1580 ±64";
 *         confidence is the half-width the leaderboard subtracts when sorting (as V5 does).
 */
export function computeIqRatings(input) { return null; }

/** TODO({{PARTNER_NAME}}): one team's rating after each event, for the profile graph. */
export function computeIqRatingHistory(input) { return null; }
```

- `/api/rankings` and `/api/teams` call these for IQ. `null` → `ratingStatus: "pending"` → every
  client shows "Rating coming soon" in the slot where the number goes, styled like the existing
  empty states. A non-null result flows through the existing V5 response fields, so the UI needs
  no further change when the partner lands the algorithm.
- `website/tests/vcr-iq.test.mjs`: shape and invariant tests marked `todo` (reported, never
  failing the suite) that turn into real passes once the functions return data: every rated team
  appears once, ratings are integers, confidence is non-negative, the leaderboard order is
  rating minus confidence.
- `docs/viqrc-vcr-handoff.md`: the interface, fixture paths, the exact UI slots per platform, how
  to run the todo tests, and how historical IQ archives would plug into the archive path.

---

## 5. Tests and build order

**New tests (with the fixtures):**
- `lib/viqrc.mjs`: `teamworkMatches()` turns red/blue one-team "alliances" into one pair with one
  score; never reports a tie or winner; skips unscored matches.
- IQ standings: rank, average and high score per team; ordering matches the API rank.
- Skills merge: IQ grade names, `Elementary` request mapping, combined = driver + coding.
- Grade filters: ES/MS options, no HS for IQ.
- `routes.mjs`: `#/iq/...` round-trips; every existing V5 hash parses exactly as before.
- Worker `canonicalUrl`: `program` allow-listed; a V5 URL produces today's cache key unchanged.
- Team route: the `teamId` path rejects a team from the other program.
- iOS (VEXRankKit): decode the fixtures (copied into `Tests/Fixtures`), teamwork parsing, program
  in snapshot names, `ratingStatus` decoding.
- Every existing test stays green (website 66, VEXRankKit 212, Android unit tests).

**Build order** (each step builds and passes its tests before the next):
1. `lib/programs.mjs`, `lib/viqrc.mjs`, `lib/vcr-iq.mjs`, route and Worker changes, tests.
2. Website: program context and switch, routes, then screens in the table's order.
3. iOS: `VEXRankKit` (program, models, API, snapshots) then `App` screens.
4. Android, if confirmed in scope.
5. Verify (Phase 4): both programs at phone and desktop width, one light-accent theme, switching,
   Back, deep links, relaunch.

---

## 6. Open questions

1. **Android:** the build order in the brief lists the website and iOS only, but the UI rules and
   the verification step mention Android. Include Android in this pass, or follow up later?
2. **Partner's name**, for the TODOs and the handoff doc (currently `{{PARTNER_NAME}}`).
3. **RobotEvents token:** three things can only be confirmed or built with it — how IQ finals are
   encoded (round number and finalist rankings), whether ranking rows carry average and total
   points, and building the IQ team-directory asset. Will you run those, or make the token
   available locally as an environment variable for the session (never written to files)?
4. **Strengths hexagon for IQ:** ADAPT with measured axes (scores and skills placed within the
   division), or HIDE until the IQ rating exists?
5. **Deploying the Worker:** the clients need the new `program` parameter live on the test Worker
   before IQ screens show real data. Should I deploy to the test Worker when I get there, or leave
   deploys to you?

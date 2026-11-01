# VEXRank roadmap

Legend:

- Bullet point is the points
- () is the explanation
- [] is the date issued
- {} is the date closed
- `...` means not closed, to continue

## Things to add/do in the near future

- Choose Able Color Theme (Kind of like the eve online thing, with pre designed color themes to choose from.) [9/16/2026]
- Review Algorithm (ISTG there's still some thing weird about it, especially that the number on the line graph doesn't seem to be aligning with the number on the ranking.) [9/16/2026]
- User Account and Login (This is optional right now i think.) [9/16/2026]
- Decide the Frequency the Website Updates (This really depends on how many users are there and if the free backend can handle it.) [9/16/2026]
- Publishing!!! (Crazy I know right!) [9/16/2026]
- Gallery (A photo gallery of teams with picture? I kind of want to do this for recording the legacy of teams with their picture of their previous robots recorded.) [9/16/2026]
- Link/Website of the Team (Similar to the previous one, make it so teams can upload their own link to their team to maybe promote or just refer to.) [9/16/2026]
- Team Logo (I don't know if the api has it, it should. But if not idk if i want to do it myself) [9/16/2026]

...

## Findings against the above

### Review Algorithm — three separate causes, all confirmed against live data

- Ranking list is sorted by one number and displays another (`app/api/rankings/route.ts` sorts by `displayedStrength = decayedRating - confidence` but renders `decayedRating`. 203 of 585 teams therefore show a rating higher than the team ranked above them. #1 31260X shows 1567 while #2 41103C shows 1569. This is the most visible symptom and needs a product decision: show the conservative number, show both, or sort by the displayed one.) [9/17/2026]
- Graph and ranking are computed from different event sets (`/api/rankings` processes only the selected season from a fresh state map, so every team restarts at 1500. `/api/teams/[number]` walks the team's whole career in one continuous state. For a veteran team the two diverge badly: 31260X reads 1567 in the rankings and 1678 at the end of its graph, a gap of 111.) [9/17/2026]
- Graph ignores the recency decay the ranking applies (The ranking sums `rawChange * recencyWeight(eventDate, cutoff)`; the graph plots the undecayed running `rating`. This is why even single-season teams disagree: 22020V 1534 vs 1574, 52111A 1563 vs 1600.) [9/17/2026]
- Fourth cause found and it is intentional, not a bug (`/api/rankings` ends its event filter with `.slice(-36)`: the live ranking replays only the season's 36 most recent completed events, which is what the "Live official-data sample" caption in the rankings header refers to. The team graph uses all of a team's events. 22020V reads 1 event / 11 matches in the ranking and 2 events / 23 matches in its profile for exactly this reason. Not fixable by aligning code - it is a deliberate limit. The team page now says so.) [9/17/2026] {9/17/2026}
- Note: the algorithm itself may be correct. Two of the three are surfaces disagreeing, not the model being wrong. Worth splitting into "is the model right" and "do the surfaces agree", because the second is definitely no. [9/17/2026]

### Scoring constants disagreed between live and archives

- Live rankings and historical archives used different maths (`app/api/rankings/route.ts` floored confidence at 35 while `scripts/build-historical-ranking.mjs` and `scripts/rebuild-season-archives.mjs` floored it at 25, and the recency curve was duplicated three times. A 2025-26 archived rating was therefore not comparable with a 2026-27 live one, even though the season selector puts them side by side. All three now import lib/vcr-scoring.mjs. Archives must be regenerated for this to take effect.) [9/17/2026] {9/17/2026}

### Team Logo — the API does not have it

- RobotEvents exposes no team imagery (The shaped team payload carries id, number, name, organization, robot, grade, region, country, registered, active, currentSeasonEvents, seasons. No logo, avatar or photo field exists anywhere in the data layer. Worth one confirmation against the raw API with the token, but assume self-hosted.) [9/17/2026]
- Consequence: Team Logo, Gallery and Link/Website collapse into one platform decision (All three need somewhere to store user-submitted content plus moderation, which makes them depend on User Account and Login rather than being independent items. Login is currently marked optional; these three are what would make it non-optional.) [9/17/2026]

### Content blockers break the site, and only a deployment change truly fixes it

- Every data request is third-party, which is what blockers drop (The site is served from GitHub Pages while the API lives on a separate *.workers.dev origin. workers.dev appears on several blocklists because it is free and widely abused, and strict blocker modes drop cross-origin XHR outright. The request then fails at the network layer with a TypeError and no status.) [9/17/2026]
- Mitigated in the client, not solved (Blocked requests are now detected and reported as "a browser content blocker or privacy extension is the usual cause", with a retry, instead of a generic failure or a false "no events". The data still does not load - the reader is just told why and what to do.) [9/17/2026] {9/17/2026}
- The real fix is to stop being third-party (Serve the API from the same origin as the page, or put it behind a custom domain that is not workers.dev. Same-origin requests are essentially never blocked, because blockers do not block a page's requests to its own host. The Worker already serves /api/* and the archive assets, so pointing a custom domain at it - and ideally serving the static site from it too - would remove the whole class of problem. Needs a domain and a deployment change, not a code change.) [9/17/2026]

### Publishing and update frequency — one blocker found

- Backend returns intermittent 502s (Five consecutive calls to /api/events?season=197 gave 502, 200, 200, 200, 200, first success taking 4.7s, which looks like an upstream cold start. The frontend now retries with backoff, so users rarely see it, but the underlying flakiness should be understood before real traffic.) [9/17/2026]

### Colour themes — cheapest item on the list

- Design tokens are already centralised (globals.css defines the palette as CSS custom properties on `:root`, so a theme is mostly one token block per theme plus a picker. No component changes needed.) [9/17/2026]

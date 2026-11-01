# Contributing to Vex-Rank

You can develop this project with a text editor, Node.js, pnpm and Git. No AI tools are required. Start with the source map below, reproduce the behavior you want to change, then run the relevant checks.

## Local setup

Use Node.js 22.13 or newer (the Pages workflow uses Node 24) and pnpm 11.19.0. From the repository root:

```sh
cd website
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` runs the full application through Vinext. Live API routes read `ROBOT_EVENTS_API_TOKEN` from the server process environment; set it before starting the server if you need official data. A missing token produces a 503 response. Keep credentials out of browser code and commits.

For frontend work against the existing public test API, no personal API token is needed:

```sh
pnpm exec vite --config vite.pages.config.ts
```

Open `http://127.0.0.1:5173/Vex-Rank/`. This entry point defaults to the public test Worker, so it needs network access and can encounter upstream rate limits. Backend edits are exercised through the full application, not by calling that already-deployed Worker.

## Where to make changes

Paths below are relative to `website/`.

| Area | Start here | Responsibility |
| --- | --- | --- |
| Website views and navigation | `app/page.tsx`, `app/globals.css` | Main React UI, selected seasons, loading states and rendering |
| Pages entry point | `static-site/main.tsx`, `vite.pages.config.ts` | Static frontend using the shared main UI and separate API origin |
| API routes | `app/api/` | Events, event details, team profiles, skills and sampled rankings |
| Upstream requests | `lib/vex-api.ts` | Bounded concurrency, pagination, retries and successful-page cache |
| Rating calculations | `lib/vcr3.mjs` | Shared event evidence, settlement and audit history |
| Historical archives | `scripts/rebuild-season-archives.mjs` | Resumable downloads, chronological replay and coverage checks |
| Archive validation | `lib/archive-matches.mjs`, `lib/ranking-seasons.mjs` | Match eligibility and season/model/coverage validation |
| Archive packaging | `scripts/prepare-archive-assets.mjs` | Validate and prepare Worker assets and their manifest |
| Event display rules | `lib/event-classification.ts`, `lib/agenda.ts`, `lib/bracket.ts` | Calendar labels, organizer schedules and bracket slots/replays |
| Browser requests | `lib/client-fetch.ts` | Route API/archive requests and static assets to their configured origins |
| Worker backend | `cloudflare/worker.ts`, `cloudflare/archive-source.ts` | Dispatch routes, serve archives and cache API responses in D1 |
| Regression checks | `tests/*.test.mjs` | Small repeatable fixtures that run without live credentials |

## Understand the data flow

The UI calls `siteFetch`. API requests reach the Worker or the same-origin application, depending on the build. The Worker serves historical ranking assets directly; other supported requests go through `app/api/` and the upstream helpers. The live ranking route replays only the latest 36 completed events. It is a sample, not a complete season archive.

Historical rebuilding downloads all events in the fetched season calendar, caches their pages and payloads, sorts events by end date and ID, then calls `processCompletedEvent` for each event. It writes a versioned file only when coverage checks pass. Coverage describes the fetched calendar, not an independent guarantee that upstream records contain every real competition.

The rating processor mutates maps keyed by official numeric team IDs. Call it exactly once per event in chronological replay order. Expectations use frozen pre-event ratings; partner shares also use earlier evidence within that event. Settlement returns component values, winner correction and cap adjustment for auditing. Display rounding and 75-day recency decay happen outside settlement.

The executable model is `lib/vcr3.mjs`, currently a VCR 3 candidate. The older VCR 2 README formulas and PDFs describe a different design. Do not copy their formulas into an individual API route; update the shared implementation and its tests together when intentionally changing the model.

## Rules and limitations to preserve

- A failed upstream page must fail the collection; returning partial data as a complete result would silently change rankings.
- Bracket positions are keyed by round and instance. Replays stay in the same slot, and missing positions stay `null`.
- Unscored historical 0-0 matches are ambiguous placeholders; explicitly scored 0-0 ties remain eligible.
- Event display classification and rating-tier classification currently differ. In particular, `level=World` is a qualifier flag in the calendar but maps to Worlds in the rating heuristic. Treat changing this as an algorithm change, not a comment cleanup.
- Champion detection currently uses named finals and win/loss counts. It is not a complete resolver for multi-division championship brackets.
- Live ranking `opr` and `dpr` fields are half-alliance averages, not fitted contribution estimates. Zero autonomous/skills fields in that response are placeholders.
- Archive caches have no automatic expiry. Re-running a builder resumes cached data; corrected upstream records require a deliberate cache refresh and rebuild.
- The Worker cache allowlist must include every query parameter that changes a response. Model-version changes also need the versioned cache namespace.

## Checks before opening a pull request

Run from `website/`:

```sh
node --test tests/data-regressions.test.mjs tests/vcr3.test.mjs tests/archive.test.mjs
pnpm lint
pnpm exec vite build --config vite.pages.config.ts
```

Use `pnpm build` when changing the full Vinext application. The fixture tests cover data handling, rating settlement and archive validation; they do not prove live API availability or historical model calibration. Report existing lint/build failures separately from failures introduced by your change.

For a UI change, also inspect the affected view, loading/error state and a narrow screen. For a bug fix, add a small fixture reproducing the bug. Comments should explain assumptions, units, side effects and reasons for unusual behavior, rather than narrating obvious syntax.

## Rebuilding historical data

This is a separate maintenance operation, not necessary for ordinary UI or comment changes. From `website/`, for example:

```sh
node scripts/rebuild-season-archives.mjs 197
```

Supported historical season IDs are 197, 190, 181 and 173. The command calls the configured public test API, retains progress under `.ranking-cache/`, and writes `public/rankings-YYYY-YY-vcr3.json`. If it stops on rate limiting or missing payloads, review the coverage report under `.ranking-cache/<season>/event-payloads/coverage.json` and resume later. A run interrupted before reporting may not have a new coverage report.

`scripts/build-historical-ranking.mjs` is the older direct-token builder: it limits divisions and omits the new coverage envelope. Use the rebuild script for versioned archives. After validating generated archives, `node scripts/prepare-archive-assets.mjs` prepares all configured seasons, while `--available` skips missing source files. Neither command deploys the website or Worker.

## GitHub and deployment

Create a focused branch and pull request with the problem, change and checks performed. Avoid committing dependencies, local caches, credentials or unrelated generated data. Deployment instructions live in [website/cloudflare/DEPLOYMENT.md](website/cloudflare/DEPLOYMENT.md); their status notes describe a previous deployment and should be checked before operational use. The root `.github/workflows/github-pages-test.yml` workflow publishes the frontend when manually dispatched. A source-code update alone does not deploy the API or rebuild historical archives.

## Access and review roles

The three project maintainers are `easonli29`, `fredyang88`, and `StevenQQian`. They have repository Admin access and are listed in `.github/CODEOWNERS` for every path. The `main` branch requires a pull request, one approval, Code Owner review, and resolved conversations for ordinary contributors; administrators can bypass those review requirements when necessary. Force pushes and branch deletion remain disabled for everyone.

Other contributors should fork this public repository and open a pull request; they do not need repository access to propose changes. If direct access is needed, grant only the minimum role required, such as Read or Triage, rather than Admin or Write. Repository Admin is not the same as organization Owner: the latter also controls organization-wide membership and settings.

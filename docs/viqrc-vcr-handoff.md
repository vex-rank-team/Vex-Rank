# VEX IQ rating (VIQCR 1.1): implementation notes

For: the partner who wrote the specification,
`output/pdf/vex_iq_competitive_rating_full_algorithm.pdf` (VIQCR-1.1-candidate.1).

The specification is implemented in full, including partner-adjusted consistency. The parts below
marked **decision** are things the specification leaves open; each needs your review before the
ratings are treated as more than a candidate.

## Where it lives

| File | What |
|---|---|
| `website/lib/viqcr.mjs` | The model: normalization fit, joint teamwork fit, consistency, skills, public score, inactivity, provisional status, season carry, validation, official-record helpers |
| `website/lib/viqcr-import.mjs` | Official events.vex records to the normalized event/session contract |
| `website/scripts/build-iq-ratings.mjs` | Fetches a season, fits the calibration window, replays it, publishes the result |
| `website/lib/vcr-iq.mjs` | How the site serves it: file names, calibration rule, history lookup |
| `website/tests/viqcr.test.mjs` | Scenario tests, including the specification's consistency table, plus a real Level Up event |

Run the tests from `website/` with `node --test tests/viqcr.test.mjs`.

## Why it is built offline

A season replay needs every completed event's matches and skills. For 2026-27 Level Up that is
218 events and about 470 official requests, and the token allows 100 a minute. A Cloudflare Worker
on the free plan may make 50 requests per incoming request, so the replay cannot run there.
`build-iq-ratings.mjs` runs it locally and writes two files to `archive-assets/`:

- `viqcr-2026-27.json`: the rankings, every rated team with its provisional flag;
- `viqcr-history-2026-27.json`: each team's VIQCR after every rated event.

The Worker serves both, the same way it serves past V5 seasons and the team directories. Refresh
is by hand. See "Refresh" in `website/cloudflare/TEAM-DIRECTORY.md`.

## What the data looks like (verified November 1, 2026)

- **Stations:** a teamwork match arrives as two one-team stations, each carrying the shared
  score.
- **Rounds:** 1 practice, 2 qualification, 15 teamwork finals. Any other round fails that
  event's teamwork import.
- **`scored` flag:** it is false on played matches. A match counts as played when it started or
  carries a score.
- **Skills:** one row per team and mode, with the best score and an attempt count. That is the
  specification's best-only case: the peak, at reliability 0.5.

## Decisions to review

1. **Calibration window.** The season's first 28 days of results, widened a week at a time until
   there are at least 300 team/session teamwork observations and 100 per skills mode
   (`CALIBRATION` in `lib/vcr-iq.mjs`). Those sessions train the profile and are not rated.
2. **Minimum scales.** The positive floor for each scale: teamwork 10 points, driving 5, coding 5.
3. **Team-specific zeros.** In a station pair showing 0 beside a scoring partner, one team was
   disqualified or did not show; the record does not say which. The match is excluded and
   audited as `team-specific-zero`. Two different non-zero station scores are ambiguous: that
   event's teamwork is not imported (its skills still are), and the build lists it under
   `importIssues`.
4. **No-shows and DQs** are otherwise not distinguishable from match records, so `noShowIds` and
   `dqIds` are always empty from this importer.
5. **Display.** `rating` is VIQCR rounded. `confidence`, shown as "±", is 1.25 × RD: RD in public
   points. Ordering uses exact VIQCR, with ties broken by team id.
6. **Grades** come from the published team directory, never from names. Anything that is neither
   Elementary School nor Middle School is Unknown.

## Not implemented

- **`summarizeIQQualifications`:** it needs the official drop counts, which I have not verified
  for Level Up. Official averages and ranks are still shown from events.vex as they are.
- **League sessions:** every event is one session (`sessionId: 'main'`). Leagues need their
  session dates, which the event records I fetch do not carry.
- **Past IQ seasons:** run `build-iq-ratings.mjs --season 196` (or 189) to publish one. Not done
  yet.
- **The specification's "before publishing" steps** (validation and release criteria, items
  2-5): the held-out backtest, baseline comparisons and tuning. The site labels VIQCR as a
  candidate model.

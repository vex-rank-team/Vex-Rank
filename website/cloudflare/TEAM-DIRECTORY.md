# Team directory

The Teams page searches a complete official V5RC team-directory snapshot, not the current ranking or a single exact-number profile. The snapshot includes unregistered teams and contains only public team IDs, numbers, names, organization, school level, registration status, and city/region/country. Street addresses and coordinates are excluded.

## Programs

There are two snapshots: `team-directory.json` (V5RC) and `team-directory-viqrc.json` (VEX IQ, built with `--program 41`). Each file states its `program`; V5 files built before that field existed have none and count as V5. The website and iOS app refuse a file for the other program, so a server that predates VEX IQ, which answers the IQ request with the V5 file, shows "The VEX IQ team directory isn't available yet." instead of V5 teams.

## Refresh

Both directories are refreshed by hand, when you choose; nothing rebuilds them on a schedule. From `website`, set `ROBOT_EVENTS_API_TOKEN` privately in the process environment and run:

```
node scripts/fetch-deployed-assets.mjs
node scripts/build-team-directory.mjs
node scripts/build-team-directory.mjs --program 41
node scripts/check-directories.mjs
node scripts/build-v5-rankings.mjs
node scripts/build-iq-ratings.mjs
node scripts/check-ratings.mjs
node scripts/check-deploy-assets.mjs
node --test tests/*.test.mjs
node node_modules/wrangler/bin/wrangler.js deploy --config cloudflare/wrangler.json
```

What the extra steps are for:

- `fetch-deployed-assets.mjs` first downloads the archives the Worker serves now, checking each against its published SHA-256. A deploy replaces every asset, and the past-season archives are not in this repository, so deploying without this step would remove them. It also saves the live directories to `work/` for the next check.
- `check-directories.mjs` refuses a directory whose `program` is wrong, whose count does not add up, or which shrank by more than 5% since the live one. Do not deploy if it fails; the live directories stay as they are.
- `build-v5-rankings.mjs` replays every completed event of the current V5 season (the live route can afford only the latest 36, so teams whose events are all older are missing from it) and writes `rankings-current-v5.json`, which the Worker serves in place of the live route. Pages are cached in `work/v5-pages-<season>`.
- `check-ratings.mjs` compares both new rating files with the live ones and refuses one that shrank, lost events or is malformed; `check-deploy-assets.mjs` refuses a deploy that would drop any file the Worker serves.
- The weekly GitHub workflow (`.github/workflows/weekly-ratings.yml`) runs these ratings steps every Monday, deploys, smoke-tests (`smoke-test.mjs`) and rolls back on failure. It needs the `ROBOT_EVENTS_API_TOKEN` and `CLOUDFLARE_API_TOKEN` repository secrets.
- `build-iq-ratings.mjs` replays the current VEX IQ season with VIQCR 1.1 and writes `viqcr-*.json` (see `docs/viqrc-vcr-handoff.md`). It reads grades from the IQ directory, so run it after that build. Finished events are cached in `work/iq-pages-<season>`, so a refresh fetches only new events; `--refresh` refetches everything (needed after upstream corrections). It runs a few minutes because of the token's rate limit.
- To refresh only one program, run just that build. Leave the other program's live file in `archive-assets/` (copy it from `work/previous-…` if needed) so the deploy keeps it.

The generator downloads every page without a season or registration filter. It verifies the unique team count against official pagination metadata before replacing `archive-assets/team-directory.json`. Failed/partial downloads never replace the published snapshot. Checkpoint pages in ignored `work/team-directory-pages` are reused for up to 24 hours. The source timestamp, count and checksum are recorded in `cloudflare/team-directory-manifest.json`. No credentials are written into either artifact.

Keep the other existing files in `archive-assets` when deploying: they contain the ranking archives. The frontend obtains the snapshot through `/api/team-directory`, displays its date, and searches locally without expensive per-team history requests. Locations include inactive-only countries and regions; school levels refer to the latest official profile, not an inferred historical-season grade. New registrations appear after rebuilding/publishing this snapshot.

Use the manual GitHub Pages test deployment workflow after changing the frontend. A source update alone does not publish the website.


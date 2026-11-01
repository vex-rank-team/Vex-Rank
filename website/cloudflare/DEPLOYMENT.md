# VEXRank test deployment

## Status

- API is live: https://vexrank-api-test.qiansteven54.workers.dev
- Worker: `vexrank-api-test`, Cloudflare Workers Free.
- Database: `vexrank-test`, Cloudflare D1, ENAM region.
- Website build is prepared for https://easonli29.github.io/Vex-Rank/.
- GitHub Pages is not published. The current GitHub plan requires this private repository to become public. The owner approved public visibility but subsequently instructed that it remain private until the existing Lucidchart invitation link in the README and commit history is revoked. Do not change visibility until that is confirmed.
- The previous Firebase function deployment was abandoned; the project remains on Spark. The existing Sites deployment is unchanged.

## Data handling

The Worker reuses the existing website API routes. The Event.VEX token is a Worker secret, never a browser build variable. D1 stores shared API responses for 15 minutes and permanent event rank locks. Larger responses exceeding the D1 cache value limit are served without database caching. Public GET endpoints have no user authentication; CORS allows the GitHub Pages origin but is not an access-control boundary.

The ranking algorithm and archive scope are unchanged. The historical ranking JSON remains a static website asset. This deployment does not create a new complete season archive or change the existing current-season sampling model.

## Deploy the API

From `website`, use the existing Wrangler installation:

```sh
node node_modules/wrangler/bin/wrangler.js login
node node_modules/wrangler/bin/wrangler.js d1 execute vexrank-test --remote --config cloudflare/wrangler.json --file cloudflare/schema.sql
node node_modules/wrangler/bin/wrangler.js secret put ROBOT_EVENTS_API_TOKEN --config cloudflare/wrangler.json
node node_modules/wrangler/bin/wrangler.js deploy --config cloudflare/wrangler.json
```

The database and secret already exist. Do not recreate them for routine deployments. The schema only creates missing tables. No paid plan has been enabled.

## Deploy the website

After the owner confirms the invitation is revoked, change repository visibility to public, enable Pages with GitHub Actions as its source, and merge the reviewed test-deployment changes. The workflow must be at repository root `.github/workflows/github-pages-test.yml`; all application files are under `website/`. Run the manual **VEXRank test deployment** workflow. It checks regression tests and API health before publishing the static build. No Cloudflare or Event.VEX secrets are needed in this frontend workflow.

```sh
pnpm exec vite build --config vite.pages.config.ts
```

For local testing, set `VEX_API_BASE=http://localhost:5173` and run Vite with this configuration; its local proxy forwards API requests to the test Worker. Production uses the Worker URL directly.

## Verified

- Worker bundle and website production build pass.
- API health confirms D1 connectivity.
- Current calendar: 707 events returned.
- Current ranking: 581 teams returned.
- Push Back skills: 9,980 team entries returned.
- Team `3150D`, season 197: correct profile, 16 historical/upcoming events, and 12 qualification ranking entries returned. A cached repeat took approximately 80 ms in one test.
- Worlds event 64026: 585 teams; all 8 divisions returned, including Middle School overall finals, with elimination matches in each division.

Counts and timings are observations from the test run, not permanent guarantees. Free Worker CPU/subrequest quotas and upstream availability can still limit cold requests for larger data sets; retain the cache and monitor errors before broader release. This remains a test deployment.

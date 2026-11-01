# VEXRank for iOS

Native SwiftUI client, sharing the Worker API with the website.

## Why native rather than a web wrapper

A read-only browser over a JSON API ports cleanly, and two problems the web
build fights simply do not exist here:

- **Content blockers.** The site is served from GitHub Pages while the API lives
  on a `*.workers.dev` origin, so every data request is third-party and blockers
  drop it. A native app has no origin, sends no `Origin` header, and no
  extension can cancel its requests.
- **List size.** The web build caps Events and Teams at 60 because rendering 720
  cards cost 15,576 DOM nodes and ~125ms of layout. SwiftUI recycles rows, so
  the cap is unnecessary.

## Architecture

`VEXRankKit` is a Swift package holding models, the API client, the stroke-glyph
data and the shared views. The app target consumes it.

**The Worker owns the VCR maths.** Nothing here recomputes a rating. That is
deliberate: the same model already existed twice on the web with different
confidence floors (35 live, 25 in the archive scripts) and the two silently
disagreed. A third implementation in Swift would guarantee drift, and it would
be the hardest kind to spot - two clients showing different numbers for the same
team.

The client does not trust the server's *ordering*, though. `sortedForDisplay`
sorts by the rating the UI shows, because the deployed Worker still sorts by
`rating - confidence` while returning `rating`.

## Status

Built and tested:

- `Models.swift` - decoded against responses captured from the live Worker
- `VEXRankAPI.swift` - `URLSession` actor, retries 5xx and transport failures
  with backoff and jitter, does not retry 4xx or decoding errors
- `StrokeGlyphs.swift` - 36 centreline glyphs ported from
  `website/lib/stroke-glyphs.mjs`
- `StrokePath.swift` - parses the `M`/`L`/`C` subset and measures arc length
- `SignedNumberView.swift` - writes a team number stroke by stroke using
  `Path.trim`, which draws genuinely nothing at 0 and so cannot reproduce the
  round-cap dot the web version hit
- `Theme.swift` - the four palettes, with contrast asserted in tests

Not yet built: the rankings list, team profile and event views, and the Xcode
app target.

## Running the tests

```sh
cd ios/VEXRankKit && swift test
```

Fixtures under `Tests/VEXRankKitTests/Fixtures` are real API responses, not
hand-written samples - the point is to catch the API drifting from the models,
which a sample written here never could.

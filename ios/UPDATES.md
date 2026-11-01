# Shipping changes without an App Store release

There are two channels, because there are two kinds of change.

## What cannot be done

iOS cannot load new native code at runtime, and App Store guideline 2.5.2
forbids trying. The tools that advertise over-the-air patching (CodePush, Expo
Updates) work only because a React Native app's logic is JavaScript running in
an interpreter; a SwiftUI app has no equivalent seam. **Anything that adds a
view, a chart or a screen needs a new binary.** No design makes that untrue, so
the goal here is to make the set of changes that need one as small as possible,
and to make delivering one cheap when it is unavoidable.

## Channel 1 — config, live in five minutes

`GET /api/app-config` serves the settings the app reads at launch. They cover
everything that changes on somebody else's schedule:

| Field | What it decides |
| --- | --- |
| `currentSeason` | RobotEvents season id the live tabs read |
| `program` | Program slug in links to events.vex.com |
| `eventCacheSeconds` | Response lifetime during a live event |
| `directoryCacheSeconds` / `defaultCacheSeconds` | The other two lifetimes |
| `flags` | Free-form named switches, `store.config.flag("name")` |
| `update` | Drives the update banner (channel 2) |
| `announcement` | A note to readers, dismissed once per `id` |

The season rollover is the one worth calling out: it used to be `204` written
into two function signatures, so the first weekend of the new season would have
shown an empty app until a release cleared review.

**To change one**, write the override row — no deploy:

```bash
npx wrangler d1 execute vexrank-test --remote --command "INSERT INTO app_config(key,value) VALUES('ios','{\"currentSeason\":211}') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=unixepoch()"
```

Readers pick it up within five minutes (`max-age=300`), or immediately on next
launch. Only the keys present are overridden; everything else keeps the
Worker's defaults.

### Why a bad config cannot break the app

A config ships without review, which is the point and also the risk. So the
client treats it as a suggestion it validates, not an instruction it obeys:

- every field is optional, and anything absent, malformed or out of range keeps
  the value the binary was built with;
- an implausible season is refused outright rather than pointing the app at a
  season with no events in it;
- cache lifetimes are clamped, so a `0` cannot turn every scroll into a round
  trip and walk the app into the rate limiter;
- the last good config is stored on disk and read synchronously at launch, so a
  config service that is down or slow costs nothing;
- **the update gate never locks anyone out.** A minimum build set too high, or
  set against a build that turns out not to exist, would otherwise brick every
  install with no way to take it back — the config that could fix it is read by
  the app it just disabled. `required` shows a banner that will not dismiss and
  stops there.

`AppConfigTests` and `AppConfigStoreTests` cover each of those.
`testWorkerDefaultsAreTheBundledConfig` decodes a fixture generated from the
Worker's own `APP_CONFIG_DEFAULTS` and asserts it equals `AppConfig.bundled`, so
the two codebases cannot drift apart unnoticed.

## Channel 2 — binaries

For changes that do need a build, **TestFlight internal testing** is the closest
thing to instant: up to 100 internal testers, **no review per build**, available
minutes after upload. (External TestFlight and the App Store both review each
new version.) All of it needs a paid Apple Developer Program membership.

Once a build is up, tell the app about it so readers are not left on an old one:

```bash
npx wrangler d1 execute vexrank-test --remote --command "INSERT INTO app_config(key,value) VALUES('ios','{\"update\":{\"latestBuild\":7,\"version\":\"1.1\",\"url\":\"https://testflight.apple.com/join/XXXX\",\"notes\":\"What changed.\"}}') ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=unixepoch()"
```

`latestBuild` is compared against `CFBundleVersion`, so bump
`CURRENT_PROJECT_VERSION` on every build or the banner will not fire. Add
`minimumBuild` only when an old build genuinely misreads the current API.

## Status

Shipping the iOS binary is still blocked on Xcode having no Apple ID signed in
(`xcodebuild` fails with `No Account for Team F6CMB42387`). Sign in under
Xcode → Settings → Accounts, then `./ship.sh`.

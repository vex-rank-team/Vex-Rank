# Versioning and releases

Each product has its own version number, its own changelog and its own git
tags, so a website release never implies an app release or the other way round.

| Product | Version lives in | Changelog | Tag | Lives in |
|---|---|---|---|---|
| Website (vex-rank.com) | `website/package.json` (`version`), shown in the site footer | [`website/CHANGELOG.md`](website/CHANGELOG.md) | `website-vX.Y.Z` | this repository |
| iOS app (Scouting Cat) | `ios/make-xcodeproj.py`: `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` | `ios/CHANGELOG.md` | `ios-vX.Y.Z+BUILD` | [StevenQQian/Vex-Rank](https://github.com/StevenQQian/Vex-Rank), branch `feat/routing-and-dx` |
| Android app | `android/app/build.gradle.kts`: `versionName` and `versionCode` | `android/CHANGELOG.md` | `android-vX.Y.Z+CODE` | same as iOS |

The VCR rating model is versioned separately in [`versions/`](versions/).

## Choosing the next number

Versions follow [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

- **Patch** (1.0.0 → 1.0.1): fixes only, nothing new to announce.
- **Minor** (1.0.1 → 1.1.0): new features or visible changes.
- **Major** (1.1.0 → 2.0.0): a redesign, or something that breaks shared links
  or saved settings.

The apps also carry a **build number** (`+4` in `ios-v1.0.0+4`). It goes up by
one for every upload to App Store Connect or Google Play, even when the version
stays the same, because the stores reject a repeated build number.

## Releasing the website

1. While working, add each change under `## [Unreleased]` in
   `website/CHANGELOG.md`.
2. When it's time to release, open a PR that moves those entries under a new
   `## [X.Y.Z] - YYYY-MM-DD` heading and sets `"version"` in
   `website/package.json`. It needs a code owner's review like any change.
3. After it merges, deploy with the "VEXRank test deployment" workflow, then
   tag the merge commit and publish the release:
   ```bash
   git fetch upstream && git tag -a website-vX.Y.Z upstream/main -m "Website X.Y.Z"
   git push upstream website-vX.Y.Z
   gh release create website-vX.Y.Z -R vex-rank-team/Vex-Rank --title "VEX-Rank website X.Y.Z" --notes-file <notes>
   ```

## Releasing an app

1. Raise the build number (and the version, if it changed) and note the
   changes in the app's `CHANGELOG.md`, then commit.
2. Archive and upload **from that commit**, so the tag below matches what the
   store reviews exactly.
3. Tag it, e.g. `git tag -a ios-v1.0.0+5 -m "Scouting Cat 1.0.0 (5)"`, and push
   the tag.

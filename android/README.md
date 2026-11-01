# Makapaka Scout for Android

A native Kotlin/Compose port of the iOS app. Same API, same rules, same
captured payloads behind the tests.

## Building

The toolchain is not bundled. It needs the Android SDK (platform 35,
build-tools 35) and a JDK 21 - the machine's default JDK 25 is newer than the
Android Gradle Plugin supports, so `gradle.properties` points the build at 21
explicitly.

    brew install --cask android-commandlinetools
    brew install gradle openjdk@21
    export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
    yes | sdkmanager --licenses
    sdkmanager --install "platform-tools" "platforms;android-35" "build-tools;35.0.0"

Then:

    cd android
    gradle :app:assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
    gradle :app:testDebugUnitTest      # the ported rules

## What is shared with iOS, and what is not

Nothing is shared at build time: the iOS kit is Swift and this is Kotlin. What
is shared is the *behaviour*, and the fixtures that pin it - the JSON under
`app/src/test/resources` is copied from the iOS suite, so a rule that drifts on
one platform fails on the other.

The rules that were expensive to get right, and are therefore the ones worth
keeping in step:

- Team numbers sort as numbers, so 2A precedes 2011A.
- An event's date is a calendar day, not an instant, or it shifts west of UTC.
- A team's location comes from whichever feed names more places; the rankings
  feed omits the city.
- OPR/DPR/CCWM are fitted, not counted, with a ridge scaled to how thin the
  data is - unregularised, a young event fits nonsense.
- DPR runs smallest-first; everything else largest-first.
- An unplayed match has no score, and the API's `scored` flag cannot be trusted.
- Awards without winners are not results.

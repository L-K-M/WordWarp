#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# --skip-web is useful when building both native hosts from one verified web bundle.
if [[ "${1:-}" == "--skip-web" ]]; then
  shift
else
  npm run build:native
fi
if [[ -z "${JAVA_HOME:-}" && "$(uname)" == "Darwin" ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
if [[ -z "${ANDROID_HOME:-}" && -d "$HOME/Library/Android/sdk" ]]; then
  export ANDROID_HOME="$HOME/Library/Android/sdk"
fi
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" && ! -f native/android/local.properties ]]; then
  echo "Set ANDROID_HOME to an Android SDK with platform 36 and build-tools 35.0.0." >&2
  exit 1
fi
native/android/gradlew -p native/android --no-daemon :app:assembleDebug "$@"
mkdir -p artifacts/native
cp native/android/app/build/outputs/apk/debug/app-debug.apk artifacts/native/WordWarp-android-debug.apk
printf 'Android APK: %s/artifacts/native/WordWarp-android-debug.apk\n' "$ROOT"

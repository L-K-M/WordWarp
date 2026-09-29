# Android dependency notices

The Android runtime artifacts in `runtime-licenses.json` are third-party works,
excluded from WordWarp's Unlicense. Each exact artifact/version is identified
by SHA-256, license, attribution, upstream POM URL, and applicable build variants.
The current inventory has 72 debug artifacts and 71 release artifacts; every
artifact's published POM (including Guava's inherited parent license) was checked
and declares Apache-2.0. It includes
AndroidX/Jetpack Compose, Guava's ListenableFuture, Kotlin, coroutines,
serialization, JetBrains annotations, and JSpecify. AndroidX graphics-path also
contains its native path library; its upstream C++ sources use Apache-2.0.

`../licenses.gradle` runs before each variant's build. It verifies the resolved
inventory and artifact bytes, copies these upstream texts unchanged, and extracts
license/NOTICE resources from the actual JARs and AARs (including runtime nested
JARs). Build-time lint JARs are not part of the APK inventory. Distinct embedded
texts are deduplicated by content hash; the index maps every original entry to its
preserved text. No network lookup or license inference is performed by this task.

The APK contains `assets/licenses/android/INDEX.txt`, a combined `NOTICES.txt`,
and the separate exact texts. The shared renderer's JavaScript/font notices and
WordWarp license scope are packaged alongside these assets. Google Material
Icons' credits and license are in `assets/licenses/material-icons-NOTICE.txt`
and `assets/licenses/material-icons.txt`.

## Updating dependencies

After changing Gradle dependencies, run:

```sh
./gradlew :app:reportRuntimeLicenseArtifacts
```

Review `app/build/reports/licenses/runtime-artifacts.json` against the changed
components' published POMs, source licenses/NOTICEs, and binary resources. Update
the checked-in manifest and upstream texts only after that review. A version or
binary change intentionally fails normal builds until this inventory is updated.

To verify both distributions without compiling the app:

```sh
./gradlew :app:generateDebugLicenseNotices :app:generateReleaseLicenseNotices
```

## Exact upstream license sources

- `androidx-LICENSE.txt`: https://raw.githubusercontent.com/androidx/androidx/androidx-main/LICENSE.txt
  (also byte-identical to the LICENSE entries in the reviewed AndroidX binaries)
- `kotlin-LICENSE.txt`, `kotlin-NOTICE.txt`: https://github.com/JetBrains/kotlin/tree/v2.2.21/license
- `coroutines-LICENSE.txt`: https://raw.githubusercontent.com/Kotlin/kotlinx.coroutines/1.9.0/LICENSE.txt
- `serialization-LICENSE.txt`: https://raw.githubusercontent.com/Kotlin/kotlinx.serialization/v1.7.3/LICENSE.txt
- `annotations-LICENSE.txt`: https://raw.githubusercontent.com/JetBrains/java-annotations/23.0.0/LICENSE.txt
- `jspecify-LICENSE.txt`: https://raw.githubusercontent.com/jspecify/jspecify/v1.0.0/LICENSE
- `guava-LICENSE.txt`: https://raw.githubusercontent.com/google/guava/v26.0/COPYING
  (`listenablefuture:1.0` inherits license metadata from `guava-parent:26.0-android`)

The Gradle wrapper/start scripts are build tools, not Android runtime libraries.
Their own Apache-2.0 notices remain in the scripts. `../gradle/wrapper/LICENSE`
and `NOTICE` are copied unchanged from the checksum-verified Gradle 8.14.3
distribution; the full distribution notices also describe Gradle's build-time
dependencies, which are not included in the WordWarp APK.

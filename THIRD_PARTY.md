# Third-party material in WordWarp

The Unlicense applies to WordWarp's original work only; [LICENSING.md](LICENSING.md)
defines the exclusions. Keep third-party licenses and notices when redistributing
source or compiled packages. Attribution is not a substitute for permission.

## Bundled fonts

`src/assets/fonts/` contains Fontsource-distributed font subsets. The complete
licenses, original author credits, reserved font names and exact file provenance
are in `public/fonts/`. Luckiest Guy and Slackey use Apache-2.0; the other bundled
families use OFL-1.1. Font binaries keep their licenses and are not public domain.

## JavaScript and generated runtime code

The locked npm dependencies include React/React DOM (Meta and contributors),
Zustand (Poimandres contributors), Immer (Michel Weststrate and contributors),
Zod (Colin McDonnell and contributors), fflate (Arjun Barrett), Alea (Johannes
Baagøe), simplex-noise (Jonas Wagner), fast-png/iobuffer (image-js contributors),
gifenc (Matt DesLauriers), UPNG.js (Photopea), idb (Jake Archibald) and Workbox
(Google). These acknowledgements supplement the exact copyright statements in
the packages; they do not replace them.

Most use MIT; idb uses ISC, and Pako includes both MIT and zlib-licensed code by
Jean-loup Gailly, Mark Adler, Vitaly Puzrin and Andrey Tupitsin. Vite/Rolldown and
Tailwind supply runtime helpers or generated styles with their own notices.
Development tools retain their separate licenses even when not shipped in the app.

Every production build emits `licenses/npm-notices.txt` and
`licenses/manifest.json` from the installed, lockfile-verified package files.
The inventory conservatively includes the declared runtime dependency closure,
Workbox runtime modules (including generated service-worker code) and generated
helper/style notices. Some listed packages are not used by every target. Build
checks reject missing license files, mismatched installed versions, unreviewed
license identifiers or a bundled package absent from the inventory. Original
license/NOTICE files are retained verbatim, including Pako's separate zlib notice.

## Native hosts and build tools

- Android Material Icons: Google, Apache-2.0. Source attribution appears in each
  `native/android/app/src/main/res/drawable/ic_*.xml`; the complete license is in
  `native/android/MATERIAL-ICONS-LICENSE.txt` and APK assets.
- AndroidX, Kotlin and other resolved Android runtime components: see the native
  Android dependency notice inventory and generated APK notices. Their licenses
  apply to the embedded code, independently of WordWarp's source dedication.
- Gradle wrapper: Gradle contributors, Apache-2.0, with its supplied notices under
  `native/android/gradle/wrapper/`. The Gradle distribution is a separately
  downloaded build tool with its own licenses.
- macOS SwiftUI/AppKit/WebKit and SF Symbols are system API dependencies. No Apple
  framework or exported SF Symbols artwork is copied into this repository.
- Ubuntu's Python, GTK4, libadwaita, WebKitGTK and icon libraries are installed by
  the system package manager. The `.deb` does not copy their libraries into the
  WordWarp package; their original licenses continue to apply.
- Docker base images and GitHub Actions retain their own licenses. A WordWarp
  license declaration does not relicense an entire operating-system image.

## Original artwork and design references

The WordWarp logo was created by Lukas Mathis. Stamp geometry and procedural
textures are authored in this project, with no bundled Microsoft texture bitmap
or external clipart collection. The current named color ramps are new WordWarp
palettes inspired by broad themes such as sunset, ocean and reflected metal;
their legacy IDs preserve compatibility, not a claim to Microsoft's artwork.
Research references in PLAN.md credit the products that informed the design.
Older copied tables and excerpts remain outside the dedication; see LICENSING.md.

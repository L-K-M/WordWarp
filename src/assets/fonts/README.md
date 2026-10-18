# Bundled fonts

These thirteen WOFF2 files are third-party font software, excluded from WordWarp's
Unlicense. Eleven families use **OFL-1.1**; **Luckiest Guy and Slackey use
Apache-2.0**. System font names in the catalog do not bundle those system fonts.

The distribution notices live in [`public/fonts/LICENSE.txt`](../../../public/fonts/LICENSE.txt),
with complete, unmodified font licenses in [`public/fonts/licenses/`](../../../public/fonts/licenses/)
and a per-file inventory in [`public/fonts/SOURCES.json`](../../../public/fonts/SOURCES.json).
Vite copies this public directory into both web and native bundles, keeping the
licenses available offline in each packaged app.

## Provenance

On 2026-09-29, all thirteen existing binaries matched their Fontsource **5.3.0**
distribution files byte for byte. Baloo 2 uses `@fontsource-variable/baloo-2`;
the other fonts use their respective `@fontsource/` packages. The original import
did not record its download URLs; this audit establishes matching versioned
sources without claiming which URL was used originally. `SOURCES.json` records
the version-pinned font and license URLs, SHA-256 hashes, exact font versions,
and copyright/license metadata read from each binary's `name` table. No font
binary was changed during the license correction.

The license files are exact copies from those matching Fontsource packages.
The inventory also links the Google Fonts licenses at commit
`23e54b51ddffbc7713c583748e3bd86f62b1fa4a` as an independent upstream reference.
Some upstream notices differ: Black Ops One's binary and matching distributor
license contain the wording “PinyonScript Project Authors”; the Google Fonts
notice names “Black-Ops Project Authors”. Modak's binary says 2014, while its
distributor license says 2015. Preserve both notices instead of silently editing
third-party license text.

## Maintaining the bundle

- Keep the complete license and notices beside every distributed font. Update
  the index and inventory when adding, replacing, or removing a font.
- Record a versioned source URL and verify the SHA-256 hash of both font and
  license. Do not assume that all Google Fonts use the same license.
- These are unchanged, prebuilt Latin subsets supplied by Fontsource. WordWarp
  does not perform its own subsetting. Preserve the distributor's Reserved Font
  Name declarations. Before modifying a font, follow its OFL conditions,
  including obtaining permission to retain a reserved name or choosing a new
  name as required.
- Do not apply the project Unlicense to these files or remove their original
  notices. The complete third-party terms govern their use and redistribution.

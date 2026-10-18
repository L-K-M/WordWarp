# WordWarp licensing scope

WordWarp's original source code, documentation, procedural artwork and original
branding are released under the [Unlicense](LICENSE), SPDX identifier `Unlicense`.
Lukas Mathis has confirmed authorship of the supplied WordWarp logo; the original
logo in `media-sources/logo.png` and its application copy in
`src/assets/brand/wordwarp-logo.png` are included in this dedication.

This dedication covers rights held by WordWarp's authors. It does not replace,
waive or relicense other people's rights. In particular, the following material
is **excluded from the Unlicense** and retains its own terms:

- Font files in `src/assets/fonts/`, including their subset builds: the applicable
  SIL Open Font License or Apache License, with complete per-font notices under
  `public/fonts/`.
- npm dependencies and any copies incorporated into compiled JavaScript, workers,
  service workers or generated styles: their individual licenses and notices.
- Android Material Icons, Android/Kotlin dependencies and the Gradle wrapper:
  the third-party licenses accompanying those components.
- Third-party license texts, attribution records, quotations and external material
  carrying their own copyright notices.
- System frameworks, fonts and symbols supplied by Apple, Android or Linux, and
  third-party tools or container base images used to build or run WordWarp. These
  remain subject to their respective licenses and are not WordWarp-owned works.
- Documents, fonts or artwork imported by users. Using WordWarp does not change
  ownership of those inputs or impose the Unlicense on them.

See [THIRD_PARTY.md](THIRD_PARTY.md) for component locations and provenance.
Distributions include the dedication, this scope statement and readable notices
at `licenses/index.html`. Android also includes its resolved native dependency
notices under `assets/licenses/android/`.

References to other products describe inspiration or compatibility. They do not
imply endorsement or grant rights to third-party trademarks, patents or assets.

## Historical revisions and contributions

This scope describes the current source tree and builds made from it. Earlier Git
revisions included copied Office-style color-ramp tables and competitor code
excerpts without a recorded reuse grant. They are not dedicated by this Unlicense.
Correcting the current tree does not remove them from Git history or license old
archives. Review the history separately before making an existing private
repository public; a fresh source snapshot avoids publishing those old revisions.

Contributors must have authority to submit their original work under the
Unlicense, and must identify any third-party material and preserve its terms.
This statement does not assert ownership of independent contributors' or
employers' rights. See [CONTRIBUTING.md](CONTRIBUTING.md).

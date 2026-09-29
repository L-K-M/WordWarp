#!/usr/bin/env python3
"""Build an architecture-independent Debian package using only the standard library."""
import gzip
import io
import json
import os
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parents[2]
WEB = ROOT / "dist-native"
OUTPUT = ROOT / "artifacts/native/WordWarp-linux-all.deb"
EPOCH = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))


def archive(files: dict[str, tuple[bytes, int]]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        directories = {str(parent) for path in files for parent in Path(path).parents if str(parent) != "."}
        for name in sorted(directories, key=lambda item: (item.count("/"), item)):
            entry = tarfile.TarInfo("./" + name)
            entry.type = tarfile.DIRTYPE
            entry.mode = 0o755
            entry.mtime = EPOCH
            entry.uname = entry.gname = "root"
            tar.addfile(entry)
        for name, (data, mode) in sorted(files.items()):
            entry = tarfile.TarInfo("./" + name)
            entry.size, entry.mode, entry.mtime = len(data), mode, EPOCH
            entry.uname = entry.gname = "root"
            tar.addfile(entry, io.BytesIO(data))
    return gzip.compress(buffer.getvalue(), mtime=EPOCH)


def build() -> None:
    for required in ("native.html", "licenses/index.html", "licenses/manifest.json", "fonts/SOURCES.json"):
        if not (WEB / required).is_file():
            raise SystemExit(f"Missing dist-native/{required}. Run npm run build:native first.")
    version = json.loads((ROOT / "package.json").read_text())["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise SystemExit("Unsupported package version")
    deb_version = version.replace("-", "~", 1)
    copyright_notice = (
        "WordWarp licensing and attribution\n\n"
        "WordWarp's original work is dedicated under the Unlicense. Third-party\n"
        "components are expressly excluded and retain their individual terms.\n\n"
        "Installed notices (available offline):\n"
        "  /usr/share/wordwarp/web/licenses/index.html\n"
        "  /usr/share/wordwarp/web/licenses/LICENSING.md\n"
        "  /usr/share/wordwarp/web/licenses/THIRD_PARTY.md\n"
        "  /usr/share/wordwarp/web/licenses/npm-notices.txt\n"
        "  /usr/share/wordwarp/web/licenses/manifest.json\n"
        "  /usr/share/wordwarp/web/fonts/LICENSE.txt\n"
        "  /usr/share/wordwarp/web/fonts/SOURCES.json\n"
        "  /usr/share/wordwarp/web/fonts/licenses/\n\n"
        "Python, GTK, libadwaita, WebKitGTK and system icon libraries are apt\n"
        "dependencies; they are not copied into this package. Their notices\n"
        "are supplied by their own Debian/Ubuntu packages.\n\n"
        "===== Original-work dedication: Unlicense =====\n\n"
        + (ROOT / "LICENSE").read_text()
        + "\n===== Scope and third-party exclusions =====\n\n"
        + (ROOT / "LICENSING.md").read_text()
        + "\n===== Third-party attribution and provenance =====\n\n"
        + (ROOT / "THIRD_PARTY.md").read_text()
    ).encode()
    files = {
        "usr/bin/wordwarp": (b'#!/bin/sh\nexec /usr/bin/python3 /usr/share/wordwarp/wordwarp.py "$@"\n', 0o755),
        "usr/share/wordwarp/wordwarp.py": ((ROOT / "native/linux/wordwarp.py").read_bytes(), 0o644),
        "usr/share/wordwarp/VERSION": ((version + "\n").encode(), 0o644),
        "usr/share/applications/app.wordwarp.WordWarp.desktop": ((ROOT / "native/linux/app.wordwarp.WordWarp.desktop").read_bytes(), 0o644),
        "usr/share/mime/packages/wordwarp.xml": ((ROOT / "native/linux/wordwarp.xml").read_bytes(), 0o644),
        "usr/share/icons/hicolor/scalable/apps/app.wordwarp.WordWarp.svg": ((ROOT / "public/wordwarp-icon.svg").read_bytes(), 0o644),
        "usr/share/doc/wordwarp/README.md": ((ROOT / "native/linux/README.md").read_bytes(), 0o644),
        "usr/share/doc/wordwarp/copyright": (copyright_notice, 0o644),
    }
    for path in sorted(WEB.rglob("*")):
        if path.is_file() and not path.is_symlink():
            files["usr/share/wordwarp/web/" + path.relative_to(WEB).as_posix()] = (path.read_bytes(), 0o644)
    control = f"""Package: wordwarp
Version: {deb_version}
Architecture: all
Maintainer: WordWarp contributors
Section: graphics
Priority: optional
Depends: python3 (>= 3.10), python3-gi, python3-gi-cairo, gir1.2-gtk-4.0 (>= 4.10), gir1.2-adw-1 (>= 1.4), gir1.2-webkit-6.0 (>= 2.44), adwaita-icon-theme, librsvg2-common
Installed-Size: {(sum(len(value[0]) for value in files.values()) + 1023) // 1024}
Homepage: https://github.com/L-K-M/WordWarp
Description: Native desktop editor for warped text and layered effects
 Create text and stamp compositions with native GTK controls, editable effects,
 animation and transparent PNG, APNG and GIF export. Bundled canvas resources
 work offline without a local server. Requires Ubuntu 24.04 or compatible libraries.
"""
    members = [("debian-binary", b"2.0\n"), ("control.tar.gz", archive({"control": (control.encode(), 0o644)})), ("data.tar.gz", archive(files))]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("wb") as output:
        output.write(b"!<arch>\n")
        for name, data in members:
            output.write(f"{name + '/':<16}{EPOCH:<12}{0:<6}{0:<6}{'100644':<8}{len(data):<10}`\n".encode("ascii"))
            output.write(data)
            if len(data) % 2:
                output.write(b"\n")
    print(f"Ubuntu package: {OUTPUT}")


if __name__ == "__main__":
    build()

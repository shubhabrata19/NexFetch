# Third-party notices

NexFetch itself is licensed under the Apache License 2.0. The components below
are separate works with their own licenses. Release builds that include their
binaries must ship the corresponding notices and, where required, a source
offer. This file is a summary, not a replacement for the upstream license texts.

## Bundled runtime binaries

| Component              | Version                  | License                                   | Source                                                     | Notes                                                                                                                                                                      |
| ---------------------- | ------------------------ | ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| yt-dlp                 | 2026.10.26               | Unlicense                                 | https://github.com/yt-dlp/yt-dlp                           | Public-domain-style license; no attribution required.                                                                                                                      |
| FFmpeg / ffprobe       | n9.0.2 (BtbN LGPL build) | LGPL-3.0-or-later                         | https://ffmpeg.org / https://github.com/BtbN/FFmpeg-Builds | Distributed as separate executables. LGPL requires license text, attribution, and a way to replace/relink the library; see the upstream build for its exact configuration. |
| libtorrent (Rasterbar) | 2.1.1                    | BSD-3-Clause                              | https://libtorrent.org                                     | Linked into the torrent helper.                                                                                                                                            |
| PyInstaller bootloader | 6.22.3                   | GPL-2.0-or-later with a special exception | https://pyinstaller.org                                    | The exception permits distributing bundled applications under other licenses.                                                                                              |

The FFmpeg build reports LGPL v3-or-later via `ffmpeg -L` because it is compiled
with `--enable-version3`; re-check its license metadata for every release.

Pinned versions and SHA-256 hashes are recorded in
`resources/binaries.manifest.json`.

## Build and development dependencies

npm dependencies and their licenses are recorded in `package-lock.json`.
Python development dependencies are pinned in
`tools/torrent-helper/requirements.txt`.

## License texts

- Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
- LGPL 3.0: https://www.gnu.org/licenses/lgpl-3.0.html
- BSD 3-Clause: https://opensource.org/license/bsd-3-clause
- Unlicense: https://unlicense.org
- PyInstaller exception: https://github.com/pyinstaller/pyinstaller/blob/develop/COPYING.txt

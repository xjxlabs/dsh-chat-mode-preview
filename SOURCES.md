# Source provenance

This repository assembles two matched source trees, retaining their MIT licenses and third-party notices. No upstream Git directory, credentials, browser profile, runtime data or private acceptance evidence is included.

| Tree | Upstream | Local integration base |
|---|---|---|
| harness | https://github.com/deepseek-ai/deepseek-harness | 1abfb100c6211006ef7238c338dba7db47304ef9 |
| plugin | https://github.com/SpookySandwich/dsh-plugin-no-workspace | 8b0e5d4f55090b117560664d7fd12c04544f763f |

These SHAs identify local integration bases; they are not a claim that the commits are available from the upstream public remotes. This source snapshot is self-contained and does not require fetching those SHAs.

Included local changes: Chat persona dynamic provider/model identity; M1.1 native mode entry and navigation; composer/status presentation; historical scroll restoration and corresponding tests/documentation. The Harness baseline includes required P1D and P1F-B extensions. Original uncommitted P1F-C/C0 infrastructure work is excluded.

Release assembly changes are limited to relative-path startup, isolated preview profile setup, public documentation and source-only distribution hygiene. Upstream executable and symlink modes are preserved in the proposed Git tree. Windows checkouts with core.symlinks=false represent symlinks as target-text files, matching the original Windows source checkout. Old private review screenshots and the obsolete plugin demo GIF are excluded. Other upstream source files remain available for attribution and reproducibility.

Harness: MIT, copyright DeepSeek. Plugin: MIT, copyright SpookySandwich. This experimental combination is a community preview and does not imply upstream endorsement.

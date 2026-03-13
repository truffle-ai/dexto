---
'dexto': patch
---

Add first-class CLI lifecycle commands and finalize uninstall naming.

- Add `dexto upgrade [version]` for self-upgrade with install-method detection and npm/pnpm/bun -> native migration.
- Make `dexto uninstall` the CLI self-uninstall command (remove `uninstall-cli` command exposure).
- Keep agent lifecycle under `dexto agents ...` and add `dexto agent ...` alias for singular usage.
- Improve update notifications to point to `dexto upgrade` and source latest version from GitHub Releases.

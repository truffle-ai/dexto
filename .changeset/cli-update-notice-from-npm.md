---
'dexto': patch
---

Tell people and agents when the CLI is out of date

The update check read GitHub's latest release, which in this monorepo is whichever package released last (such as `@dexto/image-logger-agent@1.18.1`), so it compared the CLI against another package's version and almost never said a newer CLI was out. It now reads the `dexto` package's own latest version from npm. Every command except the interactive CLI (which shows its own notice) and `dexto upgrade` now prints the notice before it runs, on stderr: the styled notice at a terminal, otherwise one plain line, so an agent running a `--json` command learns its CLI is out of date while stdout stays the command's result. `DEXTO_NO_UPDATE_CHECK=true` still turns the check off.

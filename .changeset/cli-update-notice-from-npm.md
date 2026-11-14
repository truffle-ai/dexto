---
'dexto': patch
---

Tell people when the CLI is out of date

The update check read GitHub's latest release, which in this monorepo is whichever package released last (such as `@dexto/image-logger-agent@1.18.1`), so it compared the CLI against another package's version and almost never said a newer CLI was out. It now reads the `dexto` package's own latest version from npm. Every command except the interactive CLI (which shows its own notice) and `dexto upgrade` now shows the notice to a person at a terminal, on stderr. It never appears in `--json` or `--stream-json` output, or when stdout is piped, and it never waits on npm: it reads the cached result and refreshes a day-old cache in the background. A failed lookup is cached too, so an offline machine no longer waits for npm on every start. `DEXTO_NO_UPDATE_CHECK=true` still turns the check off.

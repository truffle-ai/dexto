---
'dexto': patch
---

Usage errors from the root, `chat`, `run`, `review`, `acp`, `upgrade` and `uninstall` now follow the output contract: with `--json`, or when stdout isn't a terminal, they print `{"error":{"code":"usage","message","fix"}}` on stderr, the fix naming that command's help, and still exit 2. `dexto bogus --json` reports `bogus` instead of "unknown option '--json'". `--help --json` prints JSON help for every command, not only the root.

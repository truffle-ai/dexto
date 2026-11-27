---
'dexto': patch
---

`dexto workspace sites records update` takes `--expected-version <n>`, the record version you read, and sends it as the Site record tool's `expectedVersion`. When the record changed since, the update fails as a `conflict` (exit 1; `{ error: { code: "conflict", message, fix } }` with `--json`): the message carries the record as it is now, and `fix` is the `records get` command to read it again before retrying.

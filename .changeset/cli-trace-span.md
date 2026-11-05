---
'dexto': minor
'@dexto/cloud-client': patch
---

`dexto trace list`, `dexto trace view <run_id>` and `dexto span list <run_id>` are back, on Dexto's public `/v1/traces` API: 1.x's filters (`--period`, `--status`, `--session`, `--name`, `--sort`, `--limit`) under the 2.0 output contract (tables at a terminal, JSON with `--json` or when piped). `dexto trace <run_id>` is now `dexto trace view <run_id>`, and the JSON is the `/v1/traces` objects rather than 1.x's `{ traces }`, `{ trace }` and `{ spans }`. The client covers the run trace operations.

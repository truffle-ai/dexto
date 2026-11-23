---
'dexto': patch
---

A command run with `--yes` no longer asks to sign in again when the sign-in lacks a permission. It fails with exit 3 (`needs_permission`) and the sign-in that grants the permission as its fix, in `{"error":{"code","message","fix"}}` under `--json` (DEXTO-3589).

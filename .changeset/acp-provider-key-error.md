---
'dexto': patch
---

`dexto acp` reports a missing provider key such as `ANTHROPIC_API_KEY` as an invalid-request error instead of `auth_required`, so ACP apps no longer offer Dexto sign-in for it. Dexto models still answer `auth_required`.

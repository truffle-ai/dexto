---
'dexto': patch
---

Cloud commands now refuse an argument past their last one instead of dropping it. `dexto workspace call <tool> '<json>'` used to call the tool with `{}`; it now exits 2 and says to pass the body with `--data '<json>'`.

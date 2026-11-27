---
'@dexto/core': patch
---

Redact a boxed string (`new String(...)`) as the whole string it wraps, and write boxed numbers and booleans as their primitive values, so a wrapped secret no longer reaches output one character per key.

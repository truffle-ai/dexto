---
'@dexto/core': patch
---

A stream error part that is not an Error (a string, or an OpenAI-compatible gateway's `{ code, message }` object) now throws the mapped Error, keeping its message and the provider's code as `providerErrorCode`, instead of the raw value. Callers no longer see "[object Object]" when the run fails.

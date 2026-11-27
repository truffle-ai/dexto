---
'@dexto/core': patch
---

Write an Error in `safeStringify` as its name, message, cause and fields, without its stack, so tool results and turn error text never show stack frames or file paths. Trace attributes keep the masked stack through `safeStringifyWithStacks`; logs are unchanged.

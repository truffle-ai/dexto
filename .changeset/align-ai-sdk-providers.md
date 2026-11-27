---
'@dexto/core': patch
---

Raise `@ai-sdk/anthropic` to 2.0.104 and `@ai-sdk/openai` to 2.0.128, on `@ai-sdk/provider` 2.0.5 and `@ai-sdk/provider-utils` 3.0.38. A host that pins these newer providers, such as Dexto Cloud for fast mode, then bundles one copy of each instead of two.

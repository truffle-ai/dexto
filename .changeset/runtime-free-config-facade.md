---
'@dexto/core': patch
'@dexto/agent-config': patch
---

Make the `@dexto/core/config` facade genuinely runtime-free so config-assembly consumers can bundle for Worker/browser targets without Node polyfills.

- `@dexto/core/config` now also exports `createLLMConfigSchema`, and `@dexto/agent-config` imports it from the facade instead of the `@dexto/core` root barrel (which dragged the whole server graph into downstream bundles).
- `SystemPromptConfigSchema` no longer imports Node `path` or the dynamic prompt generator registry (`fs`/`os`/`path`); the absolute-path check is a runtime-free equivalent and `PROMPT_GENERATOR_SOURCES` lives in a dependency-free module (still re-exported from its previous locations).
- `DextoBaseError` generates trace IDs with `globalThis.crypto.randomUUID()` instead of `node:crypto`.
- A bundling regression test rejects any Node builtin or non-allowlisted package in the facade's import graph.

Root imports from `@dexto/core` are unchanged.

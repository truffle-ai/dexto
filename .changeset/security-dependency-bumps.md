---
'dexto': patch
'@dexto/core': patch
'@dexto/server': patch
'@dexto/client-sdk': patch
'@dexto/tools-builtins': patch
'@dexto/tools-todo': patch
'@dexto/image-bundler': patch
'@dexto/webui': patch
---

Update dependencies with published security advisories: `hono` 4.13.13, `@hono/node-server` 1.19.17, `tar` 7.5.22, `undici` 7.30.1, `ws` 8.22.0, `nanoid` 5.1.16 and `esbuild` 0.28. OpenTelemetry moves to the 2.x SDK (`@opentelemetry/core` 2.12, `@opentelemetry/sdk-node` 0.223), so the optional OpenTelemetry peer dependencies of `@dexto/core` now require those versions. The AI SDK packages in `@dexto/core` are pinned to releases that use `@ai-sdk/provider-utils` 3.0.30, because 3.0.31 and later depend on `undici` 5, which has unpatched advisories.

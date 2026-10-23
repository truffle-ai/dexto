---
'dexto': minor
'@dexto/core': minor
'@dexto/server': patch
'@dexto/client-sdk': patch
'@dexto/tools-builtins': patch
'@dexto/tools-todo': patch
'@dexto/image-bundler': patch
'@dexto/webui': patch
---

Update dependencies with published security advisories: `hono` 4.13.13, `@hono/node-server` 1.19.17, `tar` 7.5.22, `undici` 7.30.1, `ws` 8.22.0, `nanoid` 5.1.16 and `esbuild` 0.28. The AI SDK packages in `@dexto/core` are pinned to releases that use `@ai-sdk/provider-utils` 3.0.30, because 3.0.31 and later depend on `undici` 5, which has unpatched advisories.

Telemetry now requires the OpenTelemetry 2.x SDK (`@opentelemetry/core`, `resources` and `sdk-trace-base` 2.12; `sdk-node`, `instrumentation-http` and the trace exporters 0.223; `instrumentation-undici` 0.33). The OpenTelemetry 1.x packages carry the advisories this release fixes, so they are no longer supported. The `dexto` CLI ships these packages itself and needs no action. Hosts that install the optional OpenTelemetry peer dependencies of `@dexto/core` themselves must upgrade them to these versions before enabling telemetry.

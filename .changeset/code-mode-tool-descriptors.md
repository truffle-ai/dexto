---
"@dexto/core": minor
---

Expose tool registry primitives for hosted Code Mode: `ToolManager.getToolDescriptors()` / `getToolDescriptor()` with canonical input/output schemas and schema fingerprints, nested tool calls via `parentToolCallId`, nested approval policy controls, a browser-safe `@dexto/core/tools/identity` entry point, MCP input validation before calls, and tool payloads kept out of telemetry.

## Context

`MCPManager` creates `DextoMcpClient` candidates for initial connection and restart. Registration can reject a connected candidate because server names collide after sanitization. Previously those failures recorded an error without closing the rejected client.

## Decision

Use one private cleanup operation shared by connection and restart failure paths. Remove registration and caches only when the registered client is the failed candidate, then attempt its disconnect. Cleanup failure is logged without replacing the original connection error. Preserve restart configuration for retry.

The existing SDK already closes a stdio transport when its initialization handshake fails. Manager-level cleanup is still attempted and is covered by a real fixture; the registration failures demonstrate the previously missing cleanup.

## Scope and compatibility

Keep successful connection behavior, error wrapping and codes, strict/lenient initialization, tool qualification, and best-effort disconnect contracts unchanged. No new constructor arguments or public lifecycle methods are required. Existing agent consumers use the same manager.

Standalone calls remain caller-authorized. MCP discovery and argument validation do not imply permission to execute. Cancellation and continuous status are separate future concerns.

## Validation

Use hermetic stdio servers to observe candidate process exit, unaffected peer calls, failed restart retry, and handshake failures. Inject a disconnect rejection to verify that cleanup cannot mask the original error. Run existing manager/client regressions and scoped Core checks; complete the full quality gate before publication.

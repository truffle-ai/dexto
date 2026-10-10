---
sidebar_position: 2
title: 'MCPManager'
---

# MCPManager

`MCPManager` is a standalone MCP connection and discovery service. It does not require a `DextoAgent`, an LLM, or Cloud login. See the [standalone guide](/docs/mcp/mcp-manager) for a complete connection and cleanup example.

```typescript
import { MCPManager, McpServerConfigSchema } from '@dexto/core/mcp';
import type { Logger } from '@dexto/core/logger';
import type { AgentEventBus } from '@dexto/core/events';

// Supply your application's logger and optionally its own event bus.
constructor(logger: Logger, eventBusOverride?: AgentEventBus)
```

## Connections

| Method                          | Behavior                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `connectServer(name, config)`   | Connects one server using a validated MCP configuration. An already registered name is left unchanged. Failed candidates are disconnected best-effort. |
| `initializeFromConfig(configs)` | Connects enabled servers concurrently. Per-server `connectionMode: 'strict'` failures reject; `lenient` failures are recorded.                         |
| `restartServer(name)`           | Disconnects and reconnects using the saved configuration. Failed restart candidates are cleaned up; configuration remains available for retry.         |
| `removeClient(name)`            | Disconnects one client and removes legacy restart configuration, caches, and recorded error; explicit desired registration remains.                    |
| `disconnectAll()`               | Disconnects registered clients and clears legacy connection state; explicit desired registrations remain. Cleanup failures are logged.                 |
| `refresh()`                     | Refreshes cached discovery from connected clients.                                                                                                     |

Parse raw configuration before connecting:

```typescript
const config = McpServerConfigSchema.parse({
    type: 'http',
    url: 'http://localhost:3001/mcp',
    connectionMode: 'strict',
});
await manager.connectServer('local', config);
```

Supported configurations are `stdio` (`command`, `args`, optional `env`), `http`, and `sse` (`url`, optional `headers`). Remote HTTP is preferred for new servers. A server name must not collide with another name after punctuation is replaced by underscores.

`getClients()` exposes registered clients. `getServerConfig(name)` returns the saved configuration. `getFailedConnections()`, `getFailedConnectionError(name)`, and `getFailedConnectionErrorCode(name)` describe recorded connection failures. These are not continuous health checks.

## Explicit desired configuration

These additive methods opt into desired configuration ownership without changing existing connection defaults:

| Method                                                                | Behavior                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `configureServer(name, config): void`                                 | Copies validated desired configuration without connecting; rejects active names and the reserved name `__proto__`.  |
| `connectConfiguredServer(name): Promise<void>`                        | Connects a registered enabled configuration through the existing engine; rejects unknown, disabled or active names. |
| `forgetServerConfiguration(name): void`                               | Removes desired registration after disconnection; rejects active names.                                             |
| `getConfiguredServerStatuses(): readonly ConfiguredMcpServerStatus[]` | Returns fresh safe snapshots only for explicitly configured names.                                                  |

`ConfiguredMcpServerStatus` is exported from `@dexto/core/mcp`. Each row includes `name`, `configuredTransport`, and `status`; only `failed` rows include an allowlisted `errorCode`. Status precedence is `connecting`, `connected`, `disabled`, `failed`, then `configured`. Overlapping attempts remain `connecting` until all settle. Registered `connected` state is not a liveness guarantee.

`configuredTransport` describes desired configuration, even when legacy APIs connect another configuration for that name. Desired configuration and legacy restart configuration are independently owned. Disconnecting is reusable and does not forget desired registrations; forgetting is explicit. The snapshot excludes raw configurations, errors and process/client metadata. Legacy getters and agent status APIs are unchanged.

## Tools, prompts, and resources

| Method                                             | Behavior                                                                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `getAllTools()`                                    | Returns cached callable tool names and definitions. Conflicting names use `sanitized-server--tool`.                        |
| `validateToolInput(name, input)`                   | Validates arguments against the cached tool schema; returns validated arguments or throws.                                 |
| `callToolDirect(request)`                          | Calls a literal MCP descriptor identity and returns the complete typed protocol result, with optional caller cancellation. |
| `executeTool(name, args, sessionId?, runContext?)` | Routes a direct tool call. Does not apply the agent's permission policy or automatically validate arguments.               |
| `listAllPrompts()`                                 | Returns cached prompt names.                                                                                               |
| `getAllPromptMetadata()`                           | Returns cached prompt metadata, including the originating server.                                                          |
| `getPrompt(name, args?)`                           | Retrieves a rendered prompt. Duplicate prompt names currently use the last cached provider.                                |
| `listAllResources()`                               | Returns qualified resource keys and summaries.                                                                             |
| `readResource(key)`                                | Reads a resource using the key returned by discovery.                                                                      |

Discovery uses connection caches, which can be refreshed explicitly or updated by server notifications. `executeTool` retains legacy agent-oriented error conversion: MCP results marked `isError` become thrown errors. `callToolDirect` returns these results, including `content`, `structuredContent`, `_meta`, and protocol extension fields. SDK protocol and output-schema errors still reject.

### Literal protocol calls

```typescript
const tool = manager.getToolDescriptors().find((tool) => tool.name === 'lookup');
if (!tool) throw new Error('lookup tool unavailable');
const controller = new AbortController();
const result = await manager.callToolDirect({
    identity: tool.identity,
    arguments: { query: 'example' },
    signal: controller.signal,
});
if (result.isError) {
    // Handle the upstream tool error result.
}
```

`MCPDirectToolCall` is exported from `@dexto/core/mcp`. Its `identity` is the existing MCP descriptor identity (`type: 'mcp'`, `connectionId`, `toolName`); both names are literal, so alias changes and delimiter-containing names do not reroute the call. Arguments must be an object. Missing connections and observed initialization/restart operations reject before invocation. Each pending call stays bound to the captured client; replacement does not reroute it.

## Authentication and approvals

`setAuthProviderFactory(factory)` installs a caller-provided OAuth provider factory. `setApprovalManager(manager)` supplies handling for server elicitation requests.

The caller owns authorization for direct tool calls and the credentials sent to each server. Neither discovery nor schema validation authorizes an operation. There is no implicit CLI confirmation provider. `callToolDirect` accepts an optional caller-owned `signal`. It uses the saved restart configuration timeout for the connection name, independently of desired configuration. Externally registered clients with no saved configuration use the SDK request default. Registering a replacement under a name with saved legacy configuration retains that name-owned timeout. Cancellation does not disconnect the client or promise upstream side-effect rollback. Legacy `executeTool` and `DextoMcpClient.callTool` retain their existing timeout and context semantics.

## DextoMcpClient

For a single server without aggregation, `DextoMcpClient` is also exported from `@dexto/core/mcp`. Construct it with a logger, then use `connect(validatedConfig, name)`, `getTools()`, `callTool(name, args)`, prompt/resource methods, and `disconnect()` in `finally`.

`getConnectedClient()` returns the connected MCP SDK client or throws if not connected. `getConnectionStatus()` reports local connection state; it is not a server-health check. Direct client calls have the same caller-owned authorization boundary.

## Operational diagnostics

Core MCP logs describe operations using selected server/tool/prompt names and fixed Core error classifications. They omit raw stdio configuration, remote URLs, resource URIs, capability payloads, elicitation content and provider error text. Keep credentials out of chosen names. Server stderr and application or SDK logging outside these Core call sites remain separately owned.

`DextoMcpClient.getServerInfo()` returns raw command, arguments and environment alongside local process information. `getServerConfig()` and failed-connection inspection also return raw caller-owned data, and thrown errors retain their existing details. Do not serialize these APIs as public status output or ordinary logs. Use `getConnectionStatus()` for local connection state; it is not a remote-health probe.

## MCP SDK v1 compatibility

Dexto uses MCP SDK 1.32.1 while preserving these public APIs. HTTP/SSE services that redirect to a different origin must be configured with their final endpoint URL. See the [migration notes](/docs/mcp/mcp-manager#mcp-sdk-v1-compatibility) for redirect defaults, stdio buffering and OAuth issuer persistence.

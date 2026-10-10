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
| `removeClient(name)`            | Disconnects one client and removes its configuration, caches, and recorded connection error.                                                           |
| `disconnectAll()`               | Disconnects registered clients and clears manager state. Cleanup failures are logged.                                                                  |
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

## Tools, prompts, and resources

| Method                                             | Behavior                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getAllTools()`                                    | Returns cached callable tool names and definitions. Conflicting names use `sanitized-server--tool`.          |
| `validateToolInput(name, input)`                   | Validates arguments against the cached tool schema; returns validated arguments or throws.                   |
| `executeTool(name, args, sessionId?, runContext?)` | Routes a direct tool call. Does not apply the agent's permission policy or automatically validate arguments. |
| `listAllPrompts()`                                 | Returns cached prompt names.                                                                                 |
| `getAllPromptMetadata()`                           | Returns cached prompt metadata, including the originating server.                                            |
| `getPrompt(name, args?)`                           | Retrieves a rendered prompt. Duplicate prompt names currently use the last cached provider.                  |
| `listAllResources()`                               | Returns qualified resource keys and summaries.                                                               |
| `readResource(key)`                                | Reads a resource using the key returned by discovery.                                                        |

Discovery uses connection caches, which can be refreshed explicitly or updated by server notifications. Tool-call failures propagate to the caller, including MCP results marked `isError`.

## Authentication and approvals

`setAuthProviderFactory(factory)` installs a caller-provided OAuth provider factory. `setApprovalManager(manager)` supplies handling for server elicitation requests.

The caller owns authorization for direct tool calls and the credentials sent to each server. Neither discovery nor schema validation authorizes an operation. There is no implicit CLI confirmation provider. Current tool calls support the configured request timeout, but no public abort-signal option.

## DextoMcpClient

For a single server without aggregation, `DextoMcpClient` is also exported from `@dexto/core/mcp`. Construct it with a logger, then use `connect(validatedConfig, name)`, `getTools()`, `callTool(name, args)`, prompt/resource methods, and `disconnect()` in `finally`.

`getConnectedClient()` returns the connected MCP SDK client or throws if not connected. `getConnectionStatus()` reports local connection state; it is not a server-health check. Direct client calls have the same caller-owned authorization boundary.

## Operational diagnostics

Core MCP logs describe operations using selected server/tool/prompt names and fixed Core error classifications. They omit raw stdio configuration, remote URLs, resource URIs, capability payloads, elicitation content and provider error text. Keep credentials out of chosen names. Server stderr and application or SDK logging outside these Core call sites remain separately owned.

`DextoMcpClient.getServerInfo()` returns raw command, arguments and environment alongside local process information. `getServerConfig()` and failed-connection inspection also return raw caller-owned data, and thrown errors retain their existing details. Do not serialize these APIs as public status output or ordinary logs. Use `getConnectionStatus()` for local connection state; it is not a remote-health probe.

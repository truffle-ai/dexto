---
sidebar_position: 6
---

# Standalone MCP Manager

Use `MCPManager` from `@dexto/core/mcp` to connect to MCP servers and call their tools, prompts, and resources directly. You do not need a Dexto agent, an LLM, or a Dexto Cloud account.

## Install and connect

```bash
pnpm add @dexto/core
```

This example connects to an HTTP MCP server you already run. Replace the URL and tool name with your server's values.

```typescript
import { AgentEventBus } from '@dexto/core/events';
import { createLogger } from '@dexto/core/logger';
import { MCPManager, McpServerConfigSchema } from '@dexto/core/mcp';

const logger = createLogger({
    agentId: 'standalone-mcp',
    config: {
        level: 'warn',
        transports: [{ type: 'console', colorize: false }],
    },
});
const manager = new MCPManager(logger, new AgentEventBus());
const config = McpServerConfigSchema.parse({
    type: 'http',
    url: 'http://localhost:3001/mcp',
});

try {
    await manager.connectServer('local', config);
    console.log(Object.keys(await manager.getAllTools()));

    // Validate arguments separately before making a direct tool call.
    const args = manager.validateToolInput('lookup', { query: 'example' });
    const result = await manager.executeTool('lookup', args);
    console.log(result);
} finally {
    await manager.disconnectAll();
}
```

An explicit event bus keeps manager events separate from other Dexto runtimes in the same process. Omitting it uses the shared default event bus.

For a local stdio server, parse a config with `type: 'stdio'`, `command`, `args`, and an optional `env` object. The manager starts that command as a child process. Give it only the environment variables it needs. HTTP and SSE configurations use `url` and optional `headers`; prefer HTTP for new remote servers.

## Discovery and calls

- `getAllTools()` returns cached tools and their callable names. Duplicate tool names are qualified as `sanitized-server--tool`; use the names returned by discovery. Removing a conflicting server can restore a simple name.
- `validateToolInput(name, args)` validates against the cached tool schema. `executeTool(name, args)` routes the call; it does not perform this validation for you.
- `listAllPrompts()` and `getAllPromptMetadata()` discover cached prompts; `getPrompt(name, args)` asks their server to render one. Duplicate prompt names currently use the last cached provider.
- `listAllResources()` returns resources with qualified `key` values. Pass that key to `readResource(key)`.
- `refresh()` explicitly refreshes discovery. Server notifications also update caches.

## Lifecycle and failures

Always call `disconnectAll()` in a `finally` block. Use `removeClient(name)` to disconnect and forget one connection, or `restartServer(name)` to reconnect using its saved configuration.

A failed connection or restart attempts to disconnect its rejected candidate. A cleanup error does not replace the connection error. A failed restart retains its saved configuration so you can retry it; it does not restore the old connection. Other connected servers remain usable.

`getFailedConnections()` reports recorded connection errors. `getFailedConnectionError(name)` and `getFailedConnectionErrorCode(name)` expose their details. These describe failed connection attempts; they are not a continuous remote-health check.

`initializeFromConfig(configs)` connects enabled servers concurrently. Each server's `connectionMode` controls failure handling: `strict` failures reject initialization, while `lenient` failures are recorded without rejecting it. The default is `lenient`. Successful peers remain connected even if initialization rejects, so cleanup still belongs in `finally`.

Server names must remain unique after sanitization: characters outside letters, numbers, underscores, and hyphens become underscores. For example, `my@server` and `my_server` collide.

## Desired configuration and safe status

Hosts that need to display configured entries can opt into desired configuration ownership:

```typescript
manager.configureServer('local', config);
console.log(manager.getConfiguredServerStatuses());
// [{ name: 'local', configuredTransport: 'http', status: 'configured' }]

try {
    await manager.connectConfiguredServer('local');
} finally {
    await manager.disconnectAll();
    manager.forgetServerConfiguration('local');
}
```

`configureServer(name, config)` copies validated configuration without connecting. The name `__proto__` is reserved because legacy failure storage cannot record it safely; this restriction applies only to the new registration API. Names such as `constructor` and `toString` remain supported. Disabled entries appear as `disabled`; attempting to connect them rejects without starting a process. `connectConfiguredServer(name)` requires a registered, enabled configuration and rejects names with an active attempt or registered client. Configure and forget also reject active names; disconnect before replacing or forgetting configuration.

`getConfiguredServerStatuses()` includes only names registered with `configureServer`. It returns fresh readonly metadata: `name`, `configuredTransport`, `status`, and an allowlisted `errorCode` only for `failed`. Statuses are `configured`, `disabled`, `connecting`, `connected`, or `failed`. While any connection or restart attempt for the name is in flight, `connecting` takes precedence. `connected` means a client is registered; it does not promise remote liveness. Failure describes the last recorded attempt for that name, not verification of its desired configuration.

`configuredTransport` always describes desired configuration. A legacy `connectServer(name, otherConfig)` call can connect another transport for the same name without applying desired configuration. The snapshot reports registration state while keeping desired transport metadata distinct.

Desired registration survives `removeClient()` and reusable `disconnectAll()` until explicitly forgotten. `getServerConfig()` continues to describe legacy successful/restart configuration; raw error getters and existing agent status APIs keep their original behavior. Desired configuration and legacy restart configuration are independently owned. No configuration, command, URL, environment, headers, process metadata, client object or raw error message is included in the new snapshot.

## Authorization and current limits

Direct MCP management does not install the agent's tool permission policy or display a CLI approval prompt. Your application must authorize calls and supply the server's required credentials. Discovery and argument validation do not grant permission to execute a tool. An optional approval manager handles server elicitation; it is not a substitute for authorization around direct tool calls.

`setAuthProviderFactory(factory)` supplies an OAuth provider for servers that need one. Static credentials can be supplied through configured headers or a stdio server's environment. Keep credentials out of discovery output and application logs.

The current tool-call API has a configured request timeout but no public abort-signal option. Disconnect is best-effort, and connection status is not a remote-health probe. The configured status snapshot does not add cancellation, automatic retry, or CLI behavior.

See the [MCPManager API reference](/api/sdk/mcp-manager) for method signatures.

## Operational diagnostics

Core MCP logs describe operations using selected server/tool/prompt names and fixed Core error classifications. They omit raw stdio configuration, remote URLs, resource URIs, capability payloads, elicitation content and provider error text. Keep credentials out of chosen names. Server stderr and application or SDK logging outside these Core call sites remain separately owned.

`DextoMcpClient.getServerInfo()` returns raw command, arguments and environment alongside local process information. `getServerConfig()` and failed-connection inspection also return raw caller-owned data, and thrown errors retain their existing details. Do not serialize these APIs as public status output or ordinary logs. Use `getConnectionStatus()` for local connection state; it is not a remote-health probe.

---
sidebar_position: 7
title: Read shared memory from Loom
description: Connect Dexto to a Loom deployment over MCP and read a saved memory without an LLM.
---

# Read shared memory from Loom

Connect Dexto to [ClickHouse Loom](https://github.com/ClickHouse/loom) to read a saved project fact from a deployment shared with other agents. Loom exposes memory, indexed code and ingested documents through one MCP endpoint. This example reads one memory by its exact key using Dexto's standalone MCP manager; it does not start an agent or call a model.

## Prerequisites

- Node.js 22 and pnpm.
- A running Loom deployment. Follow the [Loom quickstart](https://clickhouse.github.io/loom/getting-started/quickstart/) to install and start Loom first.
- The deployment's complete MCP URL, including `/mcp`, reachable from the machine running Dexto. Use HTTPS for a remote deployment. Use the default `core` toolset for this example; the `assistant` toolset does not expose `loom_op`.
- A dedicated Loom token with the `viewer` role scoped to the namespace you intend to read. Ask your deployment administrator to issue it. Do not use an operator token.
- A memory key already saved in that namespace, such as a project's build command. The script reads existing data and creates no memory.

Provide these values through your shell or secret manager:

| Environment variable | Value |
| --- | --- |
| `LOOM_MCP_URL` | Your deployment's full MCP endpoint URL |
| `LOOM_TOKEN` | The scoped viewer token |
| `LOOM_NAMESPACE` | The namespace permitted by that token |
| `LOOM_MEMORY_KEY` | The exact key of the memory to read |

Keep the token out of source files, committed YAML, command history and logs. The example uses the token only in the HTTP Authorization header.

## Read a memory without an LLM

Create a directory for the example, then install the version used here:

```bash
pnpm init
pnpm add @dexto/core@1.19.4
```

Save this as `read-loom.mjs`:

```javascript
import { AgentEventBus } from '@dexto/core/events';
import { createLogger } from '@dexto/core/logger';
import { MCPManager, McpServerConfigSchema } from '@dexto/core/mcp';

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Set ${name} before running this example.`);
    return value;
}

const config = McpServerConfigSchema.parse({
    type: 'http',
    url: requiredEnv('LOOM_MCP_URL'),
    headers: { Authorization: `Bearer ${requiredEnv('LOOM_TOKEN')}` },
    connectionMode: 'strict',
    timeout: 30000,
});
const read = {
    op: 'memory.get',
    arguments: {
        namespace: requiredEnv('LOOM_NAMESPACE'),
        memory_key: requiredEnv('LOOM_MEMORY_KEY'),
    },
};
const logger = createLogger({
    agentId: 'loom-reader',
    config: {
        level: 'warn',
        transports: [{ type: 'console', colorize: false }],
    },
});
const manager = new MCPManager(logger, new AgentEventBus());

try {
    await manager.connectServer('loom', config);
    const tools = await manager.getAllTools();
    if (!Object.hasOwn(tools, 'loom_op')) {
        throw new Error('The configured Loom endpoint does not list loom_op.');
    }
    const args = manager.validateToolInput('loom_op', read);
    const result = await manager.executeTool('loom_op', args);
    console.log(JSON.stringify(result, null, 2));
} finally {
    await manager.disconnectAll();
}
```

Run it from a trusted terminal after setting the four environment variables:

```bash
node read-loom.mjs
```

The manager discovers tools over MCP, then calls Loom's `loom_op` tool with `op: 'memory.get'`. Loom fills the caller identity from the token; the request explicitly selects the namespace and memory key. See the [Loom MCP reference](https://clickhouse.github.io/loom/reference/mcp/) for toolsets and authentication.

The MCP response contains the memory result. A found memory includes `found: true` and its stored value; `found: false` means no matching memory was returned. The script prints this response, so choose a memory suitable for display in your terminal. A missing key is not a connection failure. An authentication error, unavailable server or tool error must not be interpreted as an empty memory.

## Use the same connection in an agent

Add this entry to the `mcpServers` section of an existing agent YAML configuration:

```yaml
mcpServers:
  loom:
    type: http
    url: $LOOM_MCP_URL
    headers:
      Authorization: Bearer $LOOM_TOKEN
    connectionMode: strict
    timeout: 30000
```

Dexto expands the environment variables when it loads the configuration. Ask the agent to read the known memory key in the permitted namespace. Starting an agent requires its separately configured model and may incur provider costs; the standalone example above does not.

This connection exposes Loom tools to Dexto. It does not replace Dexto's session storage or automatically copy conversations into Loom. The viewer token cannot write memories. Granting additional roles or sending retrieved content to a model is a separate application decision. Code and document retrieval also require those data to be indexed or ingested in the Loom deployment; connecting the endpoint alone does not populate them.

## Troubleshooting

- **Connection fails:** Check the full endpoint URL, reachability and token expiry. Keep `connectionMode: strict` when the agent requires Loom.
- **`loom_op` is absent:** Check the endpoint's toolset. This example expects the default `core` roster and one server connection.
- **No matching memory:** Check the exact key and namespace with the deployment administrator. A viewer token cannot create the missing memory.
- **Need direct-call authorization controls:** See [Standalone MCP Manager](./mcp-manager.md#authorization-and-current-limits). The manager does not apply an agent's tool approval policy; this script makes one explicit read authorized by the viewer token.

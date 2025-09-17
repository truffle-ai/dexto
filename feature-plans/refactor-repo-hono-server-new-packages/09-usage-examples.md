# Usage Examples

## CLI startup (Node)
```ts
import { loadAgentConfig } from '@dexto/core/config';
import { DextoAgent } from '@dexto/core/agent';
import { createDextoApp, createRuntimeContextFactory } from '@dexto/server/hono';
import { createNodeAdapter } from './utils/node-adapter.js';
import { createLoggerFromConfig } from './utils/logging.js';

async function boot() {
  const config = await loadAgentConfig('default-agent.yml');
  const logger = createLoggerFromConfig(config.logging);
  const agent = new DextoAgent(config, { logger });
  await agent.start();

  const createContext = createRuntimeContextFactory({
    agentFactory: async () => agent,
    logger,
  });

  const app = createDextoApp(createContext);
  const server = createNodeAdapter(app);
  server.listen(8000);

  // REPL continues to use `agent` directly
}
```

## Embedded server (hosted deployment)
```ts
import { createDextoApp, createRuntimeContextFactory } from '@dexto/server/hono';
import { serve } from '@hono/node-server';

const agent = await buildAgentFromEnv();
const logger = createLoggerFromEnv();
const createContext = createRuntimeContextFactory({ agentFactory: async () => agent, logger });

serve({ fetch: createDextoApp(createContext).fetch, port: 3000 });
```

## Client SDK usage
```ts
import { DextoClient } from '@dexto/client-sdk';

const client = new DextoClient({ baseUrl: 'https://api.dexto.dev', apiKey: process.env.DEXTO_TOKEN });
await client.connect();

const session = await client.createSession();
const response = await client.sendMessage({ sessionId: session.id, content: 'Hello!' });
console.log(response.response);
```

## Typed client (for custom integrations)
```ts
import { createTypedClient } from '@dexto/server/hono';

const client = createTypedClient('https://api.dexto.dev');
const response = await client.api.sessions.$get();
const sessions = await response.json();
```

## WebSocket subscription
```ts
const ws = new WebSocket('wss://api.dexto.dev/ws');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'session:message') {
    console.log('New message', data);
  }
};
```

These examples demonstrate how the new package layout supports CLI, hosted deployments, and consumer applications without depending on the old CLI-only Express server.

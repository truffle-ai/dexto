# Usage Examples

## CLI startup (Node)
```ts
import { loadAgentConfig } from '@dexto/core/config';
import { DextoAgent } from '@dexto/core/agent';
import { createDextoApp, createNodeServer } from '@dexto/server/hono';
import { createLoggerFromConfig } from './utils/logging.js';
import { expandAgentConfig } from './utils/runtime.js';

async function boot() {
  const rawConfig = await loadAgentConfig('default-agent.yml');
  const config = expandAgentConfig(rawConfig); // resolves @agent_dir, prefs, etc.
  const logger = createLoggerFromConfig(config.logging);
  const agent = new DextoAgent(config, { logger });
  await agent.start();

  const app = createDextoApp(agent);
  const { server } = createNodeServer(app, { agent, logger });
  server.listen(8000, () => logger.info('CLI API available on http://localhost:8000'));

  // REPL continues to use `agent` directly
}
```

## Embedded server (hosted deployment)
```ts
import { createDextoApp, createNodeServer } from '@dexto/server/hono';

const agent = await buildAgentFromEnv();
const app = createDextoApp(agent);
const { server } = createNodeServer(app, { agent });

server.listen(3000);
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

These examples reflect the new package boundaries, config preprocessing, and the Node bridge powering the CLI/server deployments.

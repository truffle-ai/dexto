# Logging Configuration

## Objectives
- Replace the singleton Winston logger with an injectable `ILogger` interface.
- Default to a browser-safe console logger inside `@dexto/core`.
- Provide a Node-only `WinstonLogger` (similar to Mastra’s transport split) for hosts that need structured/file logging.
- Keep filesystem access out of core call sites; hosts pass loggers in explicitly and resolve filesystem paths before agent construction.

## Core interface
```ts
// packages/core/src/logger/types.ts
export interface ILogger {
  level: LogLevel;
  child(context: Record<string, unknown>): ILogger;
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}
```

`ConsoleLogger` ships in `@dexto/core/logger` and writes to `console`. A `createLogger` helper returns `ConsoleLogger` unless overridden.

## Node transport
- `@dexto/core/logger/node` exports `WinstonLogger` implemented on top of Winston + file rotation.
- Construction accepts `{ level, logToConsole, filePath }` and mirrors the old features.
- Remains opt-in; browser bundles that avoid the subpath never pull Winston/`fs`.

## Injection into services
- `DextoAgent` constructor accepts `{ logger }` alongside the validated config.
- `createAgentServices` receives the logger and passes it into every subsystem (storage manager, search service, MCP manager, tool manager, prompt manager, session manager).
- Any helper that still needs to surface filesystem warnings relies on the agent-provided logger; path resolution happens before the agent is created.

## Host wiring (CLI / Node server)
```ts
// packages/cli/src/utils/logging.ts
import { WinstonLogger } from '@dexto/core/logger/node';
import { resolveDextoPath } from './runtime.js';

export function createLoggerFromConfig(logging?: LoggingConfig): ILogger {
  const level = logging?.level ?? process.env.DEXTO_LOG_LEVEL ?? 'info';
  const logToConsole = logging?.console ?? process.env.DEXTO_LOG_TO_CONSOLE === 'true';
  const filePath = logging?.file?.path ?? resolveDextoPath('logs', 'dexto.log');
  return new WinstonLogger({ level, logToConsole, filePath });
}
```

CLI bootstrap creates the logger, injects it when instantiating `DextoAgent`, and shares the same instance with the Hono Node bridge/websocket hub.

## Testing
- Unit tests cover `ConsoleLogger`, `WinstonLogger`, and the agent’s logger propagation.
- Integration tests (CLI) confirm logs land on disk with runtime config overrides.
- Browser smoke test ensures importing `@dexto/core` without the node subpath does not include Winston.

## Rollout notes
- Remove all `import { logger }` from core/CLI code.
- Provide codemods or lint rules to forbid direct singleton usage going forward.

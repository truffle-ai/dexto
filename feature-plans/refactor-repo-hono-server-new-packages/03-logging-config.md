# Logging Configuration

## Objectives
- Default to a browser-safe console logger inside `@dexto/core` / `DextoAgent`.
- Allow hosts (CLI, server) to configure file logging via YAML and environment variables.
- Keep file I/O out of core so client/browser bundles remain tree-shakeable.

## YAML structure
```yaml
logging:
  level: info            # optional (defaults to env DEXTO_LOG_LEVEL or 'info')
  console: false         # optional flag to enable console output
  file:
    path: ~/.dexto/logs/dexto.log  # optional custom path
```
Additional transports can be added later (HTTP, remote collectors).

## Helper implementation (host level)
```ts
// packages/cli/src/utils/logging.ts
import { WinstonLogger } from '@dexto/core/logger/file';
import { resolveDefaultLogPath } from './runtime.js';

export interface LoggingConfig {
  level?: string;
  console?: boolean;
  file?: { path?: string };
}

export function createLoggerFromConfig(logging?: LoggingConfig) {
  const level = logging?.level ?? process.env.DEXTO_LOG_LEVEL ?? 'info';
  const logToConsole =
    logging?.console ?? process.env.DEXTO_LOG_TO_CONSOLE === 'true';
  const customLogPath = logging?.file?.path ?? resolveDefaultLogPath();

  return new WinstonLogger({ level, logToConsole, customLogPath });
}
```
`resolveDefaultLogPath` lives in the CLI runtime utilities and implements:
- Project `.dexto/logs/dexto.log` when inside a Dexto project.
- `~/.dexto/logs/dexto.log` otherwise.

## Agent instantiation
```ts
const logger = createLoggerFromConfig(config.logging);
const agent = new DextoAgent(config, { logger });
```
`DextoAgent` uses the supplied logger; if none provided, it falls back to `ConsoleLogger`.

## WebSocket broadcasting
Handlers/websocket hub use `context.logger` (injected) so logs honour host configuration.

## Testing
- Unit tests ensure `createLoggerFromConfig` resolves defaults correctly (with and without YAML, with env overrides).
- CLI integration tests confirm log files land in the right path.
- Browser bundles should not pull Winston when the override isn’t provided (verify tree-shaking).

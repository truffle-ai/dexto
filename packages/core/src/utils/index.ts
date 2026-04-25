// TODO: (migration) path.js, execution-context.js, fs-walk.js, env-file.js
// are duplicated in @dexto/agent-management for Node-specific environment management.
// Core still needs these for FilePromptProvider, DextoMcpClient, and FileContributor functionality.
// These will remain in core until we refactor those features to be dependency-injected.

export * from './path.js';
export * from './service-initializer.js';
export * from './zod-schema-converter.js';
export * from './result.js';
export * from './error-conversion.js';
export * from './execution-context.js';
export * from './fs-walk.js';
export * from './redactor.js';
export * from './debug.js';
export * from './safe-stringify.js';
export * from './api-key-resolver.js';
export * from './defer.js';
export * from './async-context.js';
export * from './env.js';

// API key STORAGE has been moved to @dexto/agent-management
// These functions write to .env files and are CLI/server concerns, not core runtime
// Import from '@dexto/agent-management' instead:
// - updateEnvFile
// - saveProviderApiKey
// - getProviderKeyStatus
// - listProviderKeyStatus

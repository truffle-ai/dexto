// Core types and interfaces
export * from './types.js';
export * from './provider.js';
export * from './registry.js';
export * from './factory.js';
export * from './schemas.js';

// Strategies
export * from './strategies/reactive-overflow.js';
export * from './strategies/noop.js';

// Providers
export * from './providers/reactive-overflow-provider.js';
export * from './providers/noop-provider.js';

// Utilities
export * from './overflow.js';

// Register built-in providers
import { compressionRegistry } from './registry.js';
import { reactiveOverflowProvider } from './providers/reactive-overflow-provider.js';
import { noopProvider } from './providers/noop-provider.js';

// Auto-register built-in providers when module is imported
// Guard against duplicate registration when module is imported multiple times
if (!compressionRegistry.has('reactive-overflow')) {
    compressionRegistry.register(reactiveOverflowProvider);
}
if (!compressionRegistry.has('noop')) {
    compressionRegistry.register(noopProvider);
}

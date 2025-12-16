/**
 * Dexto Provider Bundle Configuration
 *
 * This file demonstrates how to register ALL types of custom providers
 * before agent initialization. Use this as a template for building your
 * own Dexto distribution with custom extensions.
 *
 * Provider Types:
 * - BlobStoreProvider: Custom storage backends (S3, Supabase, GCS, etc.)
 * - CustomToolProvider: Custom tools the agent can use
 * - CompressionProvider: Custom context compression strategies
 * - PluginProvider: Custom plugins that hook into agent execution
 */

import {
    blobStoreRegistry,
    customToolRegistry,
    compressionRegistry,
    pluginRegistry,
} from '@dexto/core';

// Import all custom providers
import { supabaseBlobStoreProvider } from './storage/supabase-storage.js';
import { dateTimeToolProvider } from './tools/datetime-helper.js';
import { slidingWindowCompressionProvider } from './compression/sliding-window-provider.js';
import { auditLoggerPluginProvider } from './plugins/audit-logger-provider.js';

/**
 * Project metadata
 */
export const projectConfig = {
    name: 'Dexto Provider Bundle Example',
    version: '1.0.0',
    description: 'A complete example showing all provider extension types',
};

/**
 * Register all custom providers
 *
 * This function is called at application startup (before loading agent configs).
 * All providers must be registered before creating agents that use them.
 *
 * Provider registration order doesn't matter - they're looked up by type
 * when agent configs reference them.
 */
export function registerProviders() {
    // ═══════════════════════════════════════════════════════════════════════
    // 1. BLOB STORAGE PROVIDERS
    // ═══════════════════════════════════════════════════════════════════════
    // Custom storage backends for conversation artifacts, file uploads, etc.
    //
    // Usage in YAML:
    //   storage:
    //     blob:
    //       type: supabase
    //       supabaseUrl: $SUPABASE_URL
    //       supabaseKey: $SUPABASE_KEY
    //       bucket: dexto-blobs
    //
    blobStoreRegistry.register(supabaseBlobStoreProvider);
    console.log('  ✓ Registered blob store: supabase');

    // ═══════════════════════════════════════════════════════════════════════
    // 2. CUSTOM TOOL PROVIDERS
    // ═══════════════════════════════════════════════════════════════════════
    // Tools that extend agent capabilities (API integrations, utilities, etc.)
    //
    // Usage in YAML:
    //   customTools:
    //     - type: datetime-helper
    //       defaultTimezone: America/New_York
    //
    customToolRegistry.register(dateTimeToolProvider);
    console.log('  ✓ Registered custom tool: datetime-helper');

    // ═══════════════════════════════════════════════════════════════════════
    // 3. COMPRESSION PROVIDERS
    // ═══════════════════════════════════════════════════════════════════════
    // Context compression strategies for managing conversation history size
    //
    // Usage in YAML:
    //   context:
    //     compression:
    //       type: sliding-window
    //       windowSize: 30
    //
    compressionRegistry.register(slidingWindowCompressionProvider);
    console.log('  ✓ Registered compression strategy: sliding-window');

    // ═══════════════════════════════════════════════════════════════════════
    // 4. PLUGIN PROVIDERS
    // ═══════════════════════════════════════════════════════════════════════
    // Plugins that hook into agent execution at extension points:
    // - beforeLLMRequest: Input validation, logging, redaction
    // - beforeToolCall: Tool approval, logging
    // - afterToolResult: Result validation, logging
    // - beforeResponse: Output sanitization, logging
    //
    // Usage in YAML:
    //   plugins:
    //     registry:
    //       - type: audit-logger
    //         priority: 5
    //         blocking: false
    //         config:
    //           logLevel: info
    //
    pluginRegistry.register(auditLoggerPluginProvider);
    console.log('  ✓ Registered plugin: audit-logger');

    console.log(`\n✓ All providers registered for ${projectConfig.name}`);
}

/**
 * Optional: Project-wide initialization logic
 *
 * Called before agent creation. Use for:
 * - Setting up monitoring/analytics
 * - Initializing external services
 * - Loading environment-specific configuration
 */
export async function initialize() {
    console.log(`\n🚀 Initializing ${projectConfig.name} v${projectConfig.version}`);
    console.log(`   ${projectConfig.description}\n`);

    // Example: Set up error tracking
    // import * as Sentry from '@sentry/node';
    // Sentry.init({ dsn: process.env.SENTRY_DSN });

    // Example: Set up analytics
    // import { Analytics } from './shared/analytics';
    // await Analytics.init();
}

/**
 * Optional: Cleanup logic
 *
 * Called when the application shuts down. Use for:
 * - Flushing logs/metrics
 * - Closing external connections
 * - Saving state
 */
export async function cleanup() {
    console.log(`\n✓ Cleaned up ${projectConfig.name}`);
}

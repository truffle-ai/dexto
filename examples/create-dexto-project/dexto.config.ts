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

// Auto-discovery utility
import { registerProvidersFromFolder } from './shared/provider-loader.js';

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
 * This function uses auto-discovery to find and register providers from
 * convention-based folder structure. All providers must be registered
 * before creating agents that use them.
 *
 * Convention (Node.js standard):
 *   storage/supabase/index.ts   -> Auto-discovered and registered
 *   tools/datetime/index.ts     -> Auto-discovered and registered
 *   compression/<folder>/index.ts  -> Auto-discovered and registered
 *   plugins/<folder>/index.ts      -> Auto-discovered and registered
 *
 * To add a new provider:
 *   1. Create a folder in the appropriate category (storage/, tools/, etc.)
 *   2. Add an index.ts file that exports your provider
 *   3. It will be automatically discovered and registered!
 *
 * Usage in YAML configs:
 *   storage:
 *     blob:
 *       type: supabase  # Matches the provider's type field
 *       supabaseUrl: $SUPABASE_URL
 *       supabaseKey: $SUPABASE_KEY
 *
 *   customTools:
 *     - type: datetime-helper
 *       defaultTimezone: America/New_York
 *
 *   context:
 *     compression:
 *       type: sliding-window
 *       windowSize: 30
 *
 *   plugins:
 *     registry:
 *       - type: audit-logger
 *         priority: 5
 */
export async function registerProviders() {
    console.log('📦 Auto-discovering providers...\n');

    // Auto-discover and register from convention-based folders
    await registerProvidersFromFolder('./storage', blobStoreRegistry);
    await registerProvidersFromFolder('./tools', customToolRegistry);
    await registerProvidersFromFolder('./compression', compressionRegistry);
    await registerProvidersFromFolder('./plugins', pluginRegistry);

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

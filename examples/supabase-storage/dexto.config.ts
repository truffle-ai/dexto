/**
 * Dexto Project Configuration
 *
 * This file defines the project-level configuration for your custom Dexto distribution.
 * It's loaded at build time and startup to register all custom providers, plugins, and tools.
 */

import { blobStoreRegistry, customToolRegistry } from '@dexto/core';
import { supabaseBlobStoreProvider } from './storage/supabase-storage.js';
import { dateTimeToolProvider } from './tools/datetime-helper.js';

/**
 * Project metadata
 */
export const projectConfig = {
    name: 'Supabase Storage Distribution',
    version: '1.0.0',
    description: 'A Dexto distribution with Supabase blob storage and datetime utilities',
};

/**
 * Register all custom providers
 * This function is called at application startup (before loading agent configs)
 */
export function registerProviders() {
    // Register blob storage providers
    blobStoreRegistry.register(supabaseBlobStoreProvider);

    // Register custom tool providers
    customToolRegistry.register(dateTimeToolProvider);

    console.log(`✓ Registered providers for ${projectConfig.name}`);
}

/**
 * Optional: Project-wide initialization logic
 * Use this for setting up monitoring, analytics, error tracking, etc.
 */
export async function initialize() {
    // Example: Set up error tracking
    // import * as Sentry from '@sentry/node';
    // Sentry.init({ dsn: process.env.SENTRY_DSN });

    // Example: Set up analytics
    // import { Analytics } from './shared/analytics';
    // await Analytics.init();

    console.log(`✓ Initialized ${projectConfig.name} v${projectConfig.version}`);
}

/**
 * Optional: Cleanup logic
 */
export async function cleanup() {
    // Perform any cleanup needed
    console.log(`✓ Cleaned up ${projectConfig.name}`);
}

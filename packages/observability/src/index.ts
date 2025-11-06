/**
 * @dexto/observability
 *
 * Standalone observability package for Dexto agents.
 * Provides telemetry storage, metrics API, and dashboard UI.
 *
 * @packageDocumentation
 */

// Main entry point - re-export key types and utilities
export type { Trace } from './storage/schema.js';
export type { ObservabilityConfig } from './config/schemas.js';

// Export submodule paths (actual exports are via package.json subpath exports)
// This file is primarily for type exports

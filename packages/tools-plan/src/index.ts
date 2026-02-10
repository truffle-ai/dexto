/**
 * @dexto/tools-plan
 *
 * Implementation planning tools with session-linked plans.
 * Provides tools for creating, reading, updating, and tracking plans.
 *
 * This package is a Dexto plugin that automatically registers:
 * - Custom tool provider: plan-tools
 * - Skill: plan (planning mode instructions)
 *
 * Usage:
 * 1. Install the package
 * 2. The plugin discovery will find .dexto-plugin/plugin.json
 * 3. Tools and skill are automatically registered
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Path to the plugin directory containing .dexto-plugin manifest.
 * Use this in image definitions to declare bundled plugins.
 *
 * @example
 * ```typescript
 * import { PLUGIN_PATH } from '@dexto/tools-plan';
 *
 * export default defineImage({
 *   bundledPlugins: [PLUGIN_PATH],
 *   // ...
 * });
 * ```
 */
export const PLUGIN_PATH = path.resolve(__dirname, '..');

// Tool provider (for direct registration if needed)
export { planToolsProvider } from './tool-provider.js';
export { planToolsFactory } from './tool-factory.js';

// Service (for advanced use cases)
export { PlanService } from './plan-service.js';

// Types
export type { Plan, PlanMeta, PlanStatus, PlanServiceOptions, PlanUpdateResult } from './types.js';

// Error utilities
export { PlanError, PlanErrorCode, type PlanErrorCodeType } from './errors.js';

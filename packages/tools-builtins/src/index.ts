/**
 * @dexto/tools-builtins
 *
 * Built-in tools shipped with Dexto.
 * These are always available to an agent and can be enabled/disabled via config.
 *
 * Tool IDs:
 * - ask_user
 * - delegate_to_url
 * - list_resources
 * - get_resource
 * - skill_load
 */
export { builtinToolsFactory, BuiltinToolsConfigSchema } from './builtin-tools-factory.js';
export { BUILTIN_TOOL_NAMES } from './builtin-tools-factory.js';
export type { BuiltinToolsConfig, BuiltinToolName } from './builtin-tools-factory.js';

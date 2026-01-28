/**
 * Internal tool constants
 *
 * Separated from registry to avoid circular dependencies and browser bundle pollution
 */

// TODO: Update docs/docs/guides/configuring-dexto/internalTools.md to reflect these new tools.

/**
 * Available internal tool names
 * Must be kept in sync with INTERNAL_TOOL_REGISTRY in registry.ts
 */
export const INTERNAL_TOOL_NAMES = [
    'search_history',
    'ask_user',
    'delegate_to_url',
    'list_resources',
    'get_resource',
    'invoke_skill',
] as const;

export type KnownInternalTool = (typeof INTERNAL_TOOL_NAMES)[number];

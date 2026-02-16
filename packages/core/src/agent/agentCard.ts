import type { AgentCard } from './schemas.js';
import { AgentCardSchema } from './schemas.js';

/**
 * Default agent description used when not provided
 */
const DEFAULT_AGENT_DESCRIPTION =
    'Dexto is an AI assistant capable of chat and task delegation, accessible via multiple protocols.';

/**
 * Minimal runtime context needed to establish defaults
 * if not provided in AgentCardOverride or by AgentCardSchema.
 */
export interface MinimalAgentCardContext {
    defaultName: string; // Ultimate fallback name if not in overrides
    defaultVersion: string; // Ultimate fallback version if not in overrides
    defaultBaseUrl: string; // Used to construct default URL if not in overrides
}

/**
 * Creates the final AgentCard by merging context-defined values with user-provided overrides,
 * then uses AgentCardSchema.parse() to apply schema-defined static defaults and perform validation.
 */
export function createAgentCard(
    context: MinimalAgentCardContext,
    overrides?: Partial<AgentCard> // Updated type from AgentCardOverride to Partial<AgentCard>
): AgentCard {
    const { defaultName, defaultVersion, defaultBaseUrl } = context;

    // Start with overrides (which are now Partial<AgentCard> or {})
    const effectiveInput: Record<string, any> = { ...(overrides || {}) };

    // Layer in context-dependent required fields if not already provided by overrides.
    effectiveInput.name = overrides?.name ?? defaultName;
    effectiveInput.version = overrides?.version ?? defaultVersion;
    effectiveInput.url = overrides?.url ?? `${defaultBaseUrl}/mcp`;
    effectiveInput.description = overrides?.description ?? DEFAULT_AGENT_DESCRIPTION;

    // Handle capabilities - pushNotifications defaults to false (no WebSocket support)
    const capsFromInput = effectiveInput.capabilities;
    effectiveInput.capabilities = {
        ...(capsFromInput ?? {}),
        pushNotifications: capsFromInput?.pushNotifications ?? false,
    };

    // If input specifies an empty skills array, this means "use schema default skills".
    if (effectiveInput.skills && effectiveInput.skills.length === 0) {
        effectiveInput.skills = undefined;
    }

    return AgentCardSchema.parse(effectiveInput);
}

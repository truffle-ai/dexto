import type { AgentCard } from './types.js';
import { AgentCardSchema } from '@core/agent/schemas.js';

/**
 * Minimal runtime context needed to establish defaults
 * if not provided in AgentCardOverride or by AgentCardSchema.
 */
export interface MinimalAgentCardContext {
    defaultName: string; // Ultimate fallback name if not in overrides
    defaultVersion: string; // Ultimate fallback version if not in overrides
    defaultBaseUrl: string; // Used to construct default URL if not in overrides
    webSubscriber?: unknown; // To determine default pushNotification capability
}

/**
 * Creates the final AgentCard by merging context-defined values with user-provided overrides,
 * then uses AgentCardSchema.parse() to apply schema-defined static defaults and perform validation.
 */
export function createAgentCard(
    context: MinimalAgentCardContext,
    overrides?: Partial<AgentCard> // Updated type from AgentCardOverride to Partial<AgentCard>
): AgentCard {
    const { defaultName, defaultVersion, defaultBaseUrl, webSubscriber } = context;

    // Start with overrides (which are now Partial<AgentCard> or {})
    const effectiveInput: Record<string, any> = { ...(overrides || {}) };

    // Layer in context-dependent required fields if not already provided by overrides.
    effectiveInput.name = overrides?.name ?? defaultName;
    effectiveInput.version = overrides?.version ?? defaultVersion;
    effectiveInput.url = overrides?.url ?? `${defaultBaseUrl}/mcp`;

    // Handle context-dependent capabilities.pushNotifications.
    const capsFromInput = effectiveInput.capabilities;
    effectiveInput.capabilities = {
        ...(capsFromInput ?? {}),
        pushNotifications: capsFromInput?.pushNotifications ?? !!webSubscriber,
    };

    // If input specifies an empty skills array, this means "use schema default skills".
    if (effectiveInput.skills && effectiveInput.skills.length === 0) {
        effectiveInput.skills = undefined;
    }

    return AgentCardSchema.parse(effectiveInput);
}

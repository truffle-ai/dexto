/**
 * Sub-agent LLM resolution logic
 *
 * When a parent agent spawns a sub-agent (e.g., coding-agent spawns explore-agent),
 * this module determines which LLM configuration the sub-agent should use.
 *
 * Resolution priority:
 * 1. If parent's provider can serve sub-agent's model (dexto/openrouter/same provider)
 *    → Use parent's provider + sub-agent's model (transformed if needed)
 * 2. If incompatible providers
 *    → Fall back to parent's full LLM config (with warning)
 *
 * Future enhancement (when .local.yml is implemented):
 * 0. Check sub-agent's .local.yml for LLM override (highest priority)
 */

import type { LLMConfig, LLMProvider } from '@dexto/core';
import { hasAllRegistryModelsSupport, transformModelNameForProvider } from '@dexto/core';

/**
 * Result of resolving a sub-agent's LLM configuration
 */
export interface SubAgentLLMResolution {
    /** The resolved LLM configuration to use */
    llm: LLMConfig;
    /** How the resolution was determined */
    resolution:
        | 'gateway-transform' // Parent has gateway provider, sub-agent's model transformed
        | 'same-provider' // Parent and sub-agent use same provider
        | 'parent-fallback'; // Incompatible providers, using parent's full config
    /** Human-readable explanation for debugging */
    reason: string;
}

export interface ResolveSubAgentLLMOptions {
    /** The sub-agent's bundled LLM configuration */
    subAgentLLM: LLMConfig;
    /** The parent agent's LLM configuration (already has preferences applied) */
    parentLLM: LLMConfig;
    /** Sub-agent ID for logging purposes */
    subAgentId?: string;
}

/**
 * Resolves which LLM configuration a sub-agent should use.
 *
 * The goal is to use the sub-agent's intended model (e.g., Haiku for explore-agent)
 * when possible, while leveraging the parent's provider/credentials.
 *
 * @example
 * // Parent uses dexto, sub-agent wants anthropic/haiku
 * resolveSubAgentLLM({
 *   subAgentLLM: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', apiKey: '$ANTHROPIC_API_KEY' },
 *   parentLLM: { provider: 'dexto', model: 'anthropic/claude-sonnet-4', apiKey: '$DEXTO_API_KEY' }
 * })
 * // Returns: { provider: 'dexto', model: 'anthropic/claude-haiku-4.5', apiKey: '$DEXTO_API_KEY' }
 */
export function resolveSubAgentLLM(options: ResolveSubAgentLLMOptions): SubAgentLLMResolution {
    const { subAgentLLM, parentLLM, subAgentId } = options;
    const agentLabel = subAgentId ? `'${subAgentId}'` : 'sub-agent';

    const subAgentProvider = subAgentLLM.provider;
    const subAgentModel = subAgentLLM.model;
    const parentProvider = parentLLM.provider;

    // Case 1: Parent's provider is a gateway that can serve all models (dexto, openrouter)
    // Transform sub-agent's model to gateway format and use parent's credentials
    if (hasAllRegistryModelsSupport(parentProvider)) {
        try {
            const transformedModel = transformModelNameForProvider(
                subAgentModel,
                subAgentProvider,
                parentProvider
            );

            return {
                llm: {
                    ...subAgentLLM,
                    provider: parentProvider,
                    model: transformedModel,
                    apiKey: parentLLM.apiKey,
                },
                resolution: 'gateway-transform',
                reason:
                    `${agentLabel} using ${parentProvider} gateway with model ${transformedModel} ` +
                    `(transformed from ${subAgentProvider}/${subAgentModel})`,
            };
        } catch {
            // Transform failed (model not in registry) - fall through to fallback
        }
    }

    // Case 2: Same provider - sub-agent can use its model with parent's credentials
    if (parentProvider === subAgentProvider) {
        return {
            llm: {
                ...subAgentLLM,
                apiKey: parentLLM.apiKey, // Use parent's credentials
            },
            resolution: 'same-provider',
            reason:
                `${agentLabel} using ${subAgentProvider}/${subAgentModel} ` +
                `with parent's credentials`,
        };
    }

    // Case 3: Incompatible providers - fall back to parent's full LLM config
    // This means sub-agent won't use its intended cheap/fast model, but it will work
    //
    // TODO: Future enhancement - add model tier system (fast/standard/flagship) to registry.
    // Instead of falling back to parent's full config, find the "fast" tier model for
    // parent's provider (e.g., openai->gpt-4o-mini, google->gemini-flash). This preserves
    // the intent (cheap/fast) rather than the specific model. Low priority since most
    // users will use dexto/openrouter which already handles this via gateway transform.
    return {
        llm: parentLLM,
        resolution: 'parent-fallback',
        reason:
            `${agentLabel} cannot use ${subAgentProvider}/${subAgentModel} with parent's ` +
            `${parentProvider} provider. Falling back to parent's LLM config. ` +
            `Tip: Use 'dexto login' for Dexto Credits which supports all models.`,
    };
}

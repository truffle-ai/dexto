const OPENROUTER_REASONING_EXCLUDED_FAMILIES = [
    'deepseek',
    'minimax',
    'glm',
    'mistral',
    'kimi',
    // Temporary workaround for OpenRouter models that intermittently error with reasoning params.
    // Keep this explicit so it's easy to remove once upstream stabilizes.
    'k2p5',
] as const;

/**
 * Conservative gate for OpenRouter reasoning tuning support.
 *
 * Rationale:
 * - OpenRouter's model catalog is broad and many models either don't support reasoning params
 *   or error when they are present.
 * - We intentionally avoid "best-effort" sending of reasoning knobs to reduce runtime failures.
 *
 * This mirrors opencode's current approach: allowlist a few known-good families and explicitly
 * exclude several known-problematic families.
 */
export function supportsOpenRouterReasoningTuning(model: string): boolean {
    const modelLower = model.toLowerCase();

    for (const family of OPENROUTER_REASONING_EXCLUDED_FAMILIES) {
        if (modelLower.includes(family)) return false;
    }

    return (
        modelLower.includes('gpt') ||
        modelLower.includes('claude') ||
        modelLower.includes('gemini-3')
    );
}

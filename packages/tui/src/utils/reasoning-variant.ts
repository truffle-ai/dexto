import { getReasoningProfile } from '@dexto/llm';

/**
 * The reasoning variant to show beside the model: the one picked for the session, else the
 * model's default. Null when the model doesn't reason or has no variant.
 */
export function displayedReasoningVariant(
    llmConfig: {
        provider: Parameters<typeof getReasoningProfile>[0];
        model: string;
        reasoning?: { variant?: string | undefined } | undefined;
    } | null
): string | null {
    if (llmConfig === null) return null;
    const profile = getReasoningProfile(llmConfig.provider, llmConfig.model);
    if (profile.capable !== true) return null;
    const variant = llmConfig.reasoning?.variant ?? profile.defaultVariant;
    return typeof variant === 'string' ? variant : null;
}

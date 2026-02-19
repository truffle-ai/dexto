export function isAnthropicAdaptiveThinkingModel(model: string): boolean {
    const modelLower = model.toLowerCase();

    // models.dev uses dashed versions for native Anthropic IDs (e.g. "claude-opus-4-6"),
    // while OpenRouter uses dotted versions (e.g. "anthropic/claude-opus-4.6").
    return (
        modelLower.includes('claude-opus-4-6') ||
        modelLower.includes('claude-opus-4.6') ||
        modelLower.includes('claude-sonnet-4-6') ||
        modelLower.includes('claude-sonnet-4.6')
    );
}

export function isAnthropicOpus46Model(model: string): boolean {
    const modelLower = model.toLowerCase();
    return modelLower.includes('claude-opus-4-6') || modelLower.includes('claude-opus-4.6');
}

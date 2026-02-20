export type OpenAIReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

function normalizeOpenAIModelId(model: string): string {
    const id = model.split('/').pop() ?? model;
    return id.toLowerCase();
}

export function getSupportedOpenAIReasoningEfforts(model: string): OpenAIReasoningEffort[] {
    const id = normalizeOpenAIModelId(model);

    // OpenAI docs (model pages / API reference) indicate per-model constraints.
    // Keep this conservative and add cases only when we have reliable evidence.
    if (id.includes('gpt-5-pro')) {
        return ['high'];
    }
    if (id.includes('gpt-5.2-pro')) {
        return ['medium', 'high', 'xhigh'];
    }
    if (id.includes('gpt-5.2-codex')) {
        return ['low', 'medium', 'high', 'xhigh'];
    }
    if (id.includes('gpt-5.1-codex-max')) {
        return ['none', 'medium', 'high', 'xhigh'];
    }

    if (id.startsWith('gpt-5.2')) {
        return ['none', 'low', 'medium', 'high', 'xhigh'];
    }
    if (id.startsWith('gpt-5.1')) {
        return ['none', 'low', 'medium', 'high'];
    }
    if (id.startsWith('gpt-5')) {
        return ['minimal', 'low', 'medium', 'high'];
    }

    if (id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4')) {
        return ['low', 'medium', 'high'];
    }

    return ['low', 'medium', 'high'];
}

function getFallbackOrder(requested: OpenAIReasoningEffort): readonly OpenAIReasoningEffort[] {
    switch (requested) {
        case 'none':
            return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
        case 'minimal':
            return ['minimal', 'low', 'medium', 'high', 'xhigh'];
        case 'low':
            return ['low', 'medium', 'high', 'xhigh'];
        case 'medium':
            return ['medium', 'high', 'xhigh'];
        case 'high':
            return ['high', 'xhigh'];
        case 'xhigh':
            return ['xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
    }
}

export function coerceOpenAIReasoningEffort(
    model: string,
    requested: OpenAIReasoningEffort
): OpenAIReasoningEffort | undefined {
    const supported = getSupportedOpenAIReasoningEfforts(model);
    for (const candidate of getFallbackOrder(requested)) {
        if (supported.includes(candidate)) return candidate;
    }
    return undefined;
}

export function supportsOpenAIReasoningEffort(
    model: string,
    effort: OpenAIReasoningEffort
): boolean {
    return getSupportedOpenAIReasoningEfforts(model).includes(effort);
}

export type OpenAIReasoningEffort =
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max';

function normalizeOpenAIModelId(model: string): string {
    const id = model.split('/').pop() ?? model;
    return id.toLowerCase();
}

export function getSupportedOpenAIReasoningEfforts(model: string): OpenAIReasoningEffort[] {
    const id = normalizeOpenAIModelId(model);

    // OpenAI docs (model pages / API reference) indicate per-model constraints.
    // Keep this conservative and only add cases when we have reliable evidence.
    //
    // Reference this table against pi-mono and opencode before changing hardcoded model facts.
    // They track provider behavior quickly and currently indicate:
    // - `none` is supported by GPT-5.1 and newer non-pro/non-chat families
    // - `xhigh` is supported by GPT-5.2 and newer non-chat families
    // - GPT-5.2+ pro models support medium/high/xhigh, while base GPT-5 pro remains high-only
    const version = parseGpt5Version(id);

    if (isGpt5Chat(id)) {
        return version === undefined ? [] : ['medium'];
    }

    if (id.includes('gpt-5-pro')) {
        return ['high'];
    }

    if (isVersionedGpt5Pro(id)) {
        return ['medium', 'high', 'xhigh'];
    }

    if (version === 6) {
        return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
    }

    if (version !== undefined && version >= 2) {
        return ['none', 'low', 'medium', 'high', 'xhigh'];
    }

    if (id.includes('gpt-5.1-codex-max')) {
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

function parseGpt5Version(id: string): number | undefined {
    const match = /(?:^|\/)gpt-5[.-](\d+)(?:[.-]|$)/.exec(id);
    if (!match) return undefined;
    const version = Number(match[1]);
    return Number.isFinite(version) ? version : undefined;
}

function isVersionedGpt5Pro(id: string): boolean {
    return /(?:^|\/)gpt-5[.-]\d+[.-]pro(?:[.-]|$)/.test(id);
}

function isGpt5Chat(id: string): boolean {
    return /(?:^|\/)gpt-5(?:[.-]\d+)?[.-]chat(?:[.-]|$)/.test(id);
}

function getFallbackOrder(requested: OpenAIReasoningEffort): readonly OpenAIReasoningEffort[] {
    switch (requested) {
        case 'none':
            return ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        case 'minimal':
            return ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
        case 'low':
            return ['low', 'medium', 'high', 'xhigh', 'max'];
        case 'medium':
            return ['medium', 'high', 'xhigh', 'max'];
        case 'high':
            return ['high', 'xhigh', 'max'];
        case 'xhigh':
            return ['xhigh', 'max', 'high', 'medium', 'low', 'minimal', 'none'];
        case 'max':
            return ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
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

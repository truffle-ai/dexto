type ClaudeVariant = 'opus' | 'sonnet' | 'haiku';

type ParsedClaudeVersion = {
    major: number;
    minor: number;
    variant?: ClaudeVariant;
};

function parseClaudeVersion(model: string): ParsedClaudeVersion | null {
    const modelLower = model.toLowerCase();

    // Anthropic-style IDs (models.dev / Bedrock / OpenRouter often use these):
    // - "claude-opus-4-6"
    // - "anthropic/claude-opus-4.6"
    // - "anthropic.claude-haiku-4-5-20251001-v1:0"
    const variantFirst = /claude-(opus|sonnet|haiku)-(\d+)(?:[.-](\d+))?/i.exec(modelLower);
    if (variantFirst) {
        const [, variant, majorRaw, minorRaw] = variantFirst;
        if (!variant || !majorRaw) return null;
        const major = Number.parseInt(majorRaw, 10);
        const minor = minorRaw ? Number.parseInt(minorRaw, 10) : 0;
        if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
        return { major, minor, variant: variant as ClaudeVariant };
    }

    // Vertex-style IDs often put the variant after the version:
    // - "claude-3-7-sonnet@20250219"
    // - "anthropic/claude-4.5-opus"
    const versionFirst = /claude-(\d+)(?:[.-](\d+))?-(opus|sonnet|haiku)/i.exec(modelLower);
    if (versionFirst) {
        const [, majorRaw, minorRaw, variant] = versionFirst;
        if (!majorRaw || !variant) return null;
        const major = Number.parseInt(majorRaw, 10);
        const minor = minorRaw ? Number.parseInt(minorRaw, 10) : 0;
        if (!Number.isFinite(major) || !Number.isFinite(minor)) return null;
        return { major, minor, variant: variant as ClaudeVariant };
    }

    return null;
}

function isAtLeast(
    version: Pick<ParsedClaudeVersion, 'major' | 'minor'>,
    min: { major: number; minor: number }
): boolean {
    return version.major > min.major || (version.major === min.major && version.minor >= min.minor);
}

export function isAnthropicAdaptiveThinkingModel(model: string): boolean {
    const version = parseClaudeVersion(model);
    if (!version) return false;

    // Claude 4.6 introduced adaptive thinking; assume it continues for subsequent versions.
    return isAtLeast(version, { major: 4, minor: 6 });
}

export function isAnthropicOpus46Model(model: string): boolean {
    const version = parseClaudeVersion(model);
    if (!version || version.variant !== 'opus') return false;
    return isAtLeast(version, { major: 4, minor: 6 });
}

export function supportsAnthropicInterleavedThinking(model: string): boolean {
    const version = parseClaudeVersion(model);
    if (!version) return false;

    // Interleaved thinking is a Claude 4 beta feature; assume it remains supported for future majors.
    return version.major >= 4;
}

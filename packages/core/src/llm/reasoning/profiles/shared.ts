export type ReasoningParadigm = 'effort' | 'adaptive-effort' | 'thinking-level' | 'budget' | 'none';

export type ReasoningVariantOption = {
    id: string;
    label: string;
};

export type ReasoningProfile = {
    capable: boolean;
    paradigm: ReasoningParadigm;
    variants: ReasoningVariantOption[];
    supportedVariants: string[];
    defaultVariant?: string;
    supportsBudgetTokens: boolean;
};

export function option(id: string, label?: string): ReasoningVariantOption {
    return { id, label: label ?? id };
}

export function withDefault(
    profile: Omit<ReasoningProfile, 'defaultVariant' | 'supportedVariants'>,
    preferredDefault: string
): ReasoningProfile {
    const hasPreferred = profile.variants.some((variant) => variant.id === preferredDefault);
    const defaultVariant = hasPreferred ? preferredDefault : profile.variants[0]?.id;
    return {
        ...profile,
        supportedVariants: profile.variants.map((variant) => variant.id),
        ...(defaultVariant !== undefined && { defaultVariant }),
    };
}

export function nonCapableProfile(): ReasoningProfile {
    return {
        capable: false,
        paradigm: 'none',
        variants: [],
        supportedVariants: [],
        supportsBudgetTokens: false,
    };
}

export function buildBudgetProfile(config: {
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled
        ? [option('disabled'), option('enabled')]
        : [option('enabled')];

    return withDefault(
        {
            capable: true,
            paradigm: 'budget',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'enabled'
    );
}

export function buildThinkingLevelProfile(config: {
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled
        ? [option('disabled'), option('minimal'), option('low'), option('medium'), option('high')]
        : [option('minimal'), option('low'), option('medium'), option('high')];

    return withDefault(
        {
            capable: true,
            paradigm: 'thinking-level',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'medium'
    );
}

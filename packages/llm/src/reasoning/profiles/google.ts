import {
    option,
    withDefault,
    type ReasoningProfile,
    type ReasoningVariantOption,
} from './shared.js';

const GEMINI_25_FLASH_BUDGET_TOKENS = 24_576;
const GEMINI_25_PRO_BUDGET_TOKENS = 32_768;
const GEMINI_25_HIGH_BUDGET_TOKENS = 16_000;

// Reference hardcoded Gemini thinking facts against pi-mono and opencode before changing them.
export function isGemini3Model(model: string): boolean {
    return model.toLowerCase().includes('gemini-3');
}

function isGemini25Model(model: string): boolean {
    return model.toLowerCase().includes('gemini-2.5');
}

function isGeminiImageModel(model: string): boolean {
    return model.toLowerCase().includes('image');
}

function isGeminiFlashModel(model: string): boolean {
    return model.toLowerCase().includes('flash');
}

function buildGoogleThinkingLevelProfile(config: {
    variants: ReasoningVariantOption[];
    supportsBudgetTokens: boolean;
    defaultVariant: string;
}): ReasoningProfile {
    return withDefault(
        {
            capable: true,
            paradigm: 'thinking-level',
            variants: config.variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        config.defaultVariant
    );
}

function buildGemini25Profile(config: {
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled
        ? [option('disabled'), option('high'), option('max')]
        : [option('high'), option('max')];

    return withDefault(
        {
            capable: true,
            paradigm: 'budget',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
        },
        'high'
    );
}

function buildGemini3Profile(config: {
    model: string;
    includeDisabled: boolean;
    supportsBudgetTokens: boolean;
}): ReasoningProfile {
    const variants = config.includeDisabled ? [option('disabled')] : [];
    const isFlash = isGeminiFlashModel(config.model);
    const isImage = isGeminiImageModel(config.model);

    if (isImage) {
        if (isFlash) {
            variants.push(option('minimal'), option('high'));
            return buildGoogleThinkingLevelProfile({
                variants,
                supportsBudgetTokens: config.supportsBudgetTokens,
                defaultVariant: 'minimal',
            });
        }

        variants.push(option('high'));
        return buildGoogleThinkingLevelProfile({
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
            defaultVariant: 'high',
        });
    }

    if (isFlash) {
        variants.push(option('minimal'), option('low'), option('medium'), option('high'));
        return buildGoogleThinkingLevelProfile({
            variants,
            supportsBudgetTokens: config.supportsBudgetTokens,
            defaultVariant: 'medium',
        });
    }

    variants.push(option('low'), option('medium'), option('high'));
    return buildGoogleThinkingLevelProfile({
        variants,
        supportsBudgetTokens: config.supportsBudgetTokens,
        defaultVariant: 'medium',
    });
}

export function getGoogleReasoningBudgetTokens(
    model: string,
    variant: string | undefined
): number | undefined {
    if (!isGemini25Model(model)) return undefined;
    if (variant === 'high') return GEMINI_25_HIGH_BUDGET_TOKENS;
    if (variant !== 'max') return undefined;
    return isGeminiFlashModel(model) ? GEMINI_25_FLASH_BUDGET_TOKENS : GEMINI_25_PRO_BUDGET_TOKENS;
}

export function buildGoogleReasoningProfile(config: {
    model: string;
    includeDisabled: boolean;
    supportsBudgetTokensForBudgetParadigm: boolean;
    supportsBudgetTokensForThinkingLevelParadigm: boolean;
}): ReasoningProfile {
    if (isGemini3Model(config.model)) {
        return buildGemini3Profile({
            model: config.model,
            includeDisabled: config.includeDisabled,
            supportsBudgetTokens: config.supportsBudgetTokensForThinkingLevelParadigm,
        });
    }

    if (isGemini25Model(config.model)) {
        return buildGemini25Profile({
            includeDisabled: config.includeDisabled,
            supportsBudgetTokens: config.supportsBudgetTokensForBudgetParadigm,
        });
    }

    const variants = config.includeDisabled
        ? [option('disabled'), option('enabled')]
        : [option('enabled')];

    return withDefault(
        {
            capable: true,
            paradigm: 'budget',
            variants,
            supportsBudgetTokens: config.supportsBudgetTokensForBudgetParadigm,
        },
        'enabled'
    );
}

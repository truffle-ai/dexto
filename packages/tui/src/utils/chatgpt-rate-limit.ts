import {
    getDefaultModelForProvider,
    getModelDisplayName,
    isModelValidForProvider,
    type CodexRateLimitSnapshot,
} from '@dexto/core';

export const CHATGPT_RATE_LIMIT_WARNING_THRESHOLD = 80;

export function shouldShowChatGPTRateLimitHint(
    status: CodexRateLimitSnapshot | null | undefined
): boolean {
    if (!status) {
        return false;
    }

    return status.exceeded || status.usedPercent >= CHATGPT_RATE_LIMIT_WARNING_THRESHOLD;
}

function formatResetTime(resetsAt: string | undefined): string | null {
    if (!resetsAt) {
        return null;
    }

    const date = new Date(resetsAt);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
}

export function getChatGPTRateLimitHint(status: CodexRateLimitSnapshot): string {
    const resetTime = formatResetTime(status.resetsAt);

    if (status.exceeded) {
        return resetTime ? `ChatGPT cap reached · resets ${resetTime}` : 'ChatGPT cap reached';
    }

    const usedPercent = Math.max(0, Math.min(100, Math.round(status.usedPercent)));
    return resetTime
        ? `ChatGPT cap ${usedPercent}% used · resets ${resetTime}`
        : `ChatGPT cap ${usedPercent}% used`;
}

export function resolveChatGPTFallbackModel(currentModel: string): {
    provider: 'openai';
    model: string;
    displayName: string;
    usedDefaultFallback: boolean;
} {
    const currentModelIsValid = isModelValidForProvider('openai', currentModel);
    const fallbackModel = currentModelIsValid
        ? currentModel
        : (getDefaultModelForProvider('openai') ?? currentModel);

    return {
        provider: 'openai',
        model: fallbackModel,
        displayName: getModelDisplayName(fallbackModel, 'openai'),
        usedDefaultFallback: !currentModelIsValid && fallbackModel !== currentModel,
    };
}

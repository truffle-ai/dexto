import type { ValidatedLLMConfig } from '../llm/schemas.js';
import type { Logger } from '../logger/v2/types.js';
import type { DextoProviderContext, LanguageModelFactory } from '../llm/services/types.js';
import { createVercelModel } from '../llm/services/factory.js';
import { generateText, type LanguageModelUsage } from 'ai';

export interface GenerateSessionTitleTokenUsage {
    cachedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
}

export interface GenerateSessionTitleResult {
    title?: string;
    error?: string;
    timedOut?: boolean;
    usage?: GenerateSessionTitleTokenUsage;
}

/**
 * Generate a concise title for a chat based on the first user message.
 * Runs a lightweight, isolated LLM completion that does not touch real history.
 */
export async function generateSessionTitle(
    config: ValidatedLLMConfig,
    userText: string,
    logger: Logger,
    opts: {
        languageModelFactory?: LanguageModelFactory;
        providerContext?: DextoProviderContext;
        timeoutMs?: number;
    } = {}
): Promise<GenerateSessionTitleResult> {
    const timeoutMs = opts.timeoutMs;
    const controller = timeoutMs !== undefined ? new AbortController() : undefined;
    let timer: NodeJS.Timeout | undefined;
    if (controller && timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
        const providerContext = opts.providerContext ?? {};
        const model = await (opts.languageModelFactory?.({
            config,
            context: providerContext,
            createDefaultLanguageModel: () => createVercelModel(config, providerContext),
        }) ?? createVercelModel(config, providerContext));

        const instruction = [
            'Generate a short conversation title from the following user message.',
            'Rules: 3–8 words; no surrounding punctuation, emojis, or PII; return only the title.',
            '',
            'Message:',
            sanitizeUserText(userText, 512),
        ].join('\n');

        const result = await generateText({
            model,
            prompt: instruction,
            maxOutputTokens: 32,
            ...(controller ? { abortSignal: controller.signal } : {}),
        });

        const processed = postProcessTitle(result.text);
        if (!processed) {
            return {
                error: 'LLM returned empty title',
                usage: toSessionTitleTokenUsage(result.totalUsage),
            };
        }
        return { title: processed, usage: toSessionTitleTokenUsage(result.totalUsage) };
    } catch (error) {
        if (controller?.signal.aborted) {
            return { timedOut: true, error: 'Timed out while waiting for LLM response' };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { error: message };
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function toSessionTitleTokenUsage(usage: LanguageModelUsage): GenerateSessionTitleTokenUsage {
    const tokenUsage: GenerateSessionTitleTokenUsage = {};
    copyTokenUsageNumber(tokenUsage, 'cachedInputTokens', usage.cachedInputTokens);
    copyTokenUsageNumber(tokenUsage, 'inputTokens', usage.inputTokens);
    copyTokenUsageNumber(tokenUsage, 'outputTokens', usage.outputTokens);
    copyTokenUsageNumber(tokenUsage, 'reasoningTokens', usage.reasoningTokens);
    copyTokenUsageNumber(tokenUsage, 'totalTokens', usage.totalTokens);
    return tokenUsage;
}

function copyTokenUsageNumber(
    target: GenerateSessionTitleTokenUsage,
    key: keyof GenerateSessionTitleTokenUsage,
    value: number | undefined
): void {
    if (typeof value === 'number' && Number.isFinite(value)) {
        target[key] = value;
    }
}

/**
 * Heuristic fallback when the LLM-based title fails.
 */
export function deriveHeuristicTitle(userText: string): string | undefined {
    const sanitized = sanitizeUserText(userText, 120);
    if (!sanitized) return undefined;

    const isSlashCommand = sanitized.startsWith('/');
    if (isSlashCommand) {
        const [commandTokenRaw, ...rest] = sanitized.split(/\s+/);
        if (!commandTokenRaw) {
            return undefined;
        }
        const commandToken = commandTokenRaw.trim();
        const commandName = commandToken.startsWith('/') ? commandToken.slice(1) : commandToken;
        if (!commandName) {
            return undefined;
        }
        const command = commandName.replace(/[-_]+/g, ' ');
        const commandTitle = toTitleCase(command);
        const remainder = rest.join(' ').trim();
        if (remainder) {
            return truncateWords(`${commandTitle} — ${remainder}`, 10, 70);
        }
        return commandTitle || undefined;
    }

    const firstLine = sanitized.split(/\r?\n/)[0] ?? sanitized;
    const withoutMarkdown = firstLine.replace(/[`*_~>#-]/g, '').trim();
    if (!withoutMarkdown) {
        return undefined;
    }
    return truncateWords(toSentenceCase(withoutMarkdown), 10, 70);
}

function sanitizeUserText(text: string, maxLen: number): string {
    const cleaned = text.replace(/\p{Cc}+/gu, ' ').trim();
    return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

function postProcessTitle(raw: string): string | undefined {
    if (!raw) return undefined;
    let t = raw.trim();
    t = t.replace(/^["'`\s]+|["'`\s]+$/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/[\s\-–—,:;.!?]+$/g, '');
    if (!t) return undefined;
    return truncateWords(toSentenceCase(t), 8, 80);
}

function truncateWords(text: string, maxWords: number, maxChars: number): string {
    const words = text.split(' ').filter(Boolean);
    let truncated = words.slice(0, maxWords).join(' ');
    if (truncated.length > maxChars) {
        truncated = truncated.slice(0, maxChars).trimEnd();
    }
    return truncated;
}

function toSentenceCase(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function toTitleCase(text: string): string {
    return text
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

import type { ValidatedLLMConfig } from '@core/llm/schemas.js';
import type { LLMRouter } from '@core/llm/types.js';
import type { ToolManager } from '@core/tools/tool-manager.js';
import type { SystemPromptManager } from '@core/systemPrompt/manager.js';
import type { ResourceManager } from '@core/resources/index.js';
import { createLLMService } from '@core/llm/services/factory.js';
import { SessionEventBus } from '@core/events/index.js';
import { MemoryHistoryProvider } from './history/memory.js';

/**
 * Generate a concise title for a chat based on the first user message.
 * Runs a fast, isolated LLM completion that does not pollute real history.
 *
 * Returns null on timeout/failure – callers should handle fallback or skip.
 */
export async function generateSessionTitle(
    config: ValidatedLLMConfig,
    router: LLMRouter,
    toolManager: ToolManager,
    systemPromptManager: SystemPromptManager,
    resourceManager: ResourceManager,
    userText: string,
    opts: { timeoutMs?: number } = {}
): Promise<string | null> {
    const timeoutMs = opts.timeoutMs ?? 2500;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // Create an isolated LLM service instance with empty in-memory history
        const history = new MemoryHistoryProvider();
        const bus = new SessionEventBus(); // not forwarded to agent bus
        const tempService = createLLMService(
            config,
            router,
            toolManager,
            systemPromptManager,
            history,
            bus,
            // Use a synthetic session id for isolation
            `titlegen-${Math.random().toString(36).slice(2)}`,
            resourceManager
        );

        // Craft a strict instruction inline (keeps infra change minimal)
        // Keep it short to minimize cost/latency.
        const instruction = [
            'Generate a short conversation title from the following user message.',
            'Rules: 3–8 words; no quotes, punctuation at the end, emojis, or PII; return only the title.',
            '',
            'Message:',
            sanitizeUserText(userText, 512),
        ].join('\n');

        const result = await tempService.completeTask(
            instruction,
            { signal: controller.signal },
            undefined,
            undefined,
            false
        );

        return postProcessTitle(result);
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function sanitizeUserText(text: string, maxLen: number): string {
    const t = (text || '').replace(/[\u0000-\u001F]/g, ' ').trim();
    return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function postProcessTitle(raw: string): string | null {
    if (!raw) return null;
    let t = raw.trim();
    // Strip surrounding quotes/backticks
    t = t.replace(/^\s*["'`]+|["'`]+\s*$/g, '');
    // Normalize whitespace
    t = t.replace(/\s+/g, ' ').trim();
    // Remove trailing punctuation
    t = t.replace(/[\s\-–—,:;.!?]+$/g, '');
    // Clamp to ~8 words
    const words = t.split(' ').filter(Boolean);
    if (words.length > 8) {
        t = words.slice(0, 8).join(' ');
    }
    // Basic sentence case
    t = t.charAt(0).toUpperCase() + t.slice(1);
    if (!t) return null;
    return t;
}

/**
 * CLI Event Subscriber for headless mode
 * Handles agent events and outputs to stdout/stderr
 *
 * Simple, composable output suitable for piping and scripting
 * No TUI, no boxes - just clean text output
 */

import { logger, DextoAgent } from '@dexto/core';
import { EventSubscriber } from '@dexto/server';
import { AgentEventBus } from '@dexto/core';
import type { SanitizedToolResult, AgentEventMap } from '@dexto/core';
import { capture } from '../analytics/index.js';

/**
 * Event subscriber for CLI headless mode
 * Implements the standard EventSubscriber pattern used throughout the codebase
 */
export class CLISubscriber implements EventSubscriber {
    private streamingContent: string = '';
    private completionResolve?: () => void;
    private completionReject?: (error: Error) => void;

    subscribe(eventBus: AgentEventBus): void {
        eventBus.on('llm:thinking', this.onThinking.bind(this));
        eventBus.on('llm:chunk', (payload) => {
            if (payload.chunkType === 'text') {
                this.onChunk(payload.content);
            }
            // Ignore reasoning chunks for headless mode
        });
        eventBus.on('llm:tool-call', (payload) => this.onToolCall(payload.toolName, payload.args));
        eventBus.on('llm:tool-result', (payload) => {
            // Only call onToolResult when we have sanitized result (success case)
            if (payload.sanitized) {
                this.onToolResult(
                    payload.toolName,
                    payload.sanitized,
                    payload.rawResult,
                    payload.success
                );
            }
            // For error case (success=false), the error is handled via llm:error event
        });
        eventBus.on('llm:response', (payload) => {
            this.onResponse(payload.content);
            this.captureTokenUsage(payload);
        });
        eventBus.on('llm:error', (payload) => this.onError(payload.error));
        eventBus.on('session:reset', this.onConversationReset.bind(this));
        eventBus.on('context:compacting', this.onContextCompacting.bind(this));
        eventBus.on('context:compacted', this.onContextCompacted.bind(this));
    }

    /**
     * Clean up internal state
     * Called when the CLI subscriber is being disposed of
     */
    cleanup(): void {
        this.streamingContent = '';

        // Reject any pending promises to prevent resource leaks
        if (this.completionReject) {
            const reject = this.completionReject;
            delete this.completionResolve;
            delete this.completionReject;
            reject(new Error('CLI subscriber cleaned up while operation pending'));
        }

        logger.debug('CLI event subscriber cleaned up');
    }

    onThinking(): void {
        // Silent in headless mode - no "thinking..." messages
    }

    onChunk(text: string): void {
        // Stream directly to stdout for real-time output
        this.streamingContent += text;
        process.stdout.write(text);
    }

    onToolCall(toolName: string, _args: any): void {
        // Simple tool indicator to stderr (doesn't interfere with stdout)
        process.stderr.write(`[Tool: ${toolName}]\n`);
    }

    onToolResult(
        toolName: string,
        sanitized: SanitizedToolResult,
        rawResult?: unknown,
        success?: boolean
    ): void {
        // Simple completion indicator to stderr
        const status = success ? '✓' : '✗';
        process.stderr.write(`[${status}] ${toolName} complete\n`);
    }

    onResponse(text: string): void {
        // If we didn't stream anything (no chunks), output the full response now
        if (!this.streamingContent) {
            process.stdout.write(text);
            if (!text.endsWith('\n')) {
                process.stdout.write('\n');
            }
        } else {
            // We already streamed the content, just add newline if needed
            if (!this.streamingContent.endsWith('\n')) {
                process.stdout.write('\n');
            }
        }

        // Clear accumulated state
        this.streamingContent = '';

        // Resolve completion promise if waiting
        if (this.completionResolve) {
            const resolve = this.completionResolve;
            delete this.completionResolve;
            delete this.completionReject;
            resolve();
        }
    }

    onError(error: Error): void {
        // Clear any partial response state
        this.streamingContent = '';

        // Show error to stderr for immediate user feedback
        console.error(`❌ Error: ${error.message}`);

        // Show recovery guidance if available (for DextoRuntimeError)
        if ('recovery' in error && error.recovery) {
            const recoveryMessages = Array.isArray(error.recovery)
                ? error.recovery
                : [error.recovery];
            console.error('');
            recoveryMessages.forEach((msg) => {
                console.error(`💡 ${msg}`);
            });
        }

        // Show stack for debugging if available
        if (error.stack) {
            console.error('');
            console.error(error.stack);
        }

        // Log details to file
        logger.error(`Error: ${error.message}`, {
            stack: error.stack,
            name: error.name,
            cause: error.cause,
            recovery: 'recovery' in error ? error.recovery : undefined,
        });

        // Reject completion promise if waiting
        if (this.completionReject) {
            const reject = this.completionReject;
            delete this.completionResolve;
            delete this.completionReject;
            reject(error);
        }
    }

    onConversationReset(): void {
        // Clear any partial response state
        this.streamingContent = '';
        logger.info('🔄 Conversation history cleared.', null, 'blue');
    }

    onContextCompacting(payload: AgentEventMap['context:compacting']): void {
        // Output to stderr (doesn't interfere with stdout response stream)
        process.stderr.write(
            `[📦 Compacting context (~${payload.estimatedTokens.toLocaleString()} tokens)...]\n`
        );
    }

    onContextCompacted(payload: AgentEventMap['context:compacted']): void {
        const { originalTokens, compactedTokens, originalMessages, compactedMessages, reason } =
            payload;
        const reductionPercent =
            originalTokens > 0
                ? Math.round(((originalTokens - compactedTokens) / originalTokens) * 100)
                : 0;

        // Output to stderr (doesn't interfere with stdout response stream)
        process.stderr.write(
            `[📦 Context compacted (${reason}): ${originalTokens.toLocaleString()} → ~${compactedTokens.toLocaleString()} tokens (${reductionPercent}% reduction), ${originalMessages} → ${compactedMessages} messages]\n`
        );
    }

    /**
     * Capture LLM token usage analytics
     */
    private captureTokenUsage(payload: AgentEventMap['llm:response']): void {
        const { tokenUsage, provider, model, sessionId } = payload;
        if (!tokenUsage || (!tokenUsage.inputTokens && !tokenUsage.outputTokens)) {
            return;
        }

        capture('dexto_llm_tokens_consumed', {
            source: 'cli',
            sessionId,
            provider,
            model,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            reasoningTokens: tokenUsage.reasoningTokens,
            totalTokens: tokenUsage.totalTokens,
            cacheReadTokens: tokenUsage.cacheReadTokens,
            cacheWriteTokens: tokenUsage.cacheWriteTokens,
        });
    }

    /**
     * Run agent in headless mode and wait for completion
     * Returns a promise that resolves when the response is complete
     */
    async runAndWait(agent: DextoAgent, prompt: string, sessionId: string): Promise<void> {
        // Prevent concurrent calls
        if (this.completionResolve || this.completionReject) {
            throw new Error('Cannot call runAndWait while another operation is pending');
        }

        return new Promise((resolve, reject) => {
            this.completionResolve = resolve;
            this.completionReject = reject;

            // Execute the prompt
            agent.run(prompt, undefined, undefined, sessionId).catch((error) => {
                // If agent.run() rejects but we haven't already rejected via event
                if (this.completionReject) {
                    const rejectHandler = this.completionReject;
                    delete this.completionResolve;
                    delete this.completionReject;
                    rejectHandler(error);
                }
            });
        });
    }
}

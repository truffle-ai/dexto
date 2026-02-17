import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';
import { DextoRuntimeError, ErrorScope, ErrorType } from '@dexto/core';

const DelegateToUrlInputSchema = z
    .object({
        url: z
            .string()
            .url()
            .describe(
                'The A2A-compliant agent URL (e.g., "http://localhost:3001" or "https://agent.example.com"). The tool will automatically append the correct JSON-RPC endpoint.'
            ),
        message: z
            .string()
            .min(1)
            .describe(
                'The message or task to delegate to the agent. This will be sent as natural language input.'
            ),
        sessionId: z
            .string()
            .optional()
            .describe(
                'Optional session ID for maintaining conversation state across multiple delegations to the same agent'
            ),
        timeout: z
            .number()
            .optional()
            .default(30000)
            .describe('Request timeout in milliseconds (default: 30000)'),
    })
    .strict();

type DelegateToUrlInput = z.output<typeof DelegateToUrlInputSchema>;

interface A2AMessage {
    role: 'user' | 'agent';
    parts: Array<{
        kind: 'text';
        text: string;
        metadata?: Record<string, unknown>;
    }>;
    messageId: string;
    taskId?: string;
    contextId?: string;
    kind: 'message';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class SimpleA2AClient {
    private url: string;
    private timeout: number;

    constructor(url: string, timeout: number = 30000) {
        this.url = url.replace(/\/$/, '');
        this.timeout = timeout;
    }

    async sendMessage(message: string, sessionId?: string): Promise<unknown> {
        const messageId = this.generateId();
        const taskId = sessionId || this.generateId();

        const a2aMessage: A2AMessage = {
            role: 'user',
            parts: [
                {
                    kind: 'text',
                    text: message,
                },
            ],
            messageId,
            taskId,
            contextId: taskId,
            kind: 'message',
        };

        const rpcRequest = {
            jsonrpc: '2.0',
            id: this.generateId(),
            method: 'message/send',
            params: {
                message: a2aMessage,
                configuration: {
                    blocking: true,
                },
            },
        };

        const endpoints = [`${this.url}/v1/jsonrpc`, `${this.url}/jsonrpc`];

        let lastError: Error | null = null;

        for (const endpoint of endpoints) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': '@dexto/core',
                    },
                    body: JSON.stringify(rpcRequest),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    lastError = new Error(
                        `HTTP ${response.status}: ${response.statusText} (tried ${endpoint})`
                    );
                    continue;
                }

                const data: unknown = await response.json();

                if (isPlainObject(data) && 'error' in data && data.error) {
                    const errorMessage =
                        isPlainObject(data.error) && typeof data.error.message === 'string'
                            ? data.error.message
                            : 'Unknown error';
                    throw new Error(`Agent returned error: ${errorMessage}`);
                }

                if (isPlainObject(data) && 'result' in data) {
                    return this.extractTaskResponse(data.result);
                }

                return data;
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new DextoRuntimeError(
                        'DELEGATION_TIMEOUT',
                        ErrorScope.TOOLS,
                        ErrorType.TIMEOUT,
                        `Delegation timeout after ${this.timeout}ms`
                    );
                }
                lastError = error instanceof Error ? error : new Error(String(error));
            } finally {
                clearTimeout(timeoutId);
            }
        }

        throw new DextoRuntimeError(
            'DELEGATION_FAILED',
            ErrorScope.TOOLS,
            ErrorType.THIRD_PARTY,
            `Failed to connect to agent at ${this.url}. Tried endpoints: ${endpoints.join(', ')}. Last error: ${lastError?.message || 'Unknown error'}`
        );
    }

    private extractTaskResponse(task: unknown): string {
        if (isPlainObject(task) && Array.isArray(task.history)) {
            const agentMessages = task.history.filter(
                (message): message is Record<string, unknown> =>
                    isPlainObject(message) && message.role === 'agent'
            );
            if (agentMessages.length > 0) {
                const lastMessage = agentMessages[agentMessages.length - 1];
                if (lastMessage && Array.isArray(lastMessage.parts)) {
                    const textParts = lastMessage.parts
                        .filter(
                            (part): part is Record<string, unknown> =>
                                isPlainObject(part) && part.kind === 'text'
                        )
                        .map((part) => part.text)
                        .filter((text): text is string => typeof text === 'string');
                    return textParts.join('\n');
                }
            }
        }

        return JSON.stringify(task, null, 2);
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
}

/**
 * Create the `delegate_to_url` tool.
 *
 * Delegates a message/task to another A2A-compliant agent URL via JSON-RPC and returns its response.
 */
export function createDelegateToUrlTool(): Tool {
    return {
        id: 'delegate_to_url',
        displayName: 'Delegate',
        description:
            'Delegate a task to another A2A-compliant agent at a specific URL. Supports STATEFUL multi-turn conversations via sessionId parameter. USAGE: (1) First delegation: provide url + message. Tool returns a response AND a sessionId. (2) Follow-up: use the SAME sessionId to continue the conversation with that agent. The agent remembers previous context. EXAMPLE: First call {url: "http://agent:3001", message: "Analyze data X"} returns {sessionId: "xyz", response: "..."}. Second call {url: "http://agent:3001", message: "What was the top insight?", sessionId: "xyz"}. The agent will remember the first analysis and can answer specifically.',
        inputSchema: DelegateToUrlInputSchema,
        execute: async (input: unknown, _context: ToolExecutionContext) => {
            const { url, message, sessionId, timeout } = input as DelegateToUrlInput;

            try {
                const client = new SimpleA2AClient(url, timeout);

                const effectiveSessionId =
                    sessionId ||
                    `delegation-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
                const response = await client.sendMessage(message, effectiveSessionId);

                return {
                    success: true,
                    agentUrl: url,
                    sessionId: effectiveSessionId,
                    response,
                    _hint: sessionId
                        ? 'Continued existing conversation'
                        : 'Started new conversation - use this sessionId for follow-ups',
                };
            } catch (error) {
                if (error instanceof DextoRuntimeError) {
                    throw error;
                }

                throw new DextoRuntimeError(
                    'DELEGATION_ERROR',
                    ErrorScope.TOOLS,
                    ErrorType.SYSTEM,
                    `Delegation failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        },
    };
}

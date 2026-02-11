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
        metadata?: Record<string, any>;
    }>;
    messageId: string;
    taskId?: string;
    contextId?: string;
    kind: 'message';
}

class SimpleA2AClient {
    private url: string;
    private timeout: number;

    constructor(url: string, timeout: number = 30000) {
        this.url = url.replace(/\/$/, '');
        this.timeout = timeout;
    }

    async sendMessage(message: string, sessionId?: string): Promise<any> {
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
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), this.timeout);

                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': '@dexto/core',
                    },
                    body: JSON.stringify(rpcRequest),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    lastError = new Error(
                        `HTTP ${response.status}: ${response.statusText} (tried ${endpoint})`
                    );
                    continue;
                }

                const data = await response.json();

                if ('error' in data && data.error) {
                    throw new Error(
                        `Agent returned error: ${data.error.message || 'Unknown error'}`
                    );
                }

                if ('result' in data) {
                    return this.extractTaskResponse(data.result);
                }

                return data;
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new DextoRuntimeError(
                        `Delegation timeout after ${this.timeout}ms`,
                        ErrorScope.TOOLS,
                        ErrorType.TIMEOUT,
                        'DELEGATION_TIMEOUT'
                    );
                }
                lastError = error instanceof Error ? error : new Error(String(error));
            }
        }

        throw new DextoRuntimeError(
            `Failed to connect to agent at ${this.url}. Tried endpoints: ${endpoints.join(', ')}. Last error: ${lastError?.message || 'Unknown error'}`,
            ErrorScope.TOOLS,
            ErrorType.THIRD_PARTY,
            'DELEGATION_FAILED'
        );
    }

    private extractTaskResponse(task: any): string {
        if (task.history && Array.isArray(task.history)) {
            const agentMessages = task.history.filter((m: any) => m.role === 'agent');
            if (agentMessages.length > 0) {
                const lastMessage = agentMessages[agentMessages.length - 1];
                if (lastMessage.parts && Array.isArray(lastMessage.parts)) {
                    const textParts = lastMessage.parts
                        .filter((p: any) => p.kind === 'text')
                        .map((p: any) => p.text);
                    if (textParts.length > 0) {
                        return textParts.join('\n');
                    }
                }
            }
        }

        return JSON.stringify(task, null, 2);
    }

    private generateId(): string {
        return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    }
}

export function createDelegateToUrlTool(): Tool {
    return {
        id: 'delegate_to_url',
        description:
            'Delegate a task to another A2A-compliant agent at a specific URL. Supports STATEFUL multi-turn conversations via sessionId parameter. USAGE: (1) First delegation: provide url + message. Tool returns a response AND a sessionId. (2) Follow-up: use the SAME sessionId to continue the conversation with that agent. The agent remembers previous context. EXAMPLE: First call {url: "http://agent:3001", message: "Analyze data X"} returns {sessionId: "xyz", response: "..."}. Second call {url: "http://agent:3001", message: "What was the top insight?", sessionId: "xyz"}. The agent will remember the first analysis and can answer specifically.',
        inputSchema: DelegateToUrlInputSchema,
        execute: async (input: unknown, _context?: ToolExecutionContext) => {
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
                    `Delegation failed: ${error instanceof Error ? error.message : String(error)}`,
                    ErrorScope.TOOLS,
                    ErrorType.SYSTEM,
                    'DELEGATION_ERROR'
                );
            }
        },
    };
}

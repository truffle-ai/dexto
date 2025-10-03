import type { LLMRouter } from '../llm/types.js';
import type { ImageData, FileData } from '../context/types.js';

export type HookName = 'beforeInput' | 'beforeToolCall' | 'afterToolResult' | 'beforeResponse';

export interface BeforeInputPayload {
    text: string;
    imageData?: ImageData;
    fileData?: FileData;
    sessionId: string;
}

export interface BeforeToolCallPayload {
    toolName: string;
    args: Record<string, unknown>;
    sessionId?: string;
    callId?: string;
}

export interface AfterToolResultPayload {
    toolName: string;
    result: unknown;
    success: boolean;
    sessionId?: string;
    callId?: string;
}

export interface BeforeResponsePayload {
    content: string;
    reasoning?: string;
    model?: string;
    router?: LLMRouter;
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };
    sessionId: string;
}

export type HookPayloadMap = {
    beforeInput: BeforeInputPayload;
    beforeToolCall: BeforeToolCallPayload;
    afterToolResult: AfterToolResultPayload;
    beforeResponse: BeforeResponsePayload;
};

export type HookHandler<T> = (payload: T) => Promise<HookResult<T> | void> | HookResult<T> | void;

export interface HookResult<T> {
    modify?: Partial<T>;
    cancel?: boolean;
    responseOverride?: string;
    notices?: HookNotice[];
}

export interface HookRunResult<T> {
    payload: T;
    canceled: boolean;
    responseOverride?: string;
    notices?: HookNotice[];
}

export interface RegisterOptions {
    id?: string;
    priority?: number;
    once?: boolean;
}

export interface HookNotice {
    kind: 'allow' | 'block' | 'warn' | 'info';
    code?: string;
    message: string;
    details?: Record<string, unknown>;
}

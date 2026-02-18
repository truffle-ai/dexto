import type {
    Hook,
    BeforeLLMRequestPayload,
    BeforeResponsePayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    HookResult,
    HookExecutionContext,
} from '@dexto/core';
import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type RequestLoggerHookConfig = {
    logDir?: string | undefined;
    logFileName?: string | undefined;
};

/**
 * Logs user requests, tool calls/results, and assistant responses to a file.
 */
export class RequestLoggerHook implements Hook {
    private logFilePath: string = '';
    private logFileHandle: fs.FileHandle | null = null;
    private requestCount: number = 0;

    async initialize(config: Record<string, unknown>): Promise<void> {
        const typed = config as RequestLoggerHookConfig;
        const logDir = typed.logDir || join(homedir(), '.dexto', 'logs');
        const logFileName = typed.logFileName || 'request-logger.log';
        this.logFilePath = join(logDir, logFileName);

        await fs.mkdir(logDir, { recursive: true });
        this.logFileHandle = await fs.open(this.logFilePath, 'a');

        await this.writeLog('='.repeat(80));
        await this.writeLog(`Request Logger initialized at ${new Date().toISOString()}`);
        await this.writeLog(`Log file: ${this.logFilePath}`);
        await this.writeLog('='.repeat(80));
    }

    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: HookExecutionContext
    ): Promise<HookResult> {
        this.requestCount++;

        await this.writeLog('');
        await this.writeLog(`[${this.requestCount}] USER REQUEST at ${new Date().toISOString()}`);
        await this.writeLog(`Session: ${payload.sessionId || 'unknown'}`);
        await this.writeLog(`User: ${context.userId || 'anonymous'}`);
        await this.writeLog(`Model: ${context.llmConfig.provider}/${context.llmConfig.model}`);
        await this.writeLog('-'.repeat(40));
        await this.writeLog(`Text: ${payload.text}`);

        if (payload.imageData) {
            await this.writeLog(
                `Image: ${payload.imageData.mimeType} (${payload.imageData.image.length} chars)`
            );
        }

        if (payload.fileData) {
            await this.writeLog(
                `File: ${payload.fileData.filename || 'unknown'} (${payload.fileData.mimeType})`
            );
        }

        await this.writeLog('-'.repeat(40));

        return { ok: true };
    }

    async beforeToolCall(
        payload: BeforeToolCallPayload,
        _context: HookExecutionContext
    ): Promise<HookResult> {
        await this.writeLog('');
        await this.writeLog(`[${this.requestCount}] TOOL CALL at ${new Date().toISOString()}`);
        await this.writeLog(`Tool: ${payload.toolName}`);
        await this.writeLog(`Call ID: ${payload.callId || 'unknown'}`);
        await this.writeLog(`Arguments: ${JSON.stringify(payload.args, null, 2)}`);

        return { ok: true };
    }

    async afterToolResult(
        payload: AfterToolResultPayload,
        _context: HookExecutionContext
    ): Promise<HookResult> {
        await this.writeLog('');
        await this.writeLog(`[${this.requestCount}] TOOL RESULT at ${new Date().toISOString()}`);
        await this.writeLog(`Tool: ${payload.toolName}`);
        await this.writeLog(`Call ID: ${payload.callId || 'unknown'}`);
        await this.writeLog(`Success: ${payload.success}`);

        const resultStr =
            typeof payload.result === 'string'
                ? payload.result.substring(0, 500) + (payload.result.length > 500 ? '...' : '')
                : JSON.stringify(payload.result, null, 2).substring(0, 500);

        await this.writeLog(`Result: ${resultStr}`);

        return { ok: true };
    }

    async beforeResponse(
        payload: BeforeResponsePayload,
        _context: HookExecutionContext
    ): Promise<HookResult> {
        await this.writeLog('');
        await this.writeLog(
            `[${this.requestCount}] ASSISTANT RESPONSE at ${new Date().toISOString()}`
        );
        await this.writeLog(`Session: ${payload.sessionId || 'unknown'}`);
        await this.writeLog(`Model: ${payload.provider}/${payload.model || 'unknown'}`);

        if (payload.tokenUsage) {
            await this.writeLog(
                `Tokens: ${payload.tokenUsage.input} input, ${payload.tokenUsage.output} output`
            );
        }

        await this.writeLog('-'.repeat(40));
        await this.writeLog(`Content: ${payload.content}`);

        if (payload.reasoning) {
            await this.writeLog('-'.repeat(40));
            await this.writeLog(`Reasoning: ${payload.reasoning}`);
        }

        await this.writeLog('-'.repeat(40));

        return { ok: true };
    }

    async cleanup(): Promise<void> {
        await this.writeLog('');
        await this.writeLog('='.repeat(80));
        await this.writeLog(`Request Logger shutting down at ${new Date().toISOString()}`);
        await this.writeLog(`Total requests logged: ${this.requestCount}`);
        await this.writeLog('='.repeat(80));

        if (this.logFileHandle) {
            await this.logFileHandle.close();
            this.logFileHandle = null;
        }
    }

    private async writeLog(message: string): Promise<void> {
        if (this.logFileHandle) {
            await this.logFileHandle.write(message + '\n');
        }
    }
}

export default RequestLoggerHook;

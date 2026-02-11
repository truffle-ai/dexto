import type {
    DextoPlugin,
    BeforeLLMRequestPayload,
    BeforeResponsePayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    PluginResult,
    PluginExecutionContext,
} from '@dexto/core';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * Request Logger Plugin
 *
 * Logs all user requests and assistant responses to a file for debugging and analysis.
 * Demonstrates the complete plugin lifecycle including resource management.
 *
 * Features:
 * - Logs user input (text, images, files)
 * - Logs tool calls and results
 * - Logs assistant responses with token usage
 * - Proper resource cleanup on shutdown
 */
export class RequestLoggerPlugin implements DextoPlugin {
    private logFilePath: string = '';
    private logFileHandle: fs.FileHandle | null = null;
    private requestCount: number = 0;

    /**
     * Initialize plugin - create log directory and open log file
     */
    async initialize(config: Record<string, any>): Promise<void> {
        // Default log path: ~/.dexto/logs/request-logger.log
        const logDir = config.logDir || join(homedir(), '.dexto', 'logs');
        const logFileName = config.logFileName || 'request-logger.log';
        this.logFilePath = join(logDir, logFileName);

        // Ensure log directory exists
        await fs.mkdir(logDir, { recursive: true });

        // Open log file in append mode
        this.logFileHandle = await fs.open(this.logFilePath, 'a');

        // Write initialization header
        await this.writeLog('='.repeat(80));
        await this.writeLog(`Request Logger initialized at ${new Date().toISOString()}`);
        await this.writeLog(`Log file: ${this.logFilePath}`);
        await this.writeLog('='.repeat(80));
    }

    /**
     * Log user input before it's sent to the LLM
     */
    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
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

    /**
     * Log tool calls before execution
     */
    async beforeToolCall(
        payload: BeforeToolCallPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        await this.writeLog('');
        await this.writeLog(`[${this.requestCount}] TOOL CALL at ${new Date().toISOString()}`);
        await this.writeLog(`Tool: ${payload.toolName}`);
        await this.writeLog(`Call ID: ${payload.callId || 'unknown'}`);
        await this.writeLog(`Arguments: ${JSON.stringify(payload.args, null, 2)}`);

        return { ok: true };
    }

    /**
     * Log tool results after execution
     */
    async afterToolResult(
        payload: AfterToolResultPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
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

    /**
     * Log assistant response before it's sent to the user
     */
    async beforeResponse(
        payload: BeforeResponsePayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
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

    /**
     * Cleanup - close log file handle
     */
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

    /**
     * Helper method to write to log file
     */
    private async writeLog(message: string): Promise<void> {
        if (this.logFileHandle) {
            await this.logFileHandle.write(message + '\n');
        }
    }
}

// Export the plugin class directly for the plugin manager to instantiate
export default RequestLoggerPlugin;

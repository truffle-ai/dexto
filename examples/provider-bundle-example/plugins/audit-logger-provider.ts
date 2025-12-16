/**
 * Example Plugin Provider: Audit Logger
 *
 * Demonstrates how to create a custom plugin provider that hooks into
 * all four extension points to log agent activity for audit purposes.
 *
 * Extension points:
 * - beforeLLMRequest: Log user inputs
 * - beforeToolCall: Log tool invocations
 * - afterToolResult: Log tool results
 * - beforeResponse: Log agent responses
 */

import { z } from 'zod';
import type {
    PluginProvider,
    PluginCreationContext,
    DextoPlugin,
    PluginResult,
    PluginExecutionContext,
    BeforeLLMRequestPayload,
    BeforeToolCallPayload,
    AfterToolResultPayload,
    BeforeResponsePayload,
} from '@dexto/core';

/**
 * Configuration schema for the audit logger plugin
 */
const AuditLoggerConfigSchema = z
    .object({
        type: z.literal('audit-logger'),
        /** Log level for audit entries */
        logLevel: z
            .enum(['debug', 'info', 'warn'])
            .default('info')
            .describe('Log level for audit entries'),
        /** Whether to log full content or just metadata */
        logFullContent: z
            .boolean()
            .default(false)
            .describe('Log full content (may include sensitive data)'),
        /** Maximum content length to log when logFullContent is true */
        maxContentLength: z
            .number()
            .int()
            .positive()
            .default(500)
            .describe('Maximum characters to log per content field'),
        /** Which extension points to enable */
        enabledHooks: z
            .object({
                beforeLLMRequest: z.boolean().default(true),
                beforeToolCall: z.boolean().default(true),
                afterToolResult: z.boolean().default(true),
                beforeResponse: z.boolean().default(true),
            })
            .default({}),
    })
    .strict();

type AuditLoggerConfig = z.output<typeof AuditLoggerConfigSchema>;

/**
 * Audit logger plugin implementation
 */
class AuditLoggerPlugin implements DextoPlugin {
    constructor(
        private config: AuditLoggerConfig,
        private context: PluginCreationContext
    ) {}

    /**
     * Initialize the plugin (called once at startup)
     */
    async initialize(config: Record<string, any>): Promise<void> {
        // Could set up external logging service, create log files, etc.
        console.log(`[AuditLogger] Initialized with log level: ${this.config.logLevel}`);
    }

    /**
     * Hook: Before LLM Request
     * Log user inputs before they're sent to the LLM
     */
    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        if (!this.config.enabledHooks.beforeLLMRequest) {
            return { ok: true };
        }

        const logData = {
            hook: 'beforeLLMRequest',
            sessionId: payload.sessionId,
            userId: context.userId,
            tenantId: context.tenantId,
            hasImage: !!payload.imageData,
            hasFile: !!payload.fileData,
            textLength: payload.text.length,
            ...(this.config.logFullContent && {
                text: this.truncate(payload.text),
            }),
        };

        this.log(context, 'User input received', logData);

        return { ok: true };
    }

    /**
     * Hook: Before Tool Call
     * Log tool invocations before execution
     */
    async beforeToolCall(
        payload: BeforeToolCallPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        if (!this.config.enabledHooks.beforeToolCall) {
            return { ok: true };
        }

        const logData = {
            hook: 'beforeToolCall',
            sessionId: payload.sessionId,
            userId: context.userId,
            toolName: payload.toolName,
            callId: payload.callId,
            ...(this.config.logFullContent && {
                args: this.truncate(JSON.stringify(payload.args)),
            }),
        };

        this.log(context, `Tool call: ${payload.toolName}`, logData);

        return { ok: true };
    }

    /**
     * Hook: After Tool Result
     * Log tool results after execution
     */
    async afterToolResult(
        payload: AfterToolResultPayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        if (!this.config.enabledHooks.afterToolResult) {
            return { ok: true };
        }

        const logData = {
            hook: 'afterToolResult',
            sessionId: payload.sessionId,
            userId: context.userId,
            toolName: payload.toolName,
            callId: payload.callId,
            success: payload.success,
            ...(this.config.logFullContent && {
                result: this.truncate(
                    typeof payload.result === 'string'
                        ? payload.result
                        : JSON.stringify(payload.result)
                ),
            }),
        };

        this.log(
            context,
            `Tool result: ${payload.toolName} (${payload.success ? 'success' : 'failure'})`,
            logData
        );

        return { ok: true };
    }

    /**
     * Hook: Before Response
     * Log agent responses before they're sent to the user
     */
    async beforeResponse(
        payload: BeforeResponsePayload,
        context: PluginExecutionContext
    ): Promise<PluginResult> {
        if (!this.config.enabledHooks.beforeResponse) {
            return { ok: true };
        }

        const logData = {
            hook: 'beforeResponse',
            sessionId: payload.sessionId,
            userId: context.userId,
            provider: payload.provider,
            model: payload.model,
            tokenUsage: payload.tokenUsage,
            contentLength: payload.content.length,
            ...(this.config.logFullContent && {
                content: this.truncate(payload.content),
            }),
        };

        this.log(context, 'Agent response', logData);

        return { ok: true };
    }

    /**
     * Cleanup (called at shutdown)
     */
    async cleanup(): Promise<void> {
        console.log('[AuditLogger] Cleaned up');
    }

    /**
     * Log helper that uses configured log level
     */
    private log(context: PluginExecutionContext, message: string, data: Record<string, any>): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[AuditLogger] [${timestamp}] ${message}`;

        switch (this.config.logLevel) {
            case 'debug':
                context.logger.debug(formattedMessage, data);
                break;
            case 'warn':
                context.logger.warn(formattedMessage, data);
                break;
            case 'info':
            default:
                context.logger.info(formattedMessage, data);
        }
    }

    /**
     * Truncate content to max length
     */
    private truncate(content: string): string {
        if (content.length <= this.config.maxContentLength) {
            return content;
        }
        return content.slice(0, this.config.maxContentLength) + '... [truncated]';
    }
}

/**
 * Audit logger plugin provider
 *
 * This provider creates a plugin that logs all agent activity for
 * compliance, debugging, or analytics purposes.
 *
 * Usage in agent YAML:
 * ```yaml
 * plugins:
 *   registry:
 *     - type: audit-logger
 *       priority: 5
 *       blocking: false
 *       config:
 *         logLevel: info
 *         logFullContent: false
 *         enabledHooks:
 *           beforeLLMRequest: true
 *           beforeToolCall: true
 *           afterToolResult: true
 *           beforeResponse: true
 * ```
 */
export const auditLoggerPluginProvider: PluginProvider<'audit-logger', AuditLoggerConfig> = {
    type: 'audit-logger',
    configSchema: AuditLoggerConfigSchema,

    create(config, context) {
        return new AuditLoggerPlugin(config, context);
    },

    metadata: {
        displayName: 'Audit Logger',
        description: 'Logs all agent activity for compliance and debugging',
        extensionPoints: [
            'beforeLLMRequest',
            'beforeToolCall',
            'afterToolResult',
            'beforeResponse',
        ],
        category: 'logging',
    },
};

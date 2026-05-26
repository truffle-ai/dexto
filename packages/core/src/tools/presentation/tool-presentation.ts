import { DextoRuntimeError } from '../../errors/index.js';
import type { Logger } from '../../logger/v2/types.js';
import type { AgentRunContext } from '../../runtime/run-context.js';
import { ToolErrorCode } from '../error-codes.js';
import type { Tool, ToolExecutionContext, ToolPresentationSnapshotV1 } from '../types.js';
import type { ToolDisplayData } from '../display-types.js';

const MCP_TOOL_PREFIX = 'mcp--';

type BuildToolExecutionContext = (options: {
    sessionId?: string | undefined;
    toolCallId?: string | undefined;
    runContext?: AgentRunContext | undefined;
}) => ToolExecutionContext;

export class ToolPresentation {
    constructor(
        private readonly getLocalTool: (toolName: string) => Tool | undefined,
        private readonly validateLocalToolArgs: (
            toolName: string,
            args: Record<string, unknown>
        ) => Record<string, unknown>,
        private readonly buildToolExecutionContext: BuildToolExecutionContext,
        private readonly logger: Logger
    ) {}

    buildGenericSnapshot(toolName: string): ToolPresentationSnapshotV1 {
        const isMcp = toolName.startsWith(MCP_TOOL_PREFIX);
        const fallbackTitle = isMcp
            ? this.titleCaseMcpToolName(toolName)
            : this.toTitleCase(toolName);

        const snapshot: ToolPresentationSnapshotV1 = {
            version: 1,
            source: {
                type: isMcp ? 'mcp' : 'local',
            },
            header: {
                title: fallbackTitle,
            },
        };

        if (snapshot.source?.type === 'mcp') {
            const actualToolName = toolName.substring(MCP_TOOL_PREFIX.length);
            const parts = actualToolName.split('--');
            if (parts.length >= 2 && parts[0]) {
                snapshot.source.mcpServerName = parts[0];
            }
        }

        return snapshot;
    }

    snapshotForToolCallEvent(input: {
        toolName: string;
        args: Record<string, unknown>;
        toolCallId: string;
        sessionId?: string | undefined;
        runContext?: AgentRunContext | undefined;
    }): ToolPresentationSnapshotV1 {
        const fallback = this.buildGenericSnapshot(input.toolName);

        if (input.toolName.startsWith(MCP_TOOL_PREFIX)) {
            return fallback;
        }

        const presentation = this.getLocalTool(input.toolName)?.presentation;
        if (!presentation?.describeHeader && !presentation?.describeArgs) {
            return fallback;
        }

        try {
            const validatedArgs = this.validateLocalToolArgs(input.toolName, input.args);
            const context = this.buildToolExecutionContext(input);
            let nextSnapshot: ToolPresentationSnapshotV1 = fallback;

            const header = presentation.describeHeader?.(validatedArgs, context);
            if (!isPromiseLike(header) && header) {
                nextSnapshot = {
                    ...nextSnapshot,
                    header: { ...nextSnapshot.header, ...header },
                };
            }

            const argsPresentation = presentation.describeArgs?.(validatedArgs, context);
            if (!isPromiseLike(argsPresentation) && argsPresentation) {
                nextSnapshot = {
                    ...nextSnapshot,
                    args: argsPresentation,
                };
            }

            return nextSnapshot;
        } catch (error) {
            this.logger.debug(
                `Tool presentation snapshot generation failed for '${input.toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return fallback;
        }
    }

    async snapshotForCall(input: {
        toolName: string;
        args: Record<string, unknown>;
        toolCallId: string;
        sessionId?: string | undefined;
        runContext?: AgentRunContext | undefined;
    }): Promise<ToolPresentationSnapshotV1> {
        const fallback = this.buildGenericSnapshot(input.toolName);

        if (input.toolName.startsWith(MCP_TOOL_PREFIX)) {
            return fallback;
        }

        const presentation = this.getLocalTool(input.toolName)?.presentation;
        if (!presentation?.describeHeader && !presentation?.describeArgs) {
            return fallback;
        }

        try {
            const context = this.buildToolExecutionContext(input);
            const describedHeader = presentation.describeHeader
                ? await Promise.resolve(presentation.describeHeader(input.args, context))
                : null;
            const describedArgs = presentation.describeArgs
                ? await Promise.resolve(presentation.describeArgs(input.args, context))
                : null;

            return {
                ...fallback,
                ...(describedHeader ? { header: { ...fallback.header, ...describedHeader } } : {}),
                ...(describedArgs ? { args: describedArgs } : {}),
            };
        } catch (error) {
            this.logger.debug(
                `Tool presentation snapshot generation failed for '${input.toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return fallback;
        }
    }

    async augmentWithResult(input: {
        toolName: string;
        snapshot: ToolPresentationSnapshotV1;
        result: unknown;
        args: Record<string, unknown>;
        toolCallId: string;
        sessionId?: string | undefined;
        runContext?: AgentRunContext | undefined;
    }): Promise<ToolPresentationSnapshotV1> {
        if (input.toolName.startsWith(MCP_TOOL_PREFIX)) {
            return input.snapshot;
        }

        const describeResult = this.getLocalTool(input.toolName)?.presentation?.describeResult;
        if (!describeResult) {
            return input.snapshot;
        }

        try {
            const context = this.buildToolExecutionContext(input);
            const resultPresentation = await Promise.resolve(
                describeResult(input.result, input.args, context)
            );
            if (!resultPresentation) {
                return input.snapshot;
            }
            return {
                ...input.snapshot,
                result: resultPresentation,
            };
        } catch (error) {
            this.logger.debug(
                `Tool result presentation snapshot generation failed for '${input.toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return input.snapshot;
        }
    }

    async preview(input: {
        toolName: string;
        args: Record<string, unknown>;
        toolCallId: string;
        sessionId?: string | undefined;
        runContext?: AgentRunContext | undefined;
    }): Promise<ToolDisplayData | undefined> {
        if (input.toolName.startsWith(MCP_TOOL_PREFIX)) {
            return undefined;
        }

        const preview = this.getLocalTool(input.toolName)?.presentation?.preview;
        if (!preview) {
            return undefined;
        }

        try {
            const context = this.buildToolExecutionContext(input);
            const displayPreview = await Promise.resolve(preview(input.args, context));
            this.logger.debug(`Generated preview for ${input.toolName}`);
            return displayPreview ?? undefined;
        } catch (error) {
            if (
                error instanceof DextoRuntimeError &&
                error.code === ToolErrorCode.VALIDATION_FAILED
            ) {
                this.logger.debug(`Validation failed for ${input.toolName}: ${error.message}`);
                throw error;
            }
            this.logger.debug(
                `Tool preview generation failed for '${input.toolName}': ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return undefined;
        }
    }

    private titleCaseMcpToolName(toolName: string): string {
        const actualToolName = toolName.substring(MCP_TOOL_PREFIX.length);
        const parts = actualToolName.split('--');
        const toolPart = parts.length >= 2 ? parts.slice(1).join('--') : actualToolName;
        return this.toTitleCase(toolPart);
    }

    private toTitleCase(name: string): string {
        return name
            .replace(/[_-]+/g, ' ')
            .split(' ')
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ');
    }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        typeof value === 'object' &&
        value !== null &&
        'then' in value &&
        typeof value.then === 'function'
    );
}

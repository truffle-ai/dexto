import { DextoMcpClient, McpServerConfigSchema } from '@dexto/core';
import { ToolError } from '@dexto/core';
import type { Logger } from '@dexto/core';

const EXA_SERVER_URL = 'https://mcp.exa.ai/mcp';

type ExaToolName = 'web_search_exa' | 'get_code_context_exa';

type ExaToolResult = {
    content?: Array<{
        type?: string;
        text?: string;
    }>;
    isError?: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asExaToolResult(value: unknown): ExaToolResult | null {
    if (!isPlainObject(value)) return null;
    const content = value.content;
    const isError = value.isError;

    const result: ExaToolResult = {};

    if (Array.isArray(content)) {
        result.content = content.filter(isPlainObject).map((entry) => {
            const mapped: { type?: string; text?: string } = {};
            if (typeof entry.type === 'string') {
                mapped.type = entry.type;
            }
            if (typeof entry.text === 'string') {
                mapped.text = entry.text;
            }
            return mapped;
        });
    }

    if (typeof isError === 'boolean') {
        result.isError = isError;
    }

    return result;
}

function extractFirstText(result: ExaToolResult): string | null {
    if (!result.content) return null;
    for (const entry of result.content) {
        if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
            return entry.text;
        }
    }
    return null;
}

/**
 * Exa search tools are implemented as internal tools (not exposed as `mcp--...` tools).
 *
 * Why:
 * - We want stable tool IDs and consistent display/approval UX.
 * - We intentionally do NOT register Exa as an MCP server in the agent-wide MCPManager, because that would:
 *   - expose extra Exa MCP tools (e.g. company research) that we don't want in the tool surface
 *   - allow the model to bypass curated wrappers by calling `mcp--...` tools directly
 *
 * Implementation detail:
 * - We still use the MCP SDK via Dexto's MCP client wrapper (no bespoke fetch/SSE parsing).
 */
export async function callExaTool(options: {
    logger: Logger;
    toolId: string;
    toolName: ExaToolName;
    args: Record<string, unknown>;
    timeoutMs: number;
}): Promise<string> {
    const { logger, toolId, toolName, args, timeoutMs } = options;

    const mcpClient = new DextoMcpClient(logger);
    const config = McpServerConfigSchema.parse({
        type: 'http',
        enabled: true,
        url: EXA_SERVER_URL,
        headers: {},
        timeout: timeoutMs,
        connectionMode: 'lenient',
    });

    try {
        await mcpClient.connect(config, 'exa');
        const client = await mcpClient.getConnectedClient();
        const result = await client.callTool({ name: toolName, arguments: args }, undefined, {
            timeout: timeoutMs,
            resetTimeoutOnProgress: true,
        });

        const parsed = asExaToolResult(result);
        if (parsed?.isError) {
            const message = extractFirstText(parsed) ?? 'Unknown error from Exa MCP tool';
            throw ToolError.executionFailed(toolId, message);
        }

        const text = parsed ? extractFirstText(parsed) : null;
        return text ?? 'No results found. Try a different query.';
    } catch (error) {
        if (error instanceof Error) {
            throw ToolError.executionFailed(toolId, error.message);
        }
        throw ToolError.executionFailed(toolId, String(error));
    } finally {
        await mcpClient.disconnect();
    }
}

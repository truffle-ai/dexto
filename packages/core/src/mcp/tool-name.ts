export const MCP_MODEL_TOOL_PREFIX = 'mcp__';
export const MCP_TOOL_SEPARATOR = '__';

export function normalizeMcpNamespace(value: string): string {
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');

    if (normalized.length === 0) return 'mcp';
    const identifier = /^[a-z_]/.test(normalized) ? normalized : `_${normalized}`;
    return identifier === 'then' ? '_then' : identifier;
}

export function isValidMcpNamespace(value: string): boolean {
    return value === normalizeMcpNamespace(value);
}

export function qualifyMcpToolName(namespace: string, toolName: string): string {
    return `${namespace}${MCP_TOOL_SEPARATOR}${toolName}`;
}

export function modelMcpToolName(qualifiedName: string): string {
    return `${MCP_MODEL_TOOL_PREFIX}${qualifiedName}`;
}

export function stripMcpModelToolPrefix(toolName: string): string | undefined {
    if (!toolName.startsWith(MCP_MODEL_TOOL_PREFIX)) return undefined;
    const qualifiedName = toolName.slice(MCP_MODEL_TOOL_PREFIX.length);
    return qualifiedName.length === 0 ? undefined : qualifiedName;
}

export function parseMcpModelToolName(
    toolName: string
): { namespace: string; toolName: string } | undefined {
    const qualifiedName = stripMcpModelToolPrefix(toolName);
    if (qualifiedName === undefined) return undefined;
    const separatorIndex = qualifiedName.indexOf(MCP_TOOL_SEPARATOR);
    if (separatorIndex <= 0) return undefined;
    const namespace = qualifiedName.slice(0, separatorIndex);
    const upstreamToolName = qualifiedName.slice(separatorIndex + MCP_TOOL_SEPARATOR.length);
    if (upstreamToolName.length === 0) return undefined;
    return { namespace, toolName: upstreamToolName };
}

import { existsSync, readFileSync, readdirSync } from 'fs';
import * as path from 'path';
import { ServersConfigSchema, type ValidatedServersConfig } from './schemas.js';

export interface LoadBundledMcpConfigOptions {
    scanNestedMcps?: boolean | undefined;
}

export interface LoadBundledMcpConfigResult {
    mcpServers?: ValidatedServersConfig | undefined;
    warnings: string[];
}

function normalizeServerEntries(
    servers: Record<string, unknown>,
    inferTransportType: boolean
): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    for (const [serverName, serverConfig] of Object.entries(servers)) {
        if (
            typeof serverConfig !== 'object' ||
            serverConfig === null ||
            Array.isArray(serverConfig)
        ) {
            continue;
        }

        const config = serverConfig as Record<string, unknown>;
        if ('type' in config || !inferTransportType) {
            normalized[serverName] = config;
        } else if ('command' in config) {
            normalized[serverName] = {
                type: 'stdio',
                ...config,
            };
        } else if ('url' in config) {
            const url = String(config.url || '');
            normalized[serverName] = {
                type: url.includes('/sse') ? 'sse' : 'http',
                ...config,
            };
        } else {
            normalized[serverName] = config;
        }
    }

    return normalized;
}

function normalizeParsedMcpServers(
    parsed: unknown,
    ownerName: string,
    sourceLabel: string,
    warnings: string[]
): Record<string, unknown> | undefined {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        warnings.push(`[${ownerName}] Invalid ${sourceLabel}: expected an object`);
        return undefined;
    }

    const parsedRecord = parsed as Record<string, unknown>;
    const candidate = parsedRecord.mcpServers;

    if (candidate !== undefined) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            warnings.push(`[${ownerName}] Invalid ${sourceLabel}: mcpServers must be an object`);
            return undefined;
        }
        return normalizeServerEntries(candidate as Record<string, unknown>, true);
    }

    if (
        Object.values(parsedRecord).some(
            (value) =>
                typeof value === 'object' &&
                value !== null &&
                !Array.isArray(value) &&
                ('type' in value || 'command' in value || 'url' in value)
        )
    ) {
        return normalizeServerEntries(parsedRecord, true);
    }

    warnings.push(`[${ownerName}] Invalid ${sourceLabel}: no MCP servers found`);
    return undefined;
}

function resolveSkillRelativeValue(bundleDirectory: string, value: string): string {
    if (value.length === 0 || path.isAbsolute(value)) {
        return value;
    }

    const candidate = path.resolve(bundleDirectory, value);
    return existsSync(candidate) ? candidate : value;
}

function resolveServerRelativePaths(
    bundleDirectory: string,
    serverConfig: Record<string, unknown>
): Record<string, unknown> {
    if (serverConfig.type !== 'stdio') {
        return serverConfig;
    }

    const resolvedConfig: Record<string, unknown> = { ...serverConfig };

    if (typeof resolvedConfig.command === 'string') {
        resolvedConfig.command = resolveSkillRelativeValue(bundleDirectory, resolvedConfig.command);
    }

    if (Array.isArray(resolvedConfig.args)) {
        resolvedConfig.args = resolvedConfig.args.map((arg) =>
            typeof arg === 'string' ? resolveSkillRelativeValue(bundleDirectory, arg) : arg
        );
    }

    return resolvedConfig;
}

function validateBundledMcpServers(
    bundleDirectory: string,
    parsedServers: Record<string, unknown>,
    ownerName: string,
    sourceLabel: string,
    warnings: string[]
): ValidatedServersConfig | undefined {
    const resolvedServers = Object.fromEntries(
        Object.entries(parsedServers).map(([serverName, serverConfig]) => {
            if (
                typeof serverConfig !== 'object' ||
                serverConfig === null ||
                Array.isArray(serverConfig)
            ) {
                return [serverName, serverConfig];
            }

            return [
                serverName,
                resolveServerRelativePaths(
                    bundleDirectory,
                    serverConfig as Record<string, unknown>
                ),
            ];
        })
    );

    const result = ServersConfigSchema.safeParse(resolvedServers);
    if (!result.success) {
        const issues = result.error.issues.map((issue) => issue.message).join(', ');
        warnings.push(`[${ownerName}] Invalid ${sourceLabel}: ${issues}`);
        return undefined;
    }

    return result.data;
}

function mergeBundledMcpServers(
    current: ValidatedServersConfig | undefined,
    incoming: ValidatedServersConfig | undefined
): ValidatedServersConfig | undefined {
    if (!incoming) {
        return current;
    }

    if (!current) {
        return incoming;
    }

    return {
        ...current,
        ...incoming,
    };
}

function loadBundledMcpConfigFile(
    filePath: string,
    bundleDirectory: string,
    ownerName: string,
    sourceLabel: string,
    warnings: string[]
): ValidatedServersConfig | undefined {
    if (!existsSync(filePath)) {
        return undefined;
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(content) as unknown;
        const parsedServers = normalizeParsedMcpServers(parsed, ownerName, sourceLabel, warnings);
        if (!parsedServers) {
            return undefined;
        }

        return validateBundledMcpServers(
            bundleDirectory,
            parsedServers,
            ownerName,
            sourceLabel,
            warnings
        );
    } catch (error) {
        if (error instanceof SyntaxError) {
            warnings.push(`[${ownerName}] Failed to parse ${sourceLabel}: invalid JSON`);
        } else {
            warnings.push(`[${ownerName}] Failed to load ${sourceLabel}: ${String(error)}`);
        }
        return undefined;
    }
}

export function loadBundledMcpConfigFromDirectory(
    bundleDirectory: string,
    ownerName: string,
    options: LoadBundledMcpConfigOptions = {}
): LoadBundledMcpConfigResult {
    const warnings: string[] = [];
    let mcpServers = loadBundledMcpConfigFile(
        path.join(bundleDirectory, '.mcp.json'),
        bundleDirectory,
        ownerName,
        '.mcp.json',
        warnings
    );

    if (options.scanNestedMcps) {
        const mcpsDirectory = path.join(bundleDirectory, 'mcps');
        if (existsSync(mcpsDirectory)) {
            try {
                const entries = readdirSync(mcpsDirectory, { withFileTypes: true })
                    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
                    .sort((left, right) => left.name.localeCompare(right.name));

                for (const entry of entries) {
                    const nestedServers = loadBundledMcpConfigFile(
                        path.join(mcpsDirectory, entry.name),
                        bundleDirectory,
                        ownerName,
                        `mcps/${entry.name}`,
                        warnings
                    );
                    mcpServers = mergeBundledMcpServers(mcpServers, nestedServers);
                }
            } catch (error) {
                warnings.push(`[${ownerName}] Failed to read mcps/: ${String(error)}`);
            }
        }
    }

    return {
        ...(mcpServers ? { mcpServers } : {}),
        warnings,
    };
}

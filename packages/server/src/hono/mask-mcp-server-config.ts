import type { ValidatedMcpServerConfig } from '@dexto/core';

export const REDACTED = '[REDACTED]';

function maskValues(values: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.keys(values).map((key) => [key, REDACTED]));
}

/** Keeps env and header names so a client can see what is set, but never their values. */
export function maskMcpServerConfig(config: ValidatedMcpServerConfig): ValidatedMcpServerConfig {
    if (config.type === 'stdio') {
        return { ...config, env: maskValues(config.env) };
    }
    return { ...config, headers: maskValues(config.headers) };
}

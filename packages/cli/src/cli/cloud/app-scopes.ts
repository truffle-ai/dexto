// Each workspace app's operations and the scopes each takes, from the MCP's published metadata,
// so a command can sign in for an operation the sign-in can't see yet.

import { z } from 'zod';
import type { CloudRuntime } from './runtime.js';

const ProtectedResourceSchema = z.object({
    /** Every scope each app's operations take; an older server publishes none. */
    dexto_app_scopes: z.record(z.string(), z.record(z.string(), z.array(z.string()))).optional(),
});

/** Each app's operations by tool or action name, with their scopes; empty from an older server. */
export async function readAppScopes(
    runtime: CloudRuntime,
    appUrl: string
): Promise<ReadonlyMap<string, Readonly<Record<string, readonly string[]>>>> {
    const url = `${appUrl.replace(/\/+$/u, '')}/.well-known/oauth-protected-resource/mcp`;
    const response = await runtime.fetch(url, {
        headers: { accept: 'application/json' },
        signal: runtime.signal,
    });
    if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}.`);
    const metadata = ProtectedResourceSchema.parse(await response.json());
    return new Map(Object.entries(metadata.dexto_app_scopes ?? {}));
}

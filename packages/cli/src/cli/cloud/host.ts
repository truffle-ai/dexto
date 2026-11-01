// The cloud commands on this machine: the sign-in under ~/.dexto/accounts and Dexto's public API.

import { dextoGateway } from '@dexto/agent-management';
import { getDextoGlobalPath } from '@dexto/core';
import type { Command } from './command.js';
import { apiCommands } from './commands/api.js';
import { dataDeletionCommands } from './commands/data-deletions.js';
import { modelCommands } from './commands/models.js';
import { projectCommands, projectsUse } from './commands/projects.js';
import { secretCommands } from './commands/secrets.js';
import { webCommands } from './commands/web.js';
import { resolveConnection } from './connection.js';
import type { CloudHost, Group } from './run.js';
import { nodeCloudRuntime } from './runtime.js';

/** Help's areas: what `dexto cloud` builds with. */
export const CLOUD_GROUPS: Readonly<Record<string, readonly Group[]>> = {
    cloud: [
        { name: 'projects', summary: 'List, create and choose Cloud projects' },
        { name: 'secrets', summary: 'Credentials agents use without seeing them' },
        { name: 'models', summary: 'Run text and media models, and see media runs' },
        { name: 'search', summary: 'Search the web' },
        { name: 'fetch', summary: 'Read web pages' },
        { name: 'data-deletions', summary: "Delete an end user's or agent's data" },
        { name: 'api', summary: 'Call any /v1 operation directly' },
    ],
};

/** Every ported cloud command; `dir` is where sign-ins are saved. */
export function cloudCommands(dir: string): readonly Command[] {
    return [
        ...projectCommands,
        projectsUse(dir),
        ...secretCommands,
        ...modelCommands,
        ...webCommands,
        ...dataDeletionCommands,
        ...apiCommands,
    ];
}

export function nodeCloudHost(signal: AbortSignal): CloudHost {
    const dir = getDextoGlobalPath('accounts');
    const runtime = nodeCloudRuntime(signal);
    const gateway = dextoGateway.defaultDextoGatewayOptions();
    return {
        commands: cloudCommands(dir),
        groups: CLOUD_GROUPS,
        runtime,
        resolveConnection: (overrides) =>
            resolveConnection({
                dir,
                environment: runtime.environment,
                overrides,
                refresh: gateway.refresh,
            }),
        signInForScope: async (overrides, scope) => {
            const [{ login }, { nodeSignInContext }] = await Promise.all([
                import('../commands/auth/sign-in-commands.js'),
                import('../commands/auth/sign-in-context.js'),
            ]);
            await login(await nodeSignInContext(), {
                profile: overrides.profile,
                org: null,
                device: false,
                browser: true,
                scopes: [scope],
                apiKey: null,
            });
            return true;
        },
    };
}

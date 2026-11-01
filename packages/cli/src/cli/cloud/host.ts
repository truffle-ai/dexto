// The cloud commands on this machine: the sign-in under ~/.dexto/accounts and Dexto's public API.

import { dextoGateway } from '@dexto/agent-management';
import { getDextoGlobalPath } from '@dexto/core';
import type { Command } from './command.js';
import { accountCommands, type SignInFor } from './commands/account.js';
import { agentCommands } from './commands/agents.js';
import { apiCommands } from './commands/api.js';
import { chatCommands } from './commands/chats.js';
import { automationCommands } from './commands/automations.js';
import { dataDeletionCommands } from './commands/data-deletions.js';
import { deployCommands } from './commands/deploys.js';
import { driveCommands } from './commands/drive.js';
import { findCommands } from './commands/find.js';
import { profileCommands } from './commands/profile.js';
import { publishCommands } from './commands/publish.js';
import { skillCommands } from './commands/skills.js';
import { fileCommands } from './commands/files.js';
import { modelCommands } from './commands/models.js';
import { projectCommands, projectsUse } from './commands/projects.js';
import { sandboxCommands } from './commands/sandboxes.js';
import { secretCommands } from './commands/secrets.js';
import { webCommands } from './commands/web.js';
import { workspaceCommands } from './commands/workspace.js';
import { resolveConnection } from './connection.js';
import type { CloudHost, Group } from './run.js';
import { nodeCloudRuntime } from './runtime.js';
import { DEXTO_CREDITS_URL } from '../auth/constants.js';

/** Help's areas: what `dexto cloud` builds with. */
export const CLOUD_GROUPS: Readonly<Record<string, readonly Group[]>> = {
    cloud: [
        { name: 'projects', summary: 'List, create and choose Cloud projects' },
        { name: 'agents', summary: 'Define agents, chat with them, read their sessions and runs' },
        { name: 'automations', summary: 'Run agents on a schedule or a webhook' },
        { name: 'files', summary: "Upload, download, share and delete the project's files" },
        { name: 'sandboxes', summary: 'Create sandboxes, run commands in them and move files' },
        { name: 'secrets', summary: 'Credentials agents use without seeing them' },
        { name: 'sites', summary: 'Deploy, list and delete Sites, packed with their own packer' },
        { name: 'functions', summary: 'Deploy and list Functions, packed with their own packer' },
        { name: 'models', summary: 'Run text and media models, and see media runs' },
        { name: 'search', summary: 'Search the web' },
        { name: 'fetch', summary: 'Read web pages' },
        { name: 'data-deletions', summary: "Delete an end user's or agent's data" },
        { name: 'api', summary: 'Call any /v1 operation directly' },
    ],
};

/** Every ported cloud command; `dir` is where sign-ins are saved. */
export function cloudCommands(dir: string, signIn: SignInFor): readonly Command[] {
    return [
        ...accountCommands(signIn, DEXTO_CREDITS_URL),
        ...projectCommands,
        projectsUse(dir),
        ...agentCommands,
        ...automationCommands,
        ...fileCommands,
        ...sandboxCommands,
        ...secretCommands,
        ...deployCommands,
        ...modelCommands,
        ...webCommands,
        ...dataDeletionCommands,
        ...apiCommands,
        ...workspaceCommands,
        ...driveCommands,
        ...findCommands,
        ...profileCommands,
        ...publishCommands,
        ...skillCommands,
        ...chatCommands,
    ];
}

export function nodeCloudHost(signal: AbortSignal): CloudHost {
    const dir = getDextoGlobalPath('accounts');
    const runtime = nodeCloudRuntime(signal);
    const gateway = dextoGateway.defaultDextoGatewayOptions();
    const signIn: SignInFor = async (io) =>
        (await import('../commands/auth/sign-in-context.js')).nodeSignInContext(io);
    return {
        commands: cloudCommands(dir, signIn),
        signIn,
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
            const { login } = await import('../commands/auth/sign-in-commands.js');
            // The sign-in's own words go to stderr: stdout is the command that runs again.
            const toStderr = (text: string) => runtime.writeError(`${text}\n`);
            await login(
                await signIn({
                    result: (_value, text) => toStderr(text),
                    note: toStderr,
                    confirm: async () => false,
                    signal,
                }),
                {
                    profile: overrides.profile,
                    org: null,
                    device: false,
                    browser: true,
                    scopes: [scope],
                    apiKey: null,
                }
            );
            return true;
        },
    };
}

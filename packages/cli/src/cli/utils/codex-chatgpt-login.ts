import { promises as fs } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import * as p from '@clack/prompts';
import open from 'open';
import { getDextoGlobalPath } from '@dexto/agent-management';
import { CodexAppServerClient } from '@dexto/core';

import { executeCommand } from './self-management.js';

const OPENAI_CODEX_PACKAGE = '@openai/codex';
const DEXTO_DEPS_PACKAGE_JSON = {
    name: 'dexto-deps',
    version: '1.0.0',
    private: true,
    description: 'Managed dependencies for Dexto',
};

export type CodexAccountState = Awaited<ReturnType<CodexAppServerClient['readAccount']>>;

type CodexInstaller = {
    command: string;
    args: string[];
    label: string;
};

async function ensureDextoDepsPackageJson(): Promise<string> {
    const depsDir = getDextoGlobalPath('deps');
    await fs.mkdir(depsDir, { recursive: true });

    const packageJsonPath = path.join(depsDir, 'package.json');
    try {
        await fs.access(packageJsonPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }

        await fs.writeFile(
            packageJsonPath,
            JSON.stringify(DEXTO_DEPS_PACKAGE_JSON, null, 2),
            'utf-8'
        );
    }

    return depsDir;
}

export function isMissingCodexCliError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false;
    }

    const code = (error as NodeJS.ErrnoException).code;
    return (
        error.message.includes('Codex CLI not found on PATH') ||
        error.message.includes('spawn codex ENOENT') ||
        (code === 'ENOENT' && error.message.includes('spawn'))
    );
}

export function getCodexLoginErrorMessage(error: unknown): string {
    if (isMissingCodexCliError(error)) {
        return 'Codex CLI not found on PATH. Install Codex to use ChatGPT Login in Dexto.';
    }

    return error instanceof Error ? error.message : String(error);
}

async function resolveCodexInstaller(): Promise<CodexInstaller | null> {
    const candidates: CodexInstaller[] = [
        {
            command: 'npm',
            args: ['install', OPENAI_CODEX_PACKAGE, '--no-audit', '--no-fund'],
            label: 'npm',
        },
        {
            command: 'pnpm',
            args: ['add', OPENAI_CODEX_PACKAGE],
            label: 'pnpm',
        },
        {
            command: 'bun',
            args: ['add', OPENAI_CODEX_PACKAGE],
            label: 'bun',
        },
    ];

    for (const candidate of candidates) {
        const probe = await executeCommand(candidate.command, ['--version']);
        if (probe.code === 0) {
            return candidate;
        }
    }

    return null;
}

function getCodexInstallerFailureMessage(
    installer: CodexInstaller,
    result: { stdout: string; stderr: string }
): string {
    const details = `${result.stderr}\n${result.stdout}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const lastLine = details.at(-1);

    return lastLine
        ? `Failed to install the OpenAI Codex CLI via ${installer.label}: ${lastLine}`
        : `Failed to install the OpenAI Codex CLI via ${installer.label}.`;
}

async function installManagedCodexCli(): Promise<void> {
    const depsDir = await ensureDextoDepsPackageJson();
    const installer = await resolveCodexInstaller();
    if (!installer) {
        throw new Error(
            'Could not find npm, pnpm, or bun to install the OpenAI Codex CLI automatically.'
        );
    }

    const result = await executeCommand(installer.command, installer.args, { cwd: depsDir });
    if (result.code !== 0) {
        throw new Error(getCodexInstallerFailureMessage(installer, result));
    }
}

export async function createCodexClientForChatGptLogin(): Promise<CodexAppServerClient> {
    try {
        return await CodexAppServerClient.create();
    } catch (error) {
        if (!isMissingCodexCliError(error)) {
            throw error;
        }

        const spinner = p.spinner();
        spinner.start('Installing OpenAI Codex CLI...');

        try {
            await installManagedCodexCli();
            spinner.stop('OpenAI Codex CLI installed');
        } catch (installError) {
            spinner.stop('OpenAI Codex CLI installation failed');
            throw installError;
        }

        return await CodexAppServerClient.create();
    }
}

async function ensureCodexChatGptLogin(client: CodexAppServerClient): Promise<CodexAccountState> {
    const spinner = p.spinner();
    spinner.start('Starting ChatGPT login with Codex...');

    const login = await client.startLogin({ type: 'chatgpt' });
    if (login.type !== 'chatgpt') {
        spinner.stop('ChatGPT login failed');
        throw new Error('Codex did not return a ChatGPT login URL');
    }

    spinner.stop('ChatGPT login ready');

    try {
        await open(login.authUrl);
        p.log.success('Opened your browser for ChatGPT login');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.log.warn(`Could not open browser automatically: ${errorMessage}`);
    }

    p.note(
        `Finish the ChatGPT login in your browser.\n\n${chalk.dim(login.authUrl)}`,
        'ChatGPT Login'
    );

    const waitSpinner = p.spinner();
    waitSpinner.start('Waiting for ChatGPT login to complete...');
    const completed = await client.waitForLoginCompleted(login.loginId, {
        timeoutMs: 5 * 60 * 1000,
    });

    if (!completed.success) {
        waitSpinner.stop('ChatGPT login failed');
        throw new Error(completed.error ?? 'Codex ChatGPT login failed');
    }

    waitSpinner.stop('ChatGPT login complete');
    return await client.readAccount(true);
}

export async function ensureCodexChatGptSession(
    client: CodexAppServerClient
): Promise<CodexAccountState | null> {
    const current = await client.readAccount(false);
    if (current.account?.type === 'chatgpt') {
        return current;
    }

    if (current.account) {
        const shouldSwitch = await p.confirm({
            message: 'Codex is currently using OpenAI API key. Switch to ChatGPT login?',
            initialValue: true,
        });

        if (p.isCancel(shouldSwitch) || !shouldSwitch) {
            return null;
        }

        await client.logout();
    }

    return await ensureCodexChatGptLogin(client);
}

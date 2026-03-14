import { existsSync } from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { confirmOrExit, selectOrExit, textOrExit } from '../../utils/prompt-helpers.js';
import {
    createDefaultDeployConfig,
    getDeployConfigPath,
    loadDeployConfig,
    normalizeWorkspaceRelativePath,
    resolveDeployEntryAgentPath,
    saveDeployConfig,
    type DeployConfig,
} from './config.js';
import { createDeployClient } from './client.js';
import { discoverEntryAgentCandidates, isAgentYamlPath } from './entry-agent.js';
import {
    loadWorkspaceDeployLink,
    removeWorkspaceDeployLink,
    saveWorkspaceDeployLink,
} from './state.js';
import { createWorkspaceSnapshot } from './snapshot.js';

interface InteractiveOptions {
    interactive?: boolean;
}

function isInteractive(options?: InteractiveOptions): boolean {
    return options?.interactive !== false;
}

async function promptForEntryAgent(workspaceRoot: string): Promise<string> {
    const discoveredCandidates = await discoverEntryAgentCandidates(workspaceRoot);
    if (discoveredCandidates.length === 1) {
        return discoveredCandidates[0]!;
    }

    if (discoveredCandidates.length > 1) {
        return selectOrExit<string>(
            {
                message: 'Select the agent config to boot in cloud',
                options: discoveredCandidates.map((candidate) => ({
                    value: candidate,
                    label: candidate,
                    hint: candidate,
                })),
            },
            'Deployment cancelled'
        );
    }

    const value = await textOrExit(
        {
            message: 'Enter the repo-relative path to the agent config',
            placeholder: 'agents/reviewer/reviewer.yml',
            validate(input) {
                try {
                    const relativePath = normalizeWorkspaceRelativePath(input);
                    if (!isAgentYamlPath(relativePath)) {
                        return 'Agent config must be a .yml or .yaml file';
                    }
                    const absolutePath = path.resolve(workspaceRoot, relativePath);
                    if (!existsSync(absolutePath)) {
                        return `File not found: ${relativePath}`;
                    }
                    return;
                } catch (error) {
                    return error instanceof Error ? error.message : 'Invalid path';
                }
            },
        },
        'Deployment cancelled'
    );

    return normalizeWorkspaceRelativePath(value);
}

async function resolveDeployConfig(
    workspaceRoot: string,
    options?: InteractiveOptions
): Promise<DeployConfig> {
    const existingConfig = await loadDeployConfig(workspaceRoot);
    if (existingConfig) {
        return existingConfig;
    }

    if (!isInteractive(options)) {
        const configPath = path.relative(workspaceRoot, getDeployConfigPath(workspaceRoot));
        throw new Error(
            `No deploy config found at ${configPath}. Run \`dexto deploy\` interactively once to create it.`
        );
    }

    const entryAgent = await promptForEntryAgent(workspaceRoot);
    const nextConfig = createDefaultDeployConfig(entryAgent);
    await saveDeployConfig(workspaceRoot, nextConfig);
    p.note(
        `${nextConfig.entryAgent}\n${path.relative(workspaceRoot, getDeployConfigPath(workspaceRoot))}`,
        'Saved deploy config'
    );
    return nextConfig;
}

function ensureEntryAgentExists(workspaceRoot: string, config: DeployConfig): string {
    const entryAgentPath = resolveDeployEntryAgentPath(workspaceRoot, config.entryAgent);
    if (!existsSync(entryAgentPath)) {
        throw new Error(
            `Entry agent not found: ${config.entryAgent}. Update ${path.relative(
                workspaceRoot,
                getDeployConfigPath(workspaceRoot)
            )} before deploying.`
        );
    }
    if (!isAgentYamlPath(config.entryAgent)) {
        throw new Error(`Entry agent must be a .yml or .yaml file: ${config.entryAgent}`);
    }
    return entryAgentPath;
}

export async function handleDeployCommand(options?: InteractiveOptions): Promise<void> {
    p.intro(chalk.inverse('Deploy Workspace'));

    const workspaceRoot = process.cwd();
    const deployConfig = await resolveDeployConfig(workspaceRoot, options);
    ensureEntryAgentExists(workspaceRoot, deployConfig);

    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    const spinner = p.spinner();
    const client = createDeployClient();

    spinner.start('Packaging workspace snapshot...');
    const snapshot = await createWorkspaceSnapshot({
        workspaceRoot,
        entryAgent: deployConfig.entryAgent,
        exclude: deployConfig.exclude,
    });

    try {
        spinner.message('Uploading workspace and provisioning sandbox...');
        const deployed = await client.deployWorkspace({
            entryAgent: deployConfig.entryAgent,
            snapshotPath: snapshot.archivePath,
            ...(deployLink?.cloudAgentId ? { cloudAgentId: deployLink.cloudAgentId } : {}),
        });

        await saveWorkspaceDeployLink(workspaceRoot, {
            cloudAgentId: deployed.cloudAgentId,
            agentUrl: deployed.agentUrl,
        });

        spinner.stop(chalk.green('✓ Workspace deployed'));
        p.outro(
            [
                `Cloud agent: ${deployed.cloudAgentId}`,
                `Status: ${deployed.state.status}`,
                `Agent URL: ${deployed.agentUrl}`,
            ].join('\n')
        );
    } catch (error) {
        spinner.stop(chalk.red('✗ Deploy failed'));
        throw error;
    } finally {
        await snapshot.cleanup();
    }
}

export async function handleDeployStatusCommand(): Promise<void> {
    const workspaceRoot = process.cwd();
    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    if (!deployLink) {
        throw new Error(
            'This workspace is not linked to a cloud deployment yet. Run `dexto deploy` first.'
        );
    }

    const client = createDeployClient();
    const status = await client.getCloudAgent(deployLink.cloudAgentId);
    p.outro(
        [
            `Cloud agent: ${status.cloudAgentId}`,
            `Status: ${status.state.status}`,
            `Agent URL: ${status.agentUrl}`,
            `Stale: ${status.stale ? 'yes' : 'no'}`,
        ].join('\n')
    );
}

export async function handleDeployStopCommand(): Promise<void> {
    const workspaceRoot = process.cwd();
    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    if (!deployLink) {
        throw new Error(
            'This workspace is not linked to a cloud deployment yet. Run `dexto deploy` first.'
        );
    }

    const spinner = p.spinner();
    spinner.start('Stopping cloud sandbox...');

    try {
        const client = createDeployClient();
        const result = await client.stopCloudAgent(deployLink.cloudAgentId);
        spinner.stop(chalk.green('✓ Cloud sandbox stopped'));
        p.outro(
            [
                `Cloud agent: ${result.cloudAgentId}`,
                `Stopped: ${result.stopped ? 'yes' : 'no'}`,
                `Already stopped: ${result.alreadyStopped ? 'yes' : 'no'}`,
                `Snapshot status: ${result.snapshotStatus}`,
            ].join('\n')
        );
    } catch (error) {
        spinner.stop(chalk.red('✗ Stop failed'));
        throw error;
    }
}

export async function handleDeployDeleteCommand(options?: InteractiveOptions): Promise<void> {
    const workspaceRoot = process.cwd();
    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    if (!deployLink) {
        throw new Error(
            'This workspace is not linked to a cloud deployment yet. Run `dexto deploy` first.'
        );
    }

    if (isInteractive(options)) {
        const confirmed = await confirmOrExit(
            {
                message: `Delete cloud deployment ${deployLink.cloudAgentId}?`,
                initialValue: false,
            },
            'Delete cancelled'
        );
        if (!confirmed) {
            p.cancel('Delete cancelled');
            return;
        }
    }

    const spinner = p.spinner();
    spinner.start('Deleting cloud deployment...');

    try {
        const client = createDeployClient();
        const result = await client.deleteCloudAgent(deployLink.cloudAgentId);
        await removeWorkspaceDeployLink(workspaceRoot);
        spinner.stop(chalk.green('✓ Cloud deployment deleted'));
        p.outro(`Deleted ${result.cloudAgentId}`);
    } catch (error) {
        spinner.stop(chalk.red('✗ Delete failed'));
        throw error;
    }
}

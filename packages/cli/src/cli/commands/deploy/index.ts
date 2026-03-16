import { existsSync } from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { confirmOrExit } from '../../utils/prompt-helpers.js';
import {
    createCloudDefaultDeployConfig,
    createWorkspaceDeployConfig,
    getDeployConfigPath,
    isWorkspaceDeployAgent,
    loadDeployConfig,
    resolveWorkspaceDeployAgentPath,
    saveDeployConfig,
    type DeployConfig,
} from './config.js';
import { createDeployClient } from './client.js';
import { discoverPrimaryWorkspaceAgent, isAgentYamlPath } from './entry-agent.js';
import { getCloudAgentDashboardUrl } from './links.js';
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

function describeDeployAgent(config: DeployConfig): string {
    if (isWorkspaceDeployAgent(config.agent)) {
        return `workspace agent (${config.agent.path})`;
    }
    return 'default cloud agent';
}

function formatCloudAgentSummary(input: {
    cloudAgentId: string;
    status: string;
    agentUrl: string;
}): string {
    return [
        `Cloud agent: ${input.cloudAgentId}`,
        `Status: ${input.status}`,
        `Agent URL: ${input.agentUrl}`,
        `Dashboard: ${getCloudAgentDashboardUrl(input.cloudAgentId)}`,
    ].join('\n');
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function resolveDeployConfig(workspaceRoot: string): Promise<DeployConfig> {
    const existingConfig = await loadDeployConfig(workspaceRoot);
    if (existingConfig) {
        return existingConfig;
    }

    const primaryWorkspaceAgent = await discoverPrimaryWorkspaceAgent(workspaceRoot);
    const nextConfig = primaryWorkspaceAgent
        ? createWorkspaceDeployConfig(primaryWorkspaceAgent)
        : createCloudDefaultDeployConfig();
    await saveDeployConfig(workspaceRoot, nextConfig);
    p.note(
        `${describeDeployAgent(nextConfig)}\n${path.relative(workspaceRoot, getDeployConfigPath(workspaceRoot))}`,
        'Saved deploy config'
    );
    return nextConfig;
}

function ensureWorkspaceAgentExists(workspaceRoot: string, config: DeployConfig): string | null {
    if (!isWorkspaceDeployAgent(config.agent)) {
        return null;
    }

    const entryAgentPath = resolveWorkspaceDeployAgentPath(workspaceRoot, config.agent.path);
    if (!existsSync(entryAgentPath)) {
        throw new Error(
            `Workspace agent not found: ${config.agent.path}. Update ${path.relative(
                workspaceRoot,
                getDeployConfigPath(workspaceRoot)
            )} before deploying.`
        );
    }
    if (!isAgentYamlPath(config.agent.path)) {
        throw new Error(`Workspace agent must be a .yml or .yaml file: ${config.agent.path}`);
    }
    return entryAgentPath;
}

export async function handleDeployCommand(options?: InteractiveOptions): Promise<void> {
    void options;
    p.intro(chalk.inverse('Deploy Workspace'));

    const workspaceRoot = process.cwd();
    const deployConfig = await resolveDeployConfig(workspaceRoot);
    ensureWorkspaceAgentExists(workspaceRoot, deployConfig);

    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    const spinner = p.spinner();
    const client = createDeployClient();
    const workspaceSnapshotInput = isWorkspaceDeployAgent(deployConfig.agent)
        ? {
              workspaceRoot,
              workspaceAgentPath: deployConfig.agent.path,
              exclude: deployConfig.exclude,
          }
        : {
              workspaceRoot,
              exclude: deployConfig.exclude,
          };
    let snapshot: Awaited<ReturnType<typeof createWorkspaceSnapshot>> | null = null;

    try {
        spinner.start('Packaging workspace snapshot...');
        snapshot = await createWorkspaceSnapshot({
            ...workspaceSnapshotInput,
        });
        spinner.message('Uploading workspace and provisioning sandbox...');
        const deployed = await client.deployWorkspace({
            agent: deployConfig.agent,
            snapshotPath: snapshot.archivePath,
            ...(deployLink?.cloudAgentId ? { cloudAgentId: deployLink.cloudAgentId } : {}),
        });
        let linkSyncError: unknown = null;
        try {
            await saveWorkspaceDeployLink(workspaceRoot, {
                cloudAgentId: deployed.cloudAgentId,
                agentUrl: deployed.agentUrl,
            });
        } catch (error) {
            linkSyncError = error;
        }

        spinner.stop(chalk.green('✓ Workspace deployed'));
        p.outro(
            [
                formatCloudAgentSummary({
                    cloudAgentId: deployed.cloudAgentId,
                    status: deployed.state.status,
                    agentUrl: deployed.agentUrl,
                }),
                ...(linkSyncError
                    ? [
                          '',
                          `Warning: deployment succeeded, but failed to save local link state (${getErrorMessage(
                              linkSyncError
                          )})`,
                          'Run `dexto deploy` again in this workspace to re-link.',
                      ]
                    : []),
                '',
                'Next steps:',
                `- Open the dashboard to inspect and interact with the deployment`,
                `- Run \`dexto deploy status\` from this workspace`,
            ].join('\n')
        );
    } catch (error) {
        spinner.stop(chalk.red('✗ Deploy failed'));
        throw error;
    } finally {
        if (snapshot) {
            await snapshot.cleanup();
        }
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
        formatCloudAgentSummary({
            cloudAgentId: status.cloudAgentId,
            status: status.state.status,
            agentUrl: status.agentUrl,
        })
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
        await confirmOrExit(
            {
                message: `Delete cloud deployment ${deployLink.cloudAgentId}?`,
                initialValue: false,
            },
            'Delete cancelled'
        );
    }

    const spinner = p.spinner();
    spinner.start('Deleting cloud deployment...');

    try {
        const client = createDeployClient();
        const result = await client.deleteCloudAgent(deployLink.cloudAgentId);
        let linkRemoveError: unknown = null;
        try {
            await removeWorkspaceDeployLink(workspaceRoot);
        } catch (error) {
            linkRemoveError = error;
        }
        spinner.stop(chalk.green('✓ Cloud deployment deleted'));
        p.outro(
            linkRemoveError
                ? `Deleted ${result.cloudAgentId}\nWarning: failed to remove local deploy link state (${getErrorMessage(
                      linkRemoveError
                  )})`
                : `Deleted ${result.cloudAgentId}`
        );
    } catch (error) {
        spinner.stop(chalk.red('✗ Delete failed'));
        throw error;
    }
}

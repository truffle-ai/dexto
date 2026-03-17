import { existsSync } from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import { findDextoProjectRoot, loadAgentConfig } from '@dexto/agent-management';
import chalk from 'chalk';
import open from 'open';
import { confirmOrExit } from '../../utils/prompt-helpers.js';
import { validateAgentConfig } from '../../utils/config-validation.js';
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
import { createDeployClient, type CloudAgentListItemResult } from './client.js';
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

function formatCloudAgentStatus(status: string): string {
    switch (status) {
        case 'ready':
            return chalk.green(status);
        case 'stopped':
            return chalk.yellow(status);
        case 'failed':
        case 'deleted':
            return chalk.red(status);
        default:
            return chalk.cyan(status);
    }
}

function formatCloudAgentListItem(
    cloudAgent: CloudAgentListItemResult,
    linkedToWorkspace: boolean
): string {
    const prefix = linkedToWorkspace ? chalk.green('→') : ' ';
    const trimmedName = cloudAgent.name?.trim();
    const heading =
        trimmedName && trimmedName !== cloudAgent.cloudAgentId
            ? `${chalk.cyan(trimmedName)} ${chalk.gray(`(${cloudAgent.cloudAgentId})`)}`
            : chalk.cyan(cloudAgent.cloudAgentId);
    const status = `${chalk.gray('[')}${formatCloudAgentStatus(cloudAgent.state.status)}${chalk.gray(']')}`;
    const lines = [`${prefix} ${heading} ${status}`];
    if (linkedToWorkspace) {
        lines.push(`  ${chalk.green('Linked to this workspace')}`);
    }
    return lines.join('\n');
}

function resolveWorkspaceRoot(): string {
    return findDextoProjectRoot(process.cwd()) ?? process.cwd();
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

async function validateWorkspaceAgent(
    entryAgentPath: string,
    workspaceAgentPath: string
): Promise<void> {
    const config = await loadAgentConfig(entryAgentPath);
    const validation = await validateAgentConfig(config, false, {
        agentPath: workspaceAgentPath,
        credentialPolicy: 'error',
    });

    if (!validation.success) {
        throw new Error(
            `Workspace agent validation failed for ${workspaceAgentPath}. Fix the issues above before deploying.`
        );
    }
}

export async function handleDeployCommand(options?: InteractiveOptions): Promise<void> {
    void options;
    p.intro(chalk.inverse('Deploy Workspace'));

    const workspaceRoot = resolveWorkspaceRoot();
    const deployConfig = await resolveDeployConfig(workspaceRoot);
    const entryAgentPath = ensureWorkspaceAgentExists(workspaceRoot, deployConfig);
    if (entryAgentPath && isWorkspaceDeployAgent(deployConfig.agent)) {
        await validateWorkspaceAgent(entryAgentPath, deployConfig.agent.path);
    }

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

export async function handleDeployListCommand(): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot();
    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    const client = createDeployClient();
    const cloudAgents = await client.listCloudAgents();

    if (cloudAgents.length === 0) {
        p.outro(
            'No cloud deployments found.\nRun `dexto deploy` from this workspace to create one.'
        );
        return;
    }

    const linkedCloudAgentId = deployLink?.cloudAgentId ?? null;
    const sortedCloudAgents = [...cloudAgents].sort((left, right) => {
        if (left.cloudAgentId === linkedCloudAgentId && right.cloudAgentId !== linkedCloudAgentId) {
            return -1;
        }
        if (right.cloudAgentId === linkedCloudAgentId && left.cloudAgentId !== linkedCloudAgentId) {
            return 1;
        }
        return 0;
    });
    const linkedVisible =
        linkedCloudAgentId !== null &&
        sortedCloudAgents.some((cloudAgent) => cloudAgent.cloudAgentId === linkedCloudAgentId);

    const lines = [
        'Cloud deployments',
        '',
        ...sortedCloudAgents.flatMap((cloudAgent, index) => {
            const entry = formatCloudAgentListItem(
                cloudAgent,
                cloudAgent.cloudAgentId === linkedCloudAgentId
            );
            return index === 0 ? [entry] : ['', entry];
        }),
    ];

    if (linkedCloudAgentId && !linkedVisible) {
        lines.push(
            '',
            chalk.yellow(
                `This workspace is linked to ${linkedCloudAgentId}, but that deployment was not returned by the cloud API.`
            )
        );
    }

    p.outro(lines.join('\n'));
}

export async function handleDeployOpenCommand(): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot();
    const deployLink = await loadWorkspaceDeployLink(workspaceRoot);
    if (!deployLink) {
        throw new Error(
            'This workspace is not linked to a cloud deployment yet. Run `dexto deploy` first.'
        );
    }

    const dashboardUrl = getCloudAgentDashboardUrl(deployLink.cloudAgentId);
    try {
        await open(dashboardUrl);
        p.outro(`Opened dashboard for ${deployLink.cloudAgentId}\n${dashboardUrl}`);
    } catch (error) {
        p.outro(
            [
                `Unable to open the dashboard automatically (${getErrorMessage(error)})`,
                dashboardUrl,
            ].join('\n')
        );
    }
}

export async function handleDeployStatusCommand(): Promise<void> {
    const workspaceRoot = resolveWorkspaceRoot();
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
    const workspaceRoot = resolveWorkspaceRoot();
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
    const workspaceRoot = resolveWorkspaceRoot();
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

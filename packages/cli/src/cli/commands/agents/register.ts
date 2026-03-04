import type { Command } from 'commander';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { InstallCommandOptions } from '../install.js';
import type { UninstallCommandOptions } from '../uninstall.js';
import type { ListAgentsCommandOptionsInput } from '../list-agents.js';
import type { SyncAgentsCommandOptions } from '../sync-agents.js';

export interface AgentsCommandRegisterContext {
    program: Command;
}

export function registerAgentsCommand({ program }: AgentsCommandRegisterContext): void {
    const agentsCommand = program.command('agents').description('Manage agents');

    agentsCommand
        .command('install [agents...]')
        .description('Install agents from registry or custom YAML files/directories')
        .option('--all', 'Install all available agents from registry')
        .option(
            '--no-inject-preferences',
            'Skip injecting global preferences into installed agents'
        )
        .option('--force', 'Force reinstall even if agent is already installed')
        .addHelpText(
            'after',
            `
Examples:
  $ dexto agents install coding-agent               Install agent from registry
  $ dexto agents install agent1 agent2              Install multiple registry agents
  $ dexto agents install --all                      Install all available registry agents
  $ dexto agents install ./my-agent.yml             Install custom agent from YAML file
  $ dexto agents install ./my-agent-dir/            Install custom agent from directory (interactive)`
        )
        .action(
            withAnalytics(
                'agents install',
                async (agents: string[] = [], options: Partial<InstallCommandOptions>) => {
                    try {
                        const { handleInstallCommand } = await import('../install.js');
                        await handleInstallCommand(agents, options);
                        safeExit('agents install', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto agents install command failed: ${err}`);
                        safeExit('agents install', 1, 'error');
                    }
                }
            )
        );

    agentsCommand
        .command('uninstall [agents...]')
        .description('Uninstall agents from the local installation')
        .option('--all', 'Uninstall all installed agents')
        .option('--force', 'Force uninstall even if agent is protected (e.g., coding-agent)')
        .action(
            withAnalytics(
                'agents uninstall',
                async (agents: string[], options: Partial<UninstallCommandOptions>) => {
                    try {
                        const { handleUninstallCommand } = await import('../uninstall.js');
                        await handleUninstallCommand(agents, options);
                        safeExit('agents uninstall', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto agents uninstall command failed: ${err}`);
                        safeExit('agents uninstall', 1, 'error');
                    }
                }
            )
        );

    agentsCommand
        .command('list')
        .description('List available and installed agents')
        .option('--verbose', 'Show detailed agent information')
        .option('--installed', 'Show only installed agents')
        .option('--available', 'Show only available agents')
        .action(
            withAnalytics('agents list', async (options: ListAgentsCommandOptionsInput) => {
                try {
                    const { handleListAgentsCommand } = await import('../list-agents.js');
                    await handleListAgentsCommand(options);
                    safeExit('agents list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto agents list command failed: ${err}`);
                    safeExit('agents list', 1, 'error');
                }
            })
        );

    agentsCommand
        .command('sync')
        .description('Sync installed agents with bundled versions')
        .option('--list', 'List agent status without updating')
        .option('--force', 'Update all agents without prompting')
        .action(
            withAnalytics('agents sync', async (options: Partial<SyncAgentsCommandOptions>) => {
                try {
                    const { handleSyncAgentsCommand } = await import('../sync-agents.js');
                    await handleSyncAgentsCommand(options);
                    safeExit('agents sync', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto agents sync command failed: ${err}`);
                    safeExit('agents sync', 1, 'error');
                }
            })
        );
}

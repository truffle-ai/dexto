import type { Command } from 'commander';
import { withAnalytics, safeExit } from '../../../analytics/wrapper.js';
import type { CloudDiscoveryCommand, CloudDiscoveryOptions } from './discovery.js';

async function discover(
    command: CloudDiscoveryCommand,
    options: CloudDiscoveryOptions
): Promise<void> {
    const { runCloudDiscovery } = await import('./discovery.js');
    const exitCode = await runCloudDiscovery(command, options);
    safeExit(`cloud ${command.command}`, exitCode);
}

export function registerCloudCommand(program: Command): void {
    const cloud = program.command('cloud').description('Discover Dexto Cloud capabilities');
    const sources = cloud.command('sources').description('List available capability sources');
    const search = cloud.command('search <query>').description('Find capabilities by name or task');
    const describe = cloud
        .command('describe <path>')
        .description('Show capability schemas and availability');
    for (const command of [sources, search, describe]) {
        command
            .option('--json', 'Emit machine-readable JSON')
            .option('--platform-url <origin>', 'Use a Cloud application origin');
    }
    for (const command of [sources, search]) {
        command
            .option('--limit <count>', 'Page size (1–100; default 20)')
            .option('--offset <count>', 'Page offset (default 0)');
    }
    sources.action(
        withAnalytics('cloud sources', (options: CloudDiscoveryOptions) =>
            discover({ command: 'sources' }, options)
        )
    );
    search.action(
        withAnalytics('cloud search', (query: string, options: CloudDiscoveryOptions) =>
            discover({ command: 'search', query }, options)
        )
    );
    describe.action(
        withAnalytics('cloud describe', (path: string, options: CloudDiscoveryOptions) =>
            discover({ command: 'describe', path }, options)
        )
    );
}

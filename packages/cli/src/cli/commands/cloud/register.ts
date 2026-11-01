import type { Command } from 'commander';
import { withAnalytics, safeExit } from '../../../analytics/wrapper.js';

/**
 * `dexto cloud …` runs on the cloud command engine, which reads its own arguments and global
 * options (--json, --api-key, --profile, --project). Analytics records only the command name, never
 * its arguments, which can hold a key.
 */
export function registerCloudCommand(program: Command): void {
    program
        .command('cloud')
        .description('Build in Dexto Cloud: projects, agents, files, sandboxes and more')
        .helpOption(false)
        .passThroughOptions()
        .allowUnknownOption()
        .allowExcessArguments()
        .argument('[args...]')
        .action(async (args: string[]) => {
            await withAnalytics('cloud', async () => {
                const [{ runCloud }, { nodeCloudHost }] = await Promise.all([
                    import('../../cloud/run.js'),
                    import('../../cloud/host.js'),
                ]);
                const code = await runCloud(nodeCloudHost(new AbortController().signal), [
                    'cloud',
                    ...args,
                ]);
                safeExit('cloud', code);
            })();
        });
}

import type { Command } from 'commander';
import { withAnalytics, safeExit } from '../../../analytics/wrapper.js';

/** The top-level words the cloud command engine owns, and what each is for. */
const ENGINE_WORDS = {
    login: 'Sign in to Dexto with your browser or a device code, or save an API key for CI',
    logout: 'End the sign-in on the server and forget it here',
    whoami: 'Show who Dexto commands act as',
    accounts: 'List, switch and remove saved sign-ins, one per account and organization',
    models: 'Models Dexto serves on your sign-in',
    billing: "Show the organization's credit balance and recent spending",
    cloud: 'Build in Dexto Cloud: projects, agents, files, sandboxes and more',
    workspace: 'Use your Dexto workspace as yourself: its apps and tools, over the Dexto MCP',
    find: 'Find the command for something you want to do in Dexto',
    publish: 'Publish a file, folder or .zip as a link anyone with it can open',
    profile: 'Show and change your Dexto profile: handle, name, bio and who can see it',
    skills: 'Push a local Skill folder into your Dexto Skills library',
} as const;

/**
 * These words run on the cloud command engine, which reads its own arguments and global options
 * (--json, --api-key, --profile, --project). Analytics records only the command name, never its
 * arguments, which can hold a key.
 */
export function registerCloudCommand(program: Command): void {
    for (const [word, description] of Object.entries(ENGINE_WORDS))
        program
            .command(word)
            .description(description)
            .helpOption(false)
            .passThroughOptions()
            .allowUnknownOption()
            .allowExcessArguments()
            .argument('[args...]')
            .action(async (args: string[]) => {
                await withAnalytics(word, async () => {
                    const [{ runCloud }, { nodeCloudHost }] = await Promise.all([
                        import('../../cloud/run.js'),
                        import('../../cloud/host.js'),
                    ]);
                    const code = await runCloud(nodeCloudHost(new AbortController().signal), [
                        word,
                        ...args,
                    ]);
                    safeExit(word, code);
                })();
            });
}

import type { Command } from 'commander';
import { withAnalytics, safeExit } from '../../../analytics/wrapper.js';

/** The top-level words the cloud command engine owns, and what each is for. */
export const ENGINE_WORDS = {
    applications: 'Inspect your managed Applications, their releases and release logs',
    artifacts: 'Publish, list and open organization Artifacts',
    autobots: 'List your AutoBots, see their status, and save, publish and talk to them',
    import: 'Import local Claude Code and Codex chats',
    connect: 'Sign in to a Claude or Codex subscription in Dexto Cloud',
    channels: 'List and read your Dexto channels, and send messages to them',
    connections: 'List, inspect and disconnect model subscriptions',
    login: 'Sign in to Dexto with your browser or a device code, or save an API key for CI',
    logout: 'End the sign-in on the server and forget it here',
    whoami: 'Show who Dexto commands act as',
    accounts: 'List, switch and remove saved sign-ins, one per account and organization',
    models: 'Models Dexto serves on your sign-in',
    notifications: 'List and read your Dexto notifications, and mark them read',
    marketplace:
        'Find, install and publish Dexto Marketplace listings: AutoBot templates, Dexto Apps and Skills',
    billing: "Show the organization's credit balance and recent spending",
    credits: 'Show the credit balance and top it up',
    cloud: 'Build in Dexto Cloud: projects, agents, files, sandboxes and more',
    projects:
        'Your Dexto Projects: list and change them, message their coordinators, start their chats',
    workspace: 'Use your Dexto workspace as yourself: its apps and tools, over the Dexto MCP',
    find: 'Find the command for something you want to do in Dexto',
    docs: "Search Dexto's public documentation and read a page as Markdown",
    loops: "List and inspect your account's, agents' and Projects' Loops and their runs",
    publish: 'Publish a file, folder or .zip as a link anyone with it can open',
    profile: 'Show and change your Dexto profile: handle, name, bio and who can see it',
    skills: 'Read, check, author, install, version and publish your Dexto Skills; push a local Skill or sync the library here',
    trace: "List your run traces and show one run's trace from Dexto",
    span: "List one run's spans from Dexto",
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

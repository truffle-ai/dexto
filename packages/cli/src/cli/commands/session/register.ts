import { withAnalytics, safeExit } from '../../../analytics/wrapper.js';
import type { BootstrapAgentMode, RuntimeCommandRegisterContext } from '../register-context.js';
import { HELD_COMMANDS } from '../../cloud/held-commands.js';

// The verbs that read this machine's chats (with --local, or chat move) through the local agent.
// Reading and deleting run it silent so --json stays parseable.
const LOCAL_AGENT_MODES: Readonly<Record<string, BootstrapAgentMode>> = {
    move: 'non-interactive',
    list: 'headless-run',
    history: 'headless-run',
    delete: 'headless-run',
};

export function registerSessionCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    const chatCommand = program.command('chat').description('Your local and cloud chats');

    // The cloud command engine owns these verbs and their options; analytics records only names.
    for (const [word, description] of Object.entries({
        local: 'List Claude Code and Codex chats on this machine that Dexto can import',
        import: 'Import Claude Code or Codex chats into Dexto',
        start: 'Start a cloud chat on your chosen connected computer and browser profile',
        list: "List your cloud chats, or this machine's with --local",
        follow: "Follow a cloud chat's events until it finishes",
        send: 'Message a cloud chat, steering its current turn or queued after it',
        cancel: "Stop a cloud chat's current run",
        fork: 'Fork a cloud chat from one of its messages',
        get: "Read a cloud chat's status and messages",
        history: "Read every message of a cloud chat, or this machine's with --local",
        delete: "Delete a cloud chat, or this machine's with --local",
        models: 'List the models your cloud chats can use',
        outputs: 'List the files and resources a cloud chat produced',
        computers: 'List your connected computers for a cloud chat',
        agents: 'List the agent profiles you can chat with in the cloud',
        'browser-profiles': 'List your browser profiles for a cloud chat',
        share: 'Set who in your organization can open one of your cloud chats',
        move: 'Move a synced chat and its working tree to cloud or local',
        watch: 'Stay attached to a chat on its cloud computer',
    }).filter(([word]) => !HELD_COMMANDS.has(`chat ${word}`)))
        chatCommand
            .command(word)
            .description(description)
            .helpOption(false)
            .passThroughOptions()
            .allowUnknownOption()
            .allowExcessArguments()
            .argument('[args...]')
            .action(async (args: string[]) => {
                await withAnalytics(`chat ${word}`, async () => {
                    const [{ runCloud }, { nodeCloudHost }] = await Promise.all([
                        import('../../cloud/run.js'),
                        import('../../cloud/host.js'),
                    ]);
                    const controller = new AbortController();
                    const stop = () => controller.abort();
                    process.once('SIGINT', stop);
                    const local: {
                        agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null;
                    } = { agent: null };
                    const cloudHost = nodeCloudHost(controller.signal);
                    // chat move and chat list --local read this machine's chats through the local
                    // agent; a list runs it silent so its --json stays parseable.
                    const localMode = LOCAL_AGENT_MODES[word];
                    const host =
                        localMode !== undefined
                            ? {
                                  ...cloudHost,
                                  openLocalAgent: async () => {
                                      local.agent ??= await bootstrapAgentFromGlobalOpts({
                                          mode: localMode,
                                      });
                                      return local.agent;
                                  },
                              }
                            : cloudHost;
                    let code: number;
                    try {
                        code = await runCloud(host, ['chat', word, ...args]);
                    } finally {
                        process.removeListener('SIGINT', stop);
                        if (local.agent !== null) await local.agent.stop();
                    }
                    safeExit(`chat ${word}`, code);
                })();
            });
}

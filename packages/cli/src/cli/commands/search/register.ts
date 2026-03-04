import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type { RuntimeCommandRegisterContext } from '../register-context.js';

export function registerSearchCommand({
    program,
    bootstrapAgentFromGlobalOpts,
}: RuntimeCommandRegisterContext): void {
    program
        .command('search')
        .description('Search session history')
        .argument('<query>', 'Search query')
        .option('--session <sessionId>', 'Search in specific session')
        .option('--role <role>', 'Filter by role (user, assistant, system, tool)')
        .option('--limit <number>', 'Limit number of results', '10')
        .action(
            withAnalytics(
                'search',
                async (
                    query: string,
                    options: { session?: string; role?: string; limit?: string }
                ) => {
                    let agent: Awaited<ReturnType<typeof bootstrapAgentFromGlobalOpts>> | null =
                        null;
                    try {
                        const searchOptions: {
                            sessionId?: string;
                            role?: 'user' | 'assistant' | 'system' | 'tool';
                            limit?: number;
                        } = {};

                        if (options.session) {
                            searchOptions.sessionId = options.session;
                        }
                        if (options.role) {
                            const allowed = new Set(['user', 'assistant', 'system', 'tool']);
                            if (!allowed.has(options.role)) {
                                console.error(
                                    `❌ Invalid role: ${options.role}. Use one of: user, assistant, system, tool`
                                );
                                safeExit('search', 1, 'invalid-role');
                            }
                            searchOptions.role = options.role as
                                | 'user'
                                | 'assistant'
                                | 'system'
                                | 'tool';
                        }
                        if (options.limit) {
                            const rawLimit = options.limit.trim();
                            const parsed = Number(rawLimit);
                            if (
                                !/^\d+$/.test(rawLimit) ||
                                !Number.isInteger(parsed) ||
                                parsed <= 0
                            ) {
                                console.error(
                                    `❌ Invalid --limit: ${options.limit}. Use a positive integer (e.g., 10).`
                                );
                                safeExit('search', 1, 'invalid-limit');
                            }
                            searchOptions.limit = parsed;
                        }

                        agent = await bootstrapAgentFromGlobalOpts({
                            mode: 'non-interactive',
                        });

                        const { handleSessionSearchCommand } = await import(
                            '../session-commands.js'
                        );
                        await handleSessionSearchCommand(agent, query, searchOptions);
                        safeExit('search', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto search command failed: ${err}`);
                        safeExit('search', 1, 'error');
                    } finally {
                        if (agent) {
                            await agent.stop().catch(() => {});
                        }
                    }
                }
            )
        );
}

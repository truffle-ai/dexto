// `find`: what to run for something you want to do, from Dexto's search, as commands.

import { integerOption, isJsonObject, UsageError, type Command } from '../command.js';
import { commandForCall, type Operation } from './workspace-apps.js';
import { listWorkspaceTools, queryWorkspaceTool } from './workspace.js';

/** One search result with the command that acts on it; null when nothing can be run from here. */
interface Found {
    readonly availability: string;
    readonly command: string | null;
    readonly kind: string;
    readonly next_step: string;
    readonly summary: string;
    readonly title: string;
}

const find: Command = {
    arguments: '<what...>',
    options: {
        limit: {
            description: 'How many to show (default 5, up to 8).',
            type: 'string',
            valueName: 'N',
        },
    },
    path: ['find'],
    summary:
        "Find what to run for something you want to do: Dexto's operations, apps, skills, agents and more, each as a command.",
    async run(context, input) {
        const query = input.positionals.join(' ').trim();
        if (query.length < 2)
            throw new UsageError('Say what you want to do, such as: dexto find "share a file".');
        const limit = integerOption(input, 'limit');
        const page = await queryWorkspaceTool(context, 'dexto_search', {
            query,
            ...(limit === undefined ? {} : { limit }),
        });
        const results =
            isJsonObject(page) && Array.isArray(page.results)
                ? page.results.filter(isJsonObject)
                : [];
        const tools = await listWorkspaceTools(context);
        const operationsByApp = new Map<string, Operation[]>();
        const found: Found[] = [];
        for (const result of results) {
            const call =
                isJsonObject(result.call) && typeof result.call.tool === 'string'
                    ? {
                          arguments: isJsonObject(result.call.arguments)
                              ? result.call.arguments
                              : {},
                          tool: result.call.tool,
                      }
                    : null;
            found.push({
                availability: String(result.availability ?? ''),
                command:
                    call === null
                        ? null
                        : await commandForCall(context, tools, call, operationsByApp),
                kind: String(result.sourceKind ?? ''),
                next_step: String(result.nextStep ?? ''),
                summary: String(result.summary ?? ''),
                title: String(result.title ?? ''),
            });
        }
        if (context.output.json) return context.output.list({ data: found }, []);
        if (found.length === 0) {
            context.runtime.writeOutput(
                'Nothing found. Try other words, or run dexto workspace for your apps.\n'
            );
            return;
        }
        context.runtime.writeOutput(
            found
                .map(
                    (each, index) =>
                        `${index + 1}. ${each.title} (${each.kind})\n   ${each.command ?? each.next_step}\n`
                )
                .join('')
        );
        context.output.note('Fill in each <value>, and run a command with --help for its input.');
    },
};

export const findCommands: readonly Command[] = [find];

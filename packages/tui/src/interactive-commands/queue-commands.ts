/**
 * Queue Commands (Interactive CLI)
 *
 * Queued input that was waiting on a run when the process was interrupted survives the restart,
 * but it never runs on its own and is never attached to the next unrelated message. This command
 * is the explicit decision point for that restored input:
 *
 * - /queue          - list restored input that is on hold
 * - /queue resume   - run the restored input now, as the next turn
 * - /queue discard  - drop the restored input without running it
 */

import type { RestoredPendingInput } from '@dexto/core';
import type { CommandDefinition, CommandContext, CommandHandlerResult } from './command-parser.js';
import { formatForInkCli } from './utils/format-output.js';
import { createSendContentMarker } from '../services/index.js';
import { previewQueuedContent } from '../utils/queuedComposerContent.js';
import type { TuiAgentBackend } from '../agent-backend.js';

const QUEUE_USAGE = '/queue [resume|discard]';

export function countRestoredPendingInput(pending: RestoredPendingInput): number {
    return pending.steer.length + pending.followUp.length;
}

export function formatRestoredPendingInput(pending: RestoredPendingInput): string {
    const total = countRestoredPendingInput(pending);
    if (total === 0) {
        return 'No queued input is waiting from an interrupted run.';
    }

    const lines = [
        `⏸ ${total} queued message${total === 1 ? '' : 's'} from an interrupted run ${total === 1 ? 'is' : 'are'} on hold.`,
        'It will not run with your next message.',
        '',
    ];
    for (const message of pending.steer) {
        lines.push(`  • (current-turn input) ${previewQueuedContent(message.content)}`);
    }
    for (const message of pending.followUp) {
        lines.push(`  • (follow-up) ${previewQueuedContent(message.content)}`);
    }
    lines.push('', '💡 /queue resume runs it now · /queue discard drops it');
    return lines.join('\n');
}

export const queueCommand: CommandDefinition = {
    name: 'queue',
    description: 'Show, resume, or discard queued input restored from an interrupted run',
    usage: QUEUE_USAGE,
    category: 'General',
    handler: async (
        args: string[],
        agent: TuiAgentBackend,
        ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const { sessionId } = ctx;
        if (!sessionId) {
            return formatForInkCli('⚠️  No active session');
        }

        const action = (args[0] ?? 'status').trim().toLowerCase();

        switch (action) {
            case 'status':
            case 'list':
            case 'show': {
                const pending = await agent.getRestoredPendingInput(sessionId);
                return formatForInkCli(formatRestoredPendingInput(pending));
            }
            case 'resume': {
                const taken = await agent.takeRestoredPendingInput(sessionId);
                if (!taken) {
                    return formatForInkCli('No queued input is waiting from an interrupted run.');
                }
                return createSendContentMarker(taken.combinedContent);
            }
            case 'discard': {
                const count = await agent.discardRestoredPendingInput(sessionId);
                if (count === 0) {
                    return formatForInkCli('No queued input is waiting from an interrupted run.');
                }
                return formatForInkCli(
                    `🗑 Discarded ${count} queued message${count === 1 ? '' : 's'} from the interrupted run`
                );
            }
            default:
                return formatForInkCli(`Unknown /queue action "${args[0]}"\nUsage: ${QUEUE_USAGE}`);
        }
    },
};

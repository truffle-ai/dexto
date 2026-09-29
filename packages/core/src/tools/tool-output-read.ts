/** Core `tool_output_read`: pages through or searches a tool result stored for this session. */
import { z } from 'zod';
import type { ConversationStore } from '../storage/conversation/types.js';
import type { ToolOutputStore } from '../storage/tool-outputs/types.js';
import { TOOL_OUTPUT_READ_TOOL_NAME } from '../llm/executor/tool-output-spill.js';
import { TOOL_ACTIVITY } from './activity.js';
import { ToolError } from './errors.js';
import { defineTool } from './define-tool.js';
import { createLocalToolCallHeader } from './presentation.js';
import type { Tool } from './types.js';

const MAX_READ_LINES = 2000;
const MAX_READ_CHARS = 50_000;
const DEFAULT_MAX_MATCHES = 100;
const MAX_MATCHES = 500;
const MAX_MATCH_LINE_CHARS = 500;

const ToolOutputReadInputSchema = z
    .object({
        id: z
            .string()
            .min(1)
            .describe('The tool call id named in a truncated or cleared tool result.'),
        offset: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe('1-based line to start reading from. Defaults to 1.'),
        charOffset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
                '0-based character to start from within the offset line, for lines too long to read at once.'
            ),
        limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_READ_LINES)
            .optional()
            .describe(`Number of lines to read, up to ${MAX_READ_LINES}.`),
        pattern: z
            .string()
            .min(1)
            .optional()
            .describe(
                'Search instead of reading a range: returns lines containing this text (case-insensitive) with their line numbers.'
            ),
        maxMatches: z
            .number()
            .int()
            .min(1)
            .max(MAX_MATCHES)
            .optional()
            .describe(`Most matching lines to return with pattern, up to ${MAX_MATCHES}.`),
    })
    .strict();

type ToolOutputReadInput = z.output<typeof ToolOutputReadInputSchema>;

export function createToolOutputReadTool(stores: {
    conversation: ConversationStore;
    toolOutputs: ToolOutputStore;
}): Tool<typeof ToolOutputReadInputSchema> {
    return defineTool({
        id: TOOL_OUTPUT_READ_TOOL_NAME,
        description:
            'Read a tool result that was truncated or cleared from this conversation, by the id named in its marker. ' +
            'Read a line range with offset and limit, or search it with pattern. Use this instead of re-running the tool.',
        inputSchema: ToolOutputReadInputSchema,
        needsApproval: false,
        presentation: {
            activity: TOOL_ACTIVITY.readToolOutput,
            describeHeader: (input) =>
                createLocalToolCallHeader({
                    title: 'Read earlier output',
                    argsText:
                        input.pattern === undefined ? input.id : `${input.id} "${input.pattern}"`,
                }),
        },
        async execute(input, context) {
            const sessionId = context.sessionId;
            if (sessionId === undefined) {
                throw ToolError.executionFailed(TOOL_OUTPUT_READ_TOOL_NAME, 'it needs a session');
            }
            const text = await loadToolOutput(stores, sessionId, input.id);
            if (text === undefined) {
                return (
                    `No stored output with id "${input.id}" in this conversation. It may have expired. ` +
                    'Re-run the tool if it only reads data, or narrow the request.'
                );
            }
            return input.pattern === undefined
                ? readLines(text, input)
                : searchLines(text, input.pattern, input.maxMatches ?? DEFAULT_MAX_MATCHES);
        },
    });
}

/**
 * Resolves an id within one session only: the stored full output first, then the tool message
 * in history, whose original content is kept even after pruning.
 */
async function loadToolOutput(
    stores: { conversation: ConversationStore; toolOutputs: ToolOutputStore },
    sessionId: string,
    toolCallId: string
): Promise<string | undefined> {
    const stored = await stores.toolOutputs.load({ sessionId, toolCallId });
    if (stored !== undefined) return stored;
    const messages = await stores.conversation.listMessages({ sessionId });
    const message = messages.find(
        (candidate) => candidate.role === 'tool' && candidate.toolCallId === toolCallId
    );
    if (message?.role !== 'tool') return undefined;
    return message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n');
}

function readLines(text: string, input: ToolOutputReadInput): string {
    const lines = text.split('\n');
    const start = Math.min(input.offset ?? 1, lines.length);
    const end = Math.min(start - 1 + (input.limit ?? MAX_READ_LINES), lines.length);
    const selected: string[] = [];
    let chars = 0;
    for (let line = start; line <= end && chars < MAX_READ_CHARS; line += 1) {
        const full = lines[line - 1] ?? '';
        const from = line === start ? Math.min(input.charOffset ?? 0, full.length) : 0;
        const piece = full.slice(from, from + MAX_READ_CHARS - chars);
        selected.push(`${line}: ${piece}`);
        chars += piece.length + 1;
        if (from + piece.length < full.length) {
            const next = from + piece.length;
            return `${selected.join('\n')}\n\n[Line ${line} continues (${full.length} characters). Use offset=${line} charOffset=${next} to continue.]`;
        }
    }
    const last = start + selected.length - 1;
    const hint =
        last < lines.length
            ? `Showing lines ${start}-${last} of ${lines.length}. Use offset=${last + 1} to continue.`
            : `Showing lines ${start}-${last} of ${lines.length}.`;
    return `${selected.join('\n')}\n\n[${hint}]`;
}

/** Plain case-insensitive text search; model-supplied regular expressions could hang the host. */
function searchLines(text: string, pattern: string, maxMatches: number): string {
    const needle = pattern.toLowerCase();
    const lines = text.split('\n');
    const found: string[] = [];
    let total = 0;
    lines.forEach((line, index) => {
        if (!line.toLowerCase().includes(needle)) return;
        total += 1;
        if (found.length < maxMatches) {
            found.push(`${index + 1}: ${line.slice(0, MAX_MATCH_LINE_CHARS)}`);
        }
    });
    if (total === 0) return `[No lines contain "${pattern}" in ${lines.length} lines.]`;
    const shown =
        total > found.length
            ? `Showing ${found.length} of ${total} matching lines; raise maxMatches or narrow the pattern.`
            : `${total} matching lines of ${lines.length}.`;
    return `${found.join('\n')}\n\n[${shown} Read around a match with offset.]`;
}

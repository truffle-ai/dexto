// Reads Claude Code session files: `$CLAUDE_CONFIG_DIR/projects/<dashed-cwd>/<session>.jsonl`.

import path from 'node:path';

import {
    createTurns,
    finishChat,
    isRecord,
    jsonLines,
    stringField,
    toolCallText,
    toolResultText,
    validTime,
    type LocalPullRequest,
    type ParsedChat,
} from './transcript.js';

/** What Claude Code writes as a `user` line but the person never typed: slash commands and their output. */
const CLAUDE_CODE_INJECTED = /^\s*<(command-name|command-message|local-command-[a-z]+)>/u;

/**
 * The title Claude Code shows for a session, in this order: the person's own (`custom-title`, from
 * renaming it), the one Claude Code generates (`ai-title`, the last one written), then a `summary`
 * line (Claude Code before 2.1). Null when there is none, and the chat is titled by its first line.
 */
class ClaudeCodeTitle {
    private custom: string | null = null;
    private generated: string | null = null;
    private summary: string | null = null;

    /** Whether the line was a title line. */
    read(line: Record<string, unknown>): boolean {
        if (line.type === 'custom-title') this.custom = stringField(line, 'customTitle');
        else if (line.type === 'ai-title') this.generated = stringField(line, 'aiTitle');
        else if (line.type === 'summary') this.summary ??= stringField(line, 'summary');
        else return false;
        return true;
    }

    get title(): string | null {
        return this.custom ?? this.generated ?? this.summary;
    }
}

/** Claude Code's `pr-link` line: `{prNumber, prRepository: "owner/name", prUrl}`. */
function pullRequest(line: Record<string, unknown>): LocalPullRequest | null {
    const repository = stringField(line, 'prRepository');
    const url = stringField(line, 'prUrl');
    const number = line.prNumber;
    if (repository === null || url === null || typeof number !== 'number') return null;
    return { number, repository, url };
}

/**
 * A Claude Code session file: one Agent SDK message per line (`type` `user` or `assistant`, with
 * Anthropic `message.content`), plus title, `pr-link` and bookkeeping lines. Sidechain (subagent),
 * meta and compact-summary lines are left out, as is thinking.
 */
export function parseClaudeCodeTranscript(text: string, file: string): ParsedChat | null {
    const turns = createTurns();
    const title = new ClaudeCodeTitle();
    const pullRequests = new Map<string, LocalPullRequest>();
    let sessionId: string | null = null;
    let cwd: string | null = null;
    let gitBranch: string | null = null;
    for (const line of jsonLines(text)) {
        if (title.read(line)) continue;
        if (line.type === 'pr-link') {
            const linked = pullRequest(line);
            if (linked !== null && !pullRequests.has(linked.url))
                pullRequests.set(linked.url, linked);
            continue;
        }
        if (line.type !== 'user' && line.type !== 'assistant') continue;
        // A compact summary is Claude Code's own recap of the turns before it, written as `user`.
        if (line.isSidechain === true || line.isMeta === true || line.isCompactSummary === true)
            continue;
        const message = line.message;
        const at = validTime(stringField(line, 'timestamp'));
        if (!isRecord(message) || at === null) continue;
        sessionId ??= stringField(line, 'sessionId');
        cwd ??= stringField(line, 'cwd');
        gitBranch ??= stringField(line, 'gitBranch');
        const content = message.content;
        if (typeof content === 'string') {
            if (line.type === 'assistant') turns.assistant(content, at);
            else if (!CLAUDE_CODE_INJECTED.test(content)) turns.user(content, at);
            continue;
        }
        if (!Array.isArray(content)) continue;
        for (const block of content) {
            if (!isRecord(block)) continue;
            if (block.type === 'text' && typeof block.text === 'string') {
                if (line.type === 'assistant') turns.assistant(block.text, at);
                else if (!CLAUDE_CODE_INJECTED.test(block.text)) turns.user(block.text, at);
            } else if (block.type === 'tool_use') {
                turns.assistant(
                    toolCallText(stringField(block, 'name') ?? 'tool', block.input),
                    at
                );
            } else if (block.type === 'tool_result') {
                turns.assistant(toolResultText(claudeToolResultText(block.content)), at);
            } else if (block.type === 'image' && line.type === 'user') {
                turns.user('[An image was attached here; it was not imported.]', at);
            }
        }
    }
    return finishChat(
        {
            cwd,
            gitBranch,
            id: sessionId ?? path.basename(file, '.jsonl'),
            path: file,
            pullRequests: [...pullRequests.values()],
            recordedRemoteUrl: null,
            source: 'claude-code',
            title: title.title,
        },
        turns.done()
    );
}

function claudeToolResultText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((part) =>
            isRecord(part) && typeof part.text === 'string'
                ? part.text
                : isRecord(part) && part.type === 'image'
                  ? '[image]'
                  : ''
        )
        .filter((part) => part !== '')
        .join('\n');
}

/** Where Claude Code keeps its sessions on this machine. */
export function claudeCodeFolder(
    environment: Readonly<Record<string, string | undefined>>,
    homeDirectory: string
): string {
    return path.join(
        environment.CLAUDE_CONFIG_DIR ?? path.join(homeDirectory, '.claude'),
        'projects'
    );
}

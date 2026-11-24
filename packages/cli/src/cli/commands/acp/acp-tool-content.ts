import type * as acp from '@agentclientprotocol/sdk';
import type { ToolDisplayData, ToolPresentationSnapshotV1 } from '@dexto/core';
import { resolve } from 'node:path';
import { parsePatch } from 'diff';

/** Dexto tool activity categories that have an ACP tool kind; the rest are `other`. */
const KIND_BY_CATEGORY = new Map<string, acp.ToolKind>([
    ['file-read', 'read'],
    ['memory-read', 'read'],
    ['plan-read', 'read'],
    ['resource', 'read'],
    ['schedule-read', 'read'],
    ['skill-read', 'read'],
    ['tool-output', 'read'],
    ['file-write', 'edit'],
    ['file-create', 'edit'],
    ['file-edit', 'edit'],
    ['memory-delete', 'delete'],
    ['schedule-delete', 'delete'],
    ['file-search', 'search'],
    ['code-search', 'search'],
    ['history-search', 'search'],
    ['skill-search', 'search'],
    ['web-search', 'fetch'],
    ['http-request', 'fetch'],
    ['command', 'execute'],
    ['command-output', 'execute'],
    ['process', 'execute'],
]);

export function toolKind(snapshot: ToolPresentationSnapshotV1 | undefined): acp.ToolKind {
    return KIND_BY_CATEGORY.get(snapshot?.activity?.category ?? '') ?? 'other';
}

/**
 * ACP content for the displays clients can render better than text: one ACP diff per hunk of a
 * file change, and a command with its output. Null for every other display.
 */
export function displayContent(
    display: ToolDisplayData,
    root: string
): acp.ToolCallContent[] | null {
    switch (display.type) {
        case 'diff':
            // ACP paths are absolute; Dexto file tools may report them relative to the workspace.
            return diffContent(resolve(root, display.filename), display.unified);
        case 'shell': {
            // Approval previews and background starts carry no output and a placeholder exit
            // code; their text result says what happened.
            if (display.stdout === undefined && display.stderr === undefined) return null;
            const output = [display.stdout, display.stderr]
                .filter((chunk): chunk is string => Boolean(chunk?.trim()))
                .map((chunk) => chunk.replace(/\n$/, ''));
            const text = [`$ ${display.command}`, ...output, `exit code ${display.exitCode}`];
            return [{ type: 'content', content: { type: 'text', text: text.join('\n') } }];
        }
        default:
            return null;
    }
}

/**
 * Dexto file tools report a unified patch, not whole files, so each hunk becomes one ACP diff
 * whose texts are the hunk's old and new lines. A hunk adding to an empty file has no old text.
 */
function diffContent(path: string, unified: string): acp.ToolCallContent[] | null {
    let patches: ReturnType<typeof parsePatch>;
    try {
        patches = parsePatch(unified);
    } catch {
        // A malformed patch keeps the tool's text result.
        return null;
    }
    const diffs = patches.flatMap((patch) =>
        patch.hunks.map((hunk): acp.ToolCallContent => {
            const { oldText, newText } = hunkTexts(hunk.lines);
            return {
                type: 'diff',
                path,
                oldText: hunk.oldLines === 0 ? null : oldText,
                newText,
            };
        })
    );
    // An unchanged file has no hunks; its text result says so.
    return diffs.length > 0 ? diffs : null;
}

/**
 * A hunk's old and new text. Each line keeps its newline unless the patch marks it as the last
 * line without one, so a change to only the final newline still shows.
 */
function hunkTexts(lines: string[]): { oldText: string; newText: string } {
    let oldText = '';
    let newText = '';
    lines.forEach((line, index) => {
        if (line.startsWith('\\')) return;
        const ending = lines[index + 1]?.startsWith('\\') ? '' : '\n';
        const text = line.slice(1).replace(/\r$/, '') + ending;
        if (!line.startsWith('+')) oldText += text;
        if (!line.startsWith('-')) newText += text;
    });
    return { oldText, newText };
}

/**
 * What one tool call shows as a Signal step row, worked out from its message. Pure, so each rule
 * is tested on its own.
 */
import type { ToolDisplayData } from '@dexto/core';
import type { Step, StepState } from '../signal/index.js';
import type { Message } from '../state/types.js';
import { formatDuration, makeRelativePath } from './messageFormatting.js';

const VERB_CELLS = 7;
const OUTPUT_LINES = 5;

const VERBS: Readonly<Record<string, string>> = {
    read_file: 'READ',
    read_media_file: 'READ',
    write_file: 'WRITE',
    edit_file: 'EDIT',
    bash_exec: 'RUN',
    bash_output: 'OUTPUT',
    kill_process: 'KILL',
    grep_content: 'SEARCH',
    search_history: 'SEARCH',
    glob_files: 'GLOB',
    todo_write: 'TODO',
    spawn_agent: 'TASK',
    invoke_skill: 'SKILL',
    skill_load: 'SKILL',
    http_request: 'FETCH',
    view_logs: 'LOGS',
    plan_create: 'PLAN',
    plan_read: 'PLAN',
    plan_update: 'PLAN',
    plan_review: 'PLAN',
};

const FILE_TOOLS = new Set(['read_file', 'read_media_file', 'write_file', 'edit_file']);

function stepState(message: Message): StepState {
    switch (message.toolStatus) {
        case 'pending':
            return 'queue';
        case 'pending_approval':
            return 'wait';
        case 'running':
            return 'run';
        default:
            if (message.toolOutcome === 'denied') return 'deny';
            if (message.toolOutcome === 'cancelled') return 'stop';
            if (message.isError === true) return 'fail';
            // A command that exits nonzero still comes back as a successful tool call.
            return message.toolDisplayData?.type === 'shell' &&
                message.toolDisplayData.exitCode !== 0
                ? 'fail'
                : 'ok';
    }
}

function stepVerb(toolName: string): string {
    if (toolName.startsWith('mcp--')) return 'MCP';
    const known = VERBS[toolName];
    if (known !== undefined) return known;
    const firstWord = toolName.split(/[_\-\s(]/)[0] ?? toolName;
    return firstWord.toUpperCase().slice(0, VERB_CELLS);
}

/** One row's worth of the call's arguments: a multi-line command reads on one line. */
function stepTarget(toolName: string, toolArgs: string): string {
    const args = toolArgs.replace(/\s*\n\s*/g, ' ').trim();
    if (toolName.startsWith('mcp--')) {
        const [, server, ...name] = toolName.split('--');
        return [`${server ?? ''}.${name.join('--')}`, args].filter((part) => part !== '').join(' ');
    }
    return FILE_TOOLS.has(toolName) ? makeRelativePath(args) : args;
}

function countLines(text: string | undefined): number {
    return text === undefined ? 0 : text.split('\n').filter((line) => line.length > 0).length;
}

function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function displayDetail(display: ToolDisplayData): string | null {
    switch (display.type) {
        case 'diff': {
            const hunks = display.unified.split('\n').filter((l) => l.startsWith('@@')).length;
            const counts = `+${display.additions} −${display.deletions}`;
            return hunks > 1 ? `${counts} · ${hunks} hunks` : counts;
        }
        case 'shell': {
            if (display.exitCode !== 0) return `exit ${display.exitCode}`;
            if (display.isBackground === true) return 'background';
            const lines = countLines(display.stdout);
            return lines > 0 ? plural(lines, 'line') : null;
        }
        case 'search': {
            const files = new Set(display.matches.map((match) => match.file)).size;
            return `${plural(display.totalMatches, 'hit')} · ${plural(files, 'file')}`;
        }
        case 'file': {
            const lines =
                display.lineCount === undefined ? null : plural(display.lineCount, 'line');
            if (display.operation === 'delete') return 'deleted';
            if (display.operation === 'create') return lines === null ? 'new' : `new · ${lines}`;
            return lines;
        }
        default:
            return null;
    }
}

function stepDetail(message: Message, state: StepState): string | null {
    if (state === 'deny') return 'you denied';
    if (state === 'run' && message.subAgentProgress !== undefined) {
        return `${plural(message.subAgentProgress.toolsCalled, 'tool')} so far`;
    }
    return message.toolDisplayData === undefined ? null : displayDetail(message.toolDisplayData);
}

export function toolStep(message: Message): Step {
    const toolName = message.toolName ?? '';
    const state = stepState(message);
    const display = message.toolDisplayData;
    return {
        state,
        verb: stepVerb(toolName !== '' ? toolName : message.content),
        target: stepTarget(toolName, message.toolArgs ?? ''),
        detail: stepDetail(message, state),
        time: display?.type === 'shell' ? formatDuration(display.duration) : null,
        cloud: false,
    };
}

/** The lines under a failed call's row: why it failed. A call that worked stays one row. */
export function toolOutput(message: Message): string[] {
    if (stepState(message) !== 'fail') return [];
    const display = message.toolDisplayData;
    const text =
        display?.type === 'shell'
            ? display.stderr?.trim() || display.stdout?.trim() || ''
            : (message.toolResult ?? '');
    return text
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .slice(-OUTPUT_LINES);
}

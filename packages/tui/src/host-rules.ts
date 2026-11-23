/**
 * Pure host rules shared by the TUI and other Dexto hosts (`dexto acp`): which permission mode
 * settles an approval without asking, how a slash command names a prompt and its arguments, and
 * how plan mode wraps a message. No UI imports, so hosts can use them without the TUI.
 */
import { ApprovalType, type ApprovalRequest } from '@dexto/core';
import { isEditInWorkspace } from './utils/approvalScope.js';
import { isAutoApprovableInEditMode } from './utils/toolUtils.js';

/**
 * A permission mode that settles approvals without asking. Accept edits checks the edit against
 * `workspace()`, which must be canonical (a real path), like the directory in an approval key. It
 * is read only for an edit that could be approved.
 */
export type AutoApprovalMode =
    | { kind: 'full-access' }
    | { kind: 'accept-edits'; workspace: () => string };

/**
 * Whether `mode` approves `request` without asking. Full access approves tool and command
 * approvals; accept edits approves file edits, writes and plan updates inside the workspace.
 * A request marked `autoApproval: 'disallowed'` always asks, and forms always ask.
 */
export function autoApproves(request: ApprovalRequest, mode: AutoApprovalMode): boolean {
    if (request.autoApproval === 'disallowed') return false;
    if (mode.kind === 'full-access') {
        return (
            request.type === ApprovalType.TOOL_APPROVAL ||
            request.type === ApprovalType.COMMAND_APPROVAL
        );
    }
    return (
        request.type === ApprovalType.TOOL_APPROVAL &&
        isAutoApprovableInEditMode(request.metadata.toolName) &&
        isEditInWorkspace(request.metadata.approvalKey, mode.workspace())
    );
}

/** Splits slash-command arguments on spaces, keeping quoted text and escaped characters. */
export function parseQuotedArguments(input: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let i = 0;

    while (i < input.length) {
        const char = input[i];
        const nextChar = input[i + 1];

        if (!inQuotes && (char === '"' || char === "'")) {
            inQuotes = true;
            quoteChar = char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            quoteChar = '';
        } else if (!inQuotes && char === ' ') {
            if (current) {
                args.push(current);
                current = '';
            }
        } else if (char === '\\' && nextChar) {
            // Handle escape sequences
            current += nextChar;
            i++; // Skip next character
        } else {
            current += char;
        }
        i++;
    }

    if (current) {
        args.push(current);
    }

    return args.filter((arg) => arg.length > 0);
}

/** A prompt command's `key=value` arguments, and the rest joined as its context. */
export function splitPromptArguments(args: string[]): {
    argMap: Record<string, string>;
    context?: string | undefined;
} {
    const map: Record<string, string> = {};
    const contextParts: string[] = [];

    for (const arg of args) {
        const equalsIndex = arg.indexOf('=');
        if (equalsIndex > 0) {
            const key = arg.slice(0, equalsIndex).trim();
            const value = arg.slice(equalsIndex + 1);
            if (key.length > 0) {
                map[key] = value;
            }
        } else if (arg.trim().length > 0) {
            contextParts.push(arg);
        }
    }

    const context = contextParts.length > 0 ? contextParts.join(' ') : undefined;
    return { argMap: map, context };
}

/** A message that invokes a prompt: `/name key=value context`. */
export type PromptInvocation = {
    commandName: string;
    args: Record<string, string>;
    context?: string;
};

/** The prompt a slash-command message invokes, or null for an ordinary message. */
export function promptInvocation(message: string): PromptInvocation | null {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return null;
    const [commandName, ...rest] = parseQuotedArguments(trimmed.slice(1));
    if (commandName === undefined) return null;
    const { argMap, context } = splitPromptArguments(rest);
    return { commandName, args: argMap, ...(context !== undefined ? { context } : {}) };
}

/** The resolved text of a prompt with its resources as `@<uri>` mentions, as the TUI sends it. */
export function promptMessage(result: { text: string; resources: string[] }): string {
    if (result.resources.length === 0) return result.text;
    const resourceRefs = result.resources.map((uri) => `@<${uri}>`).join(' ');
    return result.text ? `${result.text}\n\n${resourceRefs}` : resourceRefs;
}

/** The image prompt holding plan mode's instructions. */
export const PLAN_MODE_PROMPT = 'config:dexto-plan-mode';

/** Plan mode's instructions ahead of the first message sent in plan mode. */
export function withPlanMode(message: string, planText: string): string {
    return `<plan-mode>\n${planText}\n</plan-mode>\n\n${message}`;
}

/** Whether a tool result is an approved plan review, which ends plan mode. */
export function planApproved(
    toolName: string,
    success: boolean | undefined,
    rawResult: unknown
): boolean {
    return (
        toolName === 'plan_review' &&
        success !== false &&
        typeof rawResult === 'object' &&
        rawResult !== null &&
        'approved' in rawResult &&
        Boolean(rawResult.approved)
    );
}

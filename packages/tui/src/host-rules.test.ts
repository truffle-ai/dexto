import { describe, expect, it } from 'vitest';
import { ApprovalType, type ApprovalRequest } from '@dexto/core';
import {
    autoApproves,
    type AutoApprovalMode,
    parseQuotedArguments,
    planApproved,
    promptInvocation,
    splitPromptArguments,
    withPlanMode,
} from './host-rules.js';

function toolApproval(
    toolName: string,
    extra: { approvalKey?: string; autoApproval?: 'allowed' | 'disallowed' } = {}
): ApprovalRequest {
    const request: ApprovalRequest = {
        approvalId: 'a',
        type: ApprovalType.TOOL_APPROVAL,
        timestamp: new Date(0),
        ...(extra.autoApproval !== undefined ? { autoApproval: extra.autoApproval } : {}),
        metadata: {
            toolName,
            toolCallId: 'call',
            args: {},
            ...(extra.approvalKey !== undefined ? { approvalKey: extra.approvalKey } : {}),
        },
    };
    return request;
}

const commandApproval: ApprovalRequest = {
    approvalId: 'c',
    type: ApprovalType.COMMAND_APPROVAL,
    timestamp: new Date(0),
    metadata: { toolName: 'bash_exec', command: 'ls', originalCommand: 'ls' },
};

const elicitation: ApprovalRequest = {
    approvalId: 'e',
    type: ApprovalType.ELICITATION,
    timestamp: new Date(0),
    metadata: { schema: {}, prompt: 'Which?', serverName: 'Dexto Agent' },
};

describe('autoApproves', () => {
    const fullAccess: AutoApprovalMode = { kind: 'full-access' };
    const acceptEdits: AutoApprovalMode = { kind: 'accept-edits', workspace: () => '/work' };

    it('approves tool and command approvals in full access', () => {
        expect(autoApproves(toolApproval('bash_exec'), fullAccess)).toBe(true);
        expect(autoApproves(commandApproval, fullAccess)).toBe(true);
    });

    it('never approves a request that must always ask, or a form', () => {
        const alwaysAsk = toolApproval('ordinary', { autoApproval: 'disallowed' });
        expect(autoApproves(alwaysAsk, fullAccess)).toBe(false);
        expect(
            autoApproves(toolApproval('edit_file', { autoApproval: 'disallowed' }), acceptEdits)
        ).toBe(false);
        expect(autoApproves(elicitation, fullAccess)).toBe(false);
    });

    it('approves only workspace edits, writes and plan updates when accepting edits', () => {
        expect(autoApproves(toolApproval('edit_file'), acceptEdits)).toBe(true);
        expect(autoApproves(toolApproval('plan_update'), acceptEdits)).toBe(true);
        expect(
            autoApproves(
                toolApproval('write_file', { approvalKey: 'directory:/work/src:operation:write' }),
                acceptEdits
            )
        ).toBe(true);
        expect(
            autoApproves(
                toolApproval('edit_file', { approvalKey: 'directory:/elsewhere:operation:edit' }),
                acceptEdits
            )
        ).toBe(false);
        expect(autoApproves(toolApproval('bash_exec'), acceptEdits)).toBe(false);
        expect(autoApproves(commandApproval, acceptEdits)).toBe(false);
    });

    it('reads the workspace only for an edit it could approve', () => {
        const unread: AutoApprovalMode = {
            kind: 'accept-edits',
            workspace: () => {
                throw new Error('workspace read');
            },
        };
        expect(autoApproves(toolApproval('bash_exec'), unread)).toBe(false);
        expect(autoApproves(commandApproval, unread)).toBe(false);
        expect(autoApproves(elicitation, unread)).toBe(false);
    });
});

describe('prompt invocation', () => {
    it('splits quoted arguments the way the TUI parses slash commands', () => {
        expect(parseQuotedArguments(`review "two words" a\\ b  'x y'`)).toEqual([
            'review',
            'two words',
            'a b',
            'x y',
        ]);
    });

    it('separates key=value arguments from context', () => {
        expect(splitPromptArguments(['lang=ts', 'check', 'this'])).toEqual({
            argMap: { lang: 'ts' },
            context: 'check this',
        });
        expect(splitPromptArguments([])).toEqual({ argMap: {}, context: undefined });
    });

    it('reads a slash command from a message', () => {
        expect(promptInvocation('/review lang=ts the parser')).toEqual({
            commandName: 'review',
            args: { lang: 'ts' },
            context: 'the parser',
        });
        expect(promptInvocation('  /review')).toEqual({ commandName: 'review', args: {} });
        expect(promptInvocation('review this')).toBeNull();
        expect(promptInvocation('/')).toBeNull();
    });
});

describe('plan mode', () => {
    it('wraps the plan-mode instructions ahead of the message', () => {
        expect(withPlanMode('Add a flag', 'Plan first.')).toBe(
            '<plan-mode>\nPlan first.\n</plan-mode>\n\nAdd a flag'
        );
    });

    it('sees an approved plan review', () => {
        expect(planApproved('plan_review', true, { approved: true })).toBe(true);
        expect(planApproved('plan_review', true, { approved: false })).toBe(false);
        expect(planApproved('plan_review', false, { approved: true })).toBe(false);
        expect(planApproved('plan_review', true, null)).toBe(false);
        expect(planApproved('plan_create', true, { approved: true })).toBe(false);
    });
});

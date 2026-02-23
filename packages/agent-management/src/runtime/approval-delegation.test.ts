import { describe, expect, it, vi } from 'vitest';
import type { ApprovalManager, ApprovalRequest, ApprovalRequestDetails } from '@dexto/core';
import { ApprovalStatus, ApprovalType } from '@dexto/core';
import { createDelegatingApprovalHandler } from './approval-delegation.js';

function createMockLogger() {
    return {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => createMockLogger()),
        createFileOnlyChild: vi.fn(() => createMockLogger()),
        destroy: vi.fn(async () => undefined),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'info' as const),
        getLogFilePath: vi.fn(() => null),
    };
}

describe('createDelegatingApprovalHandler', () => {
    it('forwards approvals to parent with parent sessionId and preserves original sessionId in metadata', async () => {
        const requestApproval = vi.fn(async (details: ApprovalRequestDetails) => {
            return {
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
                sessionId: details.sessionId,
            };
        });

        const parentApprovalManager = {
            requestApproval,
            cancelApproval: vi.fn(),
        } as unknown as ApprovalManager;

        const handler = createDelegatingApprovalHandler(
            parentApprovalManager,
            'agent-sub',
            'session-parent',
            createMockLogger()
        );

        const request: ApprovalRequest = {
            approvalId: 'approval-sub',
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-sub',
            timeout: 0,
            metadata: {
                toolName: 'glob_files',
                toolCallId: 'call-1',
                args: { pattern: '**/*' },
            },
        } as unknown as ApprovalRequest;

        const response = await handler(request);

        expect(requestApproval).toHaveBeenCalledTimes(1);
        const forwarded = requestApproval.mock.calls[0]![0];
        expect(forwarded.sessionId).toBe('session-parent');
        expect((forwarded.metadata as any).delegatedFromAgent).toBe('agent-sub');
        expect((forwarded.metadata as any).delegatedFromSessionId).toBe('session-sub');
        expect(response.status).toBe(ApprovalStatus.APPROVED);
    });

    it('uses sub-agent sessionId when parent sessionId is not provided', async () => {
        const requestApproval = vi.fn(async (details: ApprovalRequestDetails) => {
            return {
                approvalId: 'approval-1',
                status: ApprovalStatus.APPROVED,
                sessionId: details.sessionId,
            };
        });

        const parentApprovalManager = {
            requestApproval,
            cancelApproval: vi.fn(),
        } as unknown as ApprovalManager;

        const handler = createDelegatingApprovalHandler(
            parentApprovalManager,
            'agent-sub',
            undefined,
            createMockLogger()
        );

        const request: ApprovalRequest = {
            approvalId: 'approval-sub',
            type: ApprovalType.TOOL_APPROVAL,
            sessionId: 'session-sub',
            timeout: 0,
            metadata: {
                toolName: 'glob_files',
                toolCallId: 'call-1',
                args: { pattern: '**/*' },
            },
        } as unknown as ApprovalRequest;

        await handler(request);

        const forwarded = requestApproval.mock.calls[0]![0];
        expect(forwarded.sessionId).toBe('session-sub');
    });
});

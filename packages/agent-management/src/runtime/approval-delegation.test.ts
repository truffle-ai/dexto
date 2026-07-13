import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest, ApprovalRequestDetails, ApprovalStore, Logger } from '@dexto/core';
import { ApprovalManager, ApprovalStatus, ApprovalType } from '@dexto/core';
import { createDelegatingApprovalHandler } from './approval-delegation.js';

function createMockLogger(): Logger {
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

function createMockApprovalStore(): ApprovalStore {
    return {
        createRequest: vi.fn(async ({ request }) => request),
        deleteSessionState: vi.fn(async () => undefined),
        getRequest: vi.fn(async () => undefined),
        getResponse: vi.fn(async () => undefined),
        listPending: vi.fn(async () => []),
        loadSessionState: vi.fn(async () => ({ approvedKeys: {} })),
        saveResponse: vi.fn(async ({ response }) => ({ response, status: 'created' as const })),
        saveSessionState: vi.fn(async () => undefined),
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

    it('preserves mandatory policy when delegating to an auto-approving parent', async () => {
        const parentApprovalManager = new ApprovalManager(
            {
                elicitation: { enabled: false },
                permissions: { mode: 'auto-approve' },
            },
            createMockLogger(),
            createMockApprovalStore()
        );
        const parentHandler = vi.fn(async (request: ApprovalRequest) => ({
            approvalId: request.approvalId,
            sessionId: request.sessionId,
            status: ApprovalStatus.APPROVED,
        }));
        parentApprovalManager.setHandler(parentHandler);
        const handler = createDelegatingApprovalHandler(
            parentApprovalManager,
            'agent-sub',
            'session-parent',
            createMockLogger()
        );

        await handler({
            approvalId: randomUUID(),
            autoApproval: 'disallowed',
            metadata: {
                args: { path: 'report.md' },
                toolCallId: 'call-mandatory',
                toolName: 'write_file',
            },
            sessionId: 'session-sub',
            timestamp: new Date(),
            type: ApprovalType.TOOL_APPROVAL,
        });

        expect(parentHandler).toHaveBeenCalledWith(
            expect.objectContaining({ autoApproval: 'disallowed' })
        );
    });
});

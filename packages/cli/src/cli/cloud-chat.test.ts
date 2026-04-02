import { describe, expect, it, vi } from 'vitest';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import { buildCloudApprovalDecision, createCloudAgentBackend } from './cloud-chat.js';
import { createDeployClient } from './commands/deploy/client.js';

type DeployClient = ReturnType<typeof createDeployClient>;

describe('buildCloudApprovalDecision', () => {
    it('extracts only the raw formData payload for approved approvals', () => {
        const decision = buildCloudApprovalDecision({
            approvalId: 'approval-1',
            status: ApprovalStatus.APPROVED,
            sessionId: 'session-1',
            data: {
                rememberChoice: true,
                rememberPattern: '*.ts',
                rememberDirectory: true,
                formData: { answer: 'yes' },
            },
        });

        expect(decision).toEqual({
            status: ApprovalStatus.APPROVED,
            formData: { answer: 'yes' },
            rememberChoice: true,
            rememberPattern: '*.ts',
            rememberDirectory: true,
        });
    });

    it('preserves denial metadata without injecting approved-only fields', () => {
        const decision = buildCloudApprovalDecision({
            approvalId: 'approval-2',
            status: ApprovalStatus.DENIED,
            sessionId: 'session-1',
            reason: DenialReason.USER_DENIED,
            message: 'No',
        });

        expect(decision).toEqual({
            status: ApprovalStatus.DENIED,
            reason: DenialReason.USER_DENIED,
            message: 'No',
        });
    });
});

describe('createCloudAgentBackend', () => {
    it('clears remote context without emitting session reset', async () => {
        const clearCloudAgentSessionContext = vi.fn(async () => {});
        const backend = createCloudAgentBackend(
            {
                clearCloudAgentSessionContext,
            } as unknown as DeployClient,
            'cloud-agent-1'
        );

        const onReset = vi.fn();
        const onCleared = vi.fn();
        backend.on('session:reset', onReset);
        backend.on('context:cleared', onCleared);

        await backend.clearContext('session-1');

        expect(clearCloudAgentSessionContext).toHaveBeenCalledWith('cloud-agent-1', 'session-1');
        expect(onReset).not.toHaveBeenCalled();
        expect(onCleared).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });
});

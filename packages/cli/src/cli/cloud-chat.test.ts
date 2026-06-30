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
                formData: { answer: 'yes' },
            },
        });

        expect(decision).toEqual({
            status: ApprovalStatus.APPROVED,
            formData: { answer: 'yes' },
            rememberChoice: true,
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

    it('stores in-flight steer messages for TUI preview and editing', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');
        const onQueued = vi.fn();
        const onRemoved = vi.fn();
        backend.on('message:queued', onQueued);
        backend.on('message:removed', onRemoved);

        const result = await backend.steer('session-1', {
            content: [{ type: 'text', text: 'adjust this turn' }],
        });

        expect(result).toMatchObject({
            queued: true,
            position: 1,
        });
        expect(await backend.getSteerMessages('session-1')).toEqual([
            expect.objectContaining({
                id: result.id,
                content: [{ type: 'text', text: 'adjust this turn' }],
            }),
        ]);
        expect(onQueued).toHaveBeenCalledWith({
            id: result.id,
            position: 1,
            queue: 'steer',
            sessionId: 'session-1',
        });

        await expect(backend.removeSteerMessage('session-1', result.id)).resolves.toBe(true);
        expect(await backend.getSteerMessages('session-1')).toEqual([]);
        expect(onRemoved).toHaveBeenCalledWith({
            id: result.id,
            queue: 'steer',
            sessionId: 'session-1',
        });
    });

    it('clears stored steer messages for a cloud session', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');

        await backend.steer('session-1', {
            content: [{ type: 'text', text: 'first' }],
        });
        await backend.steer('session-1', {
            content: [{ type: 'text', text: 'second' }],
        });

        await expect(backend.clearSteerQueue('session-1')).resolves.toBe(2);
        expect(await backend.getSteerMessages('session-1')).toEqual([]);
    });

    it('stores follow-up messages separately from steer messages for TUI preview and editing', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');
        const onQueued = vi.fn();
        const onRemoved = vi.fn();
        backend.on('message:queued', onQueued);
        backend.on('message:removed', onRemoved);

        const steer = await backend.steer('session-1', {
            content: [{ type: 'text', text: 'active steer' }],
        });
        const followUp = await backend.followUp('session-1', {
            content: [{ type: 'text', text: 'next task' }],
        });

        expect(await backend.getSteerMessages('session-1')).toEqual([
            expect.objectContaining({
                id: steer.id,
                content: [{ type: 'text', text: 'active steer' }],
            }),
        ]);
        expect(await backend.getFollowUpMessages('session-1')).toEqual([
            expect.objectContaining({
                id: followUp.id,
                content: [{ type: 'text', text: 'next task' }],
            }),
        ]);
        expect(onQueued).toHaveBeenLastCalledWith({
            id: followUp.id,
            position: 1,
            queue: 'follow-up',
            sessionId: 'session-1',
        });

        await expect(backend.removeFollowUpMessage('session-1', followUp.id)).resolves.toBe(true);
        expect(await backend.getFollowUpMessages('session-1')).toEqual([]);
        expect(await backend.getSteerMessages('session-1')).toHaveLength(1);
        expect(onRemoved).toHaveBeenCalledWith({
            id: followUp.id,
            queue: 'follow-up',
            sessionId: 'session-1',
        });
    });

    it('clears stored follow-up messages for a cloud session', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');

        await backend.followUp('session-1', {
            content: [{ type: 'text', text: 'first' }],
        });
        await backend.followUp('session-1', {
            content: [{ type: 'text', text: 'second' }],
        });

        await expect(backend.clearFollowUpQueue('session-1')).resolves.toBe(2);
        expect(await backend.getFollowUpMessages('session-1')).toEqual([]);
    });

    it('rejects unsupported steer attachments before storing the message', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');

        await expect(
            backend.steer('session-1', {
                content: [{ type: 'image', image: 'data', mimeType: 'image/png' }],
            })
        ).rejects.toThrow('Image and file attachments');
        expect(await backend.getSteerMessages('session-1')).toEqual([]);
    });

    it('does not emit removal events for missing steer messages', async () => {
        const backend = createCloudAgentBackend({} as unknown as DeployClient, 'cloud-agent-1');
        const onRemoved = vi.fn();
        backend.on('message:removed', onRemoved);

        await expect(backend.removeSteerMessage('session-1', 'missing')).resolves.toBe(false);
        expect(onRemoved).not.toHaveBeenCalled();
    });
});

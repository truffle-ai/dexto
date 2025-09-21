import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserApprovalProvider } from './user-approval-provider.js';
import { AgentEventBus } from '../../events/index.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';

describe('UserApprovalProvider', () => {
    let userApprovalProvider: UserApprovalProvider;
    let mockAllowedToolsProvider: IAllowedToolsProvider;
    let agentEventBus: AgentEventBus;

    beforeEach(() => {
        agentEventBus = new AgentEventBus();
        mockAllowedToolsProvider = {
            isToolAllowed: vi.fn().mockResolvedValue(false),
            allowTool: vi.fn().mockResolvedValue(undefined),
            clearAllowedTools: vi.fn().mockResolvedValue(undefined),
            getAllowedTools: vi.fn().mockResolvedValue([]),
        };

        userApprovalProvider = new UserApprovalProvider(mockAllowedToolsProvider, agentEventBus, {
            confirmationTimeout: 1000,
        });
    });

    describe('Tool Confirmation', () => {
        it('should emit toolConfirmationRequest event', async () => {
            const eventPromise = new Promise((resolve) => {
                agentEventBus.once('dexto:toolConfirmationRequest', resolve);
            });

            // Start the confirmation request (but don't wait for it)
            const confirmationPromise = userApprovalProvider.requestConfirmation({
                toolName: 'test_tool',
                args: { param: 'value' },
                sessionId: 'session-123',
            });

            // Verify the event was emitted
            const event = await eventPromise;
            expect(event).toMatchObject({
                toolName: 'test_tool',
                args: { param: 'value' },
                sessionId: 'session-123',
                executionId: expect.any(String),
                timestamp: expect.any(Date),
            });

            // Send a response to complete the promise
            agentEventBus.emit('dexto:toolConfirmationResponse', {
                executionId: (event as any).executionId,
                approved: true,
                sessionId: 'session-123',
            });

            const result = await confirmationPromise;
            expect(result).toBe(true);
        });

        it('should handle tool confirmation timeout', async () => {
            const confirmationPromise = userApprovalProvider.requestConfirmation({
                toolName: 'test_tool',
                args: { param: 'value' },
            });

            await expect(confirmationPromise).rejects.toThrow('timed out');
        });
    });

    describe('Elicitation', () => {
        it('should emit elicitationRequest event', async () => {
            const eventPromise = new Promise((resolve) => {
                agentEventBus.once('dexto:elicitationRequest', resolve);
            });

            // Start the elicitation request (but don't wait for it)
            const elicitationPromise = userApprovalProvider.requestElicitation({
                message: 'Please provide your username',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        username: { type: 'string' },
                    },
                    required: ['username'],
                },
                sessionId: 'session-123',
            });

            // Verify the event was emitted
            const event = await eventPromise;
            expect(event).toMatchObject({
                message: 'Please provide your username',
                requestedSchema: {
                    type: 'object',
                    properties: {
                        username: { type: 'string' },
                    },
                    required: ['username'],
                },
                sessionId: 'session-123',
                executionId: expect.any(String),
                timestamp: expect.any(Date),
            });

            // Send a response to complete the promise
            agentEventBus.emit('dexto:elicitationResponse', {
                executionId: (event as any).executionId,
                action: 'accept',
                data: { username: 'testuser' },
                sessionId: 'session-123',
            });

            const result = await elicitationPromise;
            expect(result).toEqual({
                executionId: (event as any).executionId,
                action: 'accept',
                data: { username: 'testuser' },
                sessionId: 'session-123',
            });
        });

        it('should handle elicitation decline', async () => {
            const eventPromise = new Promise((resolve) => {
                agentEventBus.once('dexto:elicitationRequest', resolve);
            });

            const elicitationPromise = userApprovalProvider.requestElicitation({
                message: 'Please provide your username',
                requestedSchema: { type: 'object' },
            });

            const event = await eventPromise;

            // Send a decline response
            agentEventBus.emit('dexto:elicitationResponse', {
                executionId: (event as any).executionId,
                action: 'decline',
            });

            const result = await elicitationPromise;
            expect(result.action).toBe('decline');
            expect(result.data).toBeUndefined();
        });

        it('should handle elicitation timeout', async () => {
            const elicitationPromise = userApprovalProvider.requestElicitation({
                message: 'Please provide your username',
                requestedSchema: { type: 'object' },
            });

            await expect(elicitationPromise).rejects.toThrow('timed out');
        });
    });

    describe('Pending Requests Management', () => {
        it('should track pending confirmations', async () => {
            expect(userApprovalProvider.getPendingConfirmations()).toHaveLength(0);

            const eventPromise = new Promise((resolve) => {
                agentEventBus.once('dexto:toolConfirmationRequest', resolve);
            });

            // Start a confirmation request but don't wait for it
            const confirmationPromise = userApprovalProvider.requestConfirmation({
                toolName: 'test_tool',
                args: {},
            });

            // Wait for the event to be emitted, which means the request is pending
            const event = await eventPromise;
            expect(userApprovalProvider.getPendingConfirmations()).toHaveLength(1);

            // Respond to complete the test cleanly
            agentEventBus.emit('dexto:toolConfirmationResponse', {
                executionId: (event as any).executionId,
                approved: false,
            });

            await confirmationPromise;
            expect(userApprovalProvider.getPendingConfirmations()).toHaveLength(0);
        });

        it('should track pending elicitations', async () => {
            expect(userApprovalProvider.getPendingElicitations()).toHaveLength(0);

            const eventPromise = new Promise((resolve) => {
                agentEventBus.once('dexto:elicitationRequest', resolve);
            });

            const elicitationPromise = userApprovalProvider.requestElicitation({
                message: 'Test',
                requestedSchema: { type: 'object' },
            });

            // Wait for the event to be emitted, which means the request is pending
            const event = await eventPromise;
            expect(userApprovalProvider.getPendingElicitations()).toHaveLength(1);

            // Respond to complete the test cleanly
            agentEventBus.emit('dexto:elicitationResponse', {
                executionId: (event as any).executionId,
                action: 'cancel',
            });

            await elicitationPromise;
            expect(userApprovalProvider.getPendingElicitations()).toHaveLength(0);
        });
    });
});

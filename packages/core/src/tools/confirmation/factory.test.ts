import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToolConfirmationProvider } from './factory.js';
import { ApprovalBasedConfirmationProvider } from './approval-based-confirmation-provider.js';
import { NoOpConfirmationProvider } from './noop-confirmation-provider.js';
import { InMemoryAllowedToolsProvider } from './allowed-tools-provider/in-memory.js';
import { AgentEventBus } from '../../events/index.js';
import { ErrorScope, ErrorType } from '@core/errors/index.js';
import { ApprovalErrorCode } from '../../approval/error-codes.js';
import { ApprovalManager } from '../../approval/manager.js';

describe('Tool Confirmation Factory', () => {
    let agentEventBus: AgentEventBus;
    let approvalManager: ApprovalManager;

    beforeEach(() => {
        agentEventBus = new AgentEventBus();
        approvalManager = new ApprovalManager(agentEventBus, {
            mode: 'event-based',
            timeout: 120000,
        });
    });

    describe('createToolConfirmationProvider', () => {
        let allowedToolsProvider: InMemoryAllowedToolsProvider;

        beforeEach(() => {
            allowedToolsProvider = new InMemoryAllowedToolsProvider();
        });

        it('should create approval-based provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                approvalManager,
            });
            expect(provider).toBeInstanceOf(ApprovalBasedConfirmationProvider);
        });

        it('should create auto-approve provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'auto-approve',
                allowedToolsProvider,
            });
            expect(provider).toBeInstanceOf(NoOpConfirmationProvider);
        });

        it('should create auto-deny provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'auto-deny',
                allowedToolsProvider,
            });
            expect(provider).toBeInstanceOf(NoOpConfirmationProvider);
        });

        it('should use provided allowed tools provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                approvalManager,
            });
            expect(provider.allowedToolsProvider).toBe(allowedToolsProvider);
        });

        it('should pass approval manager to approval-based provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                approvalManager,
            });
            expect(provider).toBeInstanceOf(ApprovalBasedConfirmationProvider);
        });

        it('should reject after the configured confirmation timeout if no response arrives', async () => {
            vi.useFakeTimers();

            // Create approval manager with short timeout
            const shortTimeoutApprovalManager = new ApprovalManager(agentEventBus, {
                mode: 'event-based',
                timeout: 5000,
            });

            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                approvalManager: shortTimeoutApprovalManager,
            });

            const confirmationPromise = provider.requestConfirmation({
                toolName: 'needsConfirmation',
                args: {},
            });

            // Advance timers to just before timeout
            await vi.advanceTimersByTimeAsync(4999);
            await expect(
                Promise.race([confirmationPromise, Promise.resolve('pending')])
            ).resolves.toBe('pending');

            // Cross the timeout threshold
            await vi.advanceTimersByTimeAsync(1);
            await expect(confirmationPromise).rejects.toMatchObject({
                code: ApprovalErrorCode.APPROVAL_TIMEOUT,
                scope: ErrorScope.TOOLS,
                type: ErrorType.TIMEOUT,
            });

            vi.useRealTimers();
        });
    });

    describe('NoOpConfirmationProvider behavior', () => {
        let allowedToolsProvider: InMemoryAllowedToolsProvider;

        beforeEach(() => {
            allowedToolsProvider = new InMemoryAllowedToolsProvider();
        });

        it('should auto-approve when created with auto-approve mode', async () => {
            const provider = createToolConfirmationProvider({
                mode: 'auto-approve',
                allowedToolsProvider,
            });
            const result = await provider.requestConfirmation({
                toolName: 'testTool',
                args: {},
            });
            expect(result).toBe(true);
        });

        it('should auto-deny when created with auto-deny mode', async () => {
            const provider = createToolConfirmationProvider({
                mode: 'auto-deny',
                allowedToolsProvider,
            });
            const result = await provider.requestConfirmation({
                toolName: 'testTool',
                args: {},
            });
            expect(result).toBe(false);
        });
    });
});

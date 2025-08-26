import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createToolConfirmationProvider } from './factory.js';
import { EventBasedConfirmationProvider } from './event-based-confirmation-provider.js';
import { NoOpConfirmationProvider } from './noop-confirmation-provider.js';
import { InMemoryAllowedToolsProvider } from './allowed-tools-provider/in-memory.js';
import { AgentEventBus } from '../../events/index.js';
import { ErrorScope, ErrorType } from '@core/errors/index.js';
import { ToolErrorCode } from '../error-codes.js';

describe('Tool Confirmation Factory', () => {
    let agentEventBus: AgentEventBus;

    beforeEach(() => {
        agentEventBus = new AgentEventBus();
    });

    describe('createToolConfirmationProvider', () => {
        let allowedToolsProvider: InMemoryAllowedToolsProvider;

        beforeEach(() => {
            allowedToolsProvider = new InMemoryAllowedToolsProvider();
        });

        it('should create event-based provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                confirmationTimeout: 30000,
                agentEventBus,
            });
            expect(provider).toBeInstanceOf(EventBasedConfirmationProvider);
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
                confirmationTimeout: 30000,
                agentEventBus,
            });
            expect(provider.allowedToolsProvider).toBe(allowedToolsProvider);
        });

        it('should pass confirmation timeout to event-based provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                confirmationTimeout: 5000,
                agentEventBus,
            });
            expect(provider).toBeInstanceOf(EventBasedConfirmationProvider);
        });

        it('should reject after the configured confirmation timeout if no response arrives', async () => {
            vi.useFakeTimers();
            const provider = createToolConfirmationProvider({
                mode: 'event-based',
                allowedToolsProvider,
                confirmationTimeout: 5000,
                agentEventBus,
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
                code: ToolErrorCode.CONFIRMATION_TIMEOUT,
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

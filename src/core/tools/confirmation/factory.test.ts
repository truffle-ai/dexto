import { describe, it, expect, beforeEach } from 'vitest';
import { createToolConfirmationProvider } from './factory.js';
import { EventBasedConfirmationProvider } from './event-based-confirmation-provider.js';
import { NoOpConfirmationProvider } from './noop-confirmation-provider.js';
import { InMemoryAllowedToolsProvider } from './allowed-tools-provider/in-memory.js';
import { AgentEventBus } from '../../events/index.js';

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
                confirmationTimeout: 30000,
                agentEventBus,
            });
            expect(provider).toBeInstanceOf(NoOpConfirmationProvider);
        });

        it('should create auto-deny provider', () => {
            const provider = createToolConfirmationProvider({
                mode: 'auto-deny',
                allowedToolsProvider,
                confirmationTimeout: 30000,
                agentEventBus,
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
                confirmationTimeout: 30000,
                agentEventBus,
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
                confirmationTimeout: 30000,
                agentEventBus,
            });
            const result = await provider.requestConfirmation({
                toolName: 'testTool',
                args: {},
            });
            expect(result).toBe(false);
        });
    });
});

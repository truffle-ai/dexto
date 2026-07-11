import { describe, expect, it, vi } from 'vitest';
import { AgentEventBus, EVENT_LISTENER_CLEANUP_REASON } from '../events/index.js';
import { createMockLogger } from '../logger/v2/test-utils.js';
import { MCPManager } from '../mcp/manager.js';
import { InMemoryDextoStores } from '../storage/index.js';
import { ResourceManager } from './manager.js';

describe('ResourceManager cleanup', () => {
    it('removes notification listeners without creating a default AbortError', () => {
        const eventBus = new AgentEventBus();
        const onSpy = vi.spyOn(eventBus, 'on');
        const invalidated = vi.fn();
        eventBus.on('resource:cache-invalidated', invalidated);
        const logger = createMockLogger();
        const manager = new ResourceManager(
            new MCPManager(logger, eventBus),
            {
                artifactStore: new InMemoryDextoStores().getStore('artifacts'),
                resourcesConfig: [],
            },
            eventBus,
            logger
        );
        const cleanupSignal = onSpy.mock.calls.find(
            ([eventName]) => eventName === 'mcp:resource-updated'
        )?.[2]?.signal;

        eventBus.emit('mcp:resource-updated', {
            resourceUri: 'resource://before-cleanup',
            serverName: 'test-server',
        });
        expect(invalidated).toHaveBeenCalledTimes(1);

        manager.cleanup();
        manager.cleanup();

        expect(cleanupSignal?.aborted).toBe(true);
        expect(cleanupSignal?.reason).toBe(EVENT_LISTENER_CLEANUP_REASON);
        expect(cleanupSignal?.reason).not.toBeInstanceOf(globalThis.DOMException);

        eventBus.emit('mcp:resource-updated', {
            resourceUri: 'resource://after-cleanup',
            serverName: 'test-server',
        });
        expect(invalidated).toHaveBeenCalledTimes(1);
    });
});

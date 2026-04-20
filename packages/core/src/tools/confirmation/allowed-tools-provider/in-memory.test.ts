import { describe, expect, it } from 'vitest';
import { InMemoryAllowedToolsProvider } from './in-memory.js';

describe('InMemoryAllowedToolsProvider', () => {
    it('should reject missing sessionId on read paths', async () => {
        const provider = new InMemoryAllowedToolsProvider();

        await expect(
            (
                provider as unknown as {
                    isToolAllowed(toolName: string): Promise<boolean>;
                }
            ).isToolAllowed('test-tool')
        ).rejects.toThrow('sessionId is required for remembered tool approvals');

        await expect(
            (
                provider as unknown as {
                    getAllowedTools(): Promise<Set<string>>;
                }
            ).getAllowedTools()
        ).rejects.toThrow('sessionId is required for remembered tool approvals');
    });

    it('should not create empty session buckets during reads', async () => {
        const provider = new InMemoryAllowedToolsProvider();
        const store = (provider as unknown as { store: Map<string, Set<string>> }).store;

        expect(await provider.isToolAllowed('test-tool', 'session-1')).toBe(false);
        expect(await provider.getAllowedTools('session-1')).toEqual(new Set());
        expect(store.has('session-1')).toBe(false);
    });
});

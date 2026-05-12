import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageAllowedToolsProvider } from './storage.js';
import type { ToolPreferenceStore } from '../../../storage/index.js';
import { createMockLogger } from '../../../logger/v2/test-utils.js';

const mockLogger = createMockLogger();

describe('StorageAllowedToolsProvider', () => {
    let provider: StorageAllowedToolsProvider;
    let toolPreferenceStore: ToolPreferenceStore;

    beforeEach(() => {
        toolPreferenceStore = {
            allowTool: vi.fn().mockResolvedValue(undefined),
            disallowTool: vi.fn().mockResolvedValue(undefined),
            isToolAllowed: vi.fn().mockResolvedValue(false),
            listAllowedTools: vi.fn().mockResolvedValue([]),
            loadSessionPreferences: vi.fn().mockResolvedValue({ allowedTools: new Set() }),
            saveSessionPreferences: vi.fn().mockResolvedValue(undefined),
            deleteSessionPreferences: vi.fn().mockResolvedValue(undefined),
        };

        provider = new StorageAllowedToolsProvider(toolPreferenceStore, mockLogger);
    });

    it('stores session-scoped tool approval', async () => {
        await provider.allowTool('testTool', 'session123');

        expect(toolPreferenceStore.allowTool).toHaveBeenCalledWith({
            toolName: 'testTool',
            sessionId: 'session123',
        });
    });

    it('stores global tool approval when no sessionId is provided', async () => {
        await provider.allowTool('testTool');

        expect(toolPreferenceStore.allowTool).toHaveBeenCalledWith({
            toolName: 'testTool',
        });
    });

    it('checks session-scoped approval', async () => {
        vi.mocked(toolPreferenceStore.isToolAllowed).mockResolvedValue(true);

        const result = await provider.isToolAllowed('sessionTool', 'session123');

        expect(result).toBe(true);
        expect(toolPreferenceStore.isToolAllowed).toHaveBeenCalledWith({
            toolName: 'sessionTool',
            sessionId: 'session123',
        });
    });

    it('removes session-scoped approval', async () => {
        await provider.disallowTool('tool2', 'session123');

        expect(toolPreferenceStore.disallowTool).toHaveBeenCalledWith({
            toolName: 'tool2',
            sessionId: 'session123',
        });
    });

    it('returns allowed tools as a Set', async () => {
        vi.mocked(toolPreferenceStore.listAllowedTools).mockResolvedValue(['tool1', 'tool2']);

        const result = await provider.getAllowedTools('session123');

        expect(result).toEqual(new Set(['tool1', 'tool2']));
        expect(toolPreferenceStore.listAllowedTools).toHaveBeenCalledWith({
            sessionId: 'session123',
        });
    });
});

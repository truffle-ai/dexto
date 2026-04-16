import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageAllowedToolsProvider } from './storage.js';
import type { StorageManager } from '../../../storage/index.js';
import { createMockLogger } from '../../../logger/v2/test-utils.js';

const mockLogger = createMockLogger();

describe('StorageAllowedToolsProvider', () => {
    let provider: StorageAllowedToolsProvider;
    let mockStorageManager: StorageManager;
    let mockDatabase: any;

    beforeEach(() => {
        mockDatabase = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            list: vi.fn(),
        };

        mockStorageManager = {
            getDatabase: vi.fn().mockReturnValue(mockDatabase),
            getCache: vi.fn(),
        } as any;

        provider = new StorageAllowedToolsProvider(mockStorageManager, mockLogger);
    });

    describe('Session-scoped tool allowance', () => {
        it('should store session-scoped tool approval', async () => {
            mockDatabase.get.mockResolvedValue([]);

            await provider.allowTool('testTool', 'session123');

            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:session123', ['testTool']);
        });

        it('should reject missing sessionId when storing approvals', async () => {
            await expect(
                (provider as unknown as { allowTool(toolName: string): Promise<void> }).allowTool(
                    'testTool'
                )
            ).rejects.toThrow('sessionId is required');
        });

        it('should append to existing session-scoped approvals', async () => {
            mockDatabase.get.mockResolvedValue(['existingTool']);

            await provider.allowTool('newTool', 'session123');

            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:session123', [
                'existingTool',
                'newTool',
            ]);
        });

        it('should not duplicate tools in approval list', async () => {
            mockDatabase.get.mockResolvedValue(['testTool']);

            await provider.allowTool('testTool', 'session123');

            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:session123', ['testTool']);
        });
    });

    describe('Session-scoped tool checking', () => {
        it('should check session-scoped approvals first', async () => {
            mockDatabase.get
                .mockResolvedValueOnce(['sessionTool']) // session-scoped
                .mockResolvedValueOnce(['globalTool']); // global

            const result = await provider.isToolAllowed('sessionTool', 'session123');

            expect(result).toBe(true);
            expect(mockDatabase.get).toHaveBeenCalledWith('allowedTools:session123');
        });

        it('should not use approvals from other sessions', async () => {
            mockDatabase.get.mockResolvedValueOnce([]);

            const result = await provider.isToolAllowed('globalTool', 'session123');

            expect(result).toBe(false);
            expect(mockDatabase.get).toHaveBeenCalledWith('allowedTools:session123');
        });

        it('should return false when tool not found in session or global', async () => {
            mockDatabase.get
                .mockResolvedValueOnce([]) // session-scoped (empty)
                .mockResolvedValueOnce([]); // global (empty)

            const result = await provider.isToolAllowed('unknownTool', 'session123');

            expect(result).toBe(false);
        });

        it('should reject missing sessionId when checking approvals', async () => {
            await expect(
                (
                    provider as unknown as { isToolAllowed(toolName: string): Promise<boolean> }
                ).isToolAllowed('globalTool')
            ).rejects.toThrow('sessionId is required');
        });
    });

    describe('Session-scoped tool removal', () => {
        it('should remove tool from session-scoped approvals', async () => {
            mockDatabase.get.mockResolvedValue(['tool1', 'tool2', 'tool3']);

            await provider.disallowTool('tool2', 'session123');

            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:session123', [
                'tool1',
                'tool3',
            ]);
        });

        it('should reject missing sessionId when removing approvals', async () => {
            await expect(
                (
                    provider as unknown as {
                        disallowTool(toolName: string): Promise<void>;
                    }
                ).disallowTool('tool1')
            ).rejects.toThrow('sessionId is required');
        });

        it('should handle removal of non-existent tool gracefully', async () => {
            mockDatabase.get.mockResolvedValue(['tool1']);

            await provider.disallowTool('nonExistent', 'session123');

            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:session123', ['tool1']);
        });

        it('should not call set when storage returns non-array', async () => {
            mockDatabase.get.mockResolvedValue(null);

            await provider.disallowTool('tool1', 'session123');

            expect(mockDatabase.set).not.toHaveBeenCalled();
        });
    });

    describe('getAllowedTools', () => {
        it('should return session-scoped tools as Set', async () => {
            mockDatabase.get.mockResolvedValue(['tool1', 'tool2']);

            const result = await provider.getAllowedTools('session123');

            expect(result).toEqual(new Set(['tool1', 'tool2']));
            expect(mockDatabase.get).toHaveBeenCalledWith('allowedTools:session123');
        });

        it('should reject missing sessionId when listing approvals', async () => {
            await expect(
                (
                    provider as unknown as { getAllowedTools(): Promise<Set<string>> }
                ).getAllowedTools()
            ).rejects.toThrow('sessionId is required');
        });

        it('should return empty Set when no tools stored', async () => {
            mockDatabase.get.mockResolvedValue(null);

            const result = await provider.getAllowedTools('session123');

            expect(result).toEqual(new Set());
        });
    });

    describe('Error handling', () => {
        it('should handle storage errors gracefully', async () => {
            mockDatabase.get.mockRejectedValue(new Error('Storage error'));

            await expect(provider.isToolAllowed('testTool', 'session123')).rejects.toThrow(
                'Storage error'
            );
        });

        it('should handle malformed data in storage', async () => {
            mockDatabase.get.mockResolvedValue('invalid-data');

            const result = await provider.isToolAllowed('testTool', 'session123');

            expect(result).toBe(false);
        });
    });

    describe('Key naming convention', () => {
        it('should use correct key format for session-scoped storage', async () => {
            mockDatabase.get.mockResolvedValue([]);

            await provider.allowTool('testTool', 'user-session-456');

            expect(mockDatabase.get).toHaveBeenCalledWith('allowedTools:user-session-456');
            expect(mockDatabase.set).toHaveBeenCalledWith('allowedTools:user-session-456', [
                'testTool',
            ]);
        });

        it('should reject missing sessionId before building a storage key', async () => {
            await expect(
                (provider as unknown as { allowTool(toolName: string): Promise<void> }).allowTool(
                    'testTool'
                )
            ).rejects.toThrow('sessionId is required');
        });
    });
});

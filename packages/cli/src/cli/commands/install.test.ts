import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';

// Mock @dexto/core partially: preserve real exports and override specific functions
vi.mock('@dexto/core', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        getDextoGlobalPath: vi.fn(),
    };
});

// Mock @dexto/agent-management
vi.mock('@dexto/agent-management', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        resolveBundledScript: vi.fn(),
    };
});

// Mock agent-helpers
vi.mock('../../utils/agent-helpers.js', () => ({
    installBundledAgent: vi.fn(),
    installCustomAgent: vi.fn(),
    listInstalledAgents: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    statSync: vi.fn(),
    readFileSync: vi.fn(),
}));

// Mock @clack/prompts
vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    text: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(),
}));

// Mock analytics
vi.mock('../../analytics/index.js', () => ({
    capture: vi.fn(),
}));

// Import SUT after mocks
import { handleInstallCommand } from './install.js';
import {
    installBundledAgent,
    installCustomAgent,
    listInstalledAgents,
} from '../../utils/agent-helpers.js';
import { resolveBundledScript } from '@dexto/agent-management';

describe('Install Command', () => {
    let consoleSpy: any;
    const mockBundledRegistry = {
        'test-agent': {
            name: 'Test Agent',
            description: 'Test agent',
            author: 'Test',
            tags: ['test'],
            source: 'test.yml',
        },
        'other-agent': {
            name: 'Other Agent',
            description: 'Other agent',
            author: 'Test',
            tags: ['test'],
            source: 'other.yml',
        },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        // Mock resolveBundledScript to return a fake path
        vi.mocked(resolveBundledScript).mockReturnValue('/mock/bundled/agents/agent-registry.json');

        // Mock fs.readFileSync to return bundled registry
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ agents: mockBundledRegistry }));

        // Mock agent helper functions
        vi.mocked(installBundledAgent).mockResolvedValue('/mock/path/agent.yml');
        vi.mocked(installCustomAgent).mockResolvedValue('/mock/path/custom-agent.yml');
        vi.mocked(listInstalledAgents).mockResolvedValue([]);

        // Mock existsSync to return false by default (agent not installed)
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Mock statSync to return file stats (default: file, not directory)
        vi.mocked(fs.statSync).mockReturnValue({
            isDirectory: () => false,
        } as any);

        // Mock console
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('Validation', () => {
        it('throws error when no agents specified and all flag is false', async () => {
            await expect(handleInstallCommand([], {})).rejects.toThrow();
        });

        it('throws error for unknown agents', async () => {
            await expect(handleInstallCommand(['test-agent', 'unknown-agent'], {})).rejects.toThrow(
                /Unknown agents.*unknown-agent/
            );
        });

        it('accepts valid agents', async () => {
            // Should not throw
            await handleInstallCommand(['test-agent'], {});

            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
        });
    });

    describe('Single agent installation', () => {
        it('installs single agent and applies preferences by default', async () => {
            await handleInstallCommand(['test-agent'], {});

            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-agent'));
        });

        it('respects force flag by calling installAgent without preferences injection', async () => {
            await handleInstallCommand(['test-agent'], { force: true });

            // Force flag doesn't affect preference injection - that's controlled by the options parameter
            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
        });
    });

    describe('Bulk installation (--all flag)', () => {
        it('installs all available agents when --all flag is used', async () => {
            await handleInstallCommand([], { all: true });

            // Should install both agents from mockBundledRegistry
            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
            expect(installBundledAgent).toHaveBeenCalledWith('other-agent', {
                injectPreferences: true,
            });
            expect(installBundledAgent).toHaveBeenCalledTimes(2);
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Installing all 2 available agents')
            );
        });

        it('ignores agent list when --all flag is used', async () => {
            await handleInstallCommand(['should-be-ignored'], { all: true });

            // Should install bundled agents, not the specified one
            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
            expect(installBundledAgent).toHaveBeenCalledWith('other-agent', {
                injectPreferences: true,
            });
            expect(installBundledAgent).not.toHaveBeenCalledWith(
                'should-be-ignored',
                expect.anything()
            );
        });
    });

    describe('Error handling', () => {
        it('continues installing other agents when one fails', async () => {
            vi.mocked(installBundledAgent).mockImplementation(async (agentId: string) => {
                if (agentId === 'other-agent') {
                    throw new Error('Installation failed');
                }
                return '/path/to/agent.yml';
            });

            // Should not throw - partial success is acceptable
            await handleInstallCommand(['test-agent', 'other-agent'], {});

            expect(installBundledAgent).toHaveBeenCalledTimes(2);
            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
            expect(installBundledAgent).toHaveBeenCalledWith('other-agent', {
                injectPreferences: true,
            });
        });

        it('throws when single agent installation fails', async () => {
            vi.mocked(installBundledAgent).mockRejectedValue(new Error('Installation failed'));

            // Single agent failure should propagate the error directly
            await expect(handleInstallCommand(['test-agent'], {})).rejects.toThrow();
        });
    });

    describe('Custom agent installation from file paths', () => {
        let mockPrompts: any;

        beforeEach(async () => {
            const prompts = await import('@clack/prompts');
            mockPrompts = {
                intro: vi.mocked(prompts.intro),
                text: vi.mocked(prompts.text),
                outro: vi.mocked(prompts.outro),
                isCancel: vi.mocked(prompts.isCancel),
            };

            // Default prompt responses
            mockPrompts.text.mockImplementation(async (opts: any) => {
                if (opts.message.includes('Agent name')) return 'my-custom-agent';
                if (opts.message.includes('Description')) return 'Test description';
                if (opts.message.includes('Author')) return 'Test Author';
                if (opts.message.includes('Tags')) return 'custom, test';
                return '';
            });
            mockPrompts.isCancel.mockReturnValue(false);
        });

        it('detects file paths and installs custom agent', async () => {
            // Mock existsSync: source file exists, installed path does not
            vi.mocked(fs.existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('my-agent.yml')) return true;
                return false; // Not installed yet
            });

            await handleInstallCommand(['./my-agent.yml'], {});

            expect(installCustomAgent).toHaveBeenCalledWith(
                'my-custom-agent',
                expect.stringContaining('my-agent.yml'),
                {
                    name: 'my-custom-agent',
                    description: 'Test description',
                    author: 'Test Author',
                    tags: ['custom', 'test'],
                },
                { injectPreferences: true }
            );
        });

        it('detects paths with forward slashes', async () => {
            vi.mocked(fs.existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('custom.yml')) return true;
                return false;
            });

            await handleInstallCommand(['./agents/custom.yml'], {});

            expect(installCustomAgent).toHaveBeenCalled();
        });

        it('validates file exists before installation', async () => {
            vi.mocked(fs.existsSync).mockReturnValue(false);

            await expect(handleInstallCommand(['./nonexistent.yml'], {})).rejects.toThrow(
                /File not found/
            );

            expect(installCustomAgent).not.toHaveBeenCalled();
        });

        it('treats non-path strings as registry names', async () => {
            await handleInstallCommand(['test-agent'], {});

            // Should use bundled agent installation, not custom
            expect(installBundledAgent).toHaveBeenCalledWith('test-agent', {
                injectPreferences: true,
            });
            expect(installCustomAgent).not.toHaveBeenCalled();
        });

        it('respects injectPreferences flag for custom agents', async () => {
            vi.mocked(fs.existsSync).mockImplementation((path: any) => {
                if (path.toString().includes('agent.yml')) return true;
                return false;
            });

            await handleInstallCommand(['./agent.yml'], { injectPreferences: false });

            expect(installCustomAgent).toHaveBeenCalledWith(
                expect.any(String),
                expect.any(String),
                expect.any(Object),
                { injectPreferences: false }
            );
        });
    });
});

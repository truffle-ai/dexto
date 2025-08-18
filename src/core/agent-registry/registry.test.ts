// TODO: Re-enable these tests after implementing agent installation system
// Currently the registry resolution logic assumes agents are already installed
// but we haven't implemented the installation step that copies agents from
// bundle to ~/.dexto/agents/. These tests will be valuable once installation
// is implemented in phase 3.

/*
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { LocalAgentRegistry } from './registry.js';

// Mock the bundled script resolver and fs functions
vi.mock('@core/utils/path.js', async () => {
    const actual = await vi.importActual('@core/utils/path.js');
    return {
        ...actual,
        resolveBundledScript: vi.fn(),
        getDextoGlobalPath: vi.fn(),
    };
});

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    };
});

describe('LocalAgentRegistry', () => {
    let registry: LocalAgentRegistry;
    
    const mockExistsSync = vi.mocked(fs.existsSync);
    const mockReadFileSync = vi.mocked(fs.readFileSync);

    beforeEach(async () => {
        vi.clearAllMocks();
        registry = new LocalAgentRegistry();
        
        // Get mocks after imports are resolved
        const { resolveBundledScript, getDextoGlobalPath } = await import('@core/utils/path.js');
        const mockResolveBundledScript = vi.mocked(resolveBundledScript);
        const mockGetDextoGlobalPath = vi.mocked(getDextoGlobalPath);
        
        // Default setup - registry file exists and has test data
        mockResolveBundledScript.mockReturnValue('/mock/agents/agent-registry.json');
        mockGetDextoGlobalPath.mockReturnValue('/home/user/.dexto/agents');
        mockExistsSync.mockImplementation((path) => {
            if (path === '/mock/agents/agent-registry.json') return true;
            return false; // Default to not existing
        });
        mockReadFileSync.mockImplementation((path) => {
            if (path === '/mock/agents/agent-registry.json') {
                return JSON.stringify({
                    version: '1.0.0',
                    agents: {
                        'test-agent': {
                            description: 'Test agent',
                            author: 'Test',
                            tags: ['test'],
                            source: 'test-agent/',
                            main: 'test-agent.yml'
                        }
                    }
                });
            }
            return '';
        });
    });

    describe('path detection', () => {
        it('identifies absolute paths correctly', async () => {
            mockExistsSync.mockReturnValue(false);
            
            await expect(registry.resolveAgent('/absolute/path/config.yml'))
                .rejects.toThrow();
        });

        it('identifies relative paths correctly', async () => {
            mockExistsSync.mockReturnValue(false);
            
            await expect(registry.resolveAgent('./relative/config.yml'))
                .rejects.toThrow();
            await expect(registry.resolveAgent('folder/config.yml'))
                .rejects.toThrow();
        });

        it('identifies file extensions correctly', async () => {
            mockExistsSync.mockReturnValue(false);
            
            await expect(registry.resolveAgent('config.yml'))
                .rejects.toThrow();
            await expect(registry.resolveAgent('config.yaml'))
                .rejects.toThrow();
        });

        it('identifies registry names correctly', async () => {
            // Known registry name that isn't installed
            await expect(registry.resolveAgent('test-agent'))
                .rejects.toThrow('not installed yet');
            
            // Unknown registry name
            await expect(registry.resolveAgent('unknown-agent'))
                .rejects.toThrow();
        });
    });

    describe('file path resolution', () => {
        it('resolves existing absolute paths', async () => {
            const testPath = '/test/config.yml';
            mockExistsSync.mockImplementation((path) => path === testPath);
            
            const result = await registry.resolveAgent(testPath);
            expect(result).toBe(testPath);
        });

        it('resolves existing relative paths', async () => {
            const testPath = './config.yml';
            const resolvedPath = path.resolve(testPath);
            mockExistsSync.mockImplementation((path) => path === resolvedPath);
            
            const result = await registry.resolveAgent(testPath);
            expect(result).toBe(resolvedPath);
        });

        it('throws for non-existent file paths', async () => {
            mockExistsSync.mockReturnValue(false);
            
            await expect(registry.resolveAgent('/non/existent/config.yml'))
                .rejects.toThrow();
        });
    });

    describe('registry name resolution', () => {
        it('handles known registry agents that are not installed', async () => {
            // test-agent exists in registry but not installed in ~/.dexto/agents/
            await expect(registry.resolveAgent('test-agent'))
                .rejects.toThrow('not installed yet');
        });

        it('handles unknown registry agents', async () => {
            await expect(registry.resolveAgent('unknown-agent'))
                .rejects.toThrow();
        });

        it('handles empty registry', async () => {
            mockReadFileSync.mockReturnValue(JSON.stringify({
                version: '1.0.0',
                agents: {}
            }));
            
            const emptyRegistry = new LocalAgentRegistry();
            await expect(emptyRegistry.resolveAgent('any-agent'))
                .rejects.toThrow();
        });

        it('handles missing registry file', async () => {
            mockExistsSync.mockReturnValue(false);
            
            const noRegistryAgent = new LocalAgentRegistry();
            await expect(noRegistryAgent.resolveAgent('any-agent'))
                .rejects.toThrow();
        });

        it('handles corrupted registry file', async () => {
            mockReadFileSync.mockReturnValue('invalid json');
            
            const corruptedRegistry = new LocalAgentRegistry();
            await expect(corruptedRegistry.resolveAgent('any-agent'))
                .rejects.toThrow();
        });
    });

    describe('installed agent resolution', () => {
        it('resolves installed registry agents', async () => {
            const installedPath = '/home/user/.dexto/agents/test-agent';
            const configPath = '/home/user/.dexto/agents/test-agent/test-agent.yml';
            
            mockExistsSync.mockImplementation((path) => {
                if (path === '/mock/agents/agent-registry.json') return true;
                if (path === installedPath) return true;
                if (path === configPath) return true;
                return false;
            });
            
            const result = await registry.resolveAgent('test-agent');
            expect(result).toBe(configPath);
        });

        it('throws error when main file not specified for directory', async () => {
            // Registry entry without main field
            mockReadFileSync.mockImplementation((path) => {
                if (path === '/mock/agents/agent-registry.json') {
                    return JSON.stringify({
                        version: '1.0.0',
                        agents: {
                            'test-agent': {
                                description: 'Test agent',
                                author: 'Test',
                                tags: ['test'],
                                source: 'test-agent/'
                                // No main field
                            }
                        }
                    });
                }
                return '';
            });
            
            const installedPath = '/home/user/.dexto/agents/test-agent';
            
            mockExistsSync.mockImplementation((path) => {
                if (path === '/mock/agents/agent-registry.json') return true;
                if (path === installedPath) return true;
                return false;
            });
            
            await expect(registry.resolveAgent('test-agent')).rejects.toThrow(
                "Registry entry for 'test-agent' specifies directory but missing 'main' field"
            );
        });

        it('throws error when main file is missing', async () => {
            const installedPath = '/home/user/.dexto/agents/test-agent';
            const missingConfigPath = '/home/user/.dexto/agents/test-agent/test-agent.yml';
            
            mockExistsSync.mockImplementation((path) => {
                if (path === '/mock/agents/agent-registry.json') return true;
                if (path === installedPath) return true;
                // Main config file doesn't exist
                if (path === missingConfigPath) return false;
                return false;
            });
            
            await expect(registry.resolveAgent('test-agent')).rejects.toThrow(
                `Main config file not found: ${missingConfigPath}`
            );
        });
    });
});
*/

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Mock fs module
vi.mock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
        ...actual,
        readdirSync: vi.fn(),
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
    };
});

import { loadClaudeCodePlugin } from './load-plugin.js';
import type { DiscoveredPlugin } from './types.js';

describe('loadClaudeCodePlugin', () => {
    // Helper to create mock Dirent-like objects for testing
    const createDirent = (name: string, isDir: boolean) => ({
        name,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        path: '',
        parentPath: '',
    });

    const createPlugin = (name: string, pluginPath: string): DiscoveredPlugin => ({
        path: pluginPath,
        manifest: { name },
        source: 'project',
        format: 'claude-code',
    });

    beforeEach(() => {
        vi.mocked(fs.readdirSync).mockReset();
        vi.mocked(fs.existsSync).mockReset();
        vi.mocked(fs.readFileSync).mockReset();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('loading commands', () => {
        it('should load commands from commands/*.md', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/commands') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/commands') {
                    return [createDirent('build.md', false), createDirent('test.md', false)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('# Command content');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(2);
            expect(result.commands[0]).toMatchObject({
                file: '/plugins/test-plugin/commands/build.md',
                namespace: 'test-plugin',
                isSkill: false,
            });
            expect(result.commands[1]).toMatchObject({
                file: '/plugins/test-plugin/commands/test.md',
                namespace: 'test-plugin',
                isSkill: false,
            });
        });

        it('should exclude README.md from commands', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/commands') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/commands') {
                    return [
                        createDirent('README.md', false),
                        createDirent('deploy.md', false),
                    ] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('# Command');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(1);
            expect(result.commands[0]!.file).toContain('deploy.md');
        });
    });

    describe('loading skills', () => {
        it('should load skills from skills/*/SKILL.md', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/skills') return true;
                if (p === '/plugins/test-plugin/skills/analyzer/SKILL.md') return true;
                if (p === '/plugins/test-plugin/skills/optimizer/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/skills') {
                    return [createDirent('analyzer', true), createDirent('optimizer', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('# Skill content');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(2);
            expect(result.commands[0]).toMatchObject({
                file: '/plugins/test-plugin/skills/analyzer/SKILL.md',
                namespace: 'test-plugin',
                isSkill: true,
            });
            expect(result.commands[1]).toMatchObject({
                file: '/plugins/test-plugin/skills/optimizer/SKILL.md',
                namespace: 'test-plugin',
                isSkill: true,
            });
        });

        it('should skip skill directories without SKILL.md', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/skills') return true;
                if (p === '/plugins/test-plugin/skills/complete/SKILL.md') return true;
                // incomplete skill has no SKILL.md
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/skills') {
                    return [
                        createDirent('complete', true),
                        createDirent('incomplete', true),
                    ] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('# Skill');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(1);
            expect(result.commands[0]!.file).toContain('complete');
        });
    });

    describe('loading MCP config', () => {
        it('should load .mcp.json when present', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');
            const mcpConfig = {
                mcpServers: {
                    'test-server': {
                        command: 'node',
                        args: ['server.js'],
                    },
                },
            };

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/.mcp.json') return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mcpConfig));

            const result = loadClaudeCodePlugin(plugin);

            expect(result.mcpConfig).toEqual(mcpConfig);
        });

        it('should return undefined mcpConfig when .mcp.json is absent', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = loadClaudeCodePlugin(plugin);

            expect(result.mcpConfig).toBeUndefined();
        });

        it('should add warning for invalid .mcp.json', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/.mcp.json') return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockReturnValue('{ invalid json }');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.mcpConfig).toBeUndefined();
            expect(result.warnings).toContainEqual(
                expect.stringContaining('Failed to parse .mcp.json')
            );
        });

        it('should normalize Claude Code format (servers at root level) to mcpServers', () => {
            const plugin = createPlugin('linear', '/plugins/linear');
            // Claude Code format: servers directly at root, not under mcpServers
            const claudeCodeFormat = {
                linear: {
                    type: 'http',
                    url: 'https://mcp.linear.app/mcp',
                },
            };

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/linear/.mcp.json') return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(claudeCodeFormat));

            const result = loadClaudeCodePlugin(plugin);

            // Should be normalized to have mcpServers key
            expect(result.mcpConfig).toEqual({
                mcpServers: {
                    linear: {
                        type: 'http',
                        url: 'https://mcp.linear.app/mcp',
                    },
                },
            });
        });

        it('should handle Claude Code stdio format', () => {
            const plugin = createPlugin('filesystem', '/plugins/filesystem');
            const claudeCodeFormat = {
                filesystem: {
                    command: 'npx',
                    args: ['@modelcontextprotocol/server-filesystem'],
                },
            };

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/filesystem/.mcp.json') return true;
                return false;
            });

            vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(claudeCodeFormat));

            const result = loadClaudeCodePlugin(plugin);

            expect(result.mcpConfig).toEqual({
                mcpServers: {
                    filesystem: {
                        command: 'npx',
                        args: ['@modelcontextprotocol/server-filesystem'],
                    },
                },
            });
        });
    });

    describe('unsupported feature warnings', () => {
        it('should warn about hooks/hooks.json', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/hooks/hooks.json') return true;
                return false;
            });

            const result = loadClaudeCodePlugin(plugin);

            expect(result.warnings).toContainEqual(
                expect.stringContaining('hooks/hooks.json detected but not supported')
            );
        });

        it('should warn about .lsp.json', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/.lsp.json') return true;
                return false;
            });

            const result = loadClaudeCodePlugin(plugin);

            expect(result.warnings).toContainEqual(
                expect.stringContaining('.lsp.json detected but not supported')
            );
        });

        it('should warn about shell injection in commands', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/commands') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/commands') {
                    return [createDirent('risky.md', false)] as any;
                }
                return [];
            });

            // Content with shell injection pattern
            vi.mocked(fs.readFileSync).mockReturnValue('Run: $(whoami)');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.warnings).toContainEqual(
                expect.stringContaining('shell injection syntax')
            );
        });

        it('should warn about backtick shell injection', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/commands') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/commands') {
                    return [createDirent('backtick.md', false)] as any;
                }
                return [];
            });

            // Content with backtick shell injection pattern
            vi.mocked(fs.readFileSync).mockReturnValue('Run: `hostname`');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.warnings).toContainEqual(
                expect.stringContaining('shell injection syntax')
            );
        });

        it('should warn about shell injection in skills', () => {
            const plugin = createPlugin('test-plugin', '/plugins/test-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/test-plugin/skills') return true;
                if (p === '/plugins/test-plugin/skills/risky/SKILL.md') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/test-plugin/skills') {
                    return [createDirent('risky', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockReturnValue('Execute: $(cat /etc/passwd)');

            const result = loadClaudeCodePlugin(plugin);

            expect(result.warnings).toContainEqual(
                expect.stringContaining('shell injection syntax')
            );
        });
    });

    describe('combined loading', () => {
        it('should load commands, skills, and MCP config together', () => {
            const plugin = createPlugin('full-plugin', '/plugins/full-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/full-plugin/commands') return true;
                if (p === '/plugins/full-plugin/skills') return true;
                if (p === '/plugins/full-plugin/skills/analyzer/SKILL.md') return true;
                if (p === '/plugins/full-plugin/.mcp.json') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation((dir) => {
                if (dir === '/plugins/full-plugin/commands') {
                    return [createDirent('build.md', false)] as any;
                }
                if (dir === '/plugins/full-plugin/skills') {
                    return [createDirent('analyzer', true)] as any;
                }
                return [];
            });

            vi.mocked(fs.readFileSync).mockImplementation((p) => {
                if (String(p).endsWith('.mcp.json')) {
                    return JSON.stringify({ mcpServers: { test: {} } });
                }
                return '# Content';
            });

            const result = loadClaudeCodePlugin(plugin);

            // Should have both command and skill
            expect(result.commands).toHaveLength(2);
            expect(result.commands.filter((c) => !c.isSkill)).toHaveLength(1);
            expect(result.commands.filter((c) => c.isSkill)).toHaveLength(1);

            // Should have MCP config
            expect(result.mcpConfig).toBeDefined();
            expect(result.mcpConfig?.mcpServers).toHaveProperty('test');

            // Should preserve manifest
            expect(result.manifest.name).toBe('full-plugin');
        });
    });

    describe('edge cases', () => {
        it('should handle empty plugin gracefully', () => {
            const plugin = createPlugin('empty-plugin', '/plugins/empty-plugin');

            vi.mocked(fs.existsSync).mockReturnValue(false);

            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(0);
            expect(result.mcpConfig).toBeUndefined();
            expect(result.warnings).toHaveLength(0);
            expect(result.manifest.name).toBe('empty-plugin');
        });

        it('should handle read errors gracefully', () => {
            const plugin = createPlugin('error-plugin', '/plugins/error-plugin');

            vi.mocked(fs.existsSync).mockImplementation((p) => {
                if (p === '/plugins/error-plugin/commands') return true;
                return false;
            });

            vi.mocked(fs.readdirSync).mockImplementation(() => {
                throw new Error('Permission denied');
            });

            // Should not throw
            const result = loadClaudeCodePlugin(plugin);

            expect(result.commands).toHaveLength(0);
        });
    });
});

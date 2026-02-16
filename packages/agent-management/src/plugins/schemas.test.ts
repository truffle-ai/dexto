import { describe, it, expect } from 'vitest';
import {
    PluginManifestSchema,
    PluginMCPConfigSchema,
    InstalledPluginEntrySchema,
    InstalledPluginsFileSchema,
} from './schemas.js';

describe('PluginManifestSchema', () => {
    it('should validate a minimal manifest with only name', () => {
        const manifest = { name: 'my-plugin' };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.name).toBe('my-plugin');
        }
    });

    it('should validate a complete manifest', () => {
        const manifest = {
            name: 'my-plugin',
            description: 'A test plugin',
            version: '1.0.0',
            author: 'Test Author',
        };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual(manifest);
        }
    });

    it('should reject manifest without name', () => {
        const manifest = { description: 'No name' };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(false);
    });

    it('should reject manifest with empty name', () => {
        const manifest = { name: '' };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(false);
    });

    it('should allow unknown fields (passthrough mode for Claude Code compatibility)', () => {
        const manifest = {
            name: 'my-plugin',
            unknownField: 'allowed for compatibility',
        };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
    });

    it('should validate author as a string', () => {
        const manifest = {
            name: 'my-plugin',
            author: 'Test Author',
        };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.author).toBe('Test Author');
        }
    });

    it('should validate author as an object with name and email', () => {
        const manifest = {
            name: 'my-plugin',
            author: {
                name: 'Anthropic',
                email: 'support@anthropic.com',
            },
        };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.author).toEqual({
                name: 'Anthropic',
                email: 'support@anthropic.com',
            });
        }
    });

    it('should validate author as an object with only name', () => {
        const manifest = {
            name: 'my-plugin',
            author: {
                name: 'Anthropic',
            },
        };
        const result = PluginManifestSchema.safeParse(manifest);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.author).toEqual({ name: 'Anthropic' });
        }
    });
});

describe('PluginMCPConfigSchema', () => {
    it('should validate an empty config', () => {
        const config = {};
        const result = PluginMCPConfigSchema.safeParse(config);

        expect(result.success).toBe(true);
    });

    it('should validate config with mcpServers', () => {
        const config = {
            mcpServers: {
                filesystem: {
                    type: 'stdio',
                    command: 'npx',
                    args: ['@modelcontextprotocol/server-filesystem'],
                },
            },
        };
        const result = PluginMCPConfigSchema.safeParse(config);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.mcpServers).toBeDefined();
        }
    });

    it('should allow unknown fields (passthrough mode)', () => {
        const config = {
            mcpServers: {},
            customField: 'allowed',
        };
        const result = PluginMCPConfigSchema.safeParse(config);

        expect(result.success).toBe(true);
    });
});

describe('InstalledPluginEntrySchema', () => {
    it('should validate a minimal entry with required fields', () => {
        const entry = {
            scope: 'user',
            installPath: '/home/user/.dexto/plugins/cache/marketplace/plugin/1.0.0',
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.scope).toBe('user');
            expect(result.data.installPath).toBe(
                '/home/user/.dexto/plugins/cache/marketplace/plugin/1.0.0'
            );
        }
    });

    it('should validate a complete entry with all fields', () => {
        const entry = {
            scope: 'project',
            installPath: '/home/user/.dexto/plugins/cache/marketplace/my-plugin/1.0.0',
            version: '1.0.0',
            installedAt: '2026-01-21T10:52:10.027Z',
            lastUpdated: '2026-01-21T10:52:10.027Z',
            gitCommitSha: 'a6a8045031de9ff3e44683264e2ed6d434a8c0b6',
            projectPath: '/Users/test/my-project',
            isLocal: false,
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toMatchObject(entry);
        }
    });

    it('should validate all scope values', () => {
        const scopes = ['project', 'user', 'local'] as const;

        for (const scope of scopes) {
            const entry = {
                scope,
                installPath: '/path/to/plugin',
            };
            const result = InstalledPluginEntrySchema.safeParse(entry);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.scope).toBe(scope);
            }
        }
    });

    it('should reject invalid scope values', () => {
        const entry = {
            scope: 'invalid',
            installPath: '/path/to/plugin',
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(false);
    });

    it('should reject entry without installPath', () => {
        const entry = {
            scope: 'user',
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(false);
    });

    it('should reject entry without scope', () => {
        const entry = {
            installPath: '/path/to/plugin',
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(false);
    });

    it('should allow unknown fields (passthrough mode)', () => {
        const entry = {
            scope: 'user',
            installPath: '/path/to/plugin',
            customField: 'allowed',
        };
        const result = InstalledPluginEntrySchema.safeParse(entry);

        expect(result.success).toBe(true);
    });
});

describe('InstalledPluginsFileSchema', () => {
    it('should validate a minimal file with empty plugins', () => {
        const file = {
            plugins: {},
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.plugins).toEqual({});
        }
    });

    it('should validate a file with version', () => {
        const file = {
            version: 2,
            plugins: {},
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.version).toBe(2);
        }
    });

    it('should validate a complete installed_plugins.json structure', () => {
        const file = {
            version: 2,
            plugins: {
                'code-review@claude-code-plugins': [
                    {
                        scope: 'user',
                        installPath:
                            '/home/user/.dexto/plugins/cache/claude-code-plugins/code-review/1.0.0',
                        version: '1.0.0',
                        installedAt: '2026-01-21T10:52:10.027Z',
                        lastUpdated: '2026-01-21T10:52:10.027Z',
                        gitCommitSha: 'a6a8045031de9ff3e44683264e2ed6d434a8c0b6',
                    },
                ],
                'another-plugin@marketplace': [
                    {
                        scope: 'project',
                        installPath:
                            '/home/user/.dexto/plugins/cache/marketplace/another-plugin/2.0.0',
                        version: '2.0.0',
                        projectPath: '/Users/test/my-project',
                    },
                    {
                        scope: 'project',
                        installPath:
                            '/home/user/.dexto/plugins/cache/marketplace/another-plugin/2.0.0',
                        version: '2.0.0',
                        projectPath: '/Users/test/other-project',
                    },
                ],
            },
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.version).toBe(2);
            expect(Object.keys(result.data.plugins)).toHaveLength(2);
            expect(result.data.plugins['code-review@claude-code-plugins']).toHaveLength(1);
            expect(result.data.plugins['another-plugin@marketplace']).toHaveLength(2);
        }
    });

    it('should validate multiple installations for the same plugin', () => {
        const file = {
            plugins: {
                'multi-install-plugin@marketplace': [
                    {
                        scope: 'user',
                        installPath: '/home/user/.dexto/plugins/cache/marketplace/plugin/1.0.0',
                    },
                    {
                        scope: 'project',
                        installPath: '/home/user/.dexto/plugins/cache/marketplace/plugin/1.0.0',
                        projectPath: '/project1',
                    },
                    {
                        scope: 'project',
                        installPath: '/home/user/.dexto/plugins/cache/marketplace/plugin/1.0.0',
                        projectPath: '/project2',
                    },
                ],
            },
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.plugins['multi-install-plugin@marketplace']).toHaveLength(3);
        }
    });

    it('should reject file without plugins field', () => {
        const file = {
            version: 2,
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(false);
    });

    it('should reject file with invalid plugin entry', () => {
        const file = {
            plugins: {
                'invalid-plugin': [
                    {
                        // Missing required fields
                        version: '1.0.0',
                    },
                ],
            },
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(false);
    });

    it('should allow unknown fields at top level (passthrough mode)', () => {
        const file = {
            version: 2,
            plugins: {},
            customTopLevelField: 'allowed',
        };
        const result = InstalledPluginsFileSchema.safeParse(file);

        expect(result.success).toBe(true);
    });
});

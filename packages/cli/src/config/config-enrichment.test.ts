/**
 * Unit tests for CLI config enrichment layer
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { deriveAgentId, enrichAgentConfig } from './config-enrichment.js';
import type { AgentConfig } from '@dexto/core';
import * as agentManagement from '@dexto/agent-management';

// Mock getDextoPath from agent-management
vi.mock('@dexto/agent-management', () => ({
    getDextoPath: vi.fn((type: string, filename?: string) => {
        if (filename) {
            return `/mock/dexto/${type}/${filename}`;
        }
        return `/mock/dexto/${type}`;
    }),
}));

// Helper to create minimal valid config (without logger - will be enriched)
const createMinimalConfig = (): AgentConfig => ({
    llm: { apiKey: 'test-key', provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    systemPrompt: '',
});

describe('deriveAgentId', () => {
    describe('Priority 1: agentCard.name', () => {
        it('should use agentCard.name when available', () => {
            const config: AgentConfig = {
                llm: {
                    apiKey: 'test-key',
                    provider: 'anthropic',
                    model: 'claude-3-5-sonnet-20241022',
                },
                systemPrompt: '',
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'in-memory' },
                    blob: { type: 'local', storePath: '/tmp/test' },
                },
                agentCard: {
                    name: 'MyCustomAgent',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('mycustomagent');
        });

        it('should sanitize agentCard.name by converting to lowercase', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: 'UPPERCASE-Agent',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('uppercase-agent');
        });

        it('should sanitize agentCard.name by replacing spaces with dashes', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: 'My Custom Agent',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('my-custom-agent');
        });

        it('should sanitize agentCard.name by removing special characters', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: 'Agent@2024!#$%',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('agent-2024');
        });

        it('should collapse multiple dashes into single dash', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: 'My---Custom   Agent',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('my-custom-agent');
        });

        it('should trim leading and trailing dashes', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: '---MyAgent---',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('myagent');
        });
    });

    describe('Priority 2: filename', () => {
        it('should use filename when agentCard.name is not available', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config, '/path/to/my-agent.yml');
            expect(agentId).toBe('my-agent');
        });

        it('should remove file extension from filename', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config, '/path/to/custom-agent.yaml');
            expect(agentId).toBe('custom-agent');
        });

        it('should skip generic filenames like "agent"', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config, '/path/to/agent.yml');
            expect(agentId).toBe('default-agent');
        });

        it('should skip generic filenames like "config"', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config, '/path/to/config.yml');
            expect(agentId).toBe('default-agent');
        });

        it('should handle paths without extension', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config, '/path/to/my-agent');
            expect(agentId).toBe('my-agent');
        });
    });

    describe('Priority 3: default fallback', () => {
        it('should fallback to "default-agent" when no name or path provided', () => {
            const config = createMinimalConfig();
            const agentId = deriveAgentId(config);
            expect(agentId).toBe('default-agent');
        });

        it('should fallback to "default-agent" when agentCard exists but name is empty', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: '',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test agent',
                },
            };

            const agentId = deriveAgentId(config);
            expect(agentId).toBe('default-agent');
        });
    });
});

describe('enrichAgentConfig', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Logger enrichment', () => {
        it('should add file transport when logger not provided', () => {
            const config = createMinimalConfig();
            const enriched = enrichAgentConfig(config, '/path/to/my-agent.yml');

            expect(enriched.logger!.transports).toHaveLength(2);
            expect(enriched.logger!.transports![0]).toEqual({ type: 'console', colorize: true });
            expect(enriched.logger!.transports![1]).toMatchObject({
                type: 'file',
                path: '/mock/dexto/logs/my-agent.log',
                maxSize: 10 * 1024 * 1024,
                maxFiles: 5,
            });
        });

        it('should respect user-provided logger config and NOT add file transport', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                logger: {
                    level: 'debug',
                    transports: [{ type: 'console', colorize: true }],
                },
            };

            const enriched = enrichAgentConfig(config);

            // Should keep user's logger config as-is (no file transport added)
            expect(enriched.logger!.level).toBe('debug');
            expect(enriched.logger!.transports).toHaveLength(1);
            expect(enriched.logger!.transports![0]).toEqual({ type: 'console', colorize: true });
        });

        it('should use default level "info" when logger not provided', () => {
            const config = createMinimalConfig();
            const enriched = enrichAgentConfig(config);

            expect(enriched.logger!.level).toBe('info');
        });

        it('should add default console transport if no transports provided', () => {
            const config = createMinimalConfig();
            const enriched = enrichAgentConfig(config);

            expect(enriched.logger!.transports).toHaveLength(2);
            expect(enriched.logger!.transports![0]).toEqual({ type: 'console', colorize: true });
        });

        it('should use agentId in log file name', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                agentCard: {
                    name: 'Custom Agent Name',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test',
                },
            };

            const enriched = enrichAgentConfig(config);

            const fileTransport = enriched.logger!.transports!.find((t) => t.type === 'file');
            expect(fileTransport).toBeDefined();
            if (fileTransport && fileTransport.type === 'file') {
                expect(fileTransport.path).toBe('/mock/dexto/logs/custom-agent-name.log');
            }
        });

        it('should use file-only transport for interactive CLI mode', () => {
            const config = createMinimalConfig();
            const enriched = enrichAgentConfig(config, '/path/to/cli-agent.yml', true);

            // Interactive CLI should only have file transport (no console)
            expect(enriched.logger!.transports).toHaveLength(1);
            expect(enriched.logger!.transports![0]).toMatchObject({
                type: 'file',
                path: '/mock/dexto/logs/cli-agent.log',
            });
        });

        it('should use console + file transports for non-interactive mode (default)', () => {
            const config = createMinimalConfig();
            const enriched = enrichAgentConfig(config, '/path/to/server-agent.yml');

            // Non-interactive (or default) should have both console + file
            expect(enriched.logger!.transports).toHaveLength(2);
            expect(enriched.logger!.transports![0]).toEqual({ type: 'console', colorize: true });
            expect(enriched.logger!.transports![1]).toMatchObject({
                type: 'file',
                path: '/mock/dexto/logs/server-agent.log',
            });
        });
    });

    describe('Storage enrichment', () => {
        it('should provide default storage when not specified in config', () => {
            const configWithoutStorage: AgentConfig = {
                llm: {
                    apiKey: 'test-key',
                    provider: 'anthropic',
                    model: 'claude-3-5-sonnet-20241022',
                },
                systemPrompt: '',
            };

            const enriched = enrichAgentConfig(configWithoutStorage, '/path/to/my-agent.yml');

            // Storage should be provided with defaults
            expect(enriched.storage).toBeDefined();
            expect(enriched.storage!.cache.type).toBe('in-memory');
            expect(enriched.storage!.database.type).toBe('sqlite');
            if (enriched.storage!.database.type === 'sqlite') {
                expect(enriched.storage!.database.path).toBe('/mock/dexto/database/my-agent.db');
            }
            expect(enriched.storage!.blob.type).toBe('local');
            if (enriched.storage!.blob.type === 'local') {
                expect(enriched.storage!.blob.storePath).toBe('/mock/dexto/blobs/my-agent');
            }
        });

        it('should add path to SQLite database config', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'sqlite', path: '' },
                    blob: { type: 'local', storePath: '/tmp/test' },
                },
            };

            const enriched = enrichAgentConfig(config, '/path/to/test-agent.yml');

            if (enriched.storage!.database.type === 'sqlite') {
                expect(enriched.storage!.database.path).toBe('/mock/dexto/database/test-agent.db');
            }
        });

        it('should not modify in-memory database config', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'in-memory' },
                    blob: { type: 'in-memory' },
                },
            };

            const enriched = enrichAgentConfig(config);

            expect(enriched.storage!.database).toEqual({ type: 'in-memory' });
        });

        it('should add storePath to local blob config', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'in-memory' },
                    blob: { type: 'local', storePath: '' },
                },
            };

            const enriched = enrichAgentConfig(config, '/path/to/my-agent.yml');

            if (enriched.storage!.blob.type === 'local') {
                expect(enriched.storage!.blob.storePath).toBe('/mock/dexto/blobs/my-agent');
            }
        });

        it('should use agentId in storage paths', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'sqlite', path: '' },
                    blob: { type: 'local', storePath: '' },
                },
                agentCard: {
                    name: 'Storage Test Agent',
                    url: 'http://example.com',
                    version: '1.0.0',
                    description: 'Test',
                },
            };

            const enriched = enrichAgentConfig(config);

            if (enriched.storage!.database.type === 'sqlite') {
                expect(enriched.storage!.database.path).toBe(
                    '/mock/dexto/database/storage-test-agent.db'
                );
            }
            if (enriched.storage!.blob.type === 'local') {
                expect(enriched.storage!.blob.storePath).toBe(
                    '/mock/dexto/blobs/storage-test-agent'
                );
            }
        });
    });

    describe('Path generation with getDextoPath', () => {
        it('should call getDextoPath for log file', () => {
            const getDextoPathSpy = vi.spyOn(agentManagement, 'getDextoPath');

            const config: AgentConfig = createMinimalConfig();

            enrichAgentConfig(config, '/path/to/test-agent.yml');

            expect(getDextoPathSpy).toHaveBeenCalledWith('logs', 'test-agent.log');
        });

        it('should call getDextoPath for database file', () => {
            const getDextoPathSpy = vi.spyOn(agentManagement, 'getDextoPath');

            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'sqlite', path: '' },
                    blob: { type: 'local', storePath: '/tmp/test' },
                },
            };

            enrichAgentConfig(config, '/path/to/db-agent.yml');

            expect(getDextoPathSpy).toHaveBeenCalledWith('database', 'db-agent.db');
        });

        it('should call getDextoPath for blob directory', () => {
            const getDextoPathSpy = vi.spyOn(agentManagement, 'getDextoPath');

            const config: AgentConfig = {
                ...createMinimalConfig(),
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'in-memory' },
                    blob: { type: 'local', storePath: '' },
                },
            };

            enrichAgentConfig(config, '/path/to/blob-agent.yml');

            expect(getDextoPathSpy).toHaveBeenCalledWith('blobs', 'blob-agent');
        });
    });

    describe('Config immutability', () => {
        it('should not modify the original config object', () => {
            const config: AgentConfig = {
                ...createMinimalConfig(),
                logger: {
                    level: 'info',
                    transports: [{ type: 'console', colorize: true }],
                },
                storage: {
                    cache: { type: 'in-memory' },
                    database: { type: 'sqlite', path: '' },
                    blob: { type: 'local', storePath: '' },
                },
            };

            const originalTransportsLength = config.logger!.transports!.length;
            const originalDbConfig = { ...config.storage!.database };

            enrichAgentConfig(config);

            // Original config should not be mutated
            expect(config.logger!.transports).toHaveLength(originalTransportsLength);
            expect(config.storage!.database).toEqual(originalDbConfig);
        });
    });
});

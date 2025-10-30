import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SystemPromptManager } from './manager.js';
import { SystemPromptConfigSchema } from './schemas.js';
import type { DynamicContributorContext } from './types.js';
import * as registry from './registry.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';
import { SystemPromptErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';

// Mock the registry functions
vi.mock('./registry.js', () => ({
    getPromptGenerator: vi.fn(),
    PROMPT_GENERATOR_SOURCES: ['dateTime', 'memorySummary', 'resources'],
}));

const mockGetPromptGenerator = vi.mocked(registry.getPromptGenerator);

describe('SystemPromptManager', () => {
    let mockContext: DynamicContributorContext;

    beforeEach(() => {
        vi.clearAllMocks();

        // Set up default mock generators to prevent "No generator registered" errors
        mockGetPromptGenerator.mockImplementation((source) => {
            const mockGenerators: Record<string, any> = {
                dateTime: vi.fn().mockResolvedValue('Mock DateTime'),
                memorySummary: vi.fn().mockResolvedValue('Mock Memory'),
                resources: vi.fn().mockResolvedValue('Mock Resources'),
            };
            return mockGenerators[source];
        });

        mockContext = {
            mcpManager: {} as any, // Mock MCPManager
        };
    });

    describe('Initialization', () => {
        it('should initialize with string config and create static contributor', () => {
            const config = SystemPromptConfigSchema.parse('You are a helpful assistant');
            const manager = new SystemPromptManager(config);

            const contributors = manager.getContributors();
            expect(contributors).toHaveLength(1);
            expect(contributors[0]?.id).toBe('inline');
            expect(contributors[0]?.priority).toBe(0);
        });

        it('should initialize with empty object config and apply defaults', () => {
            const config = SystemPromptConfigSchema.parse({});
            const manager = new SystemPromptManager(config);

            const contributors = manager.getContributors();
            expect(contributors).toHaveLength(1); // Only dateTime is enabled by default

            // Should only have dateTime (resources is disabled by default)
            expect(contributors[0]?.id).toBe('dateTime'); // priority 10, enabled: true
        });

        it('should initialize with custom contributors config', () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'main',
                        type: 'static',
                        priority: 0,
                        content: 'You are Dexto',
                        enabled: true,
                    },
                    {
                        id: 'dateTime',
                        type: 'dynamic',
                        priority: 10,
                        source: 'dateTime',
                        enabled: true,
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const contributors = manager.getContributors();

            expect(contributors).toHaveLength(2);
            expect(contributors[0]?.id).toBe('main');
            expect(contributors[1]?.id).toBe('dateTime');
        });

        it('should filter out disabled contributors', () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'enabled',
                        type: 'static',
                        priority: 0,
                        content: 'Enabled contributor',
                        enabled: true,
                    },
                    {
                        id: 'disabled',
                        type: 'static',
                        priority: 5,
                        content: 'Disabled contributor',
                        enabled: false,
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const contributors = manager.getContributors();

            expect(contributors).toHaveLength(1);
            expect(contributors[0]?.id).toBe('enabled');
        });

        it('should sort contributors by priority (lower number = higher priority)', () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    { id: 'low', type: 'static', priority: 20, content: 'Low priority' },
                    { id: 'high', type: 'static', priority: 0, content: 'High priority' },
                    { id: 'medium', type: 'static', priority: 10, content: 'Medium priority' },
                ],
            });

            const manager = new SystemPromptManager(config);
            const contributors = manager.getContributors();

            expect(contributors).toHaveLength(3);
            expect(contributors[0]?.id).toBe('high'); // priority 0
            expect(contributors[1]?.id).toBe('medium'); // priority 10
            expect(contributors[2]?.id).toBe('low'); // priority 20
        });
    });

    describe('Static Contributors', () => {
        it('should create static contributors with correct content', async () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'greeting',
                        type: 'static',
                        priority: 0,
                        content: 'Hello, I am Dexto!',
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe('Hello, I am Dexto!');
        });

        it('should handle multiline static content', async () => {
            const multilineContent = `You are Dexto, an AI assistant.

You can help with:
- Coding tasks
- Analysis
- General questions`;

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'main',
                        type: 'static',
                        priority: 0,
                        content: multilineContent,
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe(multilineContent);
        });
    });

    describe('Dynamic Contributors', () => {
        it('should create dynamic contributors and call generators', async () => {
            const mockGenerator = vi.fn().mockResolvedValue('Current time: 2023-01-01');
            mockGetPromptGenerator.mockReturnValue(mockGenerator);

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'dateTime',
                        type: 'dynamic',
                        priority: 10,
                        source: 'dateTime',
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(mockGetPromptGenerator).toHaveBeenCalledWith('dateTime');
            expect(mockGenerator).toHaveBeenCalledWith(mockContext);
            expect(result).toBe('Current time: 2023-01-01');
        });

        it('should throw error if generator is not found', () => {
            mockGetPromptGenerator.mockReturnValue(undefined);

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'unknownSource',
                        type: 'dynamic',
                        priority: 10,
                        source: 'memorySummary', // valid enum but mock returns undefined
                    },
                ],
            });

            const error = (() => {
                try {
                    new SystemPromptManager(config);
                    return null;
                } catch (e) {
                    return e;
                }
            })() as DextoRuntimeError;
            expect(error).toBeInstanceOf(DextoRuntimeError);
            expect(error.code).toBe(SystemPromptErrorCode.CONTRIBUTOR_SOURCE_UNKNOWN);
            expect(error.scope).toBe(ErrorScope.SYSTEM_PROMPT);
            expect(error.type).toBe(ErrorType.USER);
        });

        it('should handle multiple dynamic contributors', async () => {
            const dateTimeGenerator = vi.fn().mockResolvedValue('Time: 2023-01-01');
            const resourcesGenerator = vi.fn().mockResolvedValue('Resources: file1.md, file2.md');

            mockGetPromptGenerator.mockImplementation((source) => {
                if (source === 'dateTime') return dateTimeGenerator;
                if (source === 'resources') return resourcesGenerator;
                return undefined;
            });

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    { id: 'time', type: 'dynamic', priority: 10, source: 'dateTime' },
                    { id: 'files', type: 'dynamic', priority: 20, source: 'resources' },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe('Time: 2023-01-01\nResources: file1.md, file2.md');
            expect(dateTimeGenerator).toHaveBeenCalledWith(mockContext);
            expect(resourcesGenerator).toHaveBeenCalledWith(mockContext);
        });
    });

    describe('File Contributors', () => {
        it('should create file contributors with correct configuration', () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'docs',
                        type: 'file',
                        priority: 5,
                        files: ['README.md', 'GUIDELINES.md'],
                        options: {
                            includeFilenames: true,
                            separator: '\n\n---\n\n',
                        },
                    },
                ],
            });

            const manager = new SystemPromptManager(config, '/custom/config/dir');
            const contributors = manager.getContributors();

            expect(contributors).toHaveLength(1);
            expect(contributors[0]?.id).toBe('docs');
            expect(contributors[0]?.priority).toBe(5);
        });

        it('should use custom config directory', () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'docs',
                        type: 'file',
                        priority: 5,
                        files: ['context.md'],
                    },
                ],
            });

            const customConfigDir = '/custom/project/path';
            const manager = new SystemPromptManager(config, customConfigDir);

            // The FileContributor should receive the custom config directory
            expect(manager.getContributors()).toHaveLength(1);
        });
    });

    describe('Mixed Contributors', () => {
        it('should handle mixed contributor types and build correctly', async () => {
            const mockGenerator = vi.fn().mockResolvedValue('Dynamic content');
            mockGetPromptGenerator.mockReturnValue(mockGenerator);

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'static',
                        type: 'static',
                        priority: 0,
                        content: 'Static content',
                    },
                    {
                        id: 'dynamic',
                        type: 'dynamic',
                        priority: 10,
                        source: 'dateTime',
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe('Static content\nDynamic content');
        });

        it('should respect priority ordering with mixed types', async () => {
            const mockGenerator = vi.fn().mockResolvedValue('Dynamic priority 5');
            mockGetPromptGenerator.mockReturnValue(mockGenerator);

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'static-low',
                        type: 'static',
                        priority: 20,
                        content: 'Static priority 20',
                    },
                    { id: 'dynamic-high', type: 'dynamic', priority: 5, source: 'dateTime' },
                    {
                        id: 'static-high',
                        type: 'static',
                        priority: 0,
                        content: 'Static priority 0',
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            // Should be ordered by priority: 0, 5, 20
            expect(result).toBe('Static priority 0\nDynamic priority 5\nStatic priority 20');
        });
    });

    describe('Build Process', () => {
        it('should join multiple contributors with newlines', async () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    { id: 'first', type: 'static', priority: 0, content: 'First line' },
                    { id: 'second', type: 'static', priority: 10, content: 'Second line' },
                    { id: 'third', type: 'static', priority: 20, content: 'Third line' },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe('First line\nSecond line\nThird line');
        });

        it('should handle empty contributor content', async () => {
            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    { id: 'empty', type: 'static', priority: 0, content: '' },
                    { id: 'content', type: 'static', priority: 10, content: 'Has content' },
                ],
            });

            const manager = new SystemPromptManager(config);
            const result = await manager.build(mockContext);

            expect(result).toBe('\nHas content');
        });

        it('should pass context correctly to all contributors', async () => {
            const mockGenerator1 = vi.fn().mockResolvedValue('Gen1');
            const mockGenerator2 = vi.fn().mockResolvedValue('Gen2');

            mockGetPromptGenerator.mockImplementation((source) => {
                if (source === 'dateTime') return mockGenerator1;
                if (source === 'resources') return mockGenerator2;
                return undefined;
            });

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    { id: 'gen1', type: 'dynamic', priority: 0, source: 'dateTime' },
                    { id: 'gen2', type: 'dynamic', priority: 10, source: 'resources' },
                ],
            });

            const customContext = {
                mcpManager: {} as any, // Mock MCPManager
            };

            const manager = new SystemPromptManager(config);
            await manager.build(customContext);

            expect(mockGenerator1).toHaveBeenCalledWith(customContext);
            expect(mockGenerator2).toHaveBeenCalledWith(customContext);
        });
    });

    describe('Error Handling', () => {
        it('should handle async errors in contributors gracefully', async () => {
            const mockGenerator = vi.fn().mockRejectedValue(new Error('Generator failed'));
            mockGetPromptGenerator.mockReturnValue(mockGenerator);

            const config = SystemPromptConfigSchema.parse({
                contributors: [{ id: 'failing', type: 'dynamic', priority: 0, source: 'dateTime' }],
            });

            const manager = new SystemPromptManager(config);

            await expect(manager.build(mockContext)).rejects.toThrow('Generator failed');
        });

        it('should use correct config directory default', () => {
            const config = SystemPromptConfigSchema.parse('Simple prompt');

            // Mock process.cwd() to test default behavior
            const originalCwd = process.cwd;
            process.cwd = vi.fn().mockReturnValue('/mocked/cwd');

            const manager = new SystemPromptManager(config);
            expect(manager.getContributors()).toHaveLength(1);

            process.cwd = originalCwd;
        });
    });

    describe('Real-world Scenarios', () => {
        it('should handle default configuration (empty object)', async () => {
            const mockDateTimeGenerator = vi.fn().mockResolvedValue('2023-01-01 12:00:00');
            const mockResourcesGenerator = vi.fn().mockResolvedValue('Available files: config.yml');

            mockGetPromptGenerator.mockImplementation((source) => {
                if (source === 'dateTime') return mockDateTimeGenerator;
                if (source === 'resources') return mockResourcesGenerator;
                return undefined;
            });

            const config = SystemPromptConfigSchema.parse({});
            const manager = new SystemPromptManager(config);

            // Only dateTime should be enabled by default, resources is disabled
            const contributors = manager.getContributors();
            expect(contributors).toHaveLength(1);
            expect(contributors[0]?.id).toBe('dateTime');

            const result = await manager.build(mockContext);
            expect(result).toBe('2023-01-01 12:00:00');
            expect(mockDateTimeGenerator).toHaveBeenCalledWith(mockContext);
            expect(mockResourcesGenerator).not.toHaveBeenCalled();
        });

        it('should handle complex configuration with all contributor types', async () => {
            const mockGenerator = vi.fn().mockResolvedValue('2023-01-01');
            mockGetPromptGenerator.mockReturnValue(mockGenerator);

            const config = SystemPromptConfigSchema.parse({
                contributors: [
                    {
                        id: 'intro',
                        type: 'static',
                        priority: 0,
                        content: 'You are Dexto, an advanced AI assistant.',
                    },
                    {
                        id: 'context',
                        type: 'file',
                        priority: 5,
                        files: ['context.md'],
                        options: { includeFilenames: true },
                    },
                    {
                        id: 'datetime',
                        type: 'dynamic',
                        priority: 10,
                        source: 'dateTime',
                    },
                ],
            });

            const manager = new SystemPromptManager(config);
            const contributors = manager.getContributors();

            expect(contributors).toHaveLength(3);
            expect(contributors[0]?.id).toBe('intro');
            expect(contributors[1]?.id).toBe('context');
            expect(contributors[2]?.id).toBe('datetime');
        });
    });
});

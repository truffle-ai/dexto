import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomToolRegistry } from './custom-tool-registry.js';
import type { CustomToolProvider, ToolCreationContext } from './custom-tool-registry.js';
import type { InternalTool } from './types.js';
import { z } from 'zod';
import { ToolErrorCode } from './error-codes.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { customToolSchemaRegistry } from './custom-tool-schema-registry.js';

// Mock logger for testing
const mockLogger: IDextoLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    createChild: vi.fn(function (this: any) {
        return this;
    }),
    destroy: vi.fn(),
} as any;

// Mock agent for testing
const mockAgent = {} as any;

// Mock context for testing
const mockContext = { logger: mockLogger, agent: mockAgent };

// Mock tool for testing
const createMockTool = (id: string): InternalTool => ({
    id,
    description: `Mock tool ${id}`,
    inputSchema: z.object({ param: z.string() }),
    execute: async (input: unknown) => ({ result: 'success', input }),
});

// Mock provider configurations
const mockProviderAConfig = z.object({
    type: z.literal('mock-provider-a'),
    settingA: z.string(),
    optionalSetting: z.string().optional(),
});

const mockProviderBConfig = z.object({
    type: z.literal('mock-provider-b'),
    settingB: z.number(),
    requiredArray: z.array(z.string()),
});

type MockProviderAConfig = z.output<typeof mockProviderAConfig>;
type MockProviderBConfig = z.output<typeof mockProviderBConfig>;

// Mock providers
const createMockProviderA = (): CustomToolProvider<'mock-provider-a', MockProviderAConfig> => ({
    type: 'mock-provider-a',
    configSchema: mockProviderAConfig,
    create: (config: MockProviderAConfig, _context: ToolCreationContext): InternalTool[] => {
        return [createMockTool(`${config.type}-tool-1`), createMockTool(`${config.type}-tool-2`)];
    },
    metadata: {
        displayName: 'Mock Provider A',
        description: 'A mock provider for testing',
        category: 'testing',
    },
});

const createMockProviderB = (): CustomToolProvider<'mock-provider-b', MockProviderBConfig> => ({
    type: 'mock-provider-b',
    configSchema: mockProviderBConfig,
    create: (config: MockProviderBConfig, _context: ToolCreationContext): InternalTool[] => {
        return [createMockTool(`${config.type}-tool-1`)];
    },
    metadata: {
        displayName: 'Mock Provider B',
        description: 'Another mock provider for testing',
    },
});

describe('CustomToolRegistry', () => {
    let registry: CustomToolRegistry;

    beforeEach(() => {
        // Clear the global schema registry before each test
        customToolSchemaRegistry.clear();
        registry = new CustomToolRegistry();
    });

    describe('register()', () => {
        it('successfully registers a provider', () => {
            const provider = createMockProviderA();

            expect(() => registry.register(provider)).not.toThrow();
            expect(registry.has('mock-provider-a')).toBe(true);
        });

        it('registers multiple different providers', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();

            registry.register(providerA);
            registry.register(providerB);

            expect(registry.has('mock-provider-a')).toBe(true);
            expect(registry.has('mock-provider-b')).toBe(true);
            expect(registry.getTypes()).toEqual(['mock-provider-a', 'mock-provider-b']);
        });

        it('throws error when registering duplicate provider type', () => {
            const provider1 = createMockProviderA();
            const provider2 = createMockProviderA();

            registry.register(provider1);

            expect(() => registry.register(provider2)).toThrow(
                expect.objectContaining({
                    code: ToolErrorCode.CUSTOM_TOOL_PROVIDER_ALREADY_REGISTERED,
                    scope: ErrorScope.TOOLS,
                    type: ErrorType.USER,
                    context: { type: 'mock-provider-a' },
                })
            );
        });

        it('throws error with recovery suggestion for duplicate registration', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            try {
                registry.register(provider);
                expect.fail('Should have thrown error');
            } catch (error: any) {
                expect(error.message).toContain(
                    "Custom tool provider 'mock-provider-a' is already registered"
                );
                expect(error.recovery).toContain(
                    'Use unregister() first if you want to replace it'
                );
            }
        });
    });

    describe('unregister()', () => {
        it('successfully unregisters an existing provider', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            const result = registry.unregister('mock-provider-a');

            expect(result).toBe(true);
            expect(registry.has('mock-provider-a')).toBe(false);
        });

        it('returns false when unregistering non-existent provider', () => {
            const result = registry.unregister('non-existent-provider');

            expect(result).toBe(false);
        });

        it('allows re-registration after unregistering', () => {
            const provider = createMockProviderA();
            registry.register(provider);
            registry.unregister('mock-provider-a');

            // Also clear schema registry for this test since schema registry persists by design
            customToolSchemaRegistry.clear();

            expect(() => registry.register(provider)).not.toThrow();
            expect(registry.has('mock-provider-a')).toBe(true);
        });

        it('unregisters correct provider when multiple are registered', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();
            registry.register(providerA);
            registry.register(providerB);

            registry.unregister('mock-provider-a');

            expect(registry.has('mock-provider-a')).toBe(false);
            expect(registry.has('mock-provider-b')).toBe(true);
        });
    });

    describe('get()', () => {
        it('returns registered provider', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            const retrieved = registry.get('mock-provider-a');

            expect(retrieved).toBeDefined();
            expect(retrieved?.type).toBe('mock-provider-a');
            expect(retrieved?.metadata?.displayName).toBe('Mock Provider A');
        });

        it('returns undefined for non-existent provider', () => {
            const retrieved = registry.get('non-existent-provider');

            expect(retrieved).toBeUndefined();
        });

        it('returns correct provider when multiple are registered', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();
            registry.register(providerA);
            registry.register(providerB);

            const retrievedA = registry.get('mock-provider-a');
            const retrievedB = registry.get('mock-provider-b');

            expect(retrievedA?.type).toBe('mock-provider-a');
            expect(retrievedB?.type).toBe('mock-provider-b');
        });

        it('returned provider can create tools', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            const retrieved = registry.get('mock-provider-a');
            const tools = retrieved?.create(
                { type: 'mock-provider-a', settingA: 'test' },
                mockContext
            );

            expect(tools).toHaveLength(2);
            expect(tools![0]!.id).toBe('mock-provider-a-tool-1');
            expect(tools![1]!.id).toBe('mock-provider-a-tool-2');
        });
    });

    describe('has()', () => {
        it('returns true for registered provider', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            expect(registry.has('mock-provider-a')).toBe(true);
        });

        it('returns false for non-existent provider', () => {
            expect(registry.has('non-existent-provider')).toBe(false);
        });

        it('returns false after provider is unregistered', () => {
            const provider = createMockProviderA();
            registry.register(provider);
            registry.unregister('mock-provider-a');

            expect(registry.has('mock-provider-a')).toBe(false);
        });
    });

    describe('getTypes()', () => {
        it('returns empty array when no providers registered', () => {
            expect(registry.getTypes()).toEqual([]);
        });

        it('returns single type when one provider is registered', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            expect(registry.getTypes()).toEqual(['mock-provider-a']);
        });

        it('returns all registered types in order', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();
            registry.register(providerA);
            registry.register(providerB);

            const types = registry.getTypes();
            expect(types).toHaveLength(2);
            expect(types).toContain('mock-provider-a');
            expect(types).toContain('mock-provider-b');
        });

        it('updates correctly when providers are unregistered', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();
            registry.register(providerA);
            registry.register(providerB);

            registry.unregister('mock-provider-a');

            expect(registry.getTypes()).toEqual(['mock-provider-b']);
        });
    });

    describe('validateConfig()', () => {
        beforeEach(() => {
            registry.register(createMockProviderA());
            registry.register(createMockProviderB());
        });

        it('validates correct configuration for provider A', () => {
            const config = {
                type: 'mock-provider-a',
                settingA: 'test-value',
            };

            const validated = registry.validateConfig(config);

            expect(validated).toEqual(config);
            expect(validated.type).toBe('mock-provider-a');
            expect(validated.settingA).toBe('test-value');
        });

        it('validates correct configuration for provider B', () => {
            const config = {
                type: 'mock-provider-b',
                settingB: 42,
                requiredArray: ['item1', 'item2'],
            };

            const validated = registry.validateConfig(config);

            expect(validated).toEqual(config);
            expect(validated.type).toBe('mock-provider-b');
            expect(validated.settingB).toBe(42);
        });

        it('validates configuration with optional fields', () => {
            const config = {
                type: 'mock-provider-a',
                settingA: 'test',
                optionalSetting: 'optional-value',
            };

            const validated = registry.validateConfig(config);

            expect(validated.optionalSetting).toBe('optional-value');
        });

        it('throws error for unknown provider type', () => {
            const config = {
                type: 'unknown-provider',
                someSetting: 'value',
            };

            expect(() => registry.validateConfig(config)).toThrow(
                expect.objectContaining({
                    code: ToolErrorCode.CUSTOM_TOOL_PROVIDER_UNKNOWN,
                    scope: ErrorScope.TOOLS,
                    type: ErrorType.USER,
                    context: {
                        type: 'unknown-provider',
                        availableTypes: expect.arrayContaining([
                            'mock-provider-a',
                            'mock-provider-b',
                        ]),
                    },
                })
            );
        });

        it('includes available types in unknown provider error', () => {
            const config = { type: 'unknown-provider' };

            try {
                registry.validateConfig(config);
                expect.fail('Should have thrown error');
            } catch (error: any) {
                expect(error.message).toContain("Unknown custom tool provider: 'unknown-provider'");
                expect(error.recovery).toContain('mock-provider-a');
                expect(error.recovery).toContain('mock-provider-b');
            }
        });

        it('throws ZodError for invalid configuration structure', () => {
            const config = {
                type: 'mock-provider-a',
                // missing required settingA
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('throws ZodError for wrong type in configuration', () => {
            const config = {
                type: 'mock-provider-b',
                settingB: 'should-be-number', // wrong type
                requiredArray: ['item1'],
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('throws error for configuration missing type field', () => {
            const config = {
                settingA: 'test',
            };

            expect(() => registry.validateConfig(config)).toThrow();
        });

        it('throws error for null config', () => {
            expect(() => registry.validateConfig(null)).toThrow();
        });

        it('throws error for undefined config', () => {
            expect(() => registry.validateConfig(undefined)).toThrow();
        });

        it('allows extra fields to pass through with passthrough', () => {
            const config = {
                type: 'mock-provider-a',
                settingA: 'test',
                extraField: 'should-pass-through',
            };

            // This should not throw because the type schema uses passthrough()
            const validated = registry.validateConfig(config);
            expect(validated.type).toBe('mock-provider-a');
        });
    });

    describe('clear()', () => {
        it('clears all registered providers', () => {
            const providerA = createMockProviderA();
            const providerB = createMockProviderB();
            registry.register(providerA);
            registry.register(providerB);

            registry.clear();

            expect(registry.getTypes()).toEqual([]);
            expect(registry.has('mock-provider-a')).toBe(false);
            expect(registry.has('mock-provider-b')).toBe(false);
        });

        it('allows registration after clearing', () => {
            const provider = createMockProviderA();
            registry.register(provider);
            registry.clear();

            // Also clear schema registry for this test since schema registry persists by design
            customToolSchemaRegistry.clear();

            expect(() => registry.register(provider)).not.toThrow();
            expect(registry.has('mock-provider-a')).toBe(true);
        });

        it('is safe to call on empty registry', () => {
            expect(() => registry.clear()).not.toThrow();
            expect(registry.getTypes()).toEqual([]);
        });

        it('is safe to call multiple times', () => {
            const provider = createMockProviderA();
            registry.register(provider);

            registry.clear();
            registry.clear();

            expect(registry.getTypes()).toEqual([]);
        });
    });

    describe('Provider Integration', () => {
        it('provider can access logger from creation context', () => {
            const loggerSpy = vi.fn();
            const provider: CustomToolProvider<'test-logger', { type: 'test-logger' }> = {
                type: 'test-logger',
                configSchema: z.object({ type: z.literal('test-logger') }),
                create: (_config, context) => {
                    loggerSpy(context.logger);
                    return [];
                },
            };

            registry.register(provider);
            const retrieved = registry.get('test-logger');
            retrieved?.create({ type: 'test-logger' }, mockContext);

            expect(loggerSpy).toHaveBeenCalledWith(mockLogger);
        });

        it('provider can access services from creation context', () => {
            const servicesSpy = vi.fn();
            const mockServices = {
                searchService: { search: vi.fn() },
                customService: { custom: vi.fn() },
            };

            const provider: CustomToolProvider<'test-services', { type: 'test-services' }> = {
                type: 'test-services',
                configSchema: z.object({ type: z.literal('test-services') }),
                create: (_config, context) => {
                    servicesSpy(context.services);
                    return [];
                },
            };

            registry.register(provider);
            const retrieved = registry.get('test-services');
            retrieved?.create(
                { type: 'test-services' },
                { logger: mockLogger, agent: mockAgent, services: mockServices }
            );

            expect(servicesSpy).toHaveBeenCalledWith(mockServices);
        });

        it('provider can use validated config to create tools', () => {
            const provider: CustomToolProvider<
                'config-based',
                { type: 'config-based'; toolCount: number }
            > = {
                type: 'config-based',
                configSchema: z.object({
                    type: z.literal('config-based'),
                    toolCount: z.number(),
                }),
                create: (config, _context) => {
                    return Array.from({ length: config.toolCount }, (_, i) =>
                        createMockTool(`tool-${i}`)
                    );
                },
            };

            registry.register(provider);
            const validated = registry.validateConfig({ type: 'config-based', toolCount: 3 });
            const retrieved = registry.get('config-based');
            const tools = retrieved?.create(validated, mockContext);

            expect(tools).toHaveLength(3);
            expect(tools![0]!.id).toBe('tool-0');
            expect(tools![2]!.id).toBe('tool-2');
        });
    });

    describe('Edge Cases', () => {
        it('handles provider with empty metadata', () => {
            const provider: CustomToolProvider<'no-metadata', { type: 'no-metadata' }> = {
                type: 'no-metadata',
                configSchema: z.object({ type: z.literal('no-metadata') }),
                create: () => [],
            };

            registry.register(provider);
            const retrieved = registry.get('no-metadata');

            expect(retrieved?.metadata).toBeUndefined();
        });

        it('handles provider that creates zero tools', () => {
            const provider: CustomToolProvider<'zero-tools', { type: 'zero-tools' }> = {
                type: 'zero-tools',
                configSchema: z.object({ type: z.literal('zero-tools') }),
                create: () => [],
            };

            registry.register(provider);
            const retrieved = registry.get('zero-tools');
            const tools = retrieved?.create({ type: 'zero-tools' }, mockContext);

            expect(tools).toEqual([]);
        });

        it('handles provider with complex nested schema', () => {
            const complexSchema = z.object({
                type: z.literal('complex'),
                nested: z.object({
                    level1: z.object({
                        level2: z.array(z.string()),
                    }),
                }),
            });

            const provider: CustomToolProvider<'complex', z.output<typeof complexSchema>> = {
                type: 'complex',
                configSchema: complexSchema,
                create: () => [],
            };

            registry.register(provider);

            const config = {
                type: 'complex',
                nested: {
                    level1: {
                        level2: ['a', 'b', 'c'],
                    },
                },
            };

            const validated = registry.validateConfig(config);
            expect(validated).toEqual(config);
        });
    });
});

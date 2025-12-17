import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
    PluginRegistry,
    pluginRegistry,
    type PluginProvider,
    type PluginCreationContext,
} from './registry.js';
import type {
    DextoPlugin,
    PluginResult,
    BeforeLLMRequestPayload,
    PluginExecutionContext,
} from './types.js';
import { PluginErrorCode } from './error-codes.js';
import { DextoRuntimeError } from '../errors/index.js';

// Test plugin implementation
class TestPlugin implements DextoPlugin {
    constructor(
        public config: any,
        public context: PluginCreationContext
    ) {}

    async beforeLLMRequest(
        _payload: BeforeLLMRequestPayload,
        _context: PluginExecutionContext
    ): Promise<PluginResult> {
        return { ok: true };
    }
}

// Test plugin config schema
const TestPluginConfigSchema = z.object({
    type: z.literal('test-plugin'),
    message: z.string().default('hello'),
});

// Test plugin provider
const testPluginProvider: PluginProvider<'test-plugin', z.output<typeof TestPluginConfigSchema>> = {
    type: 'test-plugin',
    configSchema: TestPluginConfigSchema,
    create(config, context) {
        return new TestPlugin(config, context);
    },
    metadata: {
        displayName: 'Test Plugin',
        description: 'A test plugin for unit testing',
        extensionPoints: ['beforeLLMRequest'],
        category: 'test',
    },
};

describe('PluginRegistry', () => {
    let registry: PluginRegistry;

    beforeEach(() => {
        registry = new PluginRegistry();
    });

    describe('register', () => {
        it('should register a plugin provider', () => {
            registry.register(testPluginProvider);
            expect(registry.has('test-plugin')).toBe(true);
        });

        it('should throw when registering duplicate provider', () => {
            registry.register(testPluginProvider);

            expect(() => registry.register(testPluginProvider)).toThrow(DextoRuntimeError);

            try {
                registry.register(testPluginProvider);
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    PluginErrorCode.PLUGIN_PROVIDER_ALREADY_REGISTERED
                );
            }
        });

        it('should allow registering multiple different providers', () => {
            const provider1: PluginProvider = {
                type: 'plugin-a',
                configSchema: z.object({ type: z.literal('plugin-a') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            const provider2: PluginProvider = {
                type: 'plugin-b',
                configSchema: z.object({ type: z.literal('plugin-b') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            registry.register(provider1);
            registry.register(provider2);

            expect(registry.size).toBe(2);
            expect(registry.getTypes()).toEqual(['plugin-a', 'plugin-b']);
        });
    });

    describe('unregister', () => {
        it('should unregister an existing provider', () => {
            registry.register(testPluginProvider);
            const result = registry.unregister('test-plugin');

            expect(result).toBe(true);
            expect(registry.has('test-plugin')).toBe(false);
        });

        it('should return false when unregistering non-existent provider', () => {
            const result = registry.unregister('nonexistent');
            expect(result).toBe(false);
        });
    });

    describe('get', () => {
        it('should return the provider if found', () => {
            registry.register(testPluginProvider);

            const result = registry.get('test-plugin');
            expect(result).toEqual(testPluginProvider);
        });

        it('should return undefined if not found', () => {
            const result = registry.get('nonexistent');
            expect(result).toBeUndefined();
        });
    });

    describe('has', () => {
        it('should return true for registered providers', () => {
            registry.register(testPluginProvider);
            expect(registry.has('test-plugin')).toBe(true);
        });

        it('should return false for non-registered providers', () => {
            expect(registry.has('nonexistent')).toBe(false);
        });
    });

    describe('getTypes', () => {
        it('should return empty array when no providers', () => {
            expect(registry.getTypes()).toEqual([]);
        });

        it('should return all registered types', () => {
            const provider1: PluginProvider = {
                type: 'plugin-a',
                configSchema: z.object({ type: z.literal('plugin-a') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            const provider2: PluginProvider = {
                type: 'plugin-b',
                configSchema: z.object({ type: z.literal('plugin-b') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            registry.register(provider1);
            registry.register(provider2);

            expect(registry.getTypes()).toEqual(['plugin-a', 'plugin-b']);
        });
    });

    describe('getAll / getProviders', () => {
        it('should return empty array when no providers', () => {
            expect(registry.getAll()).toEqual([]);
            expect(registry.getProviders()).toEqual([]);
        });

        it('should return all registered providers', () => {
            registry.register(testPluginProvider);

            expect(registry.getAll()).toEqual([testPluginProvider]);
            expect(registry.getProviders()).toEqual([testPluginProvider]);
        });
    });

    describe('size', () => {
        it('should return 0 when empty', () => {
            expect(registry.size).toBe(0);
        });

        it('should return correct count', () => {
            const provider1: PluginProvider = {
                type: 'plugin-a',
                configSchema: z.object({ type: z.literal('plugin-a') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            registry.register(provider1);
            registry.register(testPluginProvider);

            expect(registry.size).toBe(2);
        });
    });

    describe('clear', () => {
        it('should remove all providers', () => {
            registry.register(testPluginProvider);
            registry.clear();

            expect(registry.size).toBe(0);
            expect(registry.getTypes()).toEqual([]);
        });
    });

    describe('validateConfig', () => {
        beforeEach(() => {
            registry.register(testPluginProvider);
        });

        it('should validate against provider schema', () => {
            const result = registry.validateConfig({ type: 'test-plugin', message: 'world' });
            expect(result).toEqual({ type: 'test-plugin', message: 'world' });
        });

        it('should use default values from schema', () => {
            const result = registry.validateConfig({ type: 'test-plugin' });
            expect(result).toEqual({ type: 'test-plugin', message: 'hello' });
        });

        it('should throw if provider not found', () => {
            expect(() => registry.validateConfig({ type: 'unknown' })).toThrow(DextoRuntimeError);

            try {
                registry.validateConfig({ type: 'unknown' });
            } catch (error) {
                expect(error).toBeInstanceOf(DextoRuntimeError);
                expect((error as DextoRuntimeError).code).toBe(
                    PluginErrorCode.PLUGIN_PROVIDER_NOT_FOUND
                );
            }
        });

        it('should throw on schema validation failure', () => {
            expect(() => registry.validateConfig({ type: 'test-plugin', message: 123 })).toThrow();
        });
    });

    describe('plugin creation', () => {
        it('should create plugin instance with correct config and context', () => {
            registry.register(testPluginProvider);
            const provider = registry.get('test-plugin')!;

            const context: PluginCreationContext = {
                config: { extra: 'data' },
                blocking: true,
                priority: 10,
            };

            const plugin = provider.create({ type: 'test-plugin', message: 'test' }, context);

            expect(plugin).toBeInstanceOf(TestPlugin);
            expect((plugin as TestPlugin).config).toEqual({ type: 'test-plugin', message: 'test' });
            expect((plugin as TestPlugin).context).toEqual(context);
        });

        it('should create plugin with metadata', () => {
            registry.register(testPluginProvider);
            const provider = registry.get('test-plugin')!;

            expect(provider.metadata).toBeDefined();
            expect(provider.metadata?.displayName).toBe('Test Plugin');
            expect(provider.metadata?.description).toBe('A test plugin for unit testing');
            expect(provider.metadata?.extensionPoints).toEqual(['beforeLLMRequest']);
            expect(provider.metadata?.category).toBe('test');
        });
    });

    describe('edge cases', () => {
        it('should handle empty string type', () => {
            const emptyProvider: PluginProvider = {
                type: '',
                configSchema: z.object({ type: z.literal('') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            registry.register(emptyProvider);
            expect(registry.has('')).toBe(true);
        });

        it('should handle special characters in type', () => {
            const specialProvider: PluginProvider = {
                type: 'plugin-with_special.chars',
                configSchema: z.object({ type: z.literal('plugin-with_special.chars') }),
                create: () => ({
                    async beforeLLMRequest() {
                        return { ok: true };
                    },
                }),
            };

            registry.register(specialProvider);
            expect(registry.has('plugin-with_special.chars')).toBe(true);
        });

        it('should handle re-registration after unregister', () => {
            registry.register(testPluginProvider);
            registry.unregister('test-plugin');
            registry.register(testPluginProvider);

            expect(registry.has('test-plugin')).toBe(true);
        });
    });
});

describe('pluginRegistry singleton', () => {
    it('should be an instance of PluginRegistry', () => {
        expect(pluginRegistry).toBeInstanceOf(PluginRegistry);
    });

    it('should be the same instance across imports', async () => {
        const { pluginRegistry: registry2 } = await import('./registry.js');
        expect(pluginRegistry).toBe(registry2);
    });
});

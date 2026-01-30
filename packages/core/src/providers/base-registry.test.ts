import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
    BaseRegistry,
    defaultErrorFactory,
    type BaseProvider,
    type ConfigurableProvider,
    type RegistryErrorFactory,
} from './base-registry.js';

// Test provider types
interface SimpleProvider extends BaseProvider {
    type: string;
    value: number;
}

interface ConfigurableTestProvider extends ConfigurableProvider {
    type: string;
    configSchema: z.ZodType<any>;
    metadata?: { displayName: string };
}

describe('BaseRegistry', () => {
    describe('with default error factory', () => {
        let registry: BaseRegistry<SimpleProvider>;

        beforeEach(() => {
            registry = new BaseRegistry<SimpleProvider>();
        });

        describe('register', () => {
            it('should register a provider', () => {
                const provider: SimpleProvider = { type: 'test', value: 42 };
                registry.register(provider);
                expect(registry.has('test')).toBe(true);
            });

            it('should throw when registering duplicate provider', () => {
                const provider: SimpleProvider = { type: 'test', value: 42 };
                registry.register(provider);

                expect(() => registry.register(provider)).toThrow(
                    "Provider 'test' is already registered"
                );
            });

            it('should allow registering multiple different providers', () => {
                registry.register({ type: 'a', value: 1 });
                registry.register({ type: 'b', value: 2 });
                registry.register({ type: 'c', value: 3 });

                expect(registry.size).toBe(3);
                expect(registry.getTypes()).toEqual(['a', 'b', 'c']);
            });
        });

        describe('unregister', () => {
            it('should unregister an existing provider', () => {
                registry.register({ type: 'test', value: 42 });
                const result = registry.unregister('test');

                expect(result).toBe(true);
                expect(registry.has('test')).toBe(false);
            });

            it('should return false when unregistering non-existent provider', () => {
                const result = registry.unregister('nonexistent');
                expect(result).toBe(false);
            });
        });

        describe('get', () => {
            it('should return the provider if found', () => {
                const provider: SimpleProvider = { type: 'test', value: 42 };
                registry.register(provider);

                const result = registry.get('test');
                expect(result).toEqual(provider);
            });

            it('should return undefined if not found', () => {
                const result = registry.get('nonexistent');
                expect(result).toBeUndefined();
            });
        });

        describe('has', () => {
            it('should return true for registered providers', () => {
                registry.register({ type: 'test', value: 42 });
                expect(registry.has('test')).toBe(true);
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
                registry.register({ type: 'a', value: 1 });
                registry.register({ type: 'b', value: 2 });

                expect(registry.getTypes()).toEqual(['a', 'b']);
            });
        });

        describe('getAll', () => {
            it('should return empty array when no providers', () => {
                expect(registry.getAll()).toEqual([]);
            });

            it('should return all registered providers', () => {
                const a: SimpleProvider = { type: 'a', value: 1 };
                const b: SimpleProvider = { type: 'b', value: 2 };
                registry.register(a);
                registry.register(b);

                expect(registry.getAll()).toEqual([a, b]);
            });
        });

        describe('size', () => {
            it('should return 0 when empty', () => {
                expect(registry.size).toBe(0);
            });

            it('should return correct count', () => {
                registry.register({ type: 'a', value: 1 });
                registry.register({ type: 'b', value: 2 });
                expect(registry.size).toBe(2);
            });
        });

        describe('clear', () => {
            it('should remove all providers', () => {
                registry.register({ type: 'a', value: 1 });
                registry.register({ type: 'b', value: 2 });
                registry.clear();

                expect(registry.size).toBe(0);
                expect(registry.getTypes()).toEqual([]);
            });
        });
    });

    describe('with custom error factory', () => {
        class CustomError extends Error {
            constructor(
                message: string,
                public code: string
            ) {
                super(message);
            }
        }

        const customErrorFactory: RegistryErrorFactory = {
            alreadyRegistered: (type: string) => new CustomError(`Duplicate: ${type}`, 'DUPLICATE'),
            notFound: (type: string, available: string[]) =>
                new CustomError(`Missing: ${type}, have: ${available}`, 'NOT_FOUND'),
        };

        let registry: BaseRegistry<SimpleProvider>;

        beforeEach(() => {
            registry = new BaseRegistry<SimpleProvider>(customErrorFactory);
        });

        it('should use custom error for duplicate registration', () => {
            registry.register({ type: 'test', value: 42 });

            try {
                registry.register({ type: 'test', value: 99 });
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(CustomError);
                expect((error as CustomError).code).toBe('DUPLICATE');
                expect((error as CustomError).message).toBe('Duplicate: test');
            }
        });

        it('should use custom error for validateConfig not found', () => {
            try {
                registry.validateConfig({ type: 'unknown' });
                expect.fail('Should have thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(CustomError);
                expect((error as CustomError).code).toBe('NOT_FOUND');
            }
        });
    });

    describe('validateConfig', () => {
        let registry: BaseRegistry<ConfigurableTestProvider>;

        beforeEach(() => {
            registry = new BaseRegistry<ConfigurableTestProvider>();
        });

        it('should throw if config has no type field', () => {
            expect(() => registry.validateConfig({})).toThrow();
        });

        it('should throw if config type is not a string', () => {
            expect(() => registry.validateConfig({ type: 123 })).toThrow();
        });

        it('should throw if provider not found', () => {
            expect(() => registry.validateConfig({ type: 'unknown' })).toThrow(
                "Provider 'unknown' not found"
            );
        });

        it('should throw if provider has no configSchema', () => {
            // Register a provider without configSchema
            const providerWithoutSchema = {
                type: 'no-schema',
            } as ConfigurableTestProvider;
            registry.register(providerWithoutSchema);

            expect(() => registry.validateConfig({ type: 'no-schema' })).toThrow(
                "Provider 'no-schema' does not support config validation"
            );
        });

        it('should validate against provider schema', () => {
            const schema = z.object({
                type: z.literal('my-type'),
                value: z.number(),
            });

            registry.register({
                type: 'my-type',
                configSchema: schema,
            });

            const result = registry.validateConfig({ type: 'my-type', value: 42 });
            expect(result).toEqual({ type: 'my-type', value: 42 });
        });

        it('should throw on schema validation failure', () => {
            const schema = z.object({
                type: z.literal('my-type'),
                value: z.number(),
            });

            registry.register({
                type: 'my-type',
                configSchema: schema,
            });

            expect(() =>
                registry.validateConfig({ type: 'my-type', value: 'not-a-number' })
            ).toThrow();
        });
    });

    describe('defaultErrorFactory', () => {
        it('should create alreadyRegistered error', () => {
            const error = defaultErrorFactory.alreadyRegistered('test-type');
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe("Provider 'test-type' is already registered");
        });

        it('should create notFound error with available types', () => {
            const error = defaultErrorFactory.notFound('unknown', ['a', 'b', 'c']);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe("Provider 'unknown' not found. Available: a, b, c");
        });

        it('should create notFound error with no available types', () => {
            const error = defaultErrorFactory.notFound('unknown', []);
            expect(error).toBeInstanceOf(Error);
            expect(error.message).toBe("Provider 'unknown' not found. Available: none");
        });
    });

    describe('type safety', () => {
        it('should maintain provider type through get()', () => {
            interface TypedProvider extends BaseProvider {
                type: string;
                specificMethod: () => string;
            }

            const registry = new BaseRegistry<TypedProvider>();
            registry.register({
                type: 'typed',
                specificMethod: () => 'hello',
            });

            const provider = registry.get('typed');
            expect(provider?.specificMethod()).toBe('hello');
        });

        it('should maintain provider type through getAll()', () => {
            interface TypedProvider extends BaseProvider {
                type: string;
                value: number;
            }

            const registry = new BaseRegistry<TypedProvider>();
            registry.register({ type: 'a', value: 1 });
            registry.register({ type: 'b', value: 2 });

            const providers = registry.getAll();
            const sum = providers.reduce((acc, p) => acc + p.value, 0);
            expect(sum).toBe(3);
        });
    });

    describe('edge cases', () => {
        let registry: BaseRegistry<SimpleProvider>;

        beforeEach(() => {
            registry = new BaseRegistry<SimpleProvider>();
        });

        it('should handle empty string type', () => {
            registry.register({ type: '', value: 42 });
            expect(registry.has('')).toBe(true);
            expect(registry.get('')?.value).toBe(42);
        });

        it('should handle special characters in type', () => {
            registry.register({ type: 'type-with_special.chars', value: 42 });
            expect(registry.has('type-with_special.chars')).toBe(true);
        });

        it('should handle re-registration after unregister', () => {
            registry.register({ type: 'test', value: 1 });
            registry.unregister('test');
            registry.register({ type: 'test', value: 2 });

            expect(registry.get('test')?.value).toBe(2);
        });

        it('should handle clear then re-register', () => {
            registry.register({ type: 'a', value: 1 });
            registry.register({ type: 'b', value: 2 });
            registry.clear();
            registry.register({ type: 'c', value: 3 });

            expect(registry.size).toBe(1);
            expect(registry.has('a')).toBe(false);
            expect(registry.has('c')).toBe(true);
        });
    });
});

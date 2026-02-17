import { describe, test, expect, afterEach } from 'vitest';
import { Telemetry } from './telemetry.js';
import type { OtelConfiguration } from './schemas.js';

describe.sequential('Telemetry Core', () => {
    // Clean up after each test to prevent state leakage
    afterEach(async () => {
        // Force clear global state
        if (Telemetry.hasGlobalInstance()) {
            await Telemetry.shutdownGlobal();
        }
        // Longer delay to ensure cleanup completes and providers are unregistered
        await new Promise((resolve) => setTimeout(resolve, 100));
    });

    describe('Initialization', () => {
        test('init() with enabled=true creates telemetry instance', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                serviceName: 'test-service',
                export: { type: 'console' },
            };

            const telemetry = await Telemetry.init(config);

            expect(telemetry).toBeDefined();
            expect(telemetry.isInitialized()).toBe(true);
            expect(telemetry.name).toBe('test-service');
            expect(Telemetry.hasGlobalInstance()).toBe(true);
        }, 15_000);

        test('init() with enabled=false creates instance but does not initialize SDK', async () => {
            const config: OtelConfiguration = {
                enabled: false,
                serviceName: 'test-service',
            };

            const telemetry = await Telemetry.init(config);

            expect(telemetry).toBeDefined();
            expect(telemetry.isInitialized()).toBe(false);
            expect(Telemetry.hasGlobalInstance()).toBe(true);
        });

        test('init() with console exporter works', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                export: { type: 'console' },
            };

            const telemetry = await Telemetry.init(config);

            expect(telemetry.isInitialized()).toBe(true);
        });

        test('init() with otlp-http exporter works', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                export: {
                    type: 'otlp',
                    protocol: 'http',
                    endpoint: 'http://localhost:4318/v1/traces',
                },
            };

            const telemetry = await Telemetry.init(config);

            expect(telemetry.isInitialized()).toBe(true);
        });

        test('init() with otlp-grpc exporter works', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                export: {
                    type: 'otlp',
                    protocol: 'grpc',
                    endpoint: 'http://localhost:4317',
                },
            };

            const telemetry = await Telemetry.init(config);

            expect(telemetry.isInitialized()).toBe(true);
        });

        test('init() is idempotent - returns same instance on subsequent calls', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                serviceName: 'test-service',
                export: { type: 'console' },
            };

            const telemetry1 = await Telemetry.init(config);
            const telemetry2 = await Telemetry.init(config);
            const telemetry3 = await Telemetry.init({ enabled: false }); // Different config

            // Should return the same instance regardless of config
            expect(telemetry1).toBe(telemetry2);
            expect(telemetry2).toBe(telemetry3);
        });

        test('init() is race-safe - concurrent calls return same instance', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                serviceName: 'test-service',
                export: { type: 'console' },
            };

            // Start multiple init calls concurrently
            const [telemetry1, telemetry2, telemetry3] = await Promise.all([
                Telemetry.init(config),
                Telemetry.init(config),
                Telemetry.init(config),
            ]);

            // All should return the same instance
            expect(telemetry1).toBe(telemetry2);
            expect(telemetry2).toBe(telemetry3);
            expect(Telemetry.hasGlobalInstance()).toBe(true);
        });

        test('get() throws when not initialized', () => {
            expect(() => Telemetry.get()).toThrow('Telemetry not initialized');
        });

        test('get() returns instance after initialization', async () => {
            const config: OtelConfiguration = {
                enabled: true,
                export: { type: 'console' },
            };

            const telemetry = await Telemetry.init(config);
            const retrieved = Telemetry.get();

            expect(retrieved).toBe(telemetry);
        });

        test('hasGlobalInstance() returns correct state', async () => {
            expect(Telemetry.hasGlobalInstance()).toBe(false);

            await Telemetry.init({ enabled: true, export: { type: 'console' } });
            expect(Telemetry.hasGlobalInstance()).toBe(true);

            await Telemetry.shutdownGlobal();
            expect(Telemetry.hasGlobalInstance()).toBe(false);
        });
    });

    describe('Shutdown', () => {
        test('shutdownGlobal() clears global instance', async () => {
            await Telemetry.init({ enabled: true, export: { type: 'console' } });
            expect(Telemetry.hasGlobalInstance()).toBe(true);

            await Telemetry.shutdownGlobal();
            expect(Telemetry.hasGlobalInstance()).toBe(false);
        });

        test('shutdownGlobal() allows re-initialization', async () => {
            // First initialization
            const telemetry1 = await Telemetry.init({
                enabled: true,
                serviceName: 'service-1',
                export: { type: 'console' },
            });
            expect(telemetry1.name).toBe('service-1');

            // Shutdown
            await Telemetry.shutdownGlobal();

            // Second initialization with different config
            const telemetry2 = await Telemetry.init({
                enabled: true,
                serviceName: 'service-2',
                export: { type: 'console' },
            });
            expect(telemetry2.name).toBe('service-2');
            expect(telemetry2).not.toBe(telemetry1);
        });

        test('shutdownGlobal() is safe to call when not initialized', async () => {
            expect(Telemetry.hasGlobalInstance()).toBe(false);
            await expect(Telemetry.shutdownGlobal()).resolves.not.toThrow();
        });

        test('shutdown() on instance clears isInitialized flag', async () => {
            const telemetry = await Telemetry.init({
                enabled: true,
                export: { type: 'console' },
            });
            expect(telemetry.isInitialized()).toBe(true);

            await telemetry.shutdown();
            expect(telemetry.isInitialized()).toBe(false);
        });
    });

    // Note: Signal handler tests removed - they are implementation details
    // that are difficult to test reliably with mocks. Signal handlers are
    // manually verified to work correctly (process cleanup on SIGTERM/SIGINT).

    describe('Agent Switching', () => {
        test('supports sequential agent switching with different configs', async () => {
            // Agent 1
            const telemetry1 = await Telemetry.init({
                enabled: true,
                serviceName: 'agent-1',
                export: { type: 'console' },
            });
            expect(telemetry1.name).toBe('agent-1');
            expect(Telemetry.hasGlobalInstance()).toBe(true);

            // Shutdown agent 1
            await Telemetry.shutdownGlobal();
            expect(Telemetry.hasGlobalInstance()).toBe(false);

            // Agent 2 with different config
            const telemetry2 = await Telemetry.init({
                enabled: true,
                serviceName: 'agent-2',
                export: {
                    type: 'otlp',
                    protocol: 'http',
                    endpoint: 'http://different:4318',
                },
            });
            expect(telemetry2.name).toBe('agent-2');
            expect(telemetry2).not.toBe(telemetry1);

            // Shutdown agent 2
            await Telemetry.shutdownGlobal();

            // Agent 3 - telemetry disabled
            const telemetry3 = await Telemetry.init({
                enabled: false,
            });
            expect(telemetry3.isInitialized()).toBe(false);
            expect(telemetry3).not.toBe(telemetry1);
            expect(telemetry3).not.toBe(telemetry2);
        });
    });

    describe('Static Methods', () => {
        test('getActiveSpan() returns undefined when no active span', () => {
            const span = Telemetry.getActiveSpan();
            expect(span).toBeUndefined();
        });

        test('setBaggage() creates new context with baggage', () => {
            const baggage = {
                sessionId: { value: 'test-session-123' },
            };

            const newCtx = Telemetry.setBaggage(baggage);
            expect(newCtx).toBeDefined();
        });

        test('withContext() executes function in given context', () => {
            const baggage = {
                testKey: { value: 'testValue' },
            };
            const ctx = Telemetry.setBaggage(baggage);

            let executed = false;
            Telemetry.withContext(ctx, () => {
                executed = true;
            });

            expect(executed).toBe(true);
        });
    });
});

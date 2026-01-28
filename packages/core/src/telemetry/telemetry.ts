import { context as otlpContext, trace, propagation } from '@opentelemetry/api';
import type { Tracer, Context, BaggageEntry } from '@opentelemetry/api';
import type { OtelConfiguration } from './schemas.js';
import { logger } from '../logger/logger.js';
import { TelemetryError } from './errors.js';
import { DextoRuntimeError } from '../errors/DextoRuntimeError.js';

// Type definitions for dynamically imported modules
type NodeSDKType = import('@opentelemetry/sdk-node').NodeSDK;
type ConsoleSpanExporterType = import('@opentelemetry/sdk-trace-base').ConsoleSpanExporter;
type OTLPHttpExporterType = import('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter;
type OTLPGrpcExporterType = import('@opentelemetry/exporter-trace-otlp-grpc').OTLPTraceExporter;

// Add type declaration for global namespace
declare global {
    var __TELEMETRY__: Telemetry | undefined;
}

/**
 * TODO (Telemetry): enhancements
 *   - Implement sampling strategies (ratio-based, parent-based, always-on/off)
 *   - Add custom span processors for filtering/enrichment
 *   - Support context propagation across A2A (agent-to-agent) calls
 *   - Add cost tracking per trace (token costs, API costs)
 *   - Add static shutdownGlobal() method for agent switching
 *   See feature-plans/telemetry.md for details
 */
export class Telemetry {
    public tracer: Tracer = trace.getTracer('dexto');
    name: string = 'dexto-service';
    private _isInitialized: boolean = false;
    private _sdk?: NodeSDKType | undefined;
    private static _initPromise?: Promise<Telemetry> | undefined;
    private static _signalHandlers?: { sigterm: () => void; sigint: () => void } | undefined;

    private constructor(config: OtelConfiguration, enabled: boolean, sdk?: NodeSDKType) {
        const serviceName = config.serviceName ?? 'dexto-service';
        const tracerName = config.tracerName ?? serviceName;

        this.name = serviceName;
        this.tracer = trace.getTracer(tracerName);
        if (sdk) {
            this._sdk = sdk;
        }
        this._isInitialized = enabled && !!sdk;
    }

    private static async buildTraceExporter(
        config: OtelConfiguration | undefined
    ): Promise<ConsoleSpanExporterType | OTLPHttpExporterType | OTLPGrpcExporterType> {
        const e = config?.export;
        if (!e || e.type === 'console') {
            const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
            return new ConsoleSpanExporter();
        }
        if (e.type === 'otlp') {
            if (e.protocol === 'grpc') {
                let OTLPGrpcExporter: typeof import('@opentelemetry/exporter-trace-otlp-grpc').OTLPTraceExporter;
                try {
                    const mod = await import('@opentelemetry/exporter-trace-otlp-grpc');
                    OTLPGrpcExporter = mod.OTLPTraceExporter;
                } catch (err) {
                    const error = err as NodeJS.ErrnoException;
                    if (error.code === 'ERR_MODULE_NOT_FOUND') {
                        throw TelemetryError.exporterDependencyNotInstalled(
                            'grpc',
                            '@opentelemetry/exporter-trace-otlp-grpc'
                        );
                    }
                    throw err;
                }
                const options: { url?: string } = {};
                if (e.endpoint) {
                    options.url = e.endpoint;
                }
                return new OTLPGrpcExporter(options);
            }
            // default to http when omitted
            let OTLPHttpExporter: typeof import('@opentelemetry/exporter-trace-otlp-http').OTLPTraceExporter;
            try {
                const mod = await import('@opentelemetry/exporter-trace-otlp-http');
                OTLPHttpExporter = mod.OTLPTraceExporter;
            } catch (err) {
                const error = err as NodeJS.ErrnoException;
                if (error.code === 'ERR_MODULE_NOT_FOUND') {
                    throw TelemetryError.exporterDependencyNotInstalled(
                        'http',
                        '@opentelemetry/exporter-trace-otlp-http'
                    );
                }
                throw err;
            }
            const options: { url?: string; headers?: Record<string, string> } = {};
            if (e.endpoint) {
                options.url = e.endpoint;
            }
            if (e.headers) {
                options.headers = e.headers;
            }
            return new OTLPHttpExporter(options);
        }
        // schema also allows 'custom' but YAML cannot provide a SpanExporter instance
        const { ConsoleSpanExporter } = await import('@opentelemetry/sdk-trace-base');
        return new ConsoleSpanExporter();
    }
    /**
     * Initialize telemetry with the given configuration
     * @param config - Optional telemetry configuration object
     * @param exporter - Optional custom span exporter (overrides config.export, useful for testing)
     * @returns Telemetry instance that can be used for tracing
     */
    static async init(
        config: OtelConfiguration = {},
        exporter?: import('@opentelemetry/sdk-trace-base').SpanExporter
    ): Promise<Telemetry> {
        try {
            // Return existing instance if already initialized
            if (globalThis.__TELEMETRY__) return globalThis.__TELEMETRY__;

            // Return pending promise if initialization is in progress
            if (Telemetry._initPromise) return Telemetry._initPromise;

            // Create and store initialization promise to prevent race conditions
            Telemetry._initPromise = (async () => {
                if (!globalThis.__TELEMETRY__) {
                    // honor enabled=false: skip SDK registration
                    const enabled = config.enabled !== false;

                    let sdk: NodeSDKType | undefined;
                    if (enabled) {
                        // Dynamic imports for optional OpenTelemetry dependencies
                        let NodeSDK: typeof import('@opentelemetry/sdk-node').NodeSDK;
                        let Resource: typeof import('@opentelemetry/resources').Resource;
                        let HttpInstrumentation: typeof import('@opentelemetry/instrumentation-http').HttpInstrumentation;
                        let UndiciInstrumentation: typeof import('@opentelemetry/instrumentation-undici').UndiciInstrumentation;
                        let ATTR_SERVICE_NAME: string;

                        try {
                            const sdkModule = await import('@opentelemetry/sdk-node');
                            NodeSDK = sdkModule.NodeSDK;

                            const resourcesModule = await import('@opentelemetry/resources');
                            Resource = resourcesModule.Resource;

                            // Import specific instrumentations instead of auto-instrumentations-node
                            // This reduces install size by ~130MB while maintaining HTTP tracing for LLM API calls
                            const httpInstModule = await import(
                                '@opentelemetry/instrumentation-http'
                            );
                            HttpInstrumentation = httpInstModule.HttpInstrumentation;

                            const undiciInstModule = await import(
                                '@opentelemetry/instrumentation-undici'
                            );
                            UndiciInstrumentation = undiciInstModule.UndiciInstrumentation;

                            const semanticModule = await import(
                                '@opentelemetry/semantic-conventions'
                            );
                            ATTR_SERVICE_NAME = semanticModule.ATTR_SERVICE_NAME;
                        } catch (importError) {
                            const err = importError as NodeJS.ErrnoException;
                            if (err.code === 'ERR_MODULE_NOT_FOUND') {
                                throw TelemetryError.dependencyNotInstalled([
                                    '@opentelemetry/sdk-node',
                                    '@opentelemetry/instrumentation-http',
                                    '@opentelemetry/instrumentation-undici',
                                    '@opentelemetry/resources',
                                    '@opentelemetry/semantic-conventions',
                                    '@opentelemetry/sdk-trace-base',
                                    '@opentelemetry/exporter-trace-otlp-http',
                                    '@opentelemetry/exporter-trace-otlp-grpc',
                                ]);
                            }
                            throw importError;
                        }

                        const resource = new Resource({
                            [ATTR_SERVICE_NAME]: config.serviceName ?? 'dexto-service',
                        });

                        // Use custom exporter if provided, otherwise build from config
                        const spanExporter =
                            exporter || (await Telemetry.buildTraceExporter(config));

                        // Dynamically import CompositeExporter to avoid loading OpenTelemetry at startup
                        const { CompositeExporter } = await import('./exporters.js');
                        const traceExporter =
                            spanExporter instanceof CompositeExporter
                                ? spanExporter
                                : new CompositeExporter([spanExporter]);

                        // Use specific instrumentations for HTTP tracing:
                        // - HttpInstrumentation: traces http/https module calls
                        // - UndiciInstrumentation: traces fetch() calls (Node.js 18+ uses undici internally)
                        sdk = new NodeSDK({
                            resource,
                            traceExporter,
                            instrumentations: [
                                new HttpInstrumentation(),
                                new UndiciInstrumentation(),
                            ],
                        });

                        await sdk.start(); // registers the global provider → no ProxyTracer

                        // graceful shutdown (one-shot, avoid unhandled rejection)
                        const sigterm = () => {
                            void sdk?.shutdown();
                        };
                        const sigint = () => {
                            void sdk?.shutdown();
                        };
                        process.once('SIGTERM', sigterm);
                        process.once('SIGINT', sigint);
                        Telemetry._signalHandlers = { sigterm, sigint };
                    }

                    globalThis.__TELEMETRY__ = new Telemetry(config, enabled, sdk);
                }
                return globalThis.__TELEMETRY__!;
            })();

            // Await the promise so failures are caught by outer try/catch
            // This ensures _initPromise is cleared on failure, allowing re-initialization
            return await Telemetry._initPromise;
        } catch (error) {
            // Clear init promise so subsequent calls can retry
            Telemetry._initPromise = undefined;
            // Re-throw typed errors as-is, wrap unknown errors
            if (error instanceof DextoRuntimeError) {
                throw error;
            }
            throw TelemetryError.initializationFailed(
                error instanceof Error ? error.message : String(error),
                error
            );
        }
    }

    static getActiveSpan() {
        const span = trace.getActiveSpan();
        return span;
    }

    /**
     * Get the global telemetry instance
     * @throws {DextoRuntimeError} If telemetry has not been initialized
     * @returns {Telemetry} The global telemetry instance
     */
    static get(): Telemetry {
        if (!globalThis.__TELEMETRY__) {
            throw TelemetryError.notInitialized();
        }
        return globalThis.__TELEMETRY__;
    }

    /**
     * Check if global telemetry instance exists
     * @returns True if telemetry has been initialized, false otherwise
     */
    static hasGlobalInstance(): boolean {
        return globalThis.__TELEMETRY__ !== undefined;
    }

    /**
     * Shutdown global telemetry instance
     * Used during agent switching to cleanly shutdown old agent's telemetry
     * before initializing new agent's telemetry with potentially different config
     * @returns Promise that resolves when shutdown is complete
     */
    static async shutdownGlobal(): Promise<void> {
        if (globalThis.__TELEMETRY__) {
            await globalThis.__TELEMETRY__.shutdown();
            globalThis.__TELEMETRY__ = undefined;
        }
        // Also clear the init promise to allow re-initialization
        Telemetry._initPromise = undefined;
    }

    /**
     * Checks if the Telemetry instance has been successfully initialized.
     * @returns True if the instance is initialized, false otherwise.
     */
    public isInitialized(): boolean {
        return this._isInitialized;
    }

    static setBaggage(baggage: Record<string, BaggageEntry>, ctx: Context = otlpContext.active()) {
        const currentBaggage = Object.fromEntries(
            propagation.getBaggage(ctx)?.getAllEntries() ?? []
        );
        const newCtx = propagation.setBaggage(
            ctx,
            propagation.createBaggage({
                ...currentBaggage,
                ...baggage,
            })
        );
        return newCtx;
    }

    static withContext(ctx: Context, fn: () => void) {
        return otlpContext.with(ctx, fn);
    }

    /**
     * Forces pending spans to be exported immediately.
     * Useful for testing to ensure spans are available in exporters.
     */
    public async forceFlush(): Promise<void> {
        if (this._isInitialized) {
            // Access the global tracer provider and force flush
            const provider = trace.getTracerProvider() as any;
            if (provider && typeof provider.forceFlush === 'function') {
                await provider.forceFlush();
            }
        }
    }

    /**
     * Shuts down the OpenTelemetry SDK, flushing any pending spans.
     * This should be called before the application exits.
     *
     * Uses two-phase shutdown:
     * 1. Best-effort flush - Try to export pending spans (can fail if backend unavailable)
     * 2. Force cleanup - Always clear global state to allow re-initialization
     *
     * This ensures agent switching works even when telemetry export fails.
     */
    public async shutdown(): Promise<void> {
        if (this._sdk) {
            try {
                // Phase 1: Best-effort flush pending spans to backend
                // This can fail if Jaeger/OTLP collector is unreachable
                await this._sdk.shutdown();
            } catch (error) {
                // Don't throw - log warning and continue with cleanup
                // Telemetry is observability infrastructure, not core functionality
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.warn(`Telemetry shutdown failed to flush spans (non-blocking): ${errorMsg}`);
            } finally {
                // Phase 2: Force cleanup - MUST always happen regardless of flush success
                // This ensures we can reinitialize telemetry for agent switching
                this._isInitialized = false;
                globalThis.__TELEMETRY__ = undefined; // Clear the global instance

                // Cleanup signal handlers to prevent leaks
                if (Telemetry._signalHandlers) {
                    process.off('SIGTERM', Telemetry._signalHandlers.sigterm);
                    process.off('SIGINT', Telemetry._signalHandlers.sigint);
                    Telemetry._signalHandlers = undefined;
                }

                // Clear references for GC and re-initialization
                this._sdk = undefined;
                Telemetry._initPromise = undefined;
            }
        }
    }
}

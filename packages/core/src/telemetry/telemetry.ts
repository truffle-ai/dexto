import { context as otlpContext, trace, propagation } from '@opentelemetry/api';
import type { Tracer, Context, BaggageEntry } from '@opentelemetry/api';
import type { OtelConfiguration } from './schemas.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter as OTLPHttpExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPTraceExporter as OTLPGrpcExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { CompositeExporter } from './exporters.js';

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
    private _sdk?: NodeSDK | undefined;
    private static _initPromise?: Promise<Telemetry> | undefined;
    private static _signalHandlers?: { sigterm: () => void; sigint: () => void } | undefined;

    private constructor(config: OtelConfiguration, enabled: boolean, sdk?: NodeSDK) {
        const serviceName = config.serviceName ?? 'dexto-service';
        const tracerName = config.tracerName ?? serviceName;

        this.name = serviceName;
        this.tracer = trace.getTracer(tracerName);
        if (sdk) {
            this._sdk = sdk;
        }
        this._isInitialized = enabled && !!sdk;
    }

    private static buildTraceExporter(config: OtelConfiguration | undefined) {
        const e = config?.export;
        if (!e || e.type === 'console') {
            return new ConsoleSpanExporter();
        }
        if (e.type === 'otlp') {
            if (e.protocol === 'grpc') {
                const options: { url?: string } = {};
                if (e.endpoint) {
                    options.url = e.endpoint;
                }
                return new OTLPGrpcExporter(options);
            }
            // default to http when omitted
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

                    let sdk: NodeSDK | undefined;
                    if (enabled) {
                        const resource = new Resource({
                            [ATTR_SERVICE_NAME]: config.serviceName ?? 'dexto-service',
                        });

                        // Use custom exporter if provided, otherwise build from config
                        const spanExporter = exporter || Telemetry.buildTraceExporter(config);
                        const traceExporter =
                            spanExporter instanceof CompositeExporter
                                ? spanExporter
                                : new CompositeExporter([spanExporter]);

                        sdk = new NodeSDK({
                            resource,
                            traceExporter,
                            instrumentations: [getNodeAutoInstrumentations()],
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

            return Telemetry._initPromise;
        } catch (error) {
            const wrappedError = new Error(
                `Failed to initialize telemetry: ${error instanceof Error ? error.message : String(error)}`
            );
            Telemetry._initPromise = undefined;
            throw wrappedError;
        }
    }

    static getActiveSpan() {
        const span = trace.getActiveSpan();
        return span;
    }

    /**
     * Get the global telemetry instance
     * @throws {Error} If telemetry has not been initialized
     * @returns {Telemetry} The global telemetry instance
     */
    static get(): Telemetry {
        if (!globalThis.__TELEMETRY__) {
            throw new Error('Telemetry not initialized');
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
     * @param force - Whether to force a shutdown, even if there are active spans.
     */
    public async shutdown(): Promise<void> {
        if (this._sdk) {
            await this._sdk.shutdown();
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

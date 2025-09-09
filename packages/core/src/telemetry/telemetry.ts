import {
    context as otlpContext,
    SpanStatusCode,
    trace,
    propagation,
    context,
} from '@opentelemetry/api';
import type { Tracer, SpanOptions, Context, Span, BaggageEntry } from '@opentelemetry/api';
import type { OtelConfiguration } from './schemas.js';
import { getBaggageValues, hasActiveTelemetry, addBaggageAttributesToSpan } from './utils.js';
import {
    NodeSDK,
    ConsoleSpanExporter,
    OTLPHttpExporter,
    OTLPGrpcExporter,
    getNodeAutoInstrumentations,
    resourceFromAttributes,
    ATTR_SERVICE_NAME,
    CompositeExporter,
} from './otel-vendor.js';

// Add type declaration for global namespace
declare global {
    var __TELEMETRY__: Telemetry | undefined;
}

export class Telemetry {
    public tracer: Tracer = trace.getTracer('dexto');
    name: string = 'dexto-service';
    private _isInitialized: boolean = false;
    private _sdk?: NodeSDK;

    private constructor(config: OtelConfiguration) {
        const serviceName = config.serviceName ?? 'dexto-service';
        const tracerName = config.tracerName ?? serviceName;

        this.name = serviceName;
        this.tracer = trace.getTracer(tracerName);
        this._isInitialized = true;
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
     * @returns Telemetry instance that can be used for tracing
     */
    static async init(config: OtelConfiguration = {}): Promise<Telemetry> {
        try {
            if (!globalThis.__TELEMETRY__) {
                // honor enabled=false: skip SDK registration
                const enabled = config.enabled !== false;

                if (enabled) {
                    const resource = resourceFromAttributes({
                        [ATTR_SERVICE_NAME]: config.serviceName ?? 'dexto-service',
                    });

                    const exporter = Telemetry.buildTraceExporter(config);
                    const traceExporter =
                        exporter instanceof CompositeExporter
                            ? exporter
                            : new CompositeExporter([exporter]);

                    const sdk = new NodeSDK({
                        resource,
                        traceExporter,
                        instrumentations: [getNodeAutoInstrumentations()],
                    });

                    await sdk.start(); // registers the global provider → no ProxyTracer
                    // graceful shutdown
                    process.on('SIGTERM', () => sdk.shutdown());
                    process.on('SIGINT', () => sdk.shutdown());
                }

                globalThis.__TELEMETRY__ = new Telemetry(config);
            }

            return globalThis.__TELEMETRY__;
        } catch (error) {
            const wrappedError = new Error(
                `Failed to initialize telemetry: ${error instanceof Error ? error.message : String(error)}`
            );
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
     * Checks if the Telemetry instance has been successfully initialized.
     * @returns True if the instance is initialized, false otherwise.
     */
    public isInitialized(): boolean {
        return this._isInitialized;
    }

    /**
     * Wraps a class instance with telemetry tracing
     * @param instance The class instance to wrap
     * @param options Optional configuration for tracing
     * @returns Wrapped instance with all methods traced
     */
    traceClass<T extends object>(
        instance: T,
        options: {
            /** Base name for spans (e.g. 'integration', 'agent') */
            spanNamePrefix?: string;
            /** Additional attributes to add to all spans */
            attributes?: Record<string, string>;
            /** Methods to exclude from tracing */
            excludeMethods?: string[];
            /** Skip tracing if telemetry is not active */
            skipIfNoTelemetry?: boolean;
        } = {}
    ): T {
        const { skipIfNoTelemetry = true } = options;

        // Skip if no telemetry is active and skipIfNoTelemetry is true
        if (skipIfNoTelemetry && !hasActiveTelemetry()) {
            return instance;
        }

        const {
            spanNamePrefix = instance.constructor.name.toLowerCase(),
            attributes = {},
            excludeMethods = [],
        } = options;

        return new Proxy(instance, {
            get: (target, prop: string | symbol) => {
                const value = target[prop as keyof T];

                // Skip tracing for excluded methods, constructors, private methods
                if (
                    typeof value === 'function' &&
                    prop !== 'constructor' &&
                    !prop.toString().startsWith('_') &&
                    !excludeMethods.includes(prop.toString())
                ) {
                    return this.traceMethod(value.bind(target), {
                        spanName: `${spanNamePrefix}.${prop.toString()}`,
                        attributes: {
                            ...attributes,
                            [`${spanNamePrefix}.name`]: target.constructor.name,
                            [`${spanNamePrefix}.method.name`]: prop.toString(),
                        },
                    });
                }

                return value;
            },
        });
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
     * method to trace individual methods with proper context
     * @param method The method to trace
     * @param context Additional context for the trace
     * @returns Wrapped method with tracing
     */
    traceMethod<TMethod extends Function>(
        method: TMethod,
        context: {
            spanName: string;
            attributes?: Record<string, string>;
            skipIfNoTelemetry?: boolean;
            parentSpan?: Span;
        }
    ): TMethod {
        let ctx = otlpContext.active();
        const { skipIfNoTelemetry = true } = context;

        // Skip if no telemetry is active and skipIfNoTelemetry is true
        if (skipIfNoTelemetry && !hasActiveTelemetry()) {
            return method;
        }

        return ((...args: unknown[]) => {
            const span = this.tracer.startSpan(context.spanName);

            function handleError(error: unknown) {
                span.recordException(error as Error);
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (error as Error).message,
                });
                span.end();
                throw error;
            }
            try {
                const { requestId, threadId, resourceId } = getBaggageValues(ctx);

                // Add all context attributes to span
                if (context.attributes) {
                    span.setAttributes(context.attributes);
                }

                addBaggageAttributesToSpan(span, ctx);

                if (context.attributes?.componentName) {
                    ctx = propagation.setBaggage(
                        ctx,
                        propagation.createBaggage({
                            componentName: { value: context.attributes.componentName },
                            runId: { value: context.attributes.runId ?? '' },
                            'http.request_id': { value: requestId ?? '' },
                        })
                    );
                } else {
                    if (this && this.name) {
                        ctx = propagation.setBaggage(
                            ctx,
                            propagation.createBaggage({
                                componentName: { value: this.name },
                                runId: { value: (this as any).runId ?? '' },
                                'http.request_id': { value: requestId ?? '' },
                                threadId: { value: threadId ?? '' },
                                resourceId: { value: resourceId ?? '' },
                            })
                        );
                    }
                }

                // Record input arguments as span attributes
                args.forEach((arg, index) => {
                    try {
                        span.setAttribute(
                            `${context.spanName}.argument.${index}`,
                            JSON.stringify(arg)
                        );
                    } catch {
                        span.setAttribute(
                            `${context.spanName}.argument.${index}`,
                            '[Not Serializable]'
                        );
                    }
                });

                let result: any;
                otlpContext.with(trace.setSpan(ctx, span), () => {
                    result = method(...args);
                });

                function recordResult(res: any) {
                    try {
                        span.setAttribute(`${context.spanName}.result`, JSON.stringify(res));
                    } catch {
                        span.setAttribute(`${context.spanName}.result`, '[Not Serializable]');
                    }

                    span.end();

                    return res;
                }

                if (result instanceof Promise) {
                    return result.then(recordResult).catch(handleError);
                } else {
                    return recordResult(result);
                }
            } catch (error) {
                handleError(error);
            }
        }) as unknown as TMethod;
    }

    getBaggageTracer(): Tracer {
        return new BaggageTracer(this.tracer);
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
        }
    }
}

class BaggageTracer implements Tracer {
    private _tracer: Tracer;

    constructor(tracer: Tracer) {
        this._tracer = tracer;
    }

    startSpan(name: string, options: SpanOptions = {}, ctx: Context) {
        ctx = ctx ?? otlpContext.active();
        const span = this._tracer.startSpan(name, options, ctx);
        addBaggageAttributesToSpan(span, ctx);

        return span;
    }

    startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>;
    startActiveSpan<F extends (span: Span) => unknown>(
        name: string,
        options: SpanOptions,
        fn: F
    ): ReturnType<F>;
    startActiveSpan<F extends (span: Span) => unknown>(
        name: string,
        options: SpanOptions,
        ctx: Context,
        fn: F
    ): ReturnType<F>;
    startActiveSpan<F extends (span: Span) => unknown>(
        name: string,
        optionsOrFn: SpanOptions | F,
        ctxOrFn?: Context | F,
        fn?: F
    ): ReturnType<F> {
        if (typeof optionsOrFn === 'function') {
            const wrappedFn = (span: Span) => {
                addBaggageAttributesToSpan(span, otlpContext.active());

                return optionsOrFn(span);
            };
            return this._tracer.startActiveSpan(name, {}, context.active(), wrappedFn as F);
        }
        if (typeof ctxOrFn === 'function') {
            const wrappedFn = (span: Span) => {
                addBaggageAttributesToSpan(span, otlpContext.active());

                return ctxOrFn(span);
            };
            return this._tracer.startActiveSpan(
                name,
                optionsOrFn,
                context.active(),
                wrappedFn as F
            );
        }
        const wrappedFn = (span: Span) => {
            addBaggageAttributesToSpan(span, ctxOrFn ?? otlpContext.active());

            return fn!(span);
        };
        return this._tracer.startActiveSpan(name, optionsOrFn, ctxOrFn!, wrappedFn as F);
    }
}

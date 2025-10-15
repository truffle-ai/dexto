import {
    trace,
    context,
    SpanStatusCode,
    SpanKind,
    propagation,
    SpanOptions,
} from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import { logger } from '../logger/index.js';
import { hasActiveTelemetry, getBaggageValues } from './utils.js';

// Type interfaces for better type safety
interface StreamFinishData {
    text?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
    finishReason?: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    warnings?: unknown;
    object?: unknown; // For structured output
}

interface StreamOptions {
    onFinish?: (data: StreamFinishData) => Promise<void> | void;
    [key: string]: unknown;
}

interface EnhancedSpan extends Span {
    __mastraStreamingSpan?: boolean;
}

/**
 * Determines whether a method call should be treated as a streaming result.
 *
 * Returns true for explicit streaming method names ('stream' or 'streamVNext'), and for non-null object results
 * that expose any of the streaming-related properties: `textStream`, `objectStream`, `usagePromise`, or `finishReasonPromise`.
 *
 * @param result - The value returned by the method; inspected for streaming-specific properties when it's an object.
 * @param methodName - The invoked method's name; if `'stream'` or `'streamVNext'` this function always returns `true`.
 * @returns `true` when the call represents a streaming response, otherwise `false`.
 */
function isStreamingResult(result: unknown, methodName: string): boolean {
    if (methodName === 'stream' || methodName === 'streamVNext') {
        return true;
    }

    if (result && typeof result === 'object' && result !== null) {
        const obj = result as Record<string, unknown>;
        return (
            'textStream' in obj ||
            'objectStream' in obj ||
            'usagePromise' in obj ||
            'finishReasonPromise' in obj
        );
    }

    return false;
}

/**
 * Returns true when the provided method name identifies a streaming method.
 *
 * Used to detect methods that follow the library's streaming conventions.
 *
 * @param methodName - The method name to check.
 * @returns `true` if `methodName` is "stream" or "streamVNext"; otherwise `false`.
 */
function isStreamingMethod(methodName: string): boolean {
    return methodName === 'stream' || methodName === 'streamVNext';
}

/**
 * Wraps streaming call arguments to capture finish telemetry and end the provided span.
 *
 * For methods named "stream" or "streamVNext" this replaces or augments the stream options'
 * `onFinish` callback with a wrapper that collects selected fields from the finish payload
 * (text, usage, finishReason, toolCalls, toolResults, warnings, and object), serializes them
 * into the span attribute `<spanName>.result`, sets the span status to OK, and ends the span.
 * If serialization or attribute-setting fails, the wrapper records a telemetry-capture error
 * value, marks the span ERROR, and still ends the span. The original `onFinish` (if present)
 * is invoked with the same `finishData` and its return value is forwarded.
 *
 * As a side effect, the span is marked as a streaming span via `span.__mastraStreamingSpan = true`.
 *
 * @param args - The original method arguments; the stream options are expected at index 1 when present.
 * @param spanName - Base name used for the span attribute where results are stored (`<spanName>.result`).
 * @returns A new arguments array with enhanced stream options for streaming methods, or the original `args` for non-streaming methods.
 */
function enhanceStreamingArgumentsWithTelemetry(
    args: unknown[],
    span: EnhancedSpan,
    spanName: string,
    methodName: string
): unknown[] {
    if (methodName === 'stream' || methodName === 'streamVNext') {
        const enhancedArgs = [...args];
        const streamOptions =
            (enhancedArgs.length > 1 && (enhancedArgs[1] as StreamOptions)) ||
            ({} as StreamOptions);
        const enhancedStreamOptions: StreamOptions = { ...streamOptions };
        const originalOnFinish = enhancedStreamOptions.onFinish;

        enhancedStreamOptions.onFinish = async (finishData: StreamFinishData) => {
            try {
                const telemetryData = {
                    text: finishData.text,
                    usage: finishData.usage,
                    finishReason: finishData.finishReason,
                    toolCalls: finishData.toolCalls,
                    toolResults: finishData.toolResults,
                    warnings: finishData.warnings,
                    ...(finishData.object !== undefined && { object: finishData.object }),
                };

                span.setAttribute(`${spanName}.result`, JSON.stringify(telemetryData));
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
            } catch (error) {
                logger.warn('Telemetry capture failed:', error);
                span.setAttribute(`${spanName}.result`, '[Telemetry Capture Error]');
                span.setStatus({ code: SpanStatusCode.ERROR });
                span.end();
            }

            if (originalOnFinish) {
                return await originalOnFinish(finishData);
            }
        };

        enhancedArgs[1] = enhancedStreamOptions;
        span.__mastraStreamingSpan = true;

        return enhancedArgs;
    }

    return args;
}

/**
 * Creates a method decorator that starts and manages an OpenTelemetry span for the decorated method.
 *
 * The returned decorator wraps the original method to:
 * - start a span (name and kind configurable),
 * - record input arguments and the result as span attributes (JSON-serialized when possible),
 * - propagate and record baggage values (requestId, componentName, runId, threadId, resourceId),
 * - special-case streaming methods to capture finish data and defer ending the span until stream completion,
 * - capture exceptions on the span and set the span status to ERROR when errors occur.
 *
 * @param options - Configuration for the created decorator:
 *   - spanName: Optional explicit span name; defaults to the decorated method name.
 *   - skipIfNoTelemetry: If true and no active telemetry is available, the original method is invoked without instrumentation.
 *   - spanKind: Optional OpenTelemetry SpanKind for the started span.
 *   - tracerName: Optional tracer name to use (defaults to 'dexto').
 * @returns A method decorator that instruments the target method with the configured span behavior.
 */
export function withSpan(options: {
    spanName?: string;
    skipIfNoTelemetry?: boolean;
    spanKind?: SpanKind;
    tracerName?: string;
}): any {
    return function (
        _target: any,
        propertyKey: string | symbol,
        descriptor?: PropertyDescriptor | number
    ) {
        if (!descriptor || typeof descriptor === 'number') return;

        const originalMethod = descriptor.value as Function;
        const methodName = String(propertyKey);

        descriptor.value = function (this: unknown, ...args: unknown[]) {
            // Skip if no telemetry is available and skipIfNoTelemetry is true
            // Guard against Telemetry.get() throwing if globalThis.__TELEMETRY__ is not yet defined
            if (
                options?.skipIfNoTelemetry &&
                (!globalThis.__TELEMETRY__ || !hasActiveTelemetry())
            ) {
                return originalMethod.apply(this, args);
            }
            const tracer = trace.getTracer(options?.tracerName ?? 'dexto');

            // Determine span name and kind
            let spanName: string = methodName; // Default spanName
            let spanKind: SpanKind | undefined;

            if (options) {
                // options is always an object here due to decorator factory
                spanName = options.spanName ?? methodName;
                if (options.spanKind !== undefined) {
                    spanKind = options.spanKind;
                }
            }

            // Start the span with optional kind
            const spanOptions: SpanOptions = {};
            if (spanKind !== undefined) {
                spanOptions.kind = spanKind;
            }
            const span = tracer.startSpan(spanName, spanOptions) as EnhancedSpan;
            let ctx = trace.setSpan(context.active(), span);

            // Record input arguments as span attributes
            args.forEach((arg, index) => {
                try {
                    span.setAttribute(`${spanName}.argument.${index}`, JSON.stringify(arg));
                } catch {
                    span.setAttribute(`${spanName}.argument.${index}`, '[Not Serializable]');
                }
            });

            const { requestId, componentName, runId, threadId, resourceId } = getBaggageValues(ctx);
            if (requestId) {
                span.setAttribute('http.request_id', requestId);
            }

            if (threadId) {
                span.setAttribute('threadId', threadId);
            }

            if (resourceId) {
                span.setAttribute('resourceId', resourceId);
            }

            if (componentName) {
                span.setAttribute('componentName', componentName);
                if (runId !== undefined) {
                    span.setAttribute('runId', String(runId));
                }
            } else if (this && typeof this === 'object' && 'name' in this) {
                const contextObj = this as { name: string; runId?: string };
                span.setAttribute('componentName', contextObj.name);
                if (contextObj.runId) {
                    span.setAttribute('runId', contextObj.runId);
                }

                const baggageEntries: Record<string, { value: string }> = {};

                if (contextObj.name !== undefined) {
                    baggageEntries.componentName = { value: String(contextObj.name) };
                }
                if (contextObj.runId !== undefined) {
                    baggageEntries.runId = { value: String(contextObj.runId) };
                }
                if (requestId !== undefined) {
                    baggageEntries['http.request_id'] = { value: String(requestId) };
                }
                if (threadId !== undefined) {
                    baggageEntries.threadId = { value: String(threadId) };
                }
                if (resourceId !== undefined) {
                    baggageEntries.resourceId = { value: String(resourceId) };
                }

                if (Object.keys(baggageEntries).length > 0) {
                    ctx = propagation.setBaggage(ctx, propagation.createBaggage(baggageEntries));
                }
            }

            let result: unknown;
            try {
                // For streaming methods, enhance arguments with telemetry capture before calling
                const enhancedArgs = isStreamingMethod(methodName)
                    ? enhanceStreamingArgumentsWithTelemetry(args, span, spanName, methodName)
                    : args;

                // Call the original method within the context
                result = context.with(ctx, () => originalMethod.apply(this, enhancedArgs));

                // Handle promises
                if (result instanceof Promise) {
                    return result
                        .then((resolvedValue) => {
                            if (isStreamingResult(resolvedValue, methodName)) {
                                return resolvedValue;
                            } else {
                                try {
                                    span.setAttribute(
                                        `${spanName}.result`,
                                        JSON.stringify(resolvedValue)
                                    );
                                } catch {
                                    span.setAttribute(`${spanName}.result`, '[Not Serializable]');
                                }
                                return resolvedValue;
                            }
                        })
                        .catch((error) => {
                            span.recordException(error);
                            span.setStatus({
                                code: SpanStatusCode.ERROR,
                                message: error?.toString(),
                            });
                            throw error;
                        })
                        .finally(() => {
                            if (!span.__mastraStreamingSpan) {
                                span.end();
                            }
                        });
                }

                // Record result for non-promise returns
                if (!isStreamingResult(result, methodName)) {
                    try {
                        span.setAttribute(`${spanName}.result`, JSON.stringify(result));
                    } catch {
                        span.setAttribute(`${spanName}.result`, '[Not Serializable]');
                    }
                }
                // Return regular results
                return result;
            } catch (error) {
                logger.error(
                    `withSpan: Error in method '${methodName}': ${error instanceof Error ? error.message : String(error)}`
                );
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: error instanceof Error ? error.message : 'Unknown error',
                });
                if (error instanceof Error) {
                    span.recordException(error);
                }
                throw error;
            } finally {
                // End span for non-promise returns
                if (!(result instanceof Promise) && !isStreamingResult(result, methodName)) {
                    span.end();
                }
            }
        };

        return descriptor;
    };
}

/**
 * Class decorator that instruments instance methods with OpenTelemetry spans.
 *
 * Wraps each function on the class prototype (except the constructor and any
 * names listed in `excludeMethods`) with the `withSpan` method decorator so
 * method calls produce spans. By default span names are the method name;
 * when `prefix` is provided the span name is `prefix.method`. Only methods
 * that pass `methodFilter` (if supplied) are instrumented. Instrumentation
 * is applied with `skipIfNoTelemetry: true` so classes remain callable when
 * telemetry is disabled.
 *
 * Options:
 * - prefix: optional prefix to namespace span names (spanName = `${prefix}.${method}`).
 * - spanKind: OpenTelemetry SpanKind to use for created spans (defaults to INTERNAL).
 * - excludeMethods: method names to skip (in addition to the constructor).
 * - methodFilter: predicate to decide whether a method should be instrumented.
 * - tracerName: optional tracer name to pass through to `withSpan`.
 *
 * @returns A class decorator that replaces prototype methods with their instrumented equivalents.
 */
export function InstrumentClass(options?: {
    prefix?: string;
    spanKind?: SpanKind;
    excludeMethods?: string[];
    methodFilter?: (methodName: string) => boolean;
    tracerName?: string;
}) {
    return function (target: any) {
        const methods = Object.getOwnPropertyNames(target.prototype);
        methods.forEach((method) => {
            // Skip excluded methods
            if (options?.excludeMethods?.includes(method) || method === 'constructor') {
                return;
            }
            // Apply method filter if provided
            if (options?.methodFilter && !options.methodFilter(method)) return;

            const descriptor = Object.getOwnPropertyDescriptor(target.prototype, method);
            if (descriptor && typeof descriptor.value === 'function') {
                Object.defineProperty(
                    target.prototype,
                    method,
                    withSpan({
                        spanName: options?.prefix ? `${options.prefix}.${method}` : method,
                        skipIfNoTelemetry: true,
                        spanKind: options?.spanKind || SpanKind.INTERNAL,
                        ...(options?.tracerName !== undefined && {
                            tracerName: options.tracerName,
                        }),
                    })(target, method, descriptor)
                );
            }
        });
        return target;
    };
}

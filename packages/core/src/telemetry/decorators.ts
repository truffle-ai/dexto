import {
    trace,
    context,
    SpanStatusCode,
    SpanKind,
    propagation,
    SpanOptions,
    type BaggageEntry,
} from '@opentelemetry/api';
import type { Logger } from '../logger/v2/types.js';
import { hasActiveTelemetry, getBaggageValues } from './utils.js';
import { safeStringify } from '../utils/safe-stringify.js';

// Decorator factory that takes optional spanName
export function withSpan(options: {
    spanName?: string;
    skipIfNoTelemetry?: boolean;
    spanKind?: SpanKind;
    tracerName?: string;
}): any {
    return function (
        _target: unknown,
        propertyKey: string | symbol,
        descriptor?: PropertyDescriptor | number
    ) {
        if (!descriptor || typeof descriptor === 'number') return;

        const originalMethod = descriptor.value as Function;
        const methodName = String(propertyKey);

        descriptor.value = function (this: unknown, ...args: unknown[]) {
            // Try to get logger from instance for DI pattern (optional)
            const logger = (this as any)?.logger as Logger | undefined;

            // Skip if no telemetry is available and skipIfNoTelemetry is true
            // Guard against Telemetry.get() throwing if globalThis.__TELEMETRY__ is not yet defined
            if (
                options?.skipIfNoTelemetry &&
                (!globalThis.__TELEMETRY__ || !hasActiveTelemetry(logger))
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
            const span = tracer.startSpan(spanName, spanOptions);
            let ctx = trace.setSpan(context.active(), span);

            // Record input arguments as span attributes (sanitized and truncated)
            args.forEach((arg, index) => {
                span.setAttribute(`${spanName}.argument.${index}`, safeStringify(arg, 8192));
            });

            // Extract baggage values from the current context (may include values set by parent spans)
            const { requestId, componentName, runId, threadId, resourceId, sessionId } =
                getBaggageValues(ctx);

            // Add all baggage values to span attributes
            // Set both direct attributes and baggage-prefixed versions for storage schema fallback
            if (sessionId) {
                span.setAttribute('sessionId', sessionId);
                span.setAttribute('baggage.sessionId', sessionId); // Fallback for storage
            }

            if (requestId) {
                span.setAttribute('http.request_id', requestId);
                span.setAttribute('baggage.http.request_id', requestId);
            }

            if (threadId) {
                span.setAttribute('threadId', threadId);
                span.setAttribute('baggage.threadId', threadId);
            }

            if (resourceId) {
                span.setAttribute('resourceId', resourceId);
                span.setAttribute('baggage.resourceId', resourceId);
            }

            if (runId !== undefined) {
                span.setAttribute('runId', String(runId));
                span.setAttribute('baggage.runId', String(runId));
            }

            if (componentName) {
                span.setAttribute('componentName', componentName);
                span.setAttribute('baggage.componentName', componentName);
            } else if (this && typeof this === 'object') {
                const contextObj = this as {
                    name?: string;
                    runId?: string;
                    constructor?: { name?: string };
                };
                // Prefer instance.name, fallback to constructor.name
                const inferredName = contextObj.name ?? contextObj.constructor?.name;
                if (inferredName) {
                    span.setAttribute('componentName', inferredName);
                }
                if (contextObj.runId) {
                    span.setAttribute('runId', contextObj.runId);
                    span.setAttribute('baggage.runId', contextObj.runId);
                }

                // Merge with existing baggage to preserve parent context values
                const existingBaggage = propagation.getBaggage(ctx);
                const baggageEntries: Record<string, BaggageEntry> = {};

                // Copy all existing baggage entries to preserve custom baggage
                if (existingBaggage) {
                    existingBaggage.getAllEntries().forEach(([key, entry]) => {
                        baggageEntries[key] = entry;
                    });
                }

                // Preserve existing baggage values and metadata
                if (sessionId !== undefined) {
                    baggageEntries.sessionId = {
                        ...baggageEntries.sessionId,
                        value: String(sessionId),
                    };
                }
                if (requestId !== undefined) {
                    baggageEntries['http.request_id'] = {
                        ...baggageEntries['http.request_id'],
                        value: String(requestId),
                    };
                }
                if (threadId !== undefined) {
                    baggageEntries.threadId = {
                        ...baggageEntries.threadId,
                        value: String(threadId),
                    };
                }
                if (resourceId !== undefined) {
                    baggageEntries.resourceId = {
                        ...baggageEntries.resourceId,
                        value: String(resourceId),
                    };
                }

                // Add new component-specific baggage values
                if (inferredName !== undefined) {
                    baggageEntries.componentName = {
                        ...baggageEntries.componentName,
                        value: String(inferredName),
                    };
                }
                if (contextObj.runId !== undefined) {
                    baggageEntries.runId = {
                        ...baggageEntries.runId,
                        value: String(contextObj.runId),
                    };
                }

                if (Object.keys(baggageEntries).length > 0) {
                    ctx = propagation.setBaggage(ctx, propagation.createBaggage(baggageEntries));
                }
            }

            let result: unknown;
            try {
                // Call the original method within the context
                result = context.with(ctx, () => originalMethod.apply(this, args));

                // Handle promises
                if (result instanceof Promise) {
                    return result
                        .then((resolvedValue) => {
                            span.setAttribute(
                                `${spanName}.result`,
                                safeStringify(resolvedValue, 8192)
                            );
                            return resolvedValue;
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
                            span.end();
                        });
                }

                // Record result for non-promise returns (sanitized and truncated)
                span.setAttribute(`${spanName}.result`, safeStringify(result, 8192));
                // Return regular results
                return result;
            } catch (error) {
                // Try to use instance logger if available (DI pattern)
                const logger = (this as any)?.logger as Logger | undefined;
                logger?.error(
                    `withSpan: Error in method '${methodName}': ${error instanceof Error ? error.message : String(error)}`,
                    { error }
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
                if (!(result instanceof Promise)) {
                    span.end();
                }
            }
        };

        return descriptor;
    };
}

// class-telemetry.decorator.ts
export function InstrumentClass(options?: {
    prefix?: string;
    spanKind?: SpanKind;
    excludeMethods?: string[];
    methodFilter?: (methodName: string) => boolean;
    tracerName?: string;
}) {
    return function <T extends { new (...args: any[]): {} }>(target: T) {
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

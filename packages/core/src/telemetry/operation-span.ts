import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type { Logger } from '../logger/v2/types.js';
import { addBaggageAttributesToSpan, hasActiveTelemetry } from './utils.js';

type OperationSpanAttributes = Record<string, string | number | boolean>;

export type OperationSpanOptions<T> = {
    attributes?: OperationSpanAttributes;
    componentName?: string;
    name: string;
    resultAttributes?: (result: T) => OperationSpanAttributes | undefined;
    skipIfNoTelemetry?: boolean;
    tracerName?: string;
};

export async function recordOperationSpan<T>(
    options: OperationSpanOptions<T>,
    operation: () => T | Promise<T>,
    logger?: Logger
): Promise<T> {
    const skipIfNoTelemetry = options.skipIfNoTelemetry ?? true;

    if (skipIfNoTelemetry && !hasActiveTelemetry(logger)) {
        return operation();
    }

    const span = trace
        .getTracer(options.tracerName ?? 'dexto')
        .startSpan(options.name, { kind: SpanKind.INTERNAL });
    const spanContext = trace.setSpan(context.active(), span);

    addBaggageAttributesToSpan(span, spanContext, logger);
    if (options.componentName !== undefined) {
        span.setAttribute('componentName', options.componentName);
    }
    setOperationSpanAttributes(span, options.attributes);

    try {
        const result = await context.with(spanContext, operation);
        try {
            setOperationSpanAttributes(span, options.resultAttributes?.(result));
        } catch (error) {
            logger?.debug('Failed to set OpenTelemetry result attributes', {
                error: error instanceof Error ? error.message : String(error),
                span: options.name,
            });
        }
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
    } catch (error) {
        if (error instanceof Error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        } else {
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
        }
        throw error;
    } finally {
        span.end();
    }
}

function setOperationSpanAttributes(
    span: Pick<Span, 'setAttribute'> | undefined,
    attributes: OperationSpanAttributes | undefined
): void {
    if (span === undefined || attributes === undefined) {
        return;
    }

    for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, value);
    }
}

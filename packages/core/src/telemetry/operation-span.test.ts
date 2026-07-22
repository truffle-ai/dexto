import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { recordOperationSpan } from './operation-span.js';

describe('recordOperationSpan', () => {
    let contextManager: AsyncHooksContextManager | undefined;
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider | undefined;

    beforeEach(() => {
        contextManager = new AsyncHooksContextManager().enable();
        exporter = new InMemorySpanExporter();
        provider = new BasicTracerProvider();
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
        provider.register({ contextManager });
    });

    afterEach(async () => {
        if (provider !== undefined) {
            await provider.shutdown();
            provider = undefined;
        }
        contextManager?.disable();
        contextManager = undefined;
        trace.disable();
    });

    it('records a real OpenTelemetry span with stable attributes', async () => {
        await expect(
            recordOperationSpan(
                {
                    name: 'skills.list',
                    componentName: 'SkillsContributor',
                    attributes: { 'tools.supports': true },
                    resultAttributes: (skills: string[]) => ({ 'skills.count': skills.length }),
                    skipIfNoTelemetry: false,
                    spanKind: SpanKind.CLIENT,
                },
                async () => ['alpha', 'beta']
            )
        ).resolves.toEqual(['alpha', 'beta']);

        const span = exporter.getFinishedSpans().find((span) => span.name === 'skills.list');

        expect(span?.attributes).toEqual(
            expect.objectContaining({
                componentName: 'SkillsContributor',
                'skills.count': 2,
                'tools.supports': true,
            })
        );
        expect(span?.kind).toBe(SpanKind.CLIENT);
    });

    it('does not fail the operation when result attribute extraction fails', async () => {
        await expect(
            recordOperationSpan(
                {
                    name: 'context.token_estimate',
                    resultAttributes: () => {
                        throw new Error('attribute bug');
                    },
                    skipIfNoTelemetry: false,
                },
                () => 42
            )
        ).resolves.toBe(42);

        const span = exporter
            .getFinishedSpans()
            .find((span) => span.name === 'context.token_estimate');

        expect(span?.status.code).toBe(SpanStatusCode.OK);
    });

    it('keeps spans created inside the operation under the operation span', async () => {
        await recordOperationSpan(
            {
                name: 'operation.parent',
                skipIfNoTelemetry: false,
            },
            () =>
                trace.getTracer('test').startActiveSpan('operation.child', (span) => {
                    span.end();
                    return 'ok';
                })
        );

        const parent = exporter.getFinishedSpans().find((span) => span.name === 'operation.parent');
        const child = exporter.getFinishedSpans().find((span) => span.name === 'operation.child');

        expect(parent).toBeDefined();
        expect(child).toBeDefined();
        if (parent === undefined || child === undefined) {
            throw new Error('Expected parent and child spans to be recorded.');
        }
        expect(child.spanContext().traceId).toBe(parent.spanContext().traceId);
        expect(child).toHaveProperty('parentSpanId', parent.spanContext().spanId);
    });

    it('can record a failed operation without copying the error into telemetry', async () => {
        const sensitiveError = new Error('provider-private-payload');

        await expect(
            recordOperationSpan(
                {
                    captureErrors: false,
                    name: 'operation.private_failure',
                    skipIfNoTelemetry: false,
                },
                () => {
                    throw sensitiveError;
                }
            )
        ).rejects.toBe(sensitiveError);

        const span = exporter
            .getFinishedSpans()
            .find((span) => span.name === 'operation.private_failure');

        expect(span?.status).toEqual({ code: SpanStatusCode.ERROR });
        expect(JSON.stringify(span?.events)).not.toContain(sensitiveError.message);
    });
});

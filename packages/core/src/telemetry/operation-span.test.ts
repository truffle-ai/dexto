import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { recordOperationSpan } from './operation-span.js';

describe('recordOperationSpan', () => {
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider | undefined;

    beforeEach(() => {
        exporter = new InMemorySpanExporter();
        provider = new BasicTracerProvider();
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
        provider.register();
    });

    afterEach(async () => {
        if (provider !== undefined) {
            await provider.shutdown();
            provider = undefined;
        }
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
});

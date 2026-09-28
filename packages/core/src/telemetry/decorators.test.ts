import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { InstrumentClass } from './decorators.js';

describe('InstrumentClass', () => {
    let contextManager: AsyncHooksContextManager | undefined;
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider | undefined;

    beforeEach(() => {
        Reflect.set(globalThis, '__TELEMETRY__', { isInitialized: () => true });
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
        Reflect.deleteProperty(globalThis, '__TELEMETRY__');
        trace.disable();
    });

    it('can trace method timing without copying private values into telemetry', async () => {
        const argument = 'private-argument';
        const result = 'private-result';
        const error = new Error('private-error');

        @InstrumentClass({
            captureArguments: false,
            captureErrors: false,
            captureResult: false,
            prefix: 'private',
        })
        class PrivateService {
            read(_value: string): string {
                return result;
            }

            async readAsync(_value: string): Promise<string> {
                return result;
            }

            async fail(): Promise<never> {
                throw error;
            }

            failSync(): never {
                throw error;
            }
        }

        const service = new PrivateService();
        expect(service.read(argument)).toBe(result);
        await expect(service.readAsync(argument)).resolves.toBe(result);
        await expect(service.fail()).rejects.toBe(error);
        expect(() => service.failSync()).toThrow(error);

        const serializedSpans = JSON.stringify(
            exporter.getFinishedSpans().map((span) => ({
                attributes: span.attributes,
                events: span.events,
                status: span.status,
            }))
        );
        expect(exporter.getFinishedSpans()).toHaveLength(4);
        expect(serializedSpans).not.toContain(argument);
        expect(serializedSpans).not.toContain(result);
        expect(serializedSpans).not.toContain(error.message);
        expect(
            exporter.getFinishedSpans().find((span) => span.name === 'private.fail')?.status
        ).toEqual({ code: SpanStatusCode.ERROR });
    });
});

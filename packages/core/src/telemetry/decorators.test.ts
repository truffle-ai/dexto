import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SpanStatusCode, context, trace } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import {
    BasicTracerProvider,
    InMemorySpanExporter,
    SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { InstrumentClass, withSpan } from './decorators.js';

describe('InstrumentClass', () => {
    let contextManager: AsyncHooksContextManager | undefined;
    let exporter: InMemorySpanExporter;
    let provider: BasicTracerProvider | undefined;

    beforeEach(() => {
        Reflect.set(globalThis, '__TELEMETRY__', { isInitialized: () => true });
        contextManager = new AsyncHooksContextManager().enable();
        exporter = new InMemorySpanExporter();
        provider = new BasicTracerProvider({
            spanProcessors: [new SimpleSpanProcessor(exporter)],
        });
        trace.setGlobalTracerProvider(provider);
        context.setGlobalContextManager(contextManager);
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

    it('withSpan does not record arguments by default', () => {
        const descriptor = withSpan({ spanName: 'direct' })(
            {},
            'run',
            Object.getOwnPropertyDescriptor({ run(_value: string) {} }, 'run')
        );

        descriptor.value('private-argument');

        const [span] = exporter.getFinishedSpans();
        expect(JSON.stringify(span?.attributes)).not.toContain('private-argument');
    });

    it('does not record method arguments unless a class asks for them', () => {
        const secret = { env: { API_TOKEN: 'secret-token' } };

        @InstrumentClass({ prefix: 'default' })
        class DefaultService {
            connect(_config: unknown): void {}
        }

        @InstrumentClass({ prefix: 'opted_in', captureArguments: true })
        class OptedInService {
            connect(_config: unknown): void {}
        }

        new DefaultService().connect(secret);
        new OptedInService().connect(secret);

        const spans = exporter.getFinishedSpans();
        const defaultSpan = spans.find((span) => span.name === 'default.connect');
        const optedInSpan = spans.find((span) => span.name === 'opted_in.connect');
        expect(JSON.stringify(defaultSpan?.attributes)).not.toContain('secret-token');
        expect(defaultSpan?.attributes['default.connect.argument.0']).toBeUndefined();
        expect(JSON.stringify(optedInSpan?.attributes)).toContain('secret-token');
    });

    it('records the masked stack of an error inside a recorded argument', () => {
        const error = new Error('boom');
        error.stack = 'Error: boom\n    at runTool (/srv/app/tools/run.ts:12:3) token=abc123';

        @InstrumentClass({ prefix: 'traced', captureArguments: true })
        class TracedService {
            report(_failure: unknown): void {}
        }

        new TracedService().report({ error });

        const span = exporter.getFinishedSpans().find((item) => item.name === 'traced.report');
        const argument = span?.attributes['traced.report.argument.0'];
        expect(argument).toContain('at runTool (/srv/app/tools/run.ts:12:3) token=[REDACTED]');
        expect(argument).not.toContain('abc123');
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
    it('records a class instance result by its class name, without reading it', async () => {
        let touched = false;
        class ChatSession {
            constructor() {
                Object.defineProperty(this, 'services', {
                    enumerable: true,
                    get() {
                        touched = true;
                        return { client: 'drizzle' };
                    },
                });
            }
        }

        @InstrumentClass({ prefix: 'agent' })
        class Agent {
            getSession(): ChatSession {
                return new ChatSession();
            }

            async createSession(): Promise<ChatSession> {
                return new ChatSession();
            }

            async listSessions(): Promise<{ ids: string[] }> {
                return { ids: ['s1'] };
            }
        }

        const agent = new Agent();
        agent.getSession();
        await agent.createSession();
        await agent.listSessions();

        const attributes = Object.fromEntries(
            exporter.getFinishedSpans().map((span) => [span.name, span.attributes])
        );
        expect(touched).toBe(false);
        expect(attributes['agent.getSession']?.['agent.getSession.result']).toBe('[ChatSession]');
        expect(attributes['agent.createSession']?.['agent.createSession.result']).toBe(
            '[ChatSession]'
        );
        expect(attributes['agent.listSessions']?.['agent.listSessions.result']).toBe(
            '{"ids":["s1"]}'
        );
    });

    it('records an argument it cannot read without failing the call', () => {
        const revoked = Proxy.revocable({}, {});
        revoked.revoke();
        const throwing = new Proxy(
            {},
            {
                getPrototypeOf() {
                    throw new Error('trap');
                },
            }
        );

        @InstrumentClass({ prefix: 'odd', captureArguments: true })
        class Odd {
            take(_first: unknown, _second: unknown): string {
                return 'done';
            }
        }

        expect(new Odd().take(revoked.proxy, throwing)).toBe('done');

        const [span] = exporter.getFinishedSpans();
        expect(span?.attributes['odd.take.argument.0']).toBe('[Unserializable value]');
        expect(span?.attributes['odd.take.argument.1']).toBe('[Unserializable value]');
    });

    it('records a Date as its time and an Error as its name and message', () => {
        @InstrumentClass({ prefix: 'values' })
        class Values {
            date(): Date {
                return new Date('2026-11-26T00:00:00.000Z');
            }

            error(): Error {
                return new TypeError('bad input');
            }
        }

        new Values().date();
        new Values().error();

        const attributes = Object.fromEntries(
            exporter.getFinishedSpans().map((span) => [span.name, span.attributes])
        );
        expect(attributes['values.date']?.['values.date.result']).toBe(
            '"2026-11-26T00:00:00.000Z"'
        );
        expect(attributes['values.error']?.['values.error.result']).toBe('"TypeError: bad input"');
    });
});

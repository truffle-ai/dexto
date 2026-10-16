import { TextDecoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import { AgentEventBus } from '@dexto/core';
import { SessionSseEventSubscriber } from './session-sse-subscriber.js';

describe('SessionSseEventSubscriber', () => {
    it('preserves retry error details in the session event stream', async () => {
        const eventBus = new AgentEventBus();
        const subscriber = new SessionSseEventSubscriber();
        subscriber.subscribe(eventBus);
        const reader = subscriber.createStream('session-1').getReader();
        const error = new Error('The model ended its reply without answering');

        try {
            eventBus.emit('llm:retrying', {
                sessionId: 'session-1',
                error,
                context: 'Retrying empty model response',
                attempt: 1,
                maxRetries: 1,
                provider: 'openai',
                model: 'gpt-4o',
                reason: 'empty_response',
            });

            const { value } = await reader.read();
            expect(new TextDecoder().decode(value)).toBe(
                `event: llm:retrying\ndata: ${JSON.stringify({
                    sessionId: 'session-1',
                    error: { message: error.message, name: error.name, stack: error.stack },
                    context: 'Retrying empty model response',
                    attempt: 1,
                    maxRetries: 1,
                    provider: 'openai',
                    model: 'gpt-4o',
                    reason: 'empty_response',
                })}\n\n`
            );
        } finally {
            await reader.cancel();
            subscriber.cleanup();
        }
    });
});

import { describe, expect, it } from 'vitest';
import { preserveOpenRouterThinkingBlocks } from './openrouter-thinking-stream.js';

describe('preserveOpenRouterThinkingBlocks', () => {
    it('separates indexed blocks across split UTF-8 SSE frames without changing other events', async () => {
        const first = { type: 'reasoning.text', index: 0, text: 'é', signature: 'one' };
        const second = { type: 'reasoning.text', index: 1, text: 'two', signature: 'two' };
        const event = (details: unknown[]) =>
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_details: details } }] })}\r\n\r\n`;
        const original = `: keepalive\r\n\r\n${event([first])}${event([second])}data: [DONE]\r\n\r\n`;
        const bytes = new globalThis.TextEncoder().encode(original);
        const fetchImpl: typeof fetch = async () =>
            new Response(
                new globalThis.ReadableStream({
                    start(controller) {
                        for (let index = 0; index < bytes.length; index += 3) {
                            controller.enqueue(bytes.slice(index, index + 3));
                        }
                        controller.close();
                    },
                }),
                {
                    headers: {
                        'content-type': 'text/event-stream',
                        'content-length': String(bytes.length),
                    },
                }
            );

        const response = await preserveOpenRouterThinkingBlocks(fetchImpl)('https://example.test');
        const text = await response.text();
        const separator = {
            type: 'reasoning.summary',
            summary: '',
            id: 'dexto:openrouter-thinking-block-separator',
            index: 1,
        };
        expect(text).toBe(
            `: keepalive\r\n\r\n${event([first])}${event([separator, second])}data: [DONE]\r\n\r\n`
        );
        expect(response.headers.has('content-length')).toBe(false);
    });

    it('does not wrap a non-streaming response', async () => {
        const original = Response.json({ error: 'bad request' }, { status: 400 });
        const response = await preserveOpenRouterThinkingBlocks(async () => original)(
            'https://example.test'
        );
        expect(response).toBe(original);
    });

    it('handles mixed SSE line endings across byte chunks', async () => {
        const event = (index: number) =>
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_details: [{ type: 'reasoning.text', text: String(index), index }] } }] })}\n\r\n`;
        const bytes = new globalThis.TextEncoder().encode(event(0) + event(1));
        const fetchImpl: typeof fetch = async () =>
            new Response(
                new globalThis.ReadableStream({
                    start(controller) {
                        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
                        controller.close();
                    },
                }),
                { headers: { 'content-type': 'text/event-stream' } }
            );

        const text = await (
            await preserveOpenRouterThinkingBlocks(fetchImpl)('https://example.test')
        ).text();
        expect(text).toContain('dexto:openrouter-thinking-block-separator');
        expect(text).toContain('\n\r\n');
    });

    it('delivers a CR-only event before the next upstream chunk', async () => {
        let source: { enqueue(chunk: Uint8Array): void; close(): void } | undefined;
        const fetchImpl: typeof fetch = async () =>
            new Response(
                new globalThis.ReadableStream({
                    start(controller) {
                        source = controller;
                    },
                }),
                { headers: { 'content-type': 'text/event-stream' } }
            );
        const response = await preserveOpenRouterThinkingBlocks(fetchImpl)('https://example.test');
        if (!source || !response.body) throw new Error('Expected a response stream');
        const reader = response.body.getReader();
        source.enqueue(new globalThis.TextEncoder().encode('data: {}\r\r'));
        const result = await Promise.race([
            reader.read().then(() => 'delivered'),
            new Promise<string>((resolve) => globalThis.setTimeout(() => resolve('delayed'), 100)),
        ]);
        source.close();
        expect(result).toBe('delivered');
    });
});

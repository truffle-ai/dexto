import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentEventBus } from '@dexto/core';
import { WebhookEventSubscriber } from '../webhook-subscriber.js';

async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('webhook delivery connects through the checked address', () => {
    let server: Server;
    let port: number;
    let requests: number;
    let subscriber: WebhookEventSubscriber | undefined;

    beforeEach(async () => {
        requests = 0;
        server = createServer((_request, response) => {
            requests += 1;
            response.end('ok');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as AddressInfo).port;
    });

    afterEach(async () => {
        subscriber?.cleanup();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    function deliverTo(resolveHost: () => Promise<string[]>) {
        subscriber = new WebhookEventSubscriber({ resolveHost, maxRetries: 1, timeout: 2000 });
        subscriber.addWebhook({
            id: 'wh_dns',
            url: `http://rebind.example:${port}/hook`,
            createdAt: new Date(),
        });
        const bus = new AgentEventBus();
        subscriber.subscribe(bus);
        bus.emit('session:reset', { sessionId: 'test-session' });
    }

    it('uses the answer it checked even if the name answers differently afterwards', async () => {
        let lookups = 0;
        deliverTo(async () => (lookups++ === 0 ? ['127.0.0.1'] : ['169.254.169.254']));

        await until(() => requests > 0);

        expect(requests).toBe(1);
    });

    it('never connects when any answer for the name is a metadata address', async () => {
        deliverTo(async () => ['127.0.0.1', '::ffff:a9fe:a9fe']);

        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(requests).toBe(0);
    });
});

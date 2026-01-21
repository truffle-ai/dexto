/**
 * Integration test for HTTP instrumentation.
 *
 * This test verifies that OpenTelemetry's HTTP/fetch instrumentation is working correctly.
 * It makes actual HTTP calls and verifies that spans are created for them.
 *
 * This is critical for ensuring that LLM API calls (which use fetch) are traced.
 *
 * NOTE: This test sets up OpenTelemetry SDK directly (not via Telemetry class) to verify
 * that the specific instrumentations (http + undici) correctly instrument fetch() calls.
 * This mirrors the production setup in telemetry.ts.
 */
import { describe, test, expect, afterAll, beforeAll } from 'vitest';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';

describe('HTTP Instrumentation', () => {
    let serverPort: number;
    let memoryExporter: InMemorySpanExporter;
    let sdk: NodeSDK;
    let server: Awaited<ReturnType<typeof import('http').createServer>>;

    beforeAll(async () => {
        // Create in-memory exporter
        memoryExporter = new InMemorySpanExporter();

        // Initialize OpenTelemetry SDK directly with specific instrumentations
        // This mirrors the production setup in telemetry.ts
        sdk = new NodeSDK({
            resource: new Resource({
                [ATTR_SERVICE_NAME]: 'http-instrumentation-test',
            }),
            spanProcessor: new SimpleSpanProcessor(memoryExporter),
            instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
        });

        await sdk.start();

        // NOW import http and create the server (after instrumentation is set up)
        const http = await import('http');
        server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'ok', path: req.url }));
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', () => {
                const addr = server.address();
                if (addr && typeof addr === 'object') {
                    serverPort = addr.port;
                }
                resolve();
            });
        });
    });

    afterAll(async () => {
        // Close server first
        if (server) {
            await new Promise<void>((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            });
        }

        // Then shutdown SDK
        if (sdk) {
            await sdk.shutdown();
        }
    });

    test('fetch() calls are instrumented and create HTTP spans', async () => {
        // Clear any previous spans
        memoryExporter.reset();

        // Make a fetch call - this should be instrumented by undici instrumentation
        // (Node.js 18+ uses undici internally for fetch())
        const url = `http://127.0.0.1:${serverPort}/test-fetch-endpoint`;
        const response = await fetch(url);
        const data = await response.json();
        expect(data.message).toBe('ok');

        // Give time for async span processing
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check that spans were created
        const spans = memoryExporter.getFinishedSpans();

        // We should have at least one HTTP span
        const httpSpans = spans.filter((span) => {
            const name = span.name.toLowerCase();
            const attrs = span.attributes;
            return (
                name.includes('get') ||
                name.includes('http') ||
                name.includes('fetch') ||
                attrs['http.method'] === 'GET' ||
                attrs['http.request.method'] === 'GET'
            );
        });

        expect(httpSpans.length).toBeGreaterThan(0);

        // Verify the span has expected HTTP attributes
        const httpSpan = httpSpans[0];
        const attrs = httpSpan.attributes;

        // Should have URL-related attributes
        expect(attrs['url.full'] || attrs['http.url'] || attrs['http.target']).toBeDefined();

        // Should have method attribute
        expect(attrs['http.request.method'] || attrs['http.method']).toBe('GET');

        // Should have status code
        expect(attrs['http.response.status_code'] || attrs['http.status_code']).toBe(200);
    });

    test('multiple fetch() calls create multiple spans', async () => {
        // Clear any previous spans
        memoryExporter.reset();

        // Make multiple fetch calls
        const urls = [
            `http://127.0.0.1:${serverPort}/endpoint-1`,
            `http://127.0.0.1:${serverPort}/endpoint-2`,
            `http://127.0.0.1:${serverPort}/endpoint-3`,
        ];

        await Promise.all(urls.map((url) => fetch(url)));

        // Give time for async span processing
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Check that spans were created
        const spans = memoryExporter.getFinishedSpans();

        // Should have at least 3 spans (one for each request)
        const httpSpans = spans.filter((span) => {
            const attrs = span.attributes;
            return attrs['http.request.method'] === 'GET' || attrs['http.method'] === 'GET';
        });

        expect(httpSpans.length).toBeGreaterThanOrEqual(3);
    });
});

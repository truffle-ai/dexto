import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WebhookConfig } from './webhook-types.js';
import { AgentEventBus } from '@core/events/index.js';
import { WebhookEventSubscriber } from './webhook-subscriber.js';

// Create a mock fetch function
const mockFetch = vi.fn();

// We'll use fake timers selectively for specific tests

describe('WebhookEventSubscriber', () => {
    let webhookSubscriber: WebhookEventSubscriber;
    let agentEventBus: AgentEventBus;

    beforeEach(() => {
        // Set test environment before creating subscriber
        process.env.NODE_ENV = 'test';

        // Completely reset the mock
        mockFetch.mockReset();

        // Set default mock implementation (no artificial delay needed with fake timers)
        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            statusText: 'OK',
        } as any);

        // Create webhook subscriber with mocked fetch
        webhookSubscriber = new WebhookEventSubscriber({ fetchFn: mockFetch as any });
        agentEventBus = new AgentEventBus();
    });

    afterEach(() => {
        // Clean up webhook subscriber and abort controllers
        webhookSubscriber.cleanup();

        // Reset all mocks
        vi.resetAllMocks();

        // Clear the test environment
        delete process.env.NODE_ENV;
    });

    describe('Webhook Management', () => {
        it('should add a webhook', () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                secret: 'secret123',
                description: 'Test webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const retrievedWebhook = webhookSubscriber.getWebhook('wh_test_123');
            expect(retrievedWebhook).toEqual(webhook);
        });

        it('should remove a webhook', () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);
            expect(webhookSubscriber.getWebhook('wh_test_123')).toBeDefined();

            const removed = webhookSubscriber.removeWebhook('wh_test_123');
            expect(removed).toBe(true);
            expect(webhookSubscriber.getWebhook('wh_test_123')).toBeUndefined();
        });

        it('should return false when removing non-existent webhook', () => {
            const removed = webhookSubscriber.removeWebhook('non_existent');
            expect(removed).toBe(false);
        });

        it('should list all webhooks', () => {
            const webhook1: WebhookConfig = {
                id: 'wh_test_1',
                url: 'https://example.com/webhook1',
                createdAt: new Date(),
            };

            const webhook2: WebhookConfig = {
                id: 'wh_test_2',
                url: 'https://example.com/webhook2',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook1);
            webhookSubscriber.addWebhook(webhook2);

            const webhooks = webhookSubscriber.getWebhooks();
            expect(webhooks).toHaveLength(2);
            expect(webhooks).toContainEqual(webhook1);
            expect(webhooks).toContainEqual(webhook2);
        });
    });

    describe('Event Subscription', () => {
        it('should subscribe to agent events', () => {
            const mockOn = vi.spyOn(agentEventBus, 'on');

            webhookSubscriber.subscribe(agentEventBus);

            // Verify that all expected events are subscribed to
            expect(mockOn).toHaveBeenCalledWith('llmservice:thinking', expect.any(Function), {
                signal: expect.any(AbortSignal),
            });
            expect(mockOn).toHaveBeenCalledWith('llmservice:response', expect.any(Function), {
                signal: expect.any(AbortSignal),
            });
            expect(mockOn).toHaveBeenCalledWith('dexto:conversationReset', expect.any(Function), {
                signal: expect.any(AbortSignal),
            });
        });

        it('should clean up event listeners on cleanup', () => {
            // Subscribe first to create abort controller
            webhookSubscriber.subscribe(agentEventBus);

            // Spy on the abort method of the actual abort controller
            const abortController = (webhookSubscriber as any).abortController;
            expect(abortController).toBeDefined();
            const mockAbort = vi.spyOn(abortController, 'abort');

            // Call cleanup
            webhookSubscriber.cleanup();

            // Verify abort was called
            expect(mockAbort).toHaveBeenCalled();

            // Verify abortController is cleaned up
            expect((webhookSubscriber as any).abortController).toBeUndefined();
        });
    });

    describe('Event Delivery', () => {
        // Default mock is already set up in parent beforeEach

        it('should deliver events to registered webhooks', async () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                secret: 'secret123',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);
            webhookSubscriber.subscribe(agentEventBus);

            // Emit event and wait for async delivery
            agentEventBus.emit('dexto:conversationReset', { sessionId: 'test-session' });

            // Wait for async delivery to complete (much shorter in test env due to 1ms delays)
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Check if fetch was called
            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/webhook',
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'User-Agent': 'DextoAgent/1.0',
                        'X-Dexto-Event-Type': 'dexto:conversationReset',
                        'X-Dexto-Signature-256': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
                    }),
                    body: expect.stringContaining('"type":"dexto:conversationReset"'),
                })
            );
        });

        it('should not deliver events when no webhooks are registered', async () => {
            webhookSubscriber.subscribe(agentEventBus);

            agentEventBus.emit('dexto:conversationReset', { sessionId: 'test-session' });

            await new Promise((resolve) => setTimeout(resolve, 5));

            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('should include proper webhook event structure', async () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);
            webhookSubscriber.subscribe(agentEventBus);

            agentEventBus.emit('llmservice:response', {
                content: 'Hello world',
                sessionId: 'test-session',
                tokenCount: 2,
                model: 'test-model',
            });

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockFetch).toHaveBeenCalled();
            expect(mockFetch.mock.calls[0]).toBeDefined();
            const [_url, requestOptions] = mockFetch.mock.calls[0]!;
            const requestBody = JSON.parse((requestOptions as any).body);

            expect(requestBody).toMatchObject({
                id: expect.stringMatching(/^evt_/),
                type: 'llmservice:response',
                data: {
                    content: 'Hello world',
                    sessionId: 'test-session',
                    tokenCount: 2,
                    model: 'test-model',
                },
                created: expect.any(String),
                apiVersion: '2025-07-03',
            });
        });
    });

    describe('Webhook Testing', () => {
        it('should test webhook successfully', async () => {
            // Use default mock which includes delay for responseTime

            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const result = await webhookSubscriber.testWebhook('wh_test_123');

            expect(result.success).toBe(true);
            expect(result.statusCode).toBe(200);
            expect(result.responseTime).toBeGreaterThanOrEqual(0);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/webhook',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('"type":"dexto:availableToolsUpdated"'),
                })
            );
        });

        it('should throw error when testing non-existent webhook', async () => {
            await expect(webhookSubscriber.testWebhook('non_existent')).rejects.toThrow(
                'Webhook not found: non_existent'
            );
        });
    });

    describe('Retry Logic', () => {
        it('should retry failed requests', async () => {
            // First two calls fail, third succeeds
            mockFetch
                .mockRejectedValueOnce(new Error('Network error'))
                .mockRejectedValueOnce(new Error('Network error'))
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                } as any);

            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const result = await webhookSubscriber.testWebhook('wh_test_123');

            expect(result.success).toBe(true);
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it('should fail after max retries', async () => {
            mockFetch.mockRejectedValue(new Error('Network error'));

            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const result = await webhookSubscriber.testWebhook('wh_test_123');

            expect(result.success).toBe(false);
            expect(result.error).toContain('Network error');
            expect(mockFetch).toHaveBeenCalledTimes(3); // Default max retries
        });
    });

    describe('Security', () => {
        it('should generate HMAC signature when secret is provided', async () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                secret: 'test-secret',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);
            webhookSubscriber.subscribe(agentEventBus);

            agentEventBus.emit('dexto:conversationReset', { sessionId: 'test-session' });

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockFetch).toHaveBeenCalled();
            expect(mockFetch.mock.calls[0]).toBeDefined();
            const [_url, requestOptions] = mockFetch.mock.calls[0]!;
            expect((requestOptions as any).headers['X-Dexto-Signature-256']).toMatch(
                /^sha256=[a-f0-9]{64}$/
            );
        });

        it('should not include signature when no secret is provided', async () => {
            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);
            webhookSubscriber.subscribe(agentEventBus);

            agentEventBus.emit('dexto:conversationReset', { sessionId: 'test-session' });

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockFetch).toHaveBeenCalled();
            expect(mockFetch.mock.calls[0]).toBeDefined();
            const [_url, requestOptions] = mockFetch.mock.calls[0]!;
            expect((requestOptions as any).headers['X-Dexto-Signature-256']).toBeUndefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle HTTP error responses', async () => {
            mockFetch.mockImplementation(async () => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                return {
                    ok: false,
                    status: 404,
                    statusText: 'Not Found',
                } as any;
            });

            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const result = await webhookSubscriber.testWebhook('wh_test_123');

            expect(result.success).toBe(false);
            expect(result.statusCode).toBe(404);
            expect(result.error).toBe('HTTP 404: Not Found');
        });

        it('should handle timeout errors', async () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            mockFetch.mockRejectedValue(abortError);

            const webhook: WebhookConfig = {
                id: 'wh_test_123',
                url: 'https://example.com/webhook',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook);

            const result = await webhookSubscriber.testWebhook('wh_test_123');

            expect(result.success).toBe(false);
            expect(result.error).toContain('aborted');
        });
    });

    describe('Multiple Webhooks', () => {
        it('should deliver events to multiple webhooks', async () => {
            const webhook1: WebhookConfig = {
                id: 'wh_test_1',
                url: 'https://example.com/webhook1',
                createdAt: new Date(),
            };

            const webhook2: WebhookConfig = {
                id: 'wh_test_2',
                url: 'https://example.com/webhook2',
                createdAt: new Date(),
            };

            webhookSubscriber.addWebhook(webhook1);
            webhookSubscriber.addWebhook(webhook2);
            webhookSubscriber.subscribe(agentEventBus);

            agentEventBus.emit('dexto:conversationReset', { sessionId: 'test-session' });

            await new Promise((resolve) => setTimeout(resolve, 200));

            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/webhook1',
                expect.any(Object)
            );
            expect(mockFetch).toHaveBeenCalledWith(
                'https://example.com/webhook2',
                expect.any(Object)
            );
        });
    });
});

import crypto from 'crypto';
import { AgentEventBus, type AgentEventName, type AgentEventMap } from '@core/events/index.js';
import { logger } from '@core/index.js';
import { EventSubscriber } from './types.js';
import {
    type WebhookConfig,
    type DextoWebhookEvent,
    type WebhookDeliveryResult,
    type WebhookDeliveryOptions,
} from './webhook-types.js';

/**
 * Default configuration for webhook delivery
 */
const DEFAULT_DELIVERY_OPTIONS: Required<WebhookDeliveryOptions> = {
    maxRetries: 3,
    timeout: 10000, // 10 seconds
    includeSignature: true,
};

/**
 * Webhook event subscriber that delivers agent events via HTTP POST
 * Mirrors WebSocketEventSubscriber but sends HTTP requests to registered webhook URLs
 */
export class WebhookEventSubscriber implements EventSubscriber {
    private webhooks: Map<string, WebhookConfig> = new Map();
    private abortController?: AbortController;
    private deliveryOptions: Required<WebhookDeliveryOptions>;
    private fetchFn: typeof globalThis.fetch;

    constructor({
        fetchFn,
        ...deliveryOptions
    }: WebhookDeliveryOptions & { fetchFn?: typeof globalThis.fetch } = {}) {
        this.deliveryOptions = { ...DEFAULT_DELIVERY_OPTIONS, ...deliveryOptions };
        // Use native fetch (Node.js 20+) or injected implementation (tests)
        this.fetchFn = fetchFn || fetch;
        logger.debug('WebhookEventSubscriber initialized');
    }

    /**
     * Subscribe to agent events and deliver them to registered webhooks
     */
    subscribe(eventBus: AgentEventBus): void {
        // Create new AbortController for this subscription
        this.abortController = new AbortController();
        const { signal } = this.abortController;

        // Note: This will generate MaxListenersExceededWarning since we subscribe to 11+ events
        // with the same AbortSignal. This is expected and harmless.

        // Subscribe to all relevant events with abort signal (same as WebSocket subscriber)
        const eventNames: AgentEventName[] = [
            'llmservice:thinking',
            'llmservice:chunk',
            'llmservice:toolCall',
            'llmservice:toolResult',
            'llmservice:response',
            'llmservice:error',
            'dexto:conversationReset',
            'dexto:mcpServerConnected',
            'dexto:availableToolsUpdated',
            'dexto:toolConfirmationRequest',
            'dexto:llmSwitched',
            'dexto:stateChanged',
        ];

        eventNames.forEach((eventName) => {
            eventBus.on(
                eventName,
                (payload) => {
                    this.deliverEvent(eventName, payload);
                },
                { signal }
            );
        });

        logger.info(`Webhook subscriber active with ${this.webhooks.size} registered webhooks`);
    }

    /**
     * Register a new webhook endpoint
     */
    addWebhook(webhook: WebhookConfig): void {
        this.webhooks.set(webhook.id, webhook);
        logger.info(`Webhook registered: ${webhook.id} -> ${webhook.url}`);
    }

    /**
     * Remove a webhook endpoint
     */
    removeWebhook(webhookId: string): boolean {
        const removed = this.webhooks.delete(webhookId);
        if (removed) {
            logger.info(`Webhook removed: ${webhookId}`);
        } else {
            logger.warn(`Attempted to remove non-existent webhook: ${webhookId}`);
        }
        return removed;
    }

    /**
     * Get all registered webhooks
     */
    getWebhooks(): WebhookConfig[] {
        return Array.from(this.webhooks.values());
    }

    /**
     * Get a specific webhook by ID
     */
    getWebhook(webhookId: string): WebhookConfig | undefined {
        return this.webhooks.get(webhookId);
    }

    /**
     * Test a webhook by sending a sample event
     */
    async testWebhook(webhookId: string): Promise<WebhookDeliveryResult> {
        const webhook = this.webhooks.get(webhookId);
        if (!webhook) {
            throw new Error(`Webhook not found: ${webhookId}`);
        }

        const testEvent: DextoWebhookEvent<'dexto:availableToolsUpdated'> = {
            id: `evt_test_${Date.now()}`,
            type: 'dexto:availableToolsUpdated',
            data: {
                tools: ['test-tool'],
                source: 'mcp',
            },
            created: new Date().toISOString(),
            apiVersion: '2025-07-03',
        };

        return this.deliverToWebhook(webhook, testEvent);
    }

    /**
     * Clean up event listeners and resources
     */
    cleanup(): void {
        if (this.abortController) {
            this.abortController.abort();
            delete (this as any).abortController;
        }

        this.webhooks.clear();
        logger.debug('Webhook event subscriber cleaned up');
    }

    /**
     * Deliver an event to all registered webhooks
     */
    private async deliverEvent<T extends AgentEventName>(
        eventType: T,
        eventData: AgentEventMap[T]
    ): Promise<void> {
        if (this.webhooks.size === 0) {
            return; // No webhooks to deliver to
        }

        const webhookEvent: DextoWebhookEvent<T> = {
            id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            type: eventType,
            data: eventData,
            created: new Date().toISOString(),
            apiVersion: '2025-07-03',
        };

        logger.debug(`Delivering webhook event: ${eventType} to ${this.webhooks.size} webhooks`);

        // Deliver to all webhooks in parallel
        const deliveryPromises = Array.from(this.webhooks.values()).map((webhook) => ({
            webhook,
            promise: this.deliverToWebhook(webhook, webhookEvent),
        }));

        const handleSettled = (results: PromiseSettledResult<WebhookDeliveryResult>[]) => {
            results.forEach((result, i) => {
                if (result.status === 'rejected') {
                    const webhook = deliveryPromises[i]?.webhook;
                    if (webhook) {
                        logger.error(
                            `Webhook delivery failed for ${webhook.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
                        );
                    }
                }
            });
        };

        // For testing purposes, we can await this if needed
        if (process.env.NODE_ENV === 'test') {
            const results = await Promise.allSettled(deliveryPromises.map((p) => p.promise));
            handleSettled(results);
        } else {
            // Fire-and-forget in production
            Promise.allSettled(deliveryPromises.map((p) => p.promise)).then(handleSettled);
        }
    }

    /**
     * Deliver an event to a specific webhook with retry logic
     */
    private async deliverToWebhook(
        webhook: WebhookConfig,
        event: DextoWebhookEvent
    ): Promise<WebhookDeliveryResult> {
        const startTime = Date.now();
        let lastError: Error | undefined;
        let lastStatusCode: number | undefined;

        for (let attempt = 1; attempt <= this.deliveryOptions.maxRetries; attempt++) {
            try {
                const result = await this.sendWebhookRequest(webhook, event, attempt);
                if (result.success) {
                    return result;
                }
                // Don't duplicate "HTTP xxx:" prefix if it's already in the error message
                lastError = new Error(result.error || `HTTP ${result.statusCode}`);
                lastStatusCode = result.statusCode;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                logger.warn(
                    `Webhook delivery attempt ${attempt}/${this.deliveryOptions.maxRetries} failed for ${webhook.id}: ${lastError.message}`
                );
            }

            // Wait before retry (exponential backoff with jitter)
            if (attempt < this.deliveryOptions.maxRetries) {
                // Use shorter delays in test environment for faster tests
                const baseDelay = process.env.NODE_ENV === 'test' ? 1 : 1000;
                const exp = baseDelay * Math.pow(2, attempt - 1);
                const jitter = exp * 0.2 * Math.random(); // ±20%
                const backoffMs = Math.min(exp + jitter, 10000);
                await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
        }

        // All attempts failed
        const totalTime = Date.now() - startTime;
        const result: WebhookDeliveryResult = {
            success: false,
            error: lastError?.message || 'Unknown error',
            responseTime: totalTime,
            attempt: this.deliveryOptions.maxRetries,
            ...(lastStatusCode !== undefined && { statusCode: lastStatusCode }),
        };

        logger.error(
            `Webhook delivery failed after ${this.deliveryOptions.maxRetries} attempts for ${webhook.id}: ${result.error}`
        );

        return result;
    }

    /**
     * Send HTTP request to webhook endpoint
     */
    private async sendWebhookRequest(
        webhook: WebhookConfig,
        event: DextoWebhookEvent,
        attempt: number
    ): Promise<WebhookDeliveryResult> {
        const startTime = Date.now();
        const payload = JSON.stringify(event);

        // Prepare headers
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'DextoAgent/1.0',
            'X-Dexto-Event-Type': event.type,
            'X-Dexto-Event-Id': event.id,
            'X-Dexto-Delivery-Attempt': attempt.toString(),
        };

        // Add signature if secret is provided
        if (webhook.secret && this.deliveryOptions.includeSignature) {
            const signature = this.generateSignature(payload, webhook.secret);
            headers['X-Dexto-Signature-256'] = signature;
        }

        try {
            const response = await this.fetchFn(webhook.url, {
                method: 'POST',
                headers,
                body: payload,
                signal: AbortSignal.timeout(this.deliveryOptions.timeout),
            });

            const responseTime = Date.now() - startTime;
            const success = response.ok;

            const result: WebhookDeliveryResult = {
                success,
                statusCode: response.status,
                responseTime,
                attempt,
            };

            if (!success) {
                result.error = `HTTP ${response.status}: ${response.statusText}`;
            }

            logger.debug(
                `Webhook delivery ${success ? 'succeeded' : 'failed'} for ${webhook.id}: ${response.status} in ${responseTime}ms`
            );

            return result;
        } catch (error) {
            const responseTime = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            return {
                success: false,
                error: errorMessage,
                responseTime,
                attempt,
            };
        }
    }

    /**
     * Generate HMAC signature for webhook verification
     */
    private generateSignature(payload: string, secret: string): string {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payload, 'utf8');
        return `sha256=${hmac.digest('hex')}`;
    }
}

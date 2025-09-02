import type { AgentEventMap, AgentEventName } from '@core/events/index.js';

/**
 * Webhook configuration interface
 * Represents a registered webhook endpoint
 */
export interface WebhookConfig {
    /** Unique identifier for the webhook */
    id: string;
    /** The URL to send webhook events to */
    url: string;
    /** Optional secret for signature verification */
    secret?: string;
    /** When the webhook was registered */
    createdAt: Date;
    /** Optional description for the webhook */
    description?: string;
}

/**
 * Webhook event payload interface
 * Mirrors Stripe.Event structure for familiar developer experience
 */
export interface DextoWebhookEvent<T extends AgentEventName = AgentEventName> {
    /** Unique identifier for this webhook event */
    id: string;
    /** The type of event - provides IDE autocomplete */
    type: T;
    /** The event data payload - typed based on event type */
    data: AgentEventMap[T];
    /** When the event was created */
    created: string;
    /** API version for future compatibility */
    apiVersion: string;
}

/**
 * Webhook delivery attempt result
 */
export interface WebhookDeliveryResult {
    /** Whether the delivery was successful */
    success: boolean;
    /** HTTP status code received */
    statusCode?: number;
    /** Error message if delivery failed */
    error?: string;
    /** Response time in milliseconds */
    responseTime: number;
    /** Number of delivery attempts */
    attempt: number;
}

/**
 * Webhook registration request body
 */
export interface WebhookRegistrationRequest {
    /** The URL to send webhook events to */
    url: string;
    /** Optional secret for signature verification */
    secret?: string;
    /** Optional description for the webhook */
    description?: string;
}

/**
 * Webhook test event payload
 */
export interface WebhookTestEvent extends DextoWebhookEvent<'dexto:availableToolsUpdated'> {
    /** Indicates this is a test event */
    test: true;
}

/**
 * Type-safe webhook handler function signature
 * Provides autocomplete for event types and typed data payloads
 */
export type WebhookHandler<T extends AgentEventName = AgentEventName> = (
    event: DextoWebhookEvent<T>
) => Promise<void> | void;

/**
 * Webhook handler mapping for type-safe event routing
 * Provides IDE autocomplete for event names like Stripe webhooks
 */
export type WebhookEventHandlers = {
    [K in AgentEventName]?: WebhookHandler<K>;
};

/**
 * Webhook delivery options
 */
export interface WebhookDeliveryOptions {
    /** Maximum number of retry attempts */
    maxRetries?: number;
    /** Timeout in milliseconds */
    timeout?: number;
    /** Include signature verification header */
    includeSignature?: boolean;
}

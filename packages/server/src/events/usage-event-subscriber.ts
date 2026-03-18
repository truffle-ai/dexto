import { setMaxListeners } from 'events';
import {
    AgentEventBus,
    calculateCostBreakdown,
    getModelPricing,
    hasMeaningfulTokenUsage,
    logger,
    type AgentEventMap,
    type Database,
} from '@dexto/core';
import type { EventSubscriber } from './types.js';
import type {
    UsageEvent,
    UsageEventBatch,
    UsageEventDeliveryOptions,
} from './usage-event-types.js';

const OUTBOX_KEY_PREFIX = 'usage-outbox:';

const DEFAULT_DELIVERY_OPTIONS: Required<UsageEventDeliveryOptions> = {
    fetchFn: fetch,
    flushIntervalMs: 5000,
    batchSize: 50,
    requestTimeoutMs: 10000,
};

interface UsageEventSubscriberConfig extends UsageEventDeliveryOptions {
    database: Database;
    targetUrl: string;
    authToken: string;
    runtimeId?: string;
    runId?: string;
}

interface UsageEventOutboxRecord {
    event: UsageEvent;
}

function createUsageEventId(usageScopeId: string, messageId: string): string {
    return `usage:${usageScopeId}:${messageId}`;
}

function createOutboxKey(eventId: string): string {
    return `${OUTBOX_KEY_PREFIX}${eventId}`;
}

export class UsageEventSubscriber implements EventSubscriber {
    private readonly database: Database;
    private readonly targetUrl: string;
    private readonly authToken: string;
    private readonly runtimeId: string | undefined;
    private readonly runId: string | undefined;
    private readonly deliveryOptions: Required<UsageEventDeliveryOptions>;
    private abortController?: AbortController;
    private flushInterval?: ReturnType<typeof setInterval>;
    private flushPromise: Promise<void> | null = null;
    private flushRequestedWhileRunning = false;

    constructor(config: UsageEventSubscriberConfig) {
        this.database = config.database;
        this.targetUrl = config.targetUrl;
        this.authToken = config.authToken;
        this.runtimeId = config.runtimeId;
        this.runId = config.runId;
        this.deliveryOptions = {
            fetchFn: config.fetchFn ?? DEFAULT_DELIVERY_OPTIONS.fetchFn,
            flushIntervalMs: config.flushIntervalMs ?? DEFAULT_DELIVERY_OPTIONS.flushIntervalMs,
            batchSize: config.batchSize ?? DEFAULT_DELIVERY_OPTIONS.batchSize,
            requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_DELIVERY_OPTIONS.requestTimeoutMs,
        };
    }

    subscribe(eventBus: AgentEventBus): void {
        this.abortController?.abort();
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
        }

        this.abortController = new AbortController();
        const { signal } = this.abortController;

        setMaxListeners(10, signal);

        eventBus.on(
            'llm:response',
            (payload) => {
                void this.enqueueUsageEvent(payload);
            },
            { signal }
        );

        this.flushInterval = setInterval(() => {
            void this.flushPending();
        }, this.deliveryOptions.flushIntervalMs);

        void this.flushPending();
    }

    cleanup(): void {
        if (this.abortController) {
            this.abortController.abort();
            delete this.abortController;
        }

        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            delete this.flushInterval;
        }
    }

    public async flush(): Promise<void> {
        await this.flushPending();
    }

    private buildUsageEvent(payload: AgentEventMap['llm:response']): UsageEvent | null {
        if (!payload.messageId || !payload.usageScopeId || !payload.tokenUsage) {
            return null;
        }

        if (!hasMeaningfulTokenUsage(payload.tokenUsage)) {
            return null;
        }

        const resolvedCostBreakdown =
            payload.provider && payload.model
                ? (() => {
                      const pricing = getModelPricing(payload.provider, payload.model);
                      if (!pricing) {
                          return undefined;
                      }

                      return calculateCostBreakdown(payload.tokenUsage, pricing);
                  })()
                : undefined;
        const resolvedEstimatedCost = payload.estimatedCost ?? resolvedCostBreakdown?.totalUsd;

        return {
            eventId: createUsageEventId(payload.usageScopeId, payload.messageId),
            occurredAt: new Date().toISOString(),
            sessionId: payload.sessionId,
            messageId: payload.messageId,
            usageScopeId: payload.usageScopeId,
            ...(payload.provider && { provider: payload.provider }),
            ...(payload.model && { model: payload.model }),
            tokenUsage: payload.tokenUsage,
            ...(resolvedEstimatedCost !== undefined && { estimatedCostUsd: resolvedEstimatedCost }),
            ...(resolvedCostBreakdown && { costBreakdownUsd: resolvedCostBreakdown }),
            ...(this.runtimeId && { runtimeId: this.runtimeId }),
            ...(this.runId && { runId: this.runId }),
        };
    }

    private async enqueueUsageEvent(payload: AgentEventMap['llm:response']): Promise<void> {
        const usageEvent = this.buildUsageEvent(payload);
        if (!usageEvent) {
            return;
        }

        await this.database.set<UsageEventOutboxRecord>(createOutboxKey(usageEvent.eventId), {
            event: usageEvent,
        });

        void this.flushPending();
    }

    private async listPendingRecords(): Promise<
        Array<{
            key: string;
            record: UsageEventOutboxRecord;
        }>
    > {
        const keys = await this.database.list(OUTBOX_KEY_PREFIX);
        if (keys.length === 0) {
            return [];
        }

        const records = await Promise.all(
            keys.map(async (key) => {
                const record = await this.database.get<UsageEventOutboxRecord>(key);
                return record ? { key, record } : null;
            })
        );

        return records
            .filter(
                (value): value is { key: string; record: UsageEventOutboxRecord } => value !== null
            )
            .sort((left, right) =>
                left.record.event.occurredAt.localeCompare(right.record.event.occurredAt)
            );
    }

    private async flushPending(): Promise<void> {
        if (this.flushPromise) {
            this.flushRequestedWhileRunning = true;
            return this.flushPromise;
        }

        this.flushPromise = this.doFlushPending().finally(() => {
            this.flushPromise = null;
            const shouldFlushAgain = this.flushRequestedWhileRunning;
            this.flushRequestedWhileRunning = false;
            if (shouldFlushAgain) {
                void this.flushPending();
            }
        });

        return this.flushPromise;
    }

    private async doFlushPending(): Promise<void> {
        const pendingRecords = await this.listPendingRecords();
        if (pendingRecords.length === 0) {
            return;
        }

        for (
            let index = 0;
            index < pendingRecords.length;
            index += this.deliveryOptions.batchSize
        ) {
            const batchRecords = pendingRecords.slice(
                index,
                index + this.deliveryOptions.batchSize
            );
            const payload: UsageEventBatch = {
                events: batchRecords.map((record) => record.record.event),
            };

            const abortController = new AbortController();
            const timeout = setTimeout(() => {
                abortController.abort();
            }, this.deliveryOptions.requestTimeoutMs);

            try {
                const response = await this.deliveryOptions.fetchFn(this.targetUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${this.authToken}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(payload),
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    logger.warn(
                        `Usage event delivery failed (${response.status}) for ${batchRecords.length} events`
                    );
                    return;
                }

                await Promise.all(batchRecords.map((record) => this.database.delete(record.key)));
            } catch (error) {
                logger.warn(
                    `Usage event delivery failed: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
                return;
            } finally {
                clearTimeout(timeout);
            }
        }
    }
}

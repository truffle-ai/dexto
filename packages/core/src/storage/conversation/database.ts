import { cloneInternalMessage, cloneInternalMessages } from '../../context/content-clone.js';
import type { InternalMessage } from '../../context/types.js';
import type { Logger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import type { Database } from '../database/types.js';
import { StorageError } from '../errors.js';
import type { ConversationStore } from './types.js';

type SessionConversationState = {
    cache: InternalMessage[] | null;
    dirty: boolean;
    flushTimer: ReturnType<typeof setTimeout> | null;
    flushPromise: Promise<void> | null;
};

export class DatabaseConversationStore implements ConversationStore {
    private readonly logger: Logger;
    private readonly states = new Map<string, SessionConversationState>();

    private static readonly FLUSH_DELAY_MS = 100;
    private static readonly LOAD_LIMIT = 10000;

    constructor(
        private readonly database: Database,
        logger: Logger
    ) {
        this.logger = logger.createChild(DextoLogComponent.STORAGE);
    }

    async listMessages(input: { sessionId: string }): Promise<InternalMessage[]> {
        const state = await this.loadState(input.sessionId);
        return cloneInternalMessages(state.cache ?? []);
    }

    async saveMessage(input: { sessionId: string; message: InternalMessage }): Promise<void> {
        const state = await this.loadState(input.sessionId);
        const cache = state.cache ?? [];

        if (input.message.id && cache.some((message) => message.id === input.message.id)) {
            this.logger.debug('DatabaseConversationStore: duplicate message skipped', {
                sessionId: input.sessionId,
                messageId: input.message.id,
            });
            return;
        }

        const message = cloneInternalMessage(input.message);
        cache.push(message);
        state.cache = cache;

        try {
            await this.database.append(this.getMessagesKey(input.sessionId), message);
        } catch (error) {
            cache.pop();
            throw StorageError.writeFailed('conversation.saveMessage', this.errorMessage(error), {
                sessionId: input.sessionId,
            });
        }
    }

    async updateMessage(input: { sessionId: string; message: InternalMessage }): Promise<void> {
        if (!input.message.id) {
            this.logger.warn('DatabaseConversationStore: ignoring message update without id', {
                sessionId: input.sessionId,
            });
            return;
        }

        const state = await this.loadState(input.sessionId);
        const cache = state.cache ?? [];
        const index = cache.findIndex((message) => message.id === input.message.id);
        if (index === -1) {
            this.logger.warn('DatabaseConversationStore: message not found for update', {
                sessionId: input.sessionId,
                messageId: input.message.id,
            });
            return;
        }

        cache[index] = cloneInternalMessage(input.message);
        state.cache = cache;
        state.dirty = true;
        this.scheduleFlush(input.sessionId, state);
    }

    async clearMessages(input: { sessionId: string }): Promise<void> {
        const state = this.getState(input.sessionId);
        this.cancelPendingFlush(state);
        state.cache = [];
        state.dirty = false;

        try {
            await this.database.delete(this.getMessagesKey(input.sessionId));
        } catch (error) {
            throw StorageError.deleteFailed(
                'conversation.clearMessages',
                this.errorMessage(error),
                {
                    sessionId: input.sessionId,
                }
            );
        }
    }

    async flush(input: { sessionId: string }): Promise<void> {
        const state = this.getState(input.sessionId);
        if (state.flushPromise) {
            await state.flushPromise;
            return;
        }

        this.cancelPendingFlush(state);
        if (!state.dirty || !state.cache) {
            return;
        }

        state.flushPromise = this.flushState(input.sessionId, state);
        try {
            await state.flushPromise;
        } finally {
            state.flushPromise = null;
        }
    }

    private async loadState(sessionId: string): Promise<SessionConversationState> {
        const state = this.getState(sessionId);
        if (state.cache !== null) {
            return state;
        }

        try {
            const rawMessages = await this.database.getRange<InternalMessage>(
                this.getMessagesKey(sessionId),
                0,
                DatabaseConversationStore.LOAD_LIMIT
            );
            if (rawMessages.length === DatabaseConversationStore.LOAD_LIMIT) {
                this.logger.warn('DatabaseConversationStore: message load hit limit', {
                    sessionId,
                    limit: DatabaseConversationStore.LOAD_LIMIT,
                });
            }

            state.cache = this.dedupeMessages(sessionId, rawMessages);
            return state;
        } catch (error) {
            throw StorageError.readFailed('conversation.listMessages', this.errorMessage(error), {
                sessionId,
            });
        }
    }

    private getState(sessionId: string): SessionConversationState {
        const existing = this.states.get(sessionId);
        if (existing) {
            return existing;
        }

        const state: SessionConversationState = {
            cache: null,
            dirty: false,
            flushTimer: null,
            flushPromise: null,
        };
        this.states.set(sessionId, state);
        return state;
    }

    private dedupeMessages(sessionId: string, messages: InternalMessage[]): InternalMessage[] {
        const seen = new Set<string>();
        const deduped: InternalMessage[] = [];
        let duplicateCount = 0;

        for (const message of messages) {
            if (message.id && seen.has(message.id)) {
                duplicateCount++;
                continue;
            }
            if (message.id) {
                seen.add(message.id);
            }
            deduped.push(cloneInternalMessage(message));
        }

        if (duplicateCount > 0) {
            this.logger.warn('DatabaseConversationStore: duplicate messages deduped', {
                sessionId,
                duplicateCount,
            });
            const state = this.getState(sessionId);
            state.dirty = true;
            this.scheduleFlush(sessionId, state);
        }

        return deduped;
    }

    private async flushState(sessionId: string, state: SessionConversationState): Promise<void> {
        if (!state.dirty || !state.cache) {
            return;
        }

        const key = this.getMessagesKey(sessionId);
        const snapshot = cloneInternalMessages(state.cache);

        try {
            await this.database.delete(key);
            for (const message of snapshot) {
                await this.database.append(key, message);
            }
            if (!state.flushTimer) {
                state.dirty = false;
            }
        } catch (error) {
            throw StorageError.writeFailed('conversation.flush', this.errorMessage(error), {
                sessionId,
            });
        }
    }

    private scheduleFlush(sessionId: string, state: SessionConversationState): void {
        if (state.flushTimer) {
            return;
        }

        state.flushTimer = setTimeout(() => {
            state.flushTimer = null;
            this.flush({ sessionId }).catch((error) => {
                this.logger.error('DatabaseConversationStore: scheduled flush failed', {
                    sessionId,
                    error: this.errorMessage(error),
                });
            });
        }, DatabaseConversationStore.FLUSH_DELAY_MS);
    }

    private cancelPendingFlush(state: SessionConversationState): void {
        if (!state.flushTimer) {
            return;
        }

        clearTimeout(state.flushTimer);
        state.flushTimer = null;
    }

    private getMessagesKey(sessionId: string): string {
        return `messages:${sessionId}`;
    }

    private errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

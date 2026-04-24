import { z } from 'zod';
import type { ToolPreferenceStore } from '../storage/index.js';
import type { Logger } from '../logger/v2/types.js';

const SessionToolPreferencesSchema = z
    .object({
        userAutoApproveTools: z.array(z.string()).default([]),
        disabledTools: z.array(z.string()).default([]),
    })
    .strict();

export type SessionToolPreferences = z.output<typeof SessionToolPreferencesSchema>;

const DEFAULT_SESSION_TOOL_PREFERENCES: SessionToolPreferences = {
    userAutoApproveTools: [],
    disabledTools: [],
};

export class SessionToolPreferencesStore {
    constructor(
        private readonly toolPreferenceStore: ToolPreferenceStore,
        private readonly logger: Logger,
        options: { cacheTtlMs?: number } = {}
    ) {
        void options;
    }

    async load(sessionId: string): Promise<SessionToolPreferences> {
        const stored = await this.toolPreferenceStore.loadSessionPreferences({ sessionId });
        return this.parsePreferences(stored, `session-tool-preferences:${sessionId}`);
    }

    async save(sessionId: string, preferences: SessionToolPreferences): Promise<void> {
        const normalized = SessionToolPreferencesSchema.parse(preferences);
        await this.toolPreferenceStore.saveSessionPreferences({
            sessionId,
            preferences: normalized,
        });
    }

    async delete(sessionId: string): Promise<void> {
        await this.toolPreferenceStore.deleteSessionPreferences({ sessionId });
    }

    private parsePreferences(value: unknown, key: string): SessionToolPreferences {
        const result = SessionToolPreferencesSchema.safeParse(value);
        if (result.success) {
            return result.data;
        }

        this.logger.warn('Invalid persisted session tool preferences encountered; using defaults', {
            key,
            error: result.error.message,
        });
        return structuredClone(DEFAULT_SESSION_TOOL_PREFERENCES);
    }
}

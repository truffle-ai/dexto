import type { InternalMessage } from '../context/types.js';

export const SESSION_COMPACTION_MODES = [
    'artifact-only',
    'continue-in-place',
    'continue-in-child',
] as const;

export type SessionCompactionMode = (typeof SESSION_COMPACTION_MODES)[number];

export const SESSION_COMPACTION_TRIGGERS = ['manual', 'api', 'scheduled', 'overflow'] as const;

export type SessionCompactionTrigger = (typeof SESSION_COMPACTION_TRIGGERS)[number];

export interface SessionCompactionInput {
    sessionId: string;
    mode?: SessionCompactionMode;
    trigger?: SessionCompactionTrigger;
    childTitle?: string;
}

export interface SessionCompactionRecord {
    id: string;
    sourceSessionId: string;
    targetSessionId?: string;
    createdAt: number;
    strategy: string;
    mode: SessionCompactionMode;
    trigger: SessionCompactionTrigger;
    originalTokens: number;
    compactedTokens: number;
    originalMessages: number;
    compactedMessages: number;
    summaryMessages: InternalMessage[];
    continuationMessages: InternalMessage[];
}

import type { SessionData } from '../../session/session-manager.js';

export interface SessionStore {
    listSessionIds(): Promise<string[]>;
    getSession(input: { sessionId: string }): Promise<SessionData | undefined>;
    saveSession(input: {
        sessionId: string;
        session: SessionData;
        ttlSeconds?: number;
    }): Promise<void>;
    deleteSession(input: { sessionId: string }): Promise<void>;
    evictSession(input: { sessionId: string }): Promise<void>;
}

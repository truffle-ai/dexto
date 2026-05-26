import type { SessionToolPreferences } from '../../tools/session-tool-preferences-store.js';

export interface ToolPreferenceStore {
    allowTool(input: { toolName: string; sessionId?: string }): Promise<void>;
    disallowTool(input: { toolName: string; sessionId?: string }): Promise<void>;
    isToolAllowed(input: { toolName: string; sessionId?: string }): Promise<boolean>;
    listAllowedTools(input: { sessionId?: string }): Promise<string[]>;
    loadSessionPreferences(input: { sessionId: string }): Promise<SessionToolPreferences>;
    saveSessionPreferences(input: {
        sessionId: string;
        preferences: SessionToolPreferences;
    }): Promise<void>;
    deleteSessionPreferences(input: { sessionId: string }): Promise<void>;
}

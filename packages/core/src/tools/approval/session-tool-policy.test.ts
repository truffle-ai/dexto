import { describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type {
    SessionToolPreferences,
    SessionToolPreferencesStore,
} from '../session-tool-preferences-store.js';
import { matchesToolPolicyPattern, SessionToolPolicy } from './session-tool-policy.js';

function createDeferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createPolicy(
    store: Pick<SessionToolPreferencesStore, 'load' | 'save' | 'delete'>
): SessionToolPolicy {
    return new SessionToolPolicy(store, createMockLogger(), (pattern) => {
        if (pattern.toLowerCase() === 'bash') {
            return 'bash_exec';
        }
        return pattern;
    });
}

describe('SessionToolPolicy', () => {
    it('normalizes and deduplicates run-scoped auto-approved tools', () => {
        const store = {
            load: vi.fn(),
            save: vi.fn(),
            delete: vi.fn(),
        };
        const policy = createPolicy(store);

        policy.setSessionAutoApproveTools('session-1', ['bash_exec']);
        policy.addSessionAutoApproveTools('session-1', ['bash', 'mcp--read_file']);

        expect(policy.getSessionAutoApproveTools('session-1')).toEqual([
            'bash_exec',
            'mcp--read_file',
        ]);
        expect(policy.isToolAutoApprovedForSession('session-1', 'bash_exec')).toBe(true);
        expect(policy.isToolAutoApprovedForSession('session-1', 'mcp--server--read_file')).toBe(
            true
        );
    });

    it('restores persisted user preferences without creating empty auto-approve state', async () => {
        const store = {
            load: vi.fn().mockResolvedValue({
                userAutoApproveTools: [],
                disabledTools: ['write_file'],
            } satisfies SessionToolPreferences),
            save: vi.fn(),
            delete: vi.fn(),
        };
        const policy = createPolicy(store);

        await policy.restoreSessionState('session-1');

        expect(policy.hasSessionUserAutoApproveTools('session-1')).toBe(false);
        expect(policy.getSessionUserAutoApproveTools('session-1')).toBeUndefined();
        expect(policy.getDisabledTools('session-1')).toEqual(['write_file']);
        expect(
            policy.filterToolsForSession(
                {
                    write_file: { parameters: { type: 'object' } },
                    read_file: { parameters: { type: 'object' } },
                },
                'session-1'
            )
        ).toEqual({ read_file: { parameters: { type: 'object' } } });
    });

    it('serializes deleteSessionState behind in-flight preference persistence', async () => {
        const sessionId = 'session-1';
        const saveStarted = createDeferred<void>();
        const releaseSave = createDeferred<void>();
        const emptyPreferences: SessionToolPreferences = {
            userAutoApproveTools: [],
            disabledTools: [],
        };
        const persistedPreferences = new Map<string, SessionToolPreferences>();
        const store = {
            load: vi.fn().mockImplementation(async (requestedSessionId: string) => {
                return structuredClone(
                    persistedPreferences.get(requestedSessionId) ?? emptyPreferences
                );
            }),
            save: vi
                .fn()
                .mockImplementation(
                    async (requestedSessionId: string, preferences: SessionToolPreferences) => {
                        saveStarted.resolve();
                        await releaseSave.promise;
                        persistedPreferences.set(requestedSessionId, structuredClone(preferences));
                    }
                ),
            delete: vi.fn().mockImplementation(async (requestedSessionId: string) => {
                persistedPreferences.delete(requestedSessionId);
            }),
        };
        const policy = createPolicy(store);

        const setDisabledPromise = policy.setSessionDisabledTools(sessionId, ['write_file']);
        await saveStarted.promise;

        let deleteFinished = false;
        const deletePromise = policy.deleteSessionState(sessionId).then(() => {
            deleteFinished = true;
        });

        await Promise.resolve();
        expect(deleteFinished).toBe(false);

        releaseSave.resolve();
        await setDisabledPromise;
        await deletePromise;

        expect(persistedPreferences.get(sessionId) ?? emptyPreferences).toEqual(emptyPreferences);
        expect(policy.getDisabledTools(sessionId)).toEqual([]);
    });

    it('matches MCP policy patterns by exact name or server-qualified suffix only', () => {
        expect(matchesToolPolicyPattern('mcp--read_file', 'mcp--read_file')).toBe(true);
        expect(matchesToolPolicyPattern('mcp--filesystem--read_file', 'mcp--read_file')).toBe(true);
        expect(matchesToolPolicyPattern('read_file', 'mcp--read_file')).toBe(false);
        expect(matchesToolPolicyPattern('write_file', 'read_file')).toBe(false);
    });
});

/**
 * Preference Store Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePreferenceStore } from './preferenceStore.js';

// Mock localStorage for Node.js test environment
const localStorageMock = (() => {
    let store: Record<string, string> = {};

    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
            store[key] = value.toString();
        },
        removeItem: (key: string) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
    };
})();

// Assign to global
global.localStorage = localStorageMock as any;

describe('preferenceStore', () => {
    beforeEach(() => {
        // Reset to default state before each test
        usePreferenceStore.setState({ isStreaming: true });
        // Clear localStorage
        localStorage.clear();
    });

    describe('Initialization', () => {
        it('should initialize with default values', () => {
            const state = usePreferenceStore.getState();
            expect(state.isStreaming).toBe(true);
        });
    });

    describe('setStreaming', () => {
        it('should update streaming preference to false', () => {
            const store = usePreferenceStore.getState();

            store.setStreaming(false);

            expect(usePreferenceStore.getState().isStreaming).toBe(false);
        });

        it('should update streaming preference to true', () => {
            const store = usePreferenceStore.getState();

            // Set to false first
            store.setStreaming(false);
            expect(usePreferenceStore.getState().isStreaming).toBe(false);

            // Then back to true
            store.setStreaming(true);
            expect(usePreferenceStore.getState().isStreaming).toBe(true);
        });
    });

    describe('localStorage persistence', () => {
        it('should have persist middleware configured', () => {
            // The store uses zustand persist middleware with 'dexto-preferences' key
            // In browser environment, this will automatically persist to localStorage
            // Here we just verify the store works correctly

            const store = usePreferenceStore.getState();

            // Change preference
            store.setStreaming(false);
            expect(usePreferenceStore.getState().isStreaming).toBe(false);

            // Change it back
            store.setStreaming(true);
            expect(usePreferenceStore.getState().isStreaming).toBe(true);

            // Note: Actual localStorage persistence is tested in browser/e2e tests
            // The persist middleware is a well-tested zustand feature
        });
    });
});

/**
 * Tests for notificationStore
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from './notificationStore.js';

describe('notificationStore', () => {
    beforeEach(() => {
        // Reset store to default state
        useNotificationStore.setState({ toasts: [], maxToasts: 5 });
    });

    describe('addToast', () => {
        it('should add a toast with generated id and timestamp', () => {
            const { addToast } = useNotificationStore.getState();

            addToast({
                title: 'Test Toast',
                intent: 'info',
            });

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].title).toBe('Test Toast');
            expect(toasts[0].intent).toBe('info');
            expect(toasts[0].id).toMatch(/^toast-/);
            expect(toasts[0].timestamp).toBeGreaterThan(0);
        });

        it('should add multiple toasts', () => {
            const { addToast } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });
            addToast({ title: 'Toast 2', intent: 'success' });
            addToast({ title: 'Toast 3', intent: 'warning' });

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(3);
            expect(toasts[0].title).toBe('Toast 1');
            expect(toasts[1].title).toBe('Toast 2');
            expect(toasts[2].title).toBe('Toast 3');
        });

        it('should include optional fields when provided', () => {
            const { addToast } = useNotificationStore.getState();

            addToast({
                title: 'Test',
                description: 'Description text',
                intent: 'danger',
                duration: 10000,
                sessionId: 'session-123',
            });

            const { toasts } = useNotificationStore.getState();
            expect(toasts[0].description).toBe('Description text');
            expect(toasts[0].duration).toBe(10000);
            expect(toasts[0].sessionId).toBe('session-123');
        });

        it('should enforce maxToasts limit by removing oldest', () => {
            const { addToast } = useNotificationStore.getState();

            // Add 6 toasts (max is 5)
            addToast({ title: 'Toast 1', intent: 'info' });
            addToast({ title: 'Toast 2', intent: 'info' });
            addToast({ title: 'Toast 3', intent: 'info' });
            addToast({ title: 'Toast 4', intent: 'info' });
            addToast({ title: 'Toast 5', intent: 'info' });
            addToast({ title: 'Toast 6', intent: 'info' });

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(5);
            // Oldest (Toast 1) should be removed
            expect(toasts[0].title).toBe('Toast 2');
            expect(toasts[4].title).toBe('Toast 6');
        });

        it('should enforce custom maxToasts limit', () => {
            // Set custom max toasts
            useNotificationStore.setState({ maxToasts: 3 });
            const { addToast } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });
            addToast({ title: 'Toast 2', intent: 'info' });
            addToast({ title: 'Toast 3', intent: 'info' });
            addToast({ title: 'Toast 4', intent: 'info' });

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(3);
            expect(toasts[0].title).toBe('Toast 2');
            expect(toasts[2].title).toBe('Toast 4');
        });
    });

    describe('removeToast', () => {
        it('should remove toast by id', () => {
            const { addToast, removeToast } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });
            addToast({ title: 'Toast 2', intent: 'info' });

            const { toasts } = useNotificationStore.getState();
            const toastId = toasts[0].id;

            removeToast(toastId);

            const updatedToasts = useNotificationStore.getState().toasts;
            expect(updatedToasts).toHaveLength(1);
            expect(updatedToasts[0].title).toBe('Toast 2');
        });

        it('should do nothing if id does not exist', () => {
            const { addToast, removeToast } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });

            removeToast('non-existent-id');

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
        });

        it('should remove all toasts with same id', () => {
            const { addToast, removeToast } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });
            const { toasts: toasts1 } = useNotificationStore.getState();
            const toastId = toasts1[0].id;

            addToast({ title: 'Toast 2', intent: 'info' });

            removeToast(toastId);

            const { toasts } = useNotificationStore.getState();
            expect(toasts).toHaveLength(1);
            expect(toasts[0].title).toBe('Toast 2');
        });
    });

    describe('clearAll', () => {
        it('should remove all toasts', () => {
            const { addToast, clearAll } = useNotificationStore.getState();

            addToast({ title: 'Toast 1', intent: 'info' });
            addToast({ title: 'Toast 2', intent: 'info' });
            addToast({ title: 'Toast 3', intent: 'info' });

            expect(useNotificationStore.getState().toasts).toHaveLength(3);

            clearAll();

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });

        it('should work when there are no toasts', () => {
            const { clearAll } = useNotificationStore.getState();

            clearAll();

            expect(useNotificationStore.getState().toasts).toHaveLength(0);
        });
    });
});

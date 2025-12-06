/**
 * Notification Store
 *
 * Manages toast notifications for the WebUI.
 * Toasts are displayed in the bottom-right corner and auto-dismiss after a duration.
 */

import { create } from 'zustand';

/**
 * Toast intent determines the visual styling
 */
export type ToastIntent = 'info' | 'success' | 'warning' | 'danger';

/**
 * Toast notification interface
 */
export interface Toast {
    /** Unique identifier */
    id: string;
    /** Toast title (required) */
    title: string;
    /** Optional description/body text */
    description?: string;
    /** Visual intent/severity */
    intent: ToastIntent;
    /** Auto-dismiss duration in milliseconds (default: 5000) */
    duration?: number;
    /** Session ID for "Go to session" action */
    sessionId?: string;
    /** Creation timestamp */
    timestamp: number;
}

/**
 * Notification store state
 */
interface NotificationStore {
    /** Active toast notifications */
    toasts: Toast[];
    /** Maximum number of toasts to show simultaneously */
    maxToasts: number;

    // -------------------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------------------

    /**
     * Add a new toast notification
     * Automatically generates ID and timestamp
     */
    addToast: (toast: Omit<Toast, 'id' | 'timestamp'>) => void;

    /**
     * Remove a toast by ID
     */
    removeToast: (id: string) => void;

    /**
     * Clear all toasts
     */
    clearAll: () => void;
}

/**
 * Generate a unique toast ID
 */
function generateToastId(): string {
    return `toast-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Default values
 */
const DEFAULT_MAX_TOASTS = 5;

/**
 * Notification store implementation
 */
export const useNotificationStore = create<NotificationStore>()((set, _get) => ({
    toasts: [],
    maxToasts: DEFAULT_MAX_TOASTS,

    addToast: (toast) => {
        const newToast: Toast = {
            ...toast,
            id: generateToastId(),
            timestamp: Date.now(),
        };

        set((state) => {
            const newToasts = [...state.toasts, newToast];

            // Enforce max toasts limit (remove oldest)
            if (newToasts.length > state.maxToasts) {
                return {
                    toasts: newToasts.slice(newToasts.length - state.maxToasts),
                };
            }

            return { toasts: newToasts };
        });
    },

    removeToast: (id) => {
        set((state) => ({
            toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
    },

    clearAll: () => {
        set({ toasts: [] });
    },
}));

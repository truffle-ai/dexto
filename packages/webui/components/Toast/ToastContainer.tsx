/**
 * Toast Container
 *
 * Displays toast notifications in the bottom-right corner.
 * Handles auto-dismiss, manual dismiss, and "Go to session" actions.
 */

'use client';

import { useEffect, useCallback } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useNotificationStore, type Toast } from '@/lib/stores/notificationStore';
import { useSessionStore } from '@/lib/stores/sessionStore';
import { X, AlertTriangle, CheckCircle2, Info, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Intent color mappings
 */
const intentStyles = {
    info: {
        bg: 'bg-blue-50 dark:bg-blue-950/50',
        border: 'border-blue-200 dark:border-blue-800',
        icon: 'text-blue-600 dark:text-blue-400',
        iconComponent: Info,
    },
    success: {
        bg: 'bg-green-50 dark:bg-green-950/50',
        border: 'border-green-200 dark:border-green-800',
        icon: 'text-green-600 dark:text-green-400',
        iconComponent: CheckCircle2,
    },
    warning: {
        bg: 'bg-yellow-50 dark:bg-yellow-950/50',
        border: 'border-yellow-200 dark:border-yellow-800',
        icon: 'text-yellow-600 dark:text-yellow-400',
        iconComponent: AlertTriangle,
    },
    danger: {
        bg: 'bg-red-50 dark:bg-red-950/50',
        border: 'border-red-200 dark:border-red-800',
        icon: 'text-red-600 dark:text-red-400',
        iconComponent: AlertCircle,
    },
};

/**
 * Individual toast item component
 */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    const navigate = useNavigate();
    const { setCurrentSession } = useSessionStore();

    // Auto-dismiss after duration
    useEffect(() => {
        const duration = toast.duration || 5000;
        const timer = setTimeout(onDismiss, duration);
        return () => clearTimeout(timer);
    }, [toast.duration, onDismiss]);

    // Navigate to session
    const handleGoToSession = useCallback(() => {
        if (toast.sessionId) {
            setCurrentSession(toast.sessionId);
            navigate({ to: '/' });
            onDismiss();
        }
    }, [toast.sessionId, setCurrentSession, navigate, onDismiss]);

    const styles = intentStyles[toast.intent];
    const IconComponent = styles.iconComponent;

    return (
        <div
            className={cn(
                'flex items-start gap-3 p-4 rounded-lg border shadow-lg',
                'min-w-[320px] max-w-[420px]',
                'animate-in slide-in-from-right-full duration-300',
                styles.bg,
                styles.border
            )}
            role="alert"
            aria-live="polite"
        >
            {/* Icon */}
            <IconComponent className={cn('w-5 h-5 flex-shrink-0 mt-0.5', styles.icon)} />

            {/* Content */}
            <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {toast.title}
                </div>
                {toast.description && (
                    <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                        {toast.description}
                    </div>
                )}
                {toast.sessionId && (
                    <button
                        onClick={handleGoToSession}
                        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline mt-2"
                    >
                        Go to session
                    </button>
                )}
            </div>

            {/* Dismiss button */}
            <button
                onClick={onDismiss}
                className="flex-shrink-0 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                aria-label="Dismiss notification"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}

/**
 * Toast container component
 *
 * Renders all active toasts in a fixed bottom-right position.
 */
export function ToastContainer() {
    const { toasts, removeToast } = useNotificationStore();

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div
            className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
            aria-label="Notifications"
        >
            {toasts.map((toast) => (
                <div key={toast.id} className="pointer-events-auto">
                    <ToastItem toast={toast} onDismiss={() => removeToast(toast.id)} />
                </div>
            ))}
        </div>
    );
}

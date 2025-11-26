'use client';

// packages/webui/lib/analytics/provider.tsx
// React Context Provider for WebUI analytics using PostHog JS SDK.

import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import posthog from 'posthog-js';
import type {
    WebUIAnalyticsEventName,
    WebUIAnalyticsEventPayload,
    BaseEventContext,
} from './events.js';

interface AnalyticsConfig {
    distinctId: string;
    posthogKey: string;
    posthogHost: string;
    appVersion: string;
}

interface AnalyticsContextType {
    capture: <Name extends WebUIAnalyticsEventName>(
        event: Name,
        properties?: WebUIAnalyticsEventPayload<Name>
    ) => void;
    enabled: boolean;
    isReady: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

interface AnalyticsProviderProps {
    children: ReactNode;
}

/**
 * Get analytics config injected during app initialization.
 * Returns null if analytics disabled or config not available.
 */
function getAnalyticsConfig(): AnalyticsConfig | null {
    if (typeof window === 'undefined') return null;
    return (window as any).__DEXTO_ANALYTICS__ ?? null;
}

/**
 * Get base context properties included with every event.
 */
function getBaseContext(): BaseEventContext {
    if (typeof window === 'undefined') {
        return {
            app: 'dexto-webui',
        };
    }

    return {
        app: 'dexto-webui',
        app_version: getAnalyticsConfig()?.appVersion ?? 'unknown',
        browser: navigator.userAgent.split(' ').pop()?.split('/')[0],
        browser_version: navigator.userAgent.split(' ').pop()?.split('/')[1],
        os: navigator.platform,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        // session_id will be managed by PostHog automatically
    };
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
    const [enabled, setEnabled] = useState(false);
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        const config = getAnalyticsConfig();

        if (!config) {
            // Analytics disabled or config not available
            setEnabled(false);
            setIsReady(true);
            return;
        }

        try {
            // Initialize PostHog
            posthog.init(config.posthogKey, {
                api_host: config.posthogHost,
                person_profiles: 'identified_only', // Only create profiles for identified users
                loaded: (posthogInstance) => {
                    // Use the distinct ID from CLI (unified tracking)
                    posthogInstance.identify(config.distinctId);
                    setEnabled(true);
                    setIsReady(true);
                },
                autocapture: false, // Disable automatic event capture
                capture_pageview: false, // We'll manually track page views for better control
                disable_session_recording: true, // Disable session replay (privacy)
                disable_surveys: true, // Disable surveys
                opt_out_capturing_by_default: false,
            });
        } catch (error) {
            console.error('Failed to initialize analytics:', error);
            setEnabled(false);
            setIsReady(true);
        }

        // Cleanup on unmount - always reset to clear identity
        return () => {
            try {
                posthog.reset(); // Always clear identity on unmount
            } catch {
                // Ignore errors if PostHog wasn't initialized
            }
        };
    }, []); // Run once on mount

    const capture = <Name extends WebUIAnalyticsEventName>(
        event: Name,
        properties?: WebUIAnalyticsEventPayload<Name>
    ) => {
        if (!enabled || !isReady) return;

        try {
            posthog.capture(event, {
                ...getBaseContext(),
                ...properties,
            });
        } catch (error) {
            console.error('Failed to capture analytics event:', error);
        }
    };

    return (
        <AnalyticsContext.Provider value={{ capture, enabled, isReady }}>
            {children}
        </AnalyticsContext.Provider>
    );
}

/**
 * Hook to access analytics from any component.
 * Must be used within an AnalyticsProvider.
 */
export function useAnalyticsContext(): AnalyticsContextType {
    const context = useContext(AnalyticsContext);
    if (!context) {
        throw new Error('useAnalyticsContext must be used within an AnalyticsProvider');
    }
    return context;
}

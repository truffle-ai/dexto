/**
 * SoundContext - Provides sound notification service to components
 *
 * Initialized at CLI startup based on user preferences.
 * Components can use useSoundService() to access the service.
 */

import React, { createContext, useContext, type ReactNode } from 'react';
import type { SoundNotificationService } from '../utils/soundNotification.js';

const SoundContext = createContext<SoundNotificationService | null>(null);

interface SoundProviderProps {
    soundService: SoundNotificationService | null;
    children: ReactNode;
}

/**
 * Provider component for sound notification service
 */
export function SoundProvider({ soundService, children }: SoundProviderProps) {
    return <SoundContext.Provider value={soundService}>{children}</SoundContext.Provider>;
}

/**
 * Hook to access the sound notification service
 * Returns null if sounds are not configured
 */
export function useSoundService(): SoundNotificationService | null {
    return useContext(SoundContext);
}

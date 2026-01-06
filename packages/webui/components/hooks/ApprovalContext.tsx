/**
 * Approval Context
 *
 * Provides approval handling functionality via React Context.
 * Wraps the approvalStore to provide a clean API for components.
 */

import { createContext, useContext, useCallback, type ReactNode } from 'react';
import { useApprovalStore } from '@/lib/stores/approvalStore';
import type { ApprovalRequest } from '@dexto/core';

// =============================================================================
// Types
// =============================================================================

interface ApprovalContextType {
    /**
     * Handle an incoming approval request (add to store)
     */
    handleApprovalRequest: (request: ApprovalRequest) => void;
}

// =============================================================================
// Context
// =============================================================================

const ApprovalContext = createContext<ApprovalContextType | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface ApprovalProviderProps {
    children: ReactNode;
}

export function ApprovalProvider({ children }: ApprovalProviderProps) {
    const addApproval = useApprovalStore((s) => s.addApproval);

    const handleApprovalRequest = useCallback(
        (request: ApprovalRequest) => {
            addApproval(request);
        },
        [addApproval]
    );

    return (
        <ApprovalContext.Provider value={{ handleApprovalRequest }}>
            {children}
        </ApprovalContext.Provider>
    );
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Hook to access approval handling functions
 *
 * @throws Error if used outside ApprovalProvider
 */
export function useApproval(): ApprovalContextType {
    const context = useContext(ApprovalContext);

    if (!context) {
        throw new Error('useApproval must be used within an ApprovalProvider');
    }

    return context;
}

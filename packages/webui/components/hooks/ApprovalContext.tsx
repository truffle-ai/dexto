import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
// Import approval types directly from core to preserve discriminated union narrowing
// (Omit<> breaks discriminated union type narrowing in TypeScript)
import type { ApprovalRequest, ApprovalResponse } from '@dexto/core';

// Re-export for consumers
export type { ApprovalRequest, ApprovalResponse };

interface ApprovalContextType {
    pendingApproval: ApprovalRequest | null;
    handleApprovalRequest: (request: ApprovalRequest) => void;
    handleApprovalResponse: (response: ApprovalResponse) => void;
    clearApproval: () => void;
}

const ApprovalContext = createContext<ApprovalContextType | undefined>(undefined);

export function ApprovalProvider({ children }: { children: ReactNode }) {
    const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | null>(null);
    const [queue, setQueue] = useState<ApprovalRequest[]>([]);

    const processNextInQueue = useCallback(() => {
        setQueue((prevQueue) => {
            if (prevQueue.length > 0) {
                const [next, ...rest] = prevQueue;
                // Use setTimeout to avoid state update during render
                setTimeout(() => setPendingApproval(next), 0);
                return rest;
            }
            return prevQueue;
        });
    }, []);

    const handleApprovalRequest = useCallback((request: ApprovalRequest) => {
        setPendingApproval((current) => {
            if (current) {
                // Queue the request if one is already pending
                setQueue((prev) => [...prev, request]);
                return current;
            }
            return request;
        });
    }, []);

    const handleApprovalResponse = useCallback(
        (response: ApprovalResponse) => {
            setPendingApproval((current) => {
                if (current?.approvalId === response.approvalId) {
                    // Clear pending approval for any terminal status
                    if (
                        response.status === 'approved' ||
                        response.status === 'denied' ||
                        response.status === 'cancelled'
                    ) {
                        if (response.status === 'cancelled') {
                            console.debug(
                                `[ApprovalContext] Approval ${response.approvalId} cancelled: ${response.reason}`
                            );
                        }
                        processNextInQueue();
                        return null;
                    }
                }
                return current;
            });
        },
        [processNextInQueue]
    );

    const clearApproval = useCallback(() => {
        setPendingApproval(null);
        processNextInQueue();
    }, [processNextInQueue]);

    return (
        <ApprovalContext.Provider
            value={{
                pendingApproval,
                handleApprovalRequest,
                handleApprovalResponse,
                clearApproval,
            }}
        >
            {children}
        </ApprovalContext.Provider>
    );
}

export function useApproval() {
    const context = useContext(ApprovalContext);
    if (!context) {
        throw new Error('useApproval must be used within ApprovalProvider');
    }
    return context;
}

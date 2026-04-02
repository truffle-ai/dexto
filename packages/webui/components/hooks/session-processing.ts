export function mergeSessionProcessingState(
    historyIsBusy: boolean,
    currentProcessing: boolean
): boolean {
    return historyIsBusy || currentProcessing;
}

export type RestoredSessionActivityStatus = 'idle' | 'thinking' | 'awaiting_approval';

export function resolveRestoredSessionActivity(params: {
    isBusy: boolean;
    hasPendingApprovals: boolean;
}): {
    processing: boolean;
    status: RestoredSessionActivityStatus;
} {
    if (params.hasPendingApprovals) {
        return {
            processing: true,
            status: 'awaiting_approval',
        };
    }

    if (params.isBusy) {
        return {
            processing: true,
            status: 'thinking',
        };
    }

    return {
        processing: false,
        status: 'idle',
    };
}

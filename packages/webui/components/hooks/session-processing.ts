export function mergeSessionProcessingState(
    historyIsBusy: boolean,
    currentProcessing: boolean
): boolean {
    return historyIsBusy || currentProcessing;
}

export type ComposerSubmitIntent = 'send' | 'steer' | 'follow-up';

export function resolveComposerSubmitIntent({
    processing,
    queueFollowUpShortcut,
}: {
    processing: boolean;
    queueFollowUpShortcut: boolean;
}): ComposerSubmitIntent {
    if (!processing) return 'send';
    if (queueFollowUpShortcut) return 'follow-up';
    return 'steer';
}

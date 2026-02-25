import type { OverlayType } from '../state/types.js';
import type { ApprovalRequest } from '../components/ApprovalPrompt.js';

export type OverlayPresentation = 'none' | 'inline' | 'focus';

const INLINE_OVERLAYS: ReadonlySet<OverlayType> = new Set([
    'slash-autocomplete',
    'resource-autocomplete',
]);

/**
 * Determine how an overlay/approval should be presented in the CLI.
 *
 * - `inline`: small overlays that keep the main input visible (e.g. autocomplete)
 * - `focus`: overlays/approvals that should take focus and hide UI chrome (input + footer)
 */
export function getOverlayPresentation(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): OverlayPresentation {
    if (approval) return 'focus';

    if (activeOverlay === 'none') return 'none';
    if (INLINE_OVERLAYS.has(activeOverlay)) return 'inline';
    return 'focus';
}

export function shouldHideCliChrome(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): boolean {
    return getOverlayPresentation(activeOverlay, approval) === 'focus';
}

/**
 * Hide "always-on" chrome (status bar, panels, footer) whenever any overlay is visible.
 *
 * This keeps inline overlays (like slash/resource autocomplete) from competing for scarce
 * terminal rows, and reduces flicker by keeping the total rendered height stable.
 */
export function shouldHideStatusChrome(
    activeOverlay: OverlayType,
    approval: ApprovalRequest | null
): boolean {
    if (approval) return true;
    return activeOverlay !== 'none';
}

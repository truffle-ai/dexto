/**
 * Consistent prompt helpers for CLI flows.
 *
 * Two patterns:
 * 1. "OrExit" functions - for linear flows where cancel = exit
 * 2. "WithBack" functions + PromptResult - for wizard flows where cancel = go back
 */

import * as p from '@clack/prompts';
import chalk from 'chalk';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Result type for wizard flows.
 * Forces callers to handle all cases - TypeScript won't let you access .value
 * without checking .ok first.
 */
export type PromptResult<T> = { ok: true; value: T } | { ok: false; reason: 'back' | 'cancelled' };

/**
 * Type guard to check if prompt succeeded.
 * Use this before accessing .value
 */
export function isSuccess<T>(result: PromptResult<T>): result is { ok: true; value: T } {
    return result.ok;
}

/**
 * Standard back option to append to select menus
 */
export const BACK_OPTION = {
    value: '_back' as const,
    label: chalk.gray('← Back'),
    hint: 'Return to previous step',
};

// =============================================================================
// LINEAR FLOW HELPERS (cancel = exit)
// =============================================================================

type SelectOptions = Parameters<typeof p.select>[0];
type TextOptions = Parameters<typeof p.text>[0];
type ConfirmOptions = Parameters<typeof p.confirm>[0];

/**
 * Select prompt that exits on cancel.
 * Use for linear flows where cancel should abort the entire operation.
 */
export async function selectOrExit<T extends string>(
    options: SelectOptions,
    cancelMessage = 'Cancelled'
): Promise<T> {
    const result = await p.select(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result as T;
}

/**
 * Text prompt that exits on cancel.
 * Use for linear flows where cancel should abort the entire operation.
 */
export async function textOrExit(
    options: TextOptions,
    cancelMessage = 'Cancelled'
): Promise<string> {
    const result = await p.text(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result;
}

/**
 * Confirm prompt that exits on cancel.
 * Use for linear flows where cancel should abort the entire operation.
 */
export async function confirmOrExit(
    options: ConfirmOptions,
    cancelMessage = 'Cancelled'
): Promise<boolean> {
    const result = await p.confirm(options);
    if (p.isCancel(result)) {
        p.cancel(cancelMessage);
        process.exit(0);
    }
    return result;
}

// =============================================================================
// WIZARD FLOW HELPERS (cancel = back, explicit back option)
// =============================================================================

/**
 * Select prompt with back option for wizard flows.
 * Returns PromptResult which forces caller to handle back/cancel cases.
 *
 * @param options - Standard p.select options (back option is added automatically)
 * @param backHint - Custom hint for the back option
 */
export async function selectWithBack<T extends string>(
    options: SelectOptions,
    backHint = 'Return to previous step'
): Promise<PromptResult<T>> {
    const result = await p.select({
        ...options,
        options: [
            ...(options.options as Array<{ value: string; label: string; hint?: string }>),
            { value: '_back' as const, label: chalk.gray('← Back'), hint: backHint },
        ],
    });

    if (p.isCancel(result)) {
        return { ok: false, reason: 'cancelled' };
    }

    if (result === '_back') {
        return { ok: false, reason: 'back' };
    }

    return { ok: true, value: result as T };
}

/**
 * Text prompt for wizard flows.
 * Cancel is treated as "back" since there's no explicit back option for text inputs.
 * Shows a hint about using Ctrl+C to go back.
 */
export async function textWithBack(options: TextOptions): Promise<PromptResult<string>> {
    p.log.info(chalk.gray('Press Ctrl+C to go back'));

    const result = await p.text(options);

    if (p.isCancel(result)) {
        return { ok: false, reason: 'back' };
    }

    return { ok: true, value: result };
}

/**
 * Confirm prompt for wizard flows.
 * Cancel is treated as "back".
 */
export async function confirmWithBack(options: ConfirmOptions): Promise<PromptResult<boolean>> {
    const result = await p.confirm(options);

    if (p.isCancel(result)) {
        return { ok: false, reason: 'back' };
    }

    return { ok: true, value: result };
}

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/**
 * Handle a non-success PromptResult in wizard context.
 * - 'cancelled' exits the process
 * - 'back' returns the provided fallback (typically previous state)
 *
 * @example
 * const result = await selectWithBack(...);
 * if (!isSuccess(result)) {
 *   return handleWizardBack(result, { ...state, step: 'previous' });
 * }
 */
export function handleWizardBack<T>(
    result: { ok: false; reason: 'back' | 'cancelled' },
    backState: T
): T | never {
    if (result.reason === 'cancelled') {
        p.cancel('Setup cancelled');
        process.exit(0);
    }
    return backState;
}

/**
 * Handle a non-success PromptResult in settings menu context.
 * Both 'cancelled' and 'back' return to the menu (no exit).
 */
export function handleMenuBack<T>(
    _result: { ok: false; reason: 'back' | 'cancelled' },
    message = 'Cancelled'
): void {
    p.log.warn(message);
}

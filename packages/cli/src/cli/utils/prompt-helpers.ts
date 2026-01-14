/**
 * Consistent prompt helpers for CLI flows.
 *
 * These helpers wrap @clack/prompts with automatic cancel handling.
 * Use for linear flows where cancel should exit the process.
 */

import * as p from '@clack/prompts';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type SelectOptions = Parameters<typeof p.select>[0];
type TextOptions = Parameters<typeof p.text>[0];
type ConfirmOptions = Parameters<typeof p.confirm>[0];

// =============================================================================
// LINEAR FLOW HELPERS (cancel = exit)
// =============================================================================

/**
 * Select prompt that exits on cancel.
 * Use for linear flows where cancel should abort the entire operation.
 *
 * @example
 * const choice = await selectOrExit<'a' | 'b'>({
 *   message: 'Pick one',
 *   options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
 * }, 'Operation cancelled');
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
 *
 * @example
 * const name = await textOrExit({
 *   message: 'Enter your name',
 *   placeholder: 'John Doe'
 * }, 'Operation cancelled');
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
 *
 * Note: This only exits on cancel (Ctrl+C), not when user selects "No".
 * For "must confirm or abort" behavior, check the return value separately.
 *
 * @example
 * const confirmed = await confirmOrExit({
 *   message: 'Are you sure?'
 * }, 'Operation cancelled');
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

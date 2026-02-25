/**
 * Bracketed Paste Mode utilities
 *
 * Bracketed paste mode tells the terminal to wrap pasted text with escape sequences:
 * - Start: \x1b[200~
 * - End: \x1b[201~
 *
 * This allows the application to distinguish between typed and pasted text,
 * which is essential for handling multi-line pastes correctly (e.g., not
 * treating newlines in pasted text as submit commands).
 */

const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';

/**
 * Enable bracketed paste mode
 * Call this when starting the CLI to ensure paste detection works
 */
export function enableBracketedPaste(): void {
    process.stdout.write(ENABLE_BRACKETED_PASTE);
}

/**
 * Disable bracketed paste mode
 * Call this when exiting the CLI to restore normal terminal behavior
 */
export function disableBracketedPaste(): void {
    process.stdout.write(DISABLE_BRACKETED_PASTE);
}

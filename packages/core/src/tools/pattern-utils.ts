/**
 * Pattern utilities used by tool approvals.
 *
 * Pattern-based approvals allow storing broader patterns (e.g. "git *") that cover
 * narrower pattern keys (e.g. "git push *").
 */

/**
 * Check if a stored pattern covers a target pattern key.
 *
 * Pattern A covers pattern B if:
 * 1) A === B (exact match), OR
 * 2) B's base starts with A's base + " " (broader pattern covers narrower)
 *
 * Examples:
 * - `git *` covers `git push *`
 * - `docker compose *` covers `docker compose up *`
 * - `npm *` does NOT cover `npx *`
 */
export function patternCovers(storedPattern: string, targetPatternKey: string): boolean {
    if (storedPattern === targetPatternKey) return true;

    const storedBase = storedPattern.endsWith(' *') ? storedPattern.slice(0, -2) : storedPattern;
    const targetBase = targetPatternKey.endsWith(' *')
        ? targetPatternKey.slice(0, -2)
        : targetPatternKey;

    return targetBase.startsWith(storedBase + ' ');
}

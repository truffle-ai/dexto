export interface ListViewportSizingOptions {
    /** Total terminal rows. */
    rows: number;
    /** Maximum number of rows/items to ever render for the list. */
    hardCap: number;
    /**
     * Rows to keep free for surrounding UI/chrome.
     * Claude Code commonly uses ~6 rows of slack to avoid Ink hitting the clear+redraw path.
     */
    reservedRows?: number;
    /** Minimum rows/items to render when possible. */
    minVisibleItems?: number;
}

/**
 * Compute a safe "max visible items" count for list UIs so we don't render content that
 * approaches/exceeds the terminal height (which can cause Ink to clear + redraw, i.e. flicker).
 */
export function getMaxVisibleItemsForTerminalRows({
    rows,
    hardCap,
    reservedRows = 6,
    minVisibleItems = 1,
}: ListViewportSizingOptions): number {
    const available = Math.max(0, rows - reservedRows);
    if (available <= 0) {
        return 1;
    }

    return Math.max(minVisibleItems, Math.min(hardCap, available));
}

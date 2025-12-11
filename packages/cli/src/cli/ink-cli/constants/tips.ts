/**
 * Informative tips for the status bar
 * These are shown during processing to teach users about features
 *
 * Categories:
 * - Command tips
 * - Keyboard shortcut tips
 * - Feature tips
 */

export const tips: string[] = [
    // Command tips
    'Type /help to see all available commands...',
    'Use /model to switch between different AI models...',
    'Use /resume to continue a previous conversation...',
    'Use /search to find messages across all sessions...',
    'Use /mcp to manage MCP servers and tools...',
    'Use /mcp add to connect new MCP servers...',
    'Use /tools to see all available tools...',
    'Use /prompt to manage custom prompts...',
    'Use /log to change logging verbosity...',
    'Use /session to manage your conversations...',
    'Use /clear to clear the screen...',
    'Use /exit or /quit to close dexto...',
    'Use /docs to access documentation...',

    // Keyboard shortcut tips
    'Press Escape to cancel the current request...',
    'Press Ctrl+C twice to exit dexto...',
    'Press Escape to close overlays and menus...',
    'Use Up/Down arrows to navigate command history...',
    'Press Enter to submit your message...',

    // Feature tips
    'Paste copied images with Ctrl+V...',
    'Large pastes are automatically collapsed - press Ctrl+T to toggle...',
    'Use @ to reference files and resources...',
    'Type / to see available slash commands...',
    'MCP servers extend dexto with custom tools...',
    'Sessions are automatically saved for later...',

    // Platform tips
    'On Mac, use Option+Up/Down to jump to start/end of input...',
];

/**
 * Get a random tip from the list
 */
export function getRandomTip(): string {
    const index = Math.floor(Math.random() * tips.length);
    return tips[index] ?? 'Type /help to see available commands...';
}

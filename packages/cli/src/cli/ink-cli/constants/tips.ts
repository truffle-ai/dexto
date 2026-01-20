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
    'Type /help to see all available commands…',
    'Use /model to switch between different AI models…',
    'Use /resume to load a previous conversation…',
    'Use /search to find messages across all sessions…',
    'Use /mcp to manage MCP servers…',
    'Use /tools to see all available tools…',
    'Use /prompts to browse, add and delete custom prompts…',
    'Use /log to change logging verbosity…',
    'Use /clear to clear the session context…',
    'Use /exit or /quit to close dexto…',
    'Use /docs to access documentation…',
    'Use /copy to copy the previous response…',
    'Use /shortcuts to see all available shortcuts…',
    'Use /sysprompt to see the current system prompt…',
    'Use /context to see the current token usage…',
    'Use /compact to summarize the current session…',

    // Keyboard shortcut tips
    'Press Escape to cancel the current request…',
    'Press Ctrl+C twice to exit dexto…',
    'Press Escape to close overlays and menus…',
    'Use Up/Down arrows to navigate command history…',
    'Press Enter to submit your message…',
    'Press Ctrl+T to collapse/expand large pastes…',
    'Press Ctrl+R to search previous prompts…',
    'Press Shift+Enter to insert a new line…',

    // Feature tips
    'Start with ! to run bash commands directly…',
    'Paste copied images with Ctrl+V…',
    'Large pastes are automatically collapsed - press Ctrl+T to toggle…',
    'Use @ to reference files and resources…',
    'Type / to see available slash commands…',
    'MCP servers extend dexto with custom tools…',
    'Sessions are automatically saved for later…',
    'You can create custom commands with /prompts…',
    'You can submit messages while Dexto is processing…',
    'Use /stream to toggle streaming mode…',

    // Platform tips
    'On Mac, use Option+Up/Down to jump to start/end of input…',
];

/**
 * Get a random tip from the list
 */
export function getRandomTip(): string {
    const index = Math.floor(Math.random() * tips.length);
    return tips[index] ?? 'Type /help to see available commands…';
}

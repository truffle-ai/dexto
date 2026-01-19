/**
 * Command Prompt Discovery
 *
 * Discovers command prompts from commands/ directories based on execution context.
 * Extracted to separate file to enable proper unit testing with mocks.
 */

import {
    getExecutionContext,
    findDextoSourceRoot,
    findDextoProjectRoot,
} from '../utils/execution-context.js';
import { getDextoGlobalPath } from '../utils/path.js';
import * as path from 'path';
import { existsSync, readdirSync } from 'fs';

/**
 * File prompt entry for discovered commands
 */
export interface FilePromptEntry {
    type: 'file';
    file: string;
    showInStarters?: boolean;
}

/**
 * Discovers command prompts from commands/ directories.
 *
 * Discovery locations (in priority order):
 *
 * Local commands (project-specific):
 * 1. <projectRoot>/commands/ (dexto-source dev mode or dexto-project only)
 * 2. <cwd>/.dexto/commands/
 * 3. <cwd>/.claude/commands/ (Claude Code compatibility)
 * 4. <cwd>/.cursor/commands/ (Cursor compatibility)
 *
 * Global commands (user-wide):
 * 5. ~/.dexto/commands/
 * 6. ~/.claude/commands/ (Claude Code compatibility)
 * 7. ~/.cursor/commands/ (Cursor compatibility)
 *
 * Files with the same basename are deduplicated (first found wins).
 *
 * @returns Array of file prompt entries for discovered .md files
 */
export function discoverCommandPrompts(): FilePromptEntry[] {
    const prompts: FilePromptEntry[] = [];
    const seenFiles = new Set<string>();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cwd = process.cwd();

    // Helper to scan a directory and add unique files
    const scanAndAdd = (dir: string): void => {
        if (!existsSync(dir)) return;
        const files = scanCommandsDirectory(dir);
        for (const file of files) {
            // Normalize to lowercase for case-insensitive deduplication (Windows/macOS)
            const basename = path.basename(file).toLowerCase();
            if (!seenFiles.has(basename)) {
                seenFiles.add(basename);
                prompts.push({ type: 'file', file });
            }
        }
    };

    // Determine local commands/ directory based on context (dexto-native projects only)
    const context = getExecutionContext();
    let localCommandsDir: string | null = null;

    switch (context) {
        case 'dexto-source': {
            // Only use local commands in dev mode
            const isDevMode = process.env.DEXTO_DEV_MODE === 'true';
            if (isDevMode) {
                const sourceRoot = findDextoSourceRoot();
                if (sourceRoot) {
                    localCommandsDir = path.join(sourceRoot, 'commands');
                }
            }
            break;
        }
        case 'dexto-project': {
            const projectRoot = findDextoProjectRoot();
            if (projectRoot) {
                localCommandsDir = path.join(projectRoot, 'commands');
            }
            break;
        }
        case 'global-cli':
            // No local commands/ for global CLI (but .dexto/commands etc. still apply)
            break;
    }

    // Scan in priority order (first found wins for same basename)

    // === Local commands (project-specific) ===

    // 1. Local commands/ directory (dexto-native projects only)
    if (localCommandsDir) {
        scanAndAdd(localCommandsDir);
    }

    // 2. Dexto local commands: <cwd>/.dexto/commands/
    scanAndAdd(path.join(cwd, '.dexto', 'commands'));

    // 3. Claude Code local commands: <cwd>/.claude/commands/
    scanAndAdd(path.join(cwd, '.claude', 'commands'));

    // 4. Cursor local commands: <cwd>/.cursor/commands/
    scanAndAdd(path.join(cwd, '.cursor', 'commands'));

    // === Global commands (user-wide) ===

    // 5. Dexto global commands: ~/.dexto/commands/
    scanAndAdd(getDextoGlobalPath('commands'));

    // 6. Claude Code global commands: ~/.claude/commands/
    if (homeDir) {
        scanAndAdd(path.join(homeDir, '.claude', 'commands'));
    }

    // 7. Cursor global commands: ~/.cursor/commands/
    if (homeDir) {
        scanAndAdd(path.join(homeDir, '.cursor', 'commands'));
    }

    return prompts;
}

/**
 * Scans a directory for .md command files
 * @param dir Directory to scan
 * @returns Array of absolute file paths
 */
function scanCommandsDirectory(dir: string): string[] {
    const files: string[] = [];
    try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md') {
                files.push(path.join(dir, entry.name));
            }
        }
    } catch {
        // Directory doesn't exist or can't be read - ignore
    }
    return files;
}

/**
 * Agent instruction file names to discover (in priority order, case-insensitive)
 * First found file wins - only one file is used
 *
 * Conventions:
 * - AGENTS.md: Open standard for AI coding agents (Linux Foundation/AAIF)
 * - CLAUDE.md: Anthropic's Claude Code instruction format
 * - GEMINI.md: Google's Gemini CLI instruction format
 */
const AGENT_INSTRUCTION_FILES = ['agents.md', 'claude.md', 'gemini.md'] as const;

/**
 * Discovers agent instruction files from the current working directory.
 *
 * Looks for files in this order of priority (case-insensitive):
 * 1. AGENTS.md (or agents.md, Agents.md, etc.)
 * 2. CLAUDE.md (or claude.md, Claude.md, etc.)
 * 3. GEMINI.md (or gemini.md, Gemini.md, etc.)
 *
 * Only the first found file is returned (we don't want multiple instruction files).
 *
 * @returns The absolute path to the first found instruction file, or null if none found
 */
export function discoverAgentInstructionFile(): string | null {
    const cwd = process.cwd();

    // Read directory once for case-insensitive matching
    let dirEntries: string[];
    try {
        dirEntries = readdirSync(cwd);
    } catch {
        return null;
    }

    // Build a map of lowercase filename -> actual filename for case-insensitive lookup
    const lowercaseMap = new Map<string, string>();
    for (const entry of dirEntries) {
        lowercaseMap.set(entry.toLowerCase(), entry);
    }

    // Find first matching file in priority order
    for (const filename of AGENT_INSTRUCTION_FILES) {
        const actualFilename = lowercaseMap.get(filename);
        if (actualFilename) {
            return path.join(cwd, actualFilename);
        }
    }

    return null;
}

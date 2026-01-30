import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';

/**
 * Agent instruction file names in priority order
 */
const AGENT_INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'] as const;

/**
 * Memory section header in the instruction file
 */
const MEMORY_SECTION_HEADER = '## Memory';

/**
 * Discovers the instruction file in current directory (case-sensitive priority)
 */
function findInstructionFile(): string | null {
    const cwd = process.cwd();

    for (const filename of AGENT_INSTRUCTION_FILES) {
        const filePath = path.join(cwd, filename);
        if (existsSync(filePath)) {
            return filePath;
        }
    }

    return null;
}

/**
 * Gets or creates the instruction file (AGENTS.md)
 */
function getOrCreateInstructionFile(): string {
    const existing = findInstructionFile();
    if (existing) {
        return existing;
    }

    // Create AGENTS.md
    const filePath = path.join(process.cwd(), 'AGENTS.md');
    const initialContent = `# Agent Instructions

This file contains instructions for AI coding agents working on this project.

${MEMORY_SECTION_HEADER}

`;
    writeFileSync(filePath, initialContent, 'utf-8');
    return filePath;
}

/**
 * Parse memory entries from file content
 */
function parseMemoryEntries(content: string): string[] {
    const lines = content.split('\n');
    const entries: string[] = [];
    let inMemorySection = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Check for memory section header
        if (trimmed === MEMORY_SECTION_HEADER) {
            inMemorySection = true;
            continue;
        }

        // Check for next section (any ## header)
        if (inMemorySection && trimmed.startsWith('##')) {
            break;
        }

        // Collect bullet points in memory section
        if (inMemorySection && trimmed.startsWith('-')) {
            const entry = trimmed.slice(1).trim();
            if (entry) {
                entries.push(entry);
            }
        }
    }

    return entries;
}

/**
 * Add a memory entry to the instruction file
 */
export function addMemoryEntry(content: string): {
    success: boolean;
    filePath: string;
    error?: string;
} {
    try {
        if (!content || content.trim() === '') {
            return {
                success: false,
                filePath: '',
                error: 'Content cannot be empty',
            };
        }

        const filePath = getOrCreateInstructionFile();
        let fileContent = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '';

        // Check if memory section exists
        if (!fileContent.includes(MEMORY_SECTION_HEADER)) {
            // Add memory section at the end
            if (!fileContent.endsWith('\n\n')) {
                fileContent += fileContent.endsWith('\n') ? '\n' : '\n\n';
            }
            fileContent += `${MEMORY_SECTION_HEADER}\n\n`;
        }

        // Find the memory section and add the entry
        const lines = fileContent.split('\n');
        const newLines: string[] = [];
        let inMemorySection = false;
        let memorySectionEnd = -1;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            const trimmed = line.trim();

            if (trimmed === MEMORY_SECTION_HEADER) {
                inMemorySection = true;
                newLines.push(line);
                continue;
            }

            // Track where memory section ends
            if (inMemorySection && trimmed.startsWith('##')) {
                inMemorySection = false;
                memorySectionEnd = i;
            }

            newLines.push(line);
        }

        // Add the new entry
        const newEntry = `- ${content.trim()}`;

        if (memorySectionEnd !== -1) {
            // Insert before next section
            newLines.splice(memorySectionEnd, 0, newEntry);
        } else {
            // Add at the end
            newLines.push(newEntry);
        }

        writeFileSync(filePath, newLines.join('\n'), 'utf-8');

        return { success: true, filePath };
    } catch (error) {
        return {
            success: false,
            filePath: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * List all memory entries
 */
export function listMemoryEntries(): { entries: string[]; filePath: string | null } {
    const filePath = findInstructionFile();

    if (!filePath || !existsSync(filePath)) {
        return { entries: [], filePath: null };
    }

    const content = readFileSync(filePath, 'utf-8');
    const entries = parseMemoryEntries(content);

    return { entries, filePath };
}

/**
 * Remove a memory entry by index (0-based)
 */
export function removeMemoryEntry(index: number): {
    success: boolean;
    filePath: string;
    error?: string;
} {
    try {
        const filePath = findInstructionFile();

        if (!filePath || !existsSync(filePath)) {
            return { success: false, filePath: '', error: 'No instruction file found' };
        }

        const content = readFileSync(filePath, 'utf-8');
        const entries = parseMemoryEntries(content);

        if (index < 0 || index >= entries.length) {
            return { success: false, filePath, error: 'Invalid entry index' };
        }

        // Remove the entry
        const entryToRemove = entries[index];
        if (!entryToRemove) {
            return { success: false, filePath, error: 'Entry not found' };
        }

        const lines = content.split('\n');
        const newLines: string[] = [];
        let inMemorySection = false;
        let removed = false;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed === MEMORY_SECTION_HEADER) {
                inMemorySection = true;
                newLines.push(line);
                continue;
            }

            if (inMemorySection && trimmed.startsWith('##')) {
                inMemorySection = false;
            }

            // Skip the line to remove
            if (inMemorySection && trimmed === `- ${entryToRemove}` && !removed) {
                removed = true;
                continue;
            }

            newLines.push(line);
        }

        writeFileSync(filePath, newLines.join('\n'), 'utf-8');

        return { success: true, filePath };
    } catch (error) {
        return {
            success: false,
            filePath: '',
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

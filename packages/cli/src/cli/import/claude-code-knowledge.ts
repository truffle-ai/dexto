// What a Claude Code project folder knows beyond its chats: its memory notes and the instructions
// that are not in its repository. `dexto import` brings them into the folder's Dexto Project.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { redactSecrets } from './redaction.js';
import type { LocalChat } from './transcript.js';

/** The server's bounds on `dexto_project_import`. */
const MAX_MEMORY_NOTES = 200;
const MAX_MEMORY_NOTE_BYTES = 16 * 1024;
const MAX_INSTRUCTIONS_BYTES = 64 * 1024;
const MAX_PROJECT_NAME_CHARS = 100;

export interface MemoryNote {
    readonly name: string;
    readonly text: string;
}

/** What `dexto_project_import` takes for one Claude Code project folder. */
export interface ClaudeCodeProjectInput {
    readonly instructions?: string;
    readonly memories?: readonly MemoryNote[];
    readonly name: string;
    readonly sourceAgent: 'claude_code';
    readonly sourceKey: string;
    readonly sourcePath: string;
}

/** The folder a chat's Project stands for: its repository's main checkout, else where it ran. */
export function projectFolder(chat: Pick<LocalChat, 'cwd' | 'repository'>): string | null {
    return chat.repository?.root ?? chat.cwd;
}

/**
 * The Project for the chats of one folder, all Claude Code's: the memory notes beside each chat's
 * session file (a later chat's note wins over an earlier one of the same name), and the instructions
 * Claude Code read that the repository doesn't carry: the person's own `CLAUDE.md` and the folder's
 * `CLAUDE.local.md`. Everything is redacted here and cut to the server's bounds.
 */
export async function readClaudeCodeProject(
    folder: string,
    chats: readonly Pick<LocalChat, 'cwd' | 'path' | 'updatedAt'>[],
    claudeConfigDir: string
): Promise<ClaudeCodeProjectInput> {
    const notes = new Map<string, string>();
    const oldestFirst = [...chats].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    for (const chat of oldestFirst)
        for (const note of await readMemoryNotes(path.join(path.dirname(chat.path), 'memory')))
            notes.set(note.name, note.text);
    const memories = [...notes]
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(0, MAX_MEMORY_NOTES)
        .map(([name, text]) => ({ name, text }));
    const folders = [...new Set([folder, ...chats.flatMap((chat) => chat.cwd ?? [])])];
    const sources = [
        { label: 'Your CLAUDE.md', file: path.join(claudeConfigDir, 'CLAUDE.md') },
        ...folders.map((each) => ({
            label: `CLAUDE.local.md in ${each}`,
            file: path.join(each, 'CLAUDE.local.md'),
        })),
    ];
    const sections: string[] = [];
    for (const source of sources) {
        const text = await readText(source.file);
        if (text !== null) sections.push(`### ${source.label}\n\n${text}`);
    }
    const instructions =
        sections.length === 0
            ? null
            : cutToBytes(
                  redactSecrets(`## Imported from Claude Code\n\n${sections.join('\n\n')}`).text,
                  MAX_INSTRUCTIONS_BYTES
              );
    const sourcePath = redactSecrets(folder).text;
    return {
        ...(instructions === null ? {} : { instructions }),
        ...(memories.length === 0 ? {} : { memories }),
        name: (path.basename(folder) || 'Imported project').slice(0, MAX_PROJECT_NAME_CHARS),
        sourceAgent: 'claude_code',
        // One key per folder on this machine: the same folder always imports into the same Project.
        sourceKey: `claude-code:folder:${createHash('sha256').update(folder).digest('hex')}`,
        sourcePath,
    };
}

/** Claude Code's `memory/*.md` notes, without its `MEMORY.md` index; none when there is no folder. */
async function readMemoryNotes(folder: string): Promise<MemoryNote[]> {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const notes: MemoryNote[] = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'MEMORY.md') continue;
        const text = await readText(path.join(folder, entry.name));
        if (text === null) continue;
        notes.push({
            name: entry.name,
            text: cutToBytes(redactSecrets(text).text, MAX_MEMORY_NOTE_BYTES),
        });
    }
    return notes;
}

/** A file's trimmed text; null when it is missing, unreadable or empty. */
async function readText(file: string): Promise<string | null> {
    const text = await readFile(file, 'utf8').catch(() => null);
    return text === null || text.trim() === '' ? null : text.trim();
}

/** The text within `max` UTF-8 bytes, with a note when some was cut. */
function cutToBytes(text: string, max: number): string {
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.byteLength <= max) return text;
    const marker = '\n… [the rest was left out]';
    // A cut inside a character leaves a replacement character at the end; drop it.
    const kept = bytes
        .subarray(0, max - Buffer.byteLength(marker))
        .toString('utf8')
        .replace(/\uFFFD$/u, '');
    return `${kept}${marker}`;
}

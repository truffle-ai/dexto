import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { LocalChatSource } from './transcript.js';
import { findRepository } from './git.js';

export interface PersonalSkill {
    readonly name: string;
    readonly path: string;
    readonly source: LocalChatSource;
}

/** Only the two user-level skill directories; project skills stay with their repository. */
export async function findPersonalSkills(
    homeDirectory: string,
    environment: Readonly<Record<string, string | undefined>> = {}
): Promise<PersonalSkill[]> {
    const roots: readonly { source: LocalChatSource; path: string }[] = [
        {
            source: 'claude-code',
            path: path.join(
                environment.CLAUDE_CONFIG_DIR || path.join(homeDirectory, '.claude'),
                'skills'
            ),
        },
        {
            source: 'codex',
            path: path.join(environment.CODEX_HOME || path.join(homeDirectory, '.codex'), 'skills'),
        },
    ];
    const skills: PersonalSkill[] = [];
    for (const root of roots) {
        let rootStat;
        try {
            const configStat = await lstat(path.dirname(root.path));
            if (!configStat.isDirectory() || configStat.isSymbolicLink()) continue;
            rootStat = await lstat(root.path);
        } catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
            throw error;
        }
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) continue;
        if (await findRepository(root.path)) continue;
        const entries = await readdir(root.path, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const folder = path.join(root.path, entry.name);
            const manifest = await lstat(path.join(folder, 'SKILL.md')).catch((error: unknown) => {
                if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
                    return null;
                throw error;
            });
            if (manifest?.isFile() && !manifest.isSymbolicLink())
                skills.push({ name: entry.name, path: folder, source: root.source });
        }
    }
    return skills;
}

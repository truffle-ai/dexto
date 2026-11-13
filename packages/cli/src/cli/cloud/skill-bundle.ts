import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { UsageError } from './command.js';
import type { TarFile } from './tar.js';

const MAX_FILES = 200;
export const SLUG = /^[a-z0-9._-]{1,80}$/u;

/**
 * The folder's files, SKILL.md first, as the bundle takes them: relative paths, the executable bit
 * kept. Names starting with a dot (`.git`, the reserved `.dexto`) and links are left out.
 */
export async function readSkillFolder(folder: string): Promise<TarFile[]> {
    if ((await stat(folder).catch(() => null))?.isDirectory() !== true)
        throw new UsageError(`${folder} is not a folder.`);
    const found: { executable: boolean; path: string }[] = [];
    const visit = async (relative: string) => {
        const entries = await readdir(path.join(folder, relative), { withFileTypes: true });
        for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
            if (entry.name.startsWith('.')) continue;
            const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
            if (entry.isDirectory()) await visit(child);
            else if (entry.isFile())
                found.push({
                    executable: ((await stat(path.join(folder, child))).mode & 0o111) !== 0,
                    path: child,
                });
        }
    };
    await visit('');
    if (!found.some((file) => file.path === 'SKILL.md'))
        throw new UsageError(`${folder} has no SKILL.md at its root.`);
    if (found.length > MAX_FILES)
        throw new UsageError(
            `${folder} has ${found.length} files; a Skill takes up to ${MAX_FILES}.`
        );
    const ordered = [
        ...found.filter((file) => file.path === 'SKILL.md'),
        ...found.filter((file) => file.path !== 'SKILL.md'),
    ];
    return await Promise.all(
        ordered.map(async (file) => ({
            ...file,
            bytes: await readFile(path.join(folder, file.path)),
        }))
    );
}

interface SkillHeader {
    readonly description?: string;
    readonly name?: string;
    readonly slug?: string;
    readonly title?: string;
}

/**
 * The plain fields of SKILL.md's `---` header: one-line values, quoted or not, and `>` or `|` blocks
 * on the indented lines below.
 */
export function skillHeader(text: string): SkillHeader {
    const lines = text.split(/\r?\n/u);
    if (lines[0] !== '---') return {};
    const end = lines.indexOf('---', 1);
    const body = lines.slice(1, end === -1 ? 1 : end);
    const fields: Record<string, string> = {};
    for (const [index, line] of body.entries()) {
        const match = /^(description|name|slug|title):\s*(.*)$/u.exec(line);
        if (match === null) continue;
        const [, key = '', raw = ''] = match;
        const value = /^[>|][-+]?$/u.test(raw)
            ? blockValue(body.slice(index + 1), raw.startsWith('>') ? ' ' : '\n')
            : unquote(raw.trim());
        if (value.length > 0) fields[key] = value;
    }
    return fields;
}

/** A `>` or `|` block: the indented lines after its key, joined. */
function blockValue(lines: readonly string[], separator: string): string {
    const end = lines.findIndex((line) => line.length > 0 && !/^\s/u.test(line));
    return (end === -1 ? lines : lines.slice(0, end))
        .map((line) => line.trim())
        .join(separator)
        .trim();
}

function unquote(value: string): string {
    return /^(["']).*\1$/u.test(value) ? value.slice(1, -1) : value;
}

/** `llm-wiki` is `Llm Wiki`. */
export function titleFromSlug(slug: string): string {
    return slug
        .split(/[-_.]+/u)
        .filter((part) => part.length > 0)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

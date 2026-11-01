// `skills push`: packs a local Skill folder and creates or updates it in the person's library.

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import {
    argument,
    CommandFailure,
    flag,
    stringOption,
    UsageError,
    YES_OPTION,
    type Command,
    type CommandContext,
} from '../command.js';
import { tarArchive, type TarFile } from '../tar.js';
import { sendBytes } from '../transfer.js';
import { formatBytes } from './files.js';
import { agreeToCall, listWorkspaceTools, queryWorkspaceTool, toolCallLevel } from './workspace.js';

/** The most files a Skill bundle takes. */
const MAX_FILES = 200;
const SLUG = /^[a-z0-9._-]{1,80}$/u;

const PreparedSchema = z.object({
    headers: z.record(z.string(), z.string()),
    method: z.string(),
    path: z.string(),
    url: z.string(),
});
const SearchSchema = z.object({
    skills: z.array(
        z.object({
            slug: z.string(),
            source: z.string(),
            visibility: z.enum(['organization', 'private', 'shared']).nullable().default(null),
        })
    ),
});
const ImportedSchema = z.object({
    location: z.object({ skillId: z.string() }),
    slug: z.string(),
    title: z.string(),
});

const push: Command = {
    arguments: '<folder>',
    options: {
        description: {
            description: "What the Skill does (default: description in SKILL.md's header).",
            type: 'string',
        },
        slug: {
            description:
                "The Skill's slug (default: slug or name in SKILL.md's header, else the folder's name).",
            type: 'string',
        },
        title: {
            description:
                "The Skill's title (default: title in SKILL.md's header, else from the slug).",
            type: 'string',
        },
        update: {
            description:
                'Update your Skill with this slug (default: update it if you have one, else create it).',
            type: 'boolean',
        },
        ...YES_OPTION,
    },
    path: ['skills', 'push'],
    summary:
        'Pack a local Skill folder (SKILL.md at its root, dotfiles left out) and create or update it in your library.',
    async run(context, input) {
        const folder = argument(input, 0, 'folder');
        const files = await readSkillFolder(folder);
        const header = skillHeader(new globalThis.TextDecoder().decode(files[0]?.bytes));
        const named = header.name !== undefined && SLUG.test(header.name) ? header.name : null;
        const slug =
            stringOption(input, 'slug') ??
            header.slug ??
            named ??
            path.basename(path.resolve(folder));
        if (!SLUG.test(slug))
            throw new UsageError(
                `${slug} can't be a Skill's slug: use up to 80 lowercase letters, digits, dots, dashes and underscores. Pass --slug.`
            );
        const title =
            stringOption(input, 'title') ??
            header.title ??
            (named === null ? header.name : undefined) ??
            titleFromSlug(slug);
        const description = stringOption(input, 'description') ?? header.description;
        if (description === undefined)
            throw new UsageError(
                "SKILL.md's header has no description. Add one there, or pass --description."
            );

        const mode =
            flag(input, 'update') || (await ownsSkill(context, slug)) ? 'update' : 'create';
        const metadata = { description, mode, slug, title };
        // Ask before anything is sent: the import is what changes the library.
        const tool = (await listWorkspaceTools(context)).find(
            (each) => each.name === 'dexto_skill_bundle_import'
        );
        const agreed =
            tool === undefined
                ? {}
                : await agreeToCall(
                      context,
                      {
                          level: toolCallLevel(tool, metadata),
                          schema: tool.inputSchema,
                          title: `${mode === 'create' ? 'Create' : 'Update'} the Skill ${slug}`,
                      },
                      flag(input, 'yes')
                  );

        const archive = tarArchive(files);
        const prepared = PreparedSchema.safeParse(
            await queryWorkspaceTool(context, 'dexto_upload_prepare', {
                filename: `${slug}.tar`,
                mimeType: 'application/x-tar',
                purpose: 'skill-bundle',
                sha256: createHash('sha256').update(archive).digest('hex'),
                sizeBytes: archive.length,
            })
        );
        if (!prepared.success)
            throw new CommandFailure(
                'failed',
                "Dexto didn't say where to upload the bundle.",
                null
            );
        const { headers, method, url } = prepared.data;
        await sendBytes(context, { headers, method, url }, new globalThis.Blob([archive]));
        const imported = await queryWorkspaceTool(context, 'dexto_skill_bundle_import', {
            ...metadata,
            uploadPath: prepared.data.path,
            ...agreed,
        });
        const shown = ImportedSchema.safeParse(imported);
        context.output.result(
            imported,
            shown.success
                ? `${mode === 'create' ? 'Created' : 'Updated'} ${shown.data.title} (${shown.data.slug}, ${files.length} file${files.length === 1 ? '' : 's'}, ${formatBytes(archive.length)}): skill ${shown.data.location.skillId}.`
                : JSON.stringify(imported, null, 2)
        );
    },
};

/**
 * The folder's files, SKILL.md first, as the bundle takes them: relative paths, the executable bit
 * kept. Names starting with a dot (`.git`, the reserved `.dexto`) and links are left out.
 */
async function readSkillFolder(folder: string): Promise<TarFile[]> {
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

/**
 * Whether the person has a Skill with this slug they can save over: their own, or their
 * organization's. One someone shared with them is theirs to copy, so a push makes the person's own.
 */
async function ownsSkill(context: CommandContext, slug: string): Promise<boolean> {
    const found = SearchSchema.safeParse(
        await queryWorkspaceTool(context, 'dexto_skills_search', {
            limit: 50,
            query: slug,
            source: 'library',
        })
    );
    return (
        found.success &&
        found.data.skills.some(
            (skill) =>
                skill.slug === slug &&
                skill.source === 'user' &&
                (skill.visibility === 'private' || skill.visibility === 'organization')
        )
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
function skillHeader(text: string): SkillHeader {
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
function titleFromSlug(slug: string): string {
    return slug
        .split(/[-_.]+/u)
        .filter((part) => part.length > 0)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

export const skillCommands: readonly Command[] = [push];

import { z } from 'zod';
import type { PersonalSkill } from '../../import/personal-skills.js';
import { redactSecrets } from '../../import/redaction.js';
import { chooseSkillClash, type SkillClashPolicy } from '../../import/skill-clash.js';
import { CommandFailure } from '../../failure.js';
import type { CommandContext } from '../command.js';
import { tarArchive } from '../tar.js';
import { uploadSkillBundle } from './skill-transport.js';
import { readSkillFolder, skillHeader, SLUG, titleFromSlug } from '../skill-bundle.js';
import { queryWorkspaceTool } from './workspace.js';

const Search = z.object({
    skills: z.array(
        z.object({
            slug: z.string(),
            source: z.string(),
            visibility: z.string().nullable().optional(),
        })
    ),
});
const Imported = z.object({ slug: z.string(), location: z.object({ skillId: z.string() }) });

export function personalSkillId(skill: PersonalSkill): string {
    return `skill:${skill.source}:${redactSecrets(skill.name).text}`;
}

/** Construct a redacted text-only bundle locally; binary assets require a separate safe import path. */
export async function preparePersonalSkill(skill: PersonalSkill) {
    if (redactSecrets(skill.name).text !== skill.name || /[\p{Cc}]/u.test(skill.name))
        throw new CommandFailure(
            'invalid_input',
            'A skill name contains sensitive or invalid content.',
            null
        );
    const files = await readSkillFolder(skill.path);
    const decoder = new globalThis.TextDecoder('utf-8', { fatal: true });
    const encoder = new globalThis.TextEncoder();
    let redactions = 0;
    const redactedFiles = files.map((file) => {
        if (redactSecrets(file.path).text !== file.path)
            throw new CommandFailure(
                'invalid_input',
                'A skill filename contains sensitive content.',
                null
            );
        let text: string;
        try {
            text = decoder.decode(file.bytes);
        } catch {
            throw new CommandFailure(
                'invalid_input',
                'A skill contains binary files; it cannot be safely redacted.',
                null
            );
        }
        if (text.includes('\u0000'))
            throw new CommandFailure(
                'invalid_input',
                'A skill contains binary files; it cannot be safely redacted.',
                null
            );
        const redacted = redactSecrets(text);
        redactions += Object.values(redacted.counts).reduce((a, b) => a + b, 0);
        return { ...file, bytes: encoder.encode(redacted.text) };
    });
    const header = skillHeader(decoder.decode(redactedFiles[0]?.bytes));
    const slug =
        header.slug ??
        (header.name !== undefined && SLUG.test(header.name) ? header.name : skill.name);
    if (!SLUG.test(slug))
        throw new CommandFailure('invalid_input', 'A skill needs a valid lowercase slug.', null);
    if (header.description === undefined)
        throw new CommandFailure('invalid_input', 'A skill needs a description in SKILL.md.', null);
    return {
        slug,
        title: header.title ?? titleFromSlug(slug),
        description: header.description,
        archive: tarArchive(redactedFiles),
        redactions,
        files: redactedFiles.length,
    };
}

type PreparedSkill = Awaited<ReturnType<typeof preparePersonalSkill>>;

/** Fail closed until the server's provenance and retry contract is verified. */
export function requireSkillProvenance(): never {
    throw new CommandFailure(
        'failed',
        'Personal skill uploads await the verified provenance and retry contract.',
        null
    );
}

async function occupied(context: CommandContext, slug: string): Promise<boolean> {
    const found = Search.parse(
        await queryWorkspaceTool(context, 'dexto_skills_search', {
            limit: 50,
            query: slug,
            source: 'library',
        })
    );
    return found.skills.some(
        (skill) =>
            skill.slug === slug &&
            skill.source === 'user' &&
            (skill.visibility === 'private' || skill.visibility === 'organization')
    );
}

export async function selectPersonalSkillSlug(
    context: CommandContext,
    prepared: PreparedSkill,
    policy: SkillClashPolicy,
    reserved: Set<string>
) {
    let slug = prepared.slug;
    if (reserved.has(slug) || (await occupied(context, slug))) {
        const choice = await chooseSkillClash({
            policy,
            json: context.output.json,
            prompt: context.runtime.prompt,
        });
        if (choice === 'skip') return null;
        let found = false;
        for (let n = 2; n <= 100; n++) {
            const suffix = `-${n}`;
            const candidate = `${prepared.slug.slice(0, 80 - suffix.length)}${suffix}`;
            if (!reserved.has(candidate) && !(await occupied(context, candidate))) {
                slug = candidate;
                found = true;
                break;
            }
        }
        if (!found) throw new CommandFailure('failed', 'No available skill name found.', null);
    }
    reserved.add(slug);
    return slug;
}

export async function importPersonalSkill(
    context: CommandContext,
    skill: PersonalSkill,
    prepared: PreparedSkill,
    slug: string
) {
    const imported = Imported.parse(
        await uploadSkillBundle(context, prepared.archive, {
            mode: 'create',
            slug,
            title: prepared.title,
            description: prepared.description,
            importProvenance: {
                sourceAgent: skill.source === 'claude-code' ? 'claude_code' : 'codex',
                sourceId: skill.name,
                sourcePath: `~/${skill.source === 'claude-code' ? '.claude' : '.codex'}/skills/${skill.name}`,
            },
        })
    );
    return {
        id: personalSkillId(skill),
        status: 'imported' as const,
        slug: imported.slug,
        skillId: imported.location.skillId,
    };
}

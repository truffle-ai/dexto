import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SkillDocument, SkillSource, SkillSummary } from '@dexto/core';

export interface LocalSkillRoot {
    id: string;
    skillFile: string;
    displayName?: string | undefined;
    description?: string | undefined;
}

type LocalSkillEntry = SkillSummary & {
    skillFile: string;
    skillDirectory: string;
};

export class LocalSkillSource implements SkillSource {
    private skills: LocalSkillEntry[] | undefined;

    constructor(
        readonly id: string,
        private readonly roots: LocalSkillRoot[]
    ) {}

    async list(): Promise<SkillSummary[]> {
        return (await this.entries()).map(
            ({ skillFile: _skillFile, skillDirectory: _skillDirectory, ...summary }) => ({
                ...summary,
            })
        );
    }

    async get(id: string): Promise<SkillDocument | null> {
        const entry = await this.findEntry(id);
        if (!entry) return null;

        const instructions = await fs.readFile(entry.skillFile, 'utf8');

        return {
            id: entry.id,
            displayName: entry.displayName,
            ...(entry.description !== undefined && { description: entry.description }),
            instructions,
        };
    }

    async readFile(skillId: string, requestedPath: string): Promise<string> {
        const entry = await this.findEntry(skillId);
        if (!entry || requestedPath.startsWith('/') || requestedPath.split('/').includes('..')) {
            throw new Error(`Skill file not found: ${skillId}/${requestedPath}`);
        }
        return fs.readFile(path.join(entry.skillDirectory, requestedPath), 'utf8');
    }

    async refresh(): Promise<void> {
        this.skills = undefined;
    }

    private async entries(): Promise<LocalSkillEntry[]> {
        if (this.skills) return this.skills;

        const entries: LocalSkillEntry[] = [];
        for (const root of this.roots) {
            const instructions = await fs.readFile(root.skillFile, 'utf8');
            entries.push({
                id: root.id,
                displayName: root.displayName ?? firstHeading(instructions) ?? root.id,
                ...((root.description ?? frontmatterDescription(instructions))
                    ? { description: root.description ?? frontmatterDescription(instructions) }
                    : {}),
                skillFile: root.skillFile,
                skillDirectory: path.dirname(root.skillFile),
            });
        }

        this.skills = entries;
        return entries;
    }

    private async findEntry(id: string): Promise<LocalSkillEntry | null> {
        return (
            (await this.entries()).find((entry) => entry.id === id || entry.displayName === id) ??
            null
        );
    }
}

function firstHeading(markdown: string): string | undefined {
    const heading = markdown
        .split('\n')
        .find((line) => line.startsWith('# ') && line.slice(2).trim().length > 0);
    return heading?.slice(2).trim();
}

function frontmatterDescription(markdown: string): string | undefined {
    if (!markdown.startsWith('---\n')) return undefined;
    const end = markdown.indexOf('\n---', 4);
    if (end < 0) return undefined;

    const line = markdown
        .slice(4, end)
        .split('\n')
        .find((candidate) => candidate.trim().startsWith('description:'));
    return line?.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '') || undefined;
}

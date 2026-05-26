import type { WorkspaceManager } from '../workspace/index.js';
import type { SkillDocument, SkillSource, SkillSummary } from './types.js';

const SKILL_PATTERNS = [
    '.agents/skills/*/SKILL.md',
    'skills/*/SKILL.md',
    '.dexto/skills/*/SKILL.md',
] as const;

type WorkspaceSkillEntry = SkillSummary & {
    skillDirectory: string;
    skillFile: string;
};

export class WorkspaceSkillSource implements SkillSource {
    readonly id = 'workspace';
    private skills: WorkspaceSkillEntry[] | undefined;

    constructor(private workspaceManager: Pick<WorkspaceManager, 'getWorkspace' | 'open'>) {}

    async list(): Promise<SkillSummary[]> {
        return (await this.entries()).map(
            ({ skillDirectory: _skillDirectory, skillFile: _skillFile, ...summary }) => ({
                ...summary,
            })
        );
    }

    async get(id: string): Promise<SkillDocument | null> {
        const entry = await this.findEntry(id);
        if (!entry) return null;
        const instructions = await this.readWorkspaceText(entry.skillFile);
        return {
            id: entry.id,
            displayName: entry.displayName,
            ...(entry.description !== undefined && { description: entry.description }),
            instructions,
        };
    }

    async readFile(skillId: string, path: string): Promise<string> {
        const entry = await this.findEntry(skillId);
        if (!entry || path.startsWith('/') || path.split('/').includes('..')) {
            throw new Error(`Skill file not found: ${skillId}/${path}`);
        }
        return this.readWorkspaceText(`${entry.skillDirectory}/${path}`);
    }

    async refresh(): Promise<void> {
        this.skills = undefined;
    }

    private async entries(): Promise<WorkspaceSkillEntry[]> {
        if (this.skills) return this.skills;

        const workspace = await this.workspaceManager.getWorkspace();
        if (!workspace) {
            this.skills = [];
            return this.skills;
        }

        const handle = await this.workspaceManager.open({ intent: 'read' });
        if (
            typeof handle.files.glob !== 'function' ||
            typeof handle.files.readText !== 'function'
        ) {
            throw new Error('Workspace file capability requires glob and readText');
        }

        const skills: WorkspaceSkillEntry[] = [];
        for (const pattern of SKILL_PATTERNS) {
            const skillFiles = await handle.files.glob(pattern);
            for (const skillFile of skillFiles) {
                const skillDirectory = skillFile.slice(0, -'/SKILL.md'.length);
                const id = skillDirectory.split('/').at(-1);
                if (!id) continue;
                const instructions = await handle.files.readText(skillFile);
                const description = frontmatterDescription(instructions);
                skills.push({
                    id,
                    displayName: firstHeading(instructions) ?? id,
                    ...(description !== undefined && { description }),
                    skillDirectory,
                    skillFile,
                });
            }
        }

        this.skills = skills;
        return skills;
    }

    private async findEntry(id: string): Promise<WorkspaceSkillEntry | null> {
        return (
            (await this.entries()).find((entry) => entry.id === id || entry.displayName === id) ??
            null
        );
    }

    private async readWorkspaceText(path: string): Promise<string> {
        const handle = await this.workspaceManager.open({ intent: 'read' });
        if (typeof handle.files.readText !== 'function') {
            throw new Error(`Workspace file read unavailable: ${path}`);
        }
        return handle.files.readText(path);
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
    return line?.split(':').slice(1).join(':').trim() || undefined;
}

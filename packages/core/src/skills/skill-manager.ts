import type { SkillDocument, SkillManager, SkillSource, SkillSummary } from './types.js';

type SkillEntry = {
    source: SkillSource;
    summary: SkillSummary;
};

export class CompositeSkillManager implements SkillManager {
    constructor(private sources: SkillSource[]) {}

    async list(): Promise<SkillSummary[]> {
        return (await this.entries()).map((entry) => entry.summary);
    }

    async get(id: string): Promise<SkillDocument | null> {
        const entry = await this.findEntry(id);
        if (!entry?.source.get) return null;
        return entry.source.get(entry.summary.id);
    }

    async readFile(skillId: string, path: string): Promise<string> {
        const entry = await this.findEntry(skillId);
        if (!entry?.source.readFile) throw new Error(`Skill file not found: ${skillId}/${path}`);
        return entry.source.readFile(entry.summary.id, path);
    }

    async invoke(id: string, args?: Record<string, string>): Promise<SkillDocument | null> {
        const entry = await this.findEntry(id);
        if (!entry) return null;
        if (entry.source.invoke) {
            return entry.source.invoke(entry.summary.id, args);
        }
        if (!entry.source.get) return null;
        return entry.source.get(entry.summary.id);
    }

    async refresh(): Promise<void> {
        for (const source of this.sources) {
            await source.refresh?.();
        }
    }

    private async findEntry(id: string): Promise<SkillEntry | null> {
        return (
            (await this.entries()).find(
                (entry) => entry.summary.id === id || entry.summary.displayName === id
            ) ?? null
        );
    }

    private async entries(): Promise<SkillEntry[]> {
        const seen = new Set<string>();
        const skills: SkillEntry[] = [];

        for (const source of this.sources) {
            for (const skill of await source.list()) {
                if (seen.has(skill.id)) continue;
                seen.add(skill.id);
                skills.push({ source, summary: skill });
            }
        }

        return skills;
    }
}

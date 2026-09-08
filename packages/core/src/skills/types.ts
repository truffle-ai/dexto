export interface SkillSummary {
    /** Exact canonical name accepted by `skill_load`. */
    name: string;
    /** Short routing guidance shown in the system prompt. */
    description: string;
}

export interface LoadedSkill {
    /** Exact canonical name requested by the caller. */
    name: string;
    instructions: string;
    supportingFiles: readonly string[];
    filesLocation: 'hosted' | 'workspace';
    baseDirectory: string | null;
}

export interface Skills {
    list(): Promise<readonly SkillSummary[]>;
    load(name: string): Promise<LoadedSkill | null>;
    readFile(name: string, path: string): Promise<string>;
}

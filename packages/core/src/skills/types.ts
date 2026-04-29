export interface SkillRequirement {
    type: 'toolkit';
    name: string;
}

export interface SkillSummary {
    id: string;
    displayName: string;
    description?: string | undefined;
    requirements?: SkillRequirement[] | undefined;
}

export interface SkillDocument extends SkillSummary {
    instructions: string;
}

export interface SkillSource {
    id: string;
    list(): Promise<SkillSummary[]>;
    get?(id: string): Promise<SkillDocument | null>;
    readFile?(skillId: string, path: string): Promise<string>;
    invoke?(id: string, args?: Record<string, string>): Promise<SkillDocument | null>;
    refresh?(): Promise<void>;
}

export interface SkillManager {
    list(): Promise<SkillSummary[]>;
    get(id: string): Promise<SkillDocument | null>;
    readFile(skillId: string, path: string): Promise<string>;
    invoke(id: string, args?: Record<string, string>): Promise<SkillDocument | null>;
    refresh(): Promise<void>;
}

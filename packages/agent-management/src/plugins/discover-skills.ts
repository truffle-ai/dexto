/**
 * Standalone Skill Discovery
 *
 * Discovers standalone skills from project-local and user-local skill directories.
 * These are different from plugin skills - they're just directories containing a SKILL.md file.
 *
 * Structure:
 * .agents/skills/
 * skills/ (legacy project root, still discovered for compatibility)
 * .dexto/skills/ (legacy project/user root, still discovered for compatibility)
 * ~/.agents/skills/
 * └── skill-name/
 *     ├── SKILL.md          (required - skill instructions)
 *     ├── handlers/         (optional - workflow helper files)
 *     ├── scripts/          (optional - executable helpers)
 *     ├── mcps/             (optional - MCP server config JSON files)
 *     └── references/       (optional - reference files)
 *
 * These skills are discovered by skill tooling, not loaded as prompts.
 */

import * as path from 'path';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';

/**
 * Represents a discovered standalone skill
 */
export interface DiscoveredSkill {
    /** Unique skill name (directory name) */
    name: string;
    /** Absolute path to the skill directory */
    path: string;
    /** Absolute path to the SKILL.md file */
    skillFile: string;
    /** Source location */
    source: 'user' | 'project';
    /**
     * Reserved for future discovery metadata.
     */
    warnings?: string[] | undefined;
}

export interface StandaloneSkillPaths {
    project: string;
    user: string;
    legacyProject: readonly string[];
    legacyUser: readonly string[];
}

/**
 * Resolves the canonical standalone Skill roots used by discovery and creator tools.
 */
export function getStandaloneSkillPaths(projectPath?: string): StandaloneSkillPaths {
    const homeDir = process.env.HOME || process.env.USERPROFILE || homedir();
    const cwd = projectPath || process.cwd();

    return {
        project: path.join(cwd, '.agents', 'skills'),
        user: path.join(homeDir, '.agents', 'skills'),
        legacyProject: [path.join(cwd, 'skills'), path.join(cwd, '.dexto', 'skills')],
        legacyUser: [path.join(homeDir, '.dexto', 'skills')],
    };
}

/**
 * Discovers standalone skills from standard locations.
 *
 * Search Locations:
 * 1. <projectRoot>/.agents/skills/*  (project)
 * 2. ~/.agents/skills/*              (user)
 *
 * @param projectPath Optional project path (defaults to cwd)
 * @returns Array of discovered skills
 */
export function discoverStandaloneSkills(projectPath?: string): DiscoveredSkill[] {
    const skills: DiscoveredSkill[] = [];
    const seenNames = new Set<string>();
    const skillPaths = getStandaloneSkillPaths(projectPath);

    /**
     * Adds a skill if not already seen (deduplication by name)
     */
    const addSkill = (skill: DiscoveredSkill): boolean => {
        const normalizedName = skill.name.toLowerCase();
        if (seenNames.has(normalizedName)) {
            return false;
        }
        seenNames.add(normalizedName);
        skills.push(skill);
        return true;
    };

    /**
     * Scans a skills directory and adds valid skills to the list
     */
    const scanSkillsDir = (dir: string, source: 'project' | 'user'): void => {
        if (!existsSync(dir)) return;

        try {
            const entries = readdirSync(dir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;

                const skillPath = path.join(dir, entry.name);
                const skillFile = path.join(skillPath, 'SKILL.md');

                // Check if SKILL.md exists
                if (existsSync(skillFile)) {
                    addSkill({
                        name: entry.name,
                        path: skillPath,
                        skillFile,
                        source,
                    });
                }
            }
        } catch {
            // Directory read error - silently skip
        }
    };

    // === Project skills ===
    // Project-authored Skills prefer the canonical root, while retaining legacy roots so
    // initialization never makes existing bundles disappear.
    scanSkillsDir(skillPaths.project, 'project');
    for (const legacyRoot of skillPaths.legacyProject) {
        scanSkillsDir(legacyRoot, 'project');
    }

    // User-authored Skills also prefer the canonical root, with the legacy root retained.
    scanSkillsDir(skillPaths.user, 'user');
    for (const legacyRoot of skillPaths.legacyUser) {
        scanSkillsDir(legacyRoot, 'user');
    }

    return skills;
}

/**
 * Gets the search locations for standalone skills.
 * Useful for debugging and testing.
 *
 * @returns Array of skill search paths
 */
export function getSkillSearchPaths(projectPath?: string): string[] {
    const skillPaths = getStandaloneSkillPaths(projectPath);
    return [
        skillPaths.project,
        ...skillPaths.legacyProject,
        skillPaths.user,
        ...skillPaths.legacyUser,
    ];
}

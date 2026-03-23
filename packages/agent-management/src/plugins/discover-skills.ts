/**
 * Standalone Skill Discovery
 *
 * Discovers standalone skills from project-local and user-local skill directories.
 * These are different from plugin skills - they're just directories containing a SKILL.md file.
 *
 * Structure:
 * skills/
 * ~/.agents/skills/
 * ~/.dexto/skills/
 * └── skill-name/
 *     ├── SKILL.md          (required - the skill prompt)
 *     ├── handlers/         (optional - workflow helper files)
 *     ├── scripts/          (optional - executable helpers)
 *     ├── mcps/             (optional - MCP server config JSON files)
 *     └── references/       (optional - reference files)
 *
 * These skills are loaded as prompts directly, not as part of a plugin package.
 */

import * as path from 'path';
import { existsSync, readdirSync } from 'fs';

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
     * Skill-bundled MCP config is resolved lazily from the skill directory when the prompt is loaded.
     */
    warnings?: string[] | undefined;
}

/**
 * Discovers standalone skills from standard locations.
 *
 * Search Locations:
 * 1. <projectRoot>/skills/*          (project)
 * 2. <projectRoot>/.agents/skills/*  (project)
 * 3. <projectRoot>/.dexto/skills/*   (project)
 * 4. ~/.agents/skills/*              (user)
 * 5. ~/.dexto/skills/*               (user)
 *
 * @param projectPath Optional project path (defaults to cwd)
 * @returns Array of discovered skills
 */
export function discoverStandaloneSkills(projectPath?: string): DiscoveredSkill[] {
    const skills: DiscoveredSkill[] = [];
    const seenNames = new Set<string>();
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cwd = projectPath || process.cwd();

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
    // 1. Top-level project skills: <projectRoot>/skills/
    scanSkillsDir(path.join(cwd, 'skills'), 'project');
    // 2. Agents project skills: <projectRoot>/.agents/skills/
    scanSkillsDir(path.join(cwd, '.agents', 'skills'), 'project');
    // 3. Dexto project skills: <projectRoot>/.dexto/skills/
    scanSkillsDir(path.join(cwd, '.dexto', 'skills'), 'project');

    // === User skills ===
    // 4. Agents user skills: ~/.agents/skills/
    // 5. Dexto user skills: ~/.dexto/skills/
    if (homeDir) {
        scanSkillsDir(path.join(homeDir, '.agents', 'skills'), 'user');
        scanSkillsDir(path.join(homeDir, '.dexto', 'skills'), 'user');
    }

    return skills;
}

/**
 * Gets the search locations for standalone skills.
 * Useful for debugging and testing.
 *
 * @returns Array of skill search paths
 */
export function getSkillSearchPaths(): string[] {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const cwd = process.cwd();

    return [
        path.join(cwd, 'skills'),
        path.join(cwd, '.agents', 'skills'),
        path.join(cwd, '.dexto', 'skills'),
        homeDir ? path.join(homeDir, '.agents', 'skills') : '',
        homeDir ? path.join(homeDir, '.dexto', 'skills') : '',
    ].filter(Boolean);
}

import path from 'node:path';
import { discoverClaudeCodePlugins } from './discover-plugins.js';
import { discoverStandaloneSkills } from './discover-skills.js';
import { loadClaudeCodePlugin } from './load-plugin.js';
import { LocalSkillSource, type LocalSkillRoot } from './local-skill-source.js';

export interface CreateLocalSkillSourcesOptions {
    workspaceRoot?: string | undefined;
    bundledPlugins?: string[] | undefined;
}

export function createLocalSkillSources(
    options: CreateLocalSkillSourcesOptions = {}
): LocalSkillSource[] {
    const roots: LocalSkillRoot[] = [];
    const seen = new Set<string>();

    const addRoot = (root: LocalSkillRoot) => {
        const resolved = path.resolve(root.skillFile);
        if (seen.has(resolved)) return;
        seen.add(resolved);
        roots.push({ ...root, skillFile: resolved });
    };

    for (const skill of discoverStandaloneSkills(options.workspaceRoot)) {
        addRoot({
            id: skill.name,
            skillFile: skill.skillFile,
        });
    }

    for (const plugin of discoverClaudeCodePlugins(
        options.workspaceRoot,
        options.bundledPlugins ?? []
    )) {
        const loaded = loadClaudeCodePlugin(plugin);
        for (const command of loaded.commands) {
            if (!command.isSkill) continue;
            const id = path.basename(path.dirname(command.file));
            addRoot({
                id: `${command.namespace}:${id}`,
                displayName: `${command.namespace}:${id}`,
                skillFile: command.file,
            });
        }
    }

    return roots.length > 0 ? [new LocalSkillSource('local', roots)] : [];
}

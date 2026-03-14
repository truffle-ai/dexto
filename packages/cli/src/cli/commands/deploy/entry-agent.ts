import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { normalizeWorkspaceRelativePath } from './config.js';

const DIRECT_ENTRY_AGENT_FILENAMES = ['coding-agent.yml', 'coding-agent.yaml'] as const;

export function isAgentYamlPath(filePath: string): boolean {
    return /\.(ya?ml)$/i.test(filePath);
}

async function collectAgentYamlFiles(
    workspaceRoot: string,
    currentDirectory: string,
    results: string[]
): Promise<void> {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sortedEntries) {
        const absolutePath = path.join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
            await collectAgentYamlFiles(workspaceRoot, absolutePath, results);
            continue;
        }
        if (!entry.isFile() || !isAgentYamlPath(entry.name)) {
            continue;
        }
        results.push(normalizeWorkspaceRelativePath(path.relative(workspaceRoot, absolutePath)));
    }
}

export async function discoverEntryAgentCandidates(workspaceRoot: string): Promise<string[]> {
    const candidates: string[] = [];
    const seen = new Set<string>();

    for (const filename of DIRECT_ENTRY_AGENT_FILENAMES) {
        const absolutePath = path.join(workspaceRoot, filename);
        if (!existsSync(absolutePath)) {
            continue;
        }
        const relativePath = normalizeWorkspaceRelativePath(filename);
        if (!seen.has(relativePath)) {
            seen.add(relativePath);
            candidates.push(relativePath);
        }
    }

    const agentsDirectory = path.join(workspaceRoot, 'agents');
    if (!existsSync(agentsDirectory)) {
        return candidates;
    }

    const discovered: string[] = [];
    await collectAgentYamlFiles(workspaceRoot, agentsDirectory, discovered);
    for (const relativePath of discovered) {
        if (seen.has(relativePath)) {
            continue;
        }
        seen.add(relativePath);
        candidates.push(relativePath);
    }

    return candidates;
}

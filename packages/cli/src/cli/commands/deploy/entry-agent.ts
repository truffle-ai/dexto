import { existsSync } from 'fs';
import path from 'path';
import { normalizeWorkspaceRelativePath } from './config.js';

const PRIMARY_WORKSPACE_AGENT_PATHS = [path.join('agents', 'coding-agent.yml')] as const;

export function isAgentYamlPath(filePath: string): boolean {
    return /\.(ya?ml)$/i.test(filePath);
}

export function discoverPrimaryWorkspaceAgent(workspaceRoot: string): string | null {
    for (const relativePath of PRIMARY_WORKSPACE_AGENT_PATHS) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }

        return normalizeWorkspaceRelativePath(relativePath);
    }

    return null;
}

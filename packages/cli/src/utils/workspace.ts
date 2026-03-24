import type { DextoAgent } from '@dexto/core';

type WorkspaceAwareAgent = Pick<DextoAgent, 'getWorkspace' | 'setWorkspace'>;

/**
 * Keep the runtime workspace in sync with the host-resolved project root so
 * prompt contributors and downstream services don't fall back to process.cwd().
 */
export async function applyWorkspaceToAgent(
    agent: WorkspaceAwareAgent,
    workspaceRoot: string
): Promise<void> {
    const normalizedWorkspaceRoot = workspaceRoot.trim();
    if (!normalizedWorkspaceRoot) {
        return;
    }

    const currentWorkspace = await agent.getWorkspace();
    if (currentWorkspace?.path === normalizedWorkspaceRoot) {
        return;
    }

    await agent.setWorkspace({
        path: normalizedWorkspaceRoot,
    });
}

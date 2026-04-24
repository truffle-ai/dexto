import { randomUUID } from 'crypto';
import type { AgentEventBus } from '../events/index.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { SetWorkspaceInput, WorkspaceContext } from './types.js';
import { WorkspaceError } from './errors.js';
import type { WorkspaceStore } from '../storage/workspaces/types.js';

export class WorkspaceManager {
    private logger: Logger;
    private currentWorkspace: WorkspaceContext | undefined;

    constructor(
        private workspaceStore: WorkspaceStore,
        private agentEventBus: AgentEventBus,
        logger: Logger
    ) {
        this.logger = logger.createChild(DextoLogComponent.AGENT);
        this.logger.debug('WorkspaceManager initialized');
    }

    async setWorkspace(input: SetWorkspaceInput): Promise<WorkspaceContext> {
        const path = (input.path || '').trim();
        if (!path) {
            throw WorkspaceError.pathRequired();
        }

        const now = Date.now();
        const existing = await this.workspaceStore.findWorkspaceByPath({ path });

        const resolvedName = input.name ?? existing?.name;

        const workspace: WorkspaceContext = existing
            ? {
                  ...existing,
                  ...(resolvedName !== undefined ? { name: resolvedName } : {}),
                  lastActiveAt: now,
              }
            : {
                  id: randomUUID(),
                  path,
                  ...(resolvedName !== undefined ? { name: resolvedName } : {}),
                  createdAt: now,
                  lastActiveAt: now,
              };

        await this.workspaceStore.saveWorkspace({ workspace });
        await this.workspaceStore.setCurrentWorkspace({ id: workspace.id });
        this.currentWorkspace = workspace;

        this.agentEventBus.emit('workspace:changed', { workspace });
        this.logger.info(`Workspace set: ${workspace.id}`);

        return workspace;
    }

    async clearWorkspace(): Promise<void> {
        await this.workspaceStore.clearCurrentWorkspace();
        this.currentWorkspace = undefined;
        this.agentEventBus.emit('workspace:changed', { workspace: null });
        this.logger.info('Workspace cleared');
    }

    async getWorkspace(): Promise<WorkspaceContext | undefined> {
        if (this.currentWorkspace) {
            return this.currentWorkspace;
        }

        const currentId = await this.workspaceStore.getCurrentWorkspaceId();
        if (!currentId) {
            return undefined;
        }

        const workspace = await this.workspaceStore.getWorkspace({ id: currentId });
        if (!workspace) {
            return undefined;
        }

        this.currentWorkspace = workspace;
        return workspace;
    }

    async listWorkspaces(): Promise<WorkspaceContext[]> {
        const workspaces = await this.workspaceStore.listWorkspaces();

        return workspaces.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    }
}

import { randomUUID } from 'crypto';
import type { Database } from '../storage/database/types.js';
import type { AgentEventBus } from '../events/index.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { SetWorkspaceInput, WorkspaceContext } from './types.js';
import { WorkspaceError } from './errors.js';

const WORKSPACE_KEY_PREFIX = 'workspace:item:';
const WORKSPACE_CURRENT_KEY = 'workspace:current';

export class WorkspaceManager {
    private logger: Logger;
    private currentWorkspace: WorkspaceContext | undefined;

    constructor(
        private database: Database,
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
        const existing = await this.findByPath(path);

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

        await this.database.set(this.toKey(workspace.id), workspace);
        await this.database.set(WORKSPACE_CURRENT_KEY, workspace.id);
        this.currentWorkspace = workspace;

        this.agentEventBus.emit('workspace:changed', { workspace });
        this.logger.info(`Workspace set: ${workspace.id}`);

        return workspace;
    }

    async clearWorkspace(): Promise<void> {
        await this.database.delete(WORKSPACE_CURRENT_KEY);
        this.currentWorkspace = undefined;
        this.agentEventBus.emit('workspace:changed', { workspace: null });
        this.logger.info('Workspace cleared');
    }

    async getWorkspace(): Promise<WorkspaceContext | undefined> {
        if (this.currentWorkspace) {
            return this.currentWorkspace;
        }

        const currentId = await this.database.get<string>(WORKSPACE_CURRENT_KEY);
        if (!currentId) {
            return undefined;
        }

        const workspace = await this.database.get<WorkspaceContext>(this.toKey(currentId));
        if (!workspace) {
            return undefined;
        }

        this.currentWorkspace = workspace;
        return workspace;
    }

    async listWorkspaces(): Promise<WorkspaceContext[]> {
        const keys = await this.database.list(WORKSPACE_KEY_PREFIX);
        const workspaces: WorkspaceContext[] = [];

        for (const key of keys) {
            const workspace = await this.database.get<WorkspaceContext>(key);
            if (workspace) {
                workspaces.push(workspace);
            }
        }

        return workspaces.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0));
    }

    private async findByPath(path: string): Promise<WorkspaceContext | undefined> {
        const keys = await this.database.list(WORKSPACE_KEY_PREFIX);
        for (const key of keys) {
            const workspace = await this.database.get<WorkspaceContext>(key);
            if (workspace?.path === path) {
                return workspace;
            }
        }
        return undefined;
    }

    private toKey(id: string): string {
        return `${WORKSPACE_KEY_PREFIX}${id}`;
    }
}

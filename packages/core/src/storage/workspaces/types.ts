import type { WorkspaceContext } from '../../workspace/types.js';

export interface WorkspaceStore {
    saveWorkspace(input: { workspace: WorkspaceContext }): Promise<void>;
    getWorkspace(input: { id: string }): Promise<WorkspaceContext | undefined>;
    findWorkspaceByPath(input: { path: string }): Promise<WorkspaceContext | undefined>;
    listWorkspaces(): Promise<WorkspaceContext[]>;
    setCurrentWorkspace(input: { id: string }): Promise<void>;
    getCurrentWorkspaceId(): Promise<string | undefined>;
    clearCurrentWorkspace(): Promise<void>;
}

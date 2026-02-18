export interface WorkspaceContext {
    id: string;
    /** Absolute or canonicalized workspace root path */
    path: string;
    /** Optional display name */
    name?: string;
    createdAt: number;
    lastActiveAt: number;
}

export interface SetWorkspaceInput {
    path: string;
    name?: string;
}

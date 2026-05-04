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

export type WorkspaceCapability = 'files' | 'processes' | 'preview' | 'apps';

export interface OpenWorkspaceInput {
    intent?: 'read' | 'write' | 'process' | 'preview' | 'apps';
    capabilities?: WorkspaceCapability[];
}

export interface WorkspaceFiles {
    readFile(path: string): Promise<string>;
    readText(path: string): Promise<string>;
    glob(pattern: string): Promise<string[]>;
    writeFile(path: string, content: string, options?: { createDirs?: boolean }): Promise<void>;
    listFiles(path?: string): Promise<string[]>;
}

export interface WorkspaceProcesses {
    exec(input: {
        command: string;
        cwd?: string;
        timeout?: number;
    }): Promise<{ exitCode?: number; stdout: string; stderr: string }>;
}

export interface WorkspacePreview {
    url?: string;
}

export interface WorkspaceApps {
    list?(): Promise<Array<{ id: string; name: string; url?: string }>>;
}

export interface WorkspaceHandle {
    context: WorkspaceContext;
    capabilities: WorkspaceCapability[];
    files: WorkspaceFiles;
    processes?: WorkspaceProcesses;
    preview?: WorkspacePreview;
    apps?: WorkspaceApps;
}

export interface WorkspaceHandleProvider {
    open(input: {
        context: WorkspaceContext;
        input?: OpenWorkspaceInput;
    }): Promise<WorkspaceHandle>;
}

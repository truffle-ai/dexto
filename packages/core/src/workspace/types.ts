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
    readFileSize?(path: string): Promise<number>;
    readText(path: string): Promise<string>;
    glob(pattern: string): Promise<string[]>;
    writeFile(path: string, content: string): Promise<void>;
    listFiles(path?: string): Promise<string[]>;
}

export interface WorkspaceProcesses {
    /**
     * Run a shell command to completion. A non-zero exit is returned as `exitCode`, not thrown.
     * When `timeout` (milliseconds) elapses the command and everything it started are stopped and
     * `timedOut` is true. When `signal` aborts they are stopped and the output so far is returned.
     */
    exec(input: {
        command: string;
        cwd?: string;
        timeout?: number;
        signal?: AbortSignal;
    }): Promise<{ exitCode?: number; stdout: string; stderr: string; timedOut?: boolean }>;
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

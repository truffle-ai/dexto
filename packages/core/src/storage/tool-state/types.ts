export interface ToolStateStore {
    get<T>(input: { toolName: string; key: string }): Promise<T | undefined>;
    set<T>(input: { toolName: string; key: string; value: T }): Promise<void>;
    delete(input: { toolName: string; key: string }): Promise<void>;
    listKeys(input: { toolName: string; prefix?: string }): Promise<string[]>;
}

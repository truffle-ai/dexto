export interface RuntimeEventRecord {
    id: string;
    type: string;
    occurredAt: Date;
    sessionId?: string;
    runId?: string;
    payload: unknown;
}

export interface RuntimeEventStore {
    append(input: { event: RuntimeEventRecord }): Promise<void>;
    list(input: {
        sessionId?: string;
        runId?: string;
        limit?: number;
    }): Promise<RuntimeEventRecord[]>;
}

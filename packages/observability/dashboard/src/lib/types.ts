// API Response Types
export interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

// Health Status
export interface HealthStatus {
    agent: {
        status: string;
        uptime: number;
    };
    storage: {
        cache: boolean;
        database: boolean;
        blob: boolean;
    };
    telemetry: {
        enabled: boolean;
        traceCount: number;
        oldestTrace?: string;
        newestTrace?: string;
    };
}

// Trace Types
export interface Trace {
    id: string;
    traceId: string;
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
    status: {
        code: number;
        message?: string;
    };
    sessionId?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    errorMessage?: string;
    attributes?: Record<string, any>;
}

export interface PaginatedTraces {
    traces: Trace[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
    };
}

// Metrics Types
export interface Metrics {
    latency: {
        p50: number;
        p95: number;
        p99: number;
        mean: number;
    };
    errorRate: number;
    throughput: {
        total: number;
        perMinute: number;
    };
    tokenUsage?: {
        total: number;
        byProvider: Record<string, number>;
    };
    toolCalls?: {
        total: number;
        byTool: Record<string, number>;
        successRate: number;
    };
}

// Session Types
export interface SessionMetrics {
    sessionId: string;
    messageCount: number;
    totalDuration: number;
    averageDuration: number;
    errorCount: number;
    toolCallCount: number;
    tokenUsage?: number;
    traces: Trace[];
}

// Filter Types
export interface TraceFilters {
    sessionId?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    status?: 'ok' | 'error';
    window?: string;
}

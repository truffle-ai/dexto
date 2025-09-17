export type ResourceMetadata = {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
    source: 'mcp' | 'internal';
    serverName?: string;
    size?: number;
    lastModified?: string | Date;
    metadata?: Record<string, unknown>;
};

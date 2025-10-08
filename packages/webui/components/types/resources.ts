// TODO: (355) Dup: pull from core types
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413260535
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

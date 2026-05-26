export type ArtifactInput = string | Uint8Array | Buffer | ArrayBuffer;

export interface ArtifactMetadata {
    mimeType?: string;
    originalName?: string;
    createdAt?: Date;
    source?: 'tool' | 'user' | 'system';
    size?: number;
}

export interface StoredArtifactMetadata {
    id: string;
    mimeType: string;
    originalName?: string;
    createdAt: Date;
    size: number;
    hash: string;
    source?: 'tool' | 'user' | 'system';
}

export interface ArtifactReference {
    id: string;
    uri: string;
    metadata: StoredArtifactMetadata;
}

export type ArtifactFormat = 'base64' | 'buffer' | 'path' | 'stream' | 'url';

export type ArtifactData =
    | { format: 'base64'; data: string; metadata: StoredArtifactMetadata }
    | { format: 'buffer'; data: Buffer; metadata: StoredArtifactMetadata }
    | { format: 'path'; data: string; metadata: StoredArtifactMetadata }
    | { format: 'stream'; data: NodeJS.ReadableStream; metadata: StoredArtifactMetadata }
    | { format: 'url'; data: string; metadata: StoredArtifactMetadata };

export interface ArtifactStats {
    count: number;
    totalSize: number;
    backendType: string;
    storePath?: string;
}

export interface ArtifactStore {
    store(input: { data: ArtifactInput; metadata?: ArtifactMetadata }): Promise<ArtifactReference>;
    retrieve(input: { reference: string; format?: ArtifactFormat }): Promise<ArtifactData>;
    exists(input: { reference: string }): Promise<boolean>;
    delete(input: { reference: string }): Promise<void>;
    cleanup(input?: { olderThan?: Date }): Promise<number>;
    getStats(): Promise<ArtifactStats>;
    listArtifacts(): Promise<ArtifactReference[]>;
    getStoragePath(): string | undefined;
}

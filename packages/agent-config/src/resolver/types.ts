import type { BlobStore } from '@dexto/core';
import type { Cache } from '@dexto/core';
import type { Database } from '@dexto/core';
import type { Plugin } from '@dexto/core';
import type { CompactionStrategy } from '@dexto/core';
import type { Logger } from '@dexto/core';
import type { Tool } from '@dexto/core';

export interface ResolvedServices {
    logger: Logger;
    storage: { blob: BlobStore; database: Database; cache: Cache };
    tools: Tool[];
    hooks: Plugin[];
    compaction: CompactionStrategy | null;
}

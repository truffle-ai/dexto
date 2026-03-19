import type { BlobStore } from '@dexto/core';
import type { Cache } from '@dexto/core';
import type { Database } from '@dexto/core';
import type { Hook } from '@dexto/core';
import type { CompactionStrategy } from '@dexto/core';
import type { Logger } from '@dexto/core';
import type { Tool, ToolkitLoader } from '@dexto/core';

export interface ResolvedServices {
    logger: Logger;
    storage: { blob: BlobStore; database: Database; cache: Cache };
    tools: Tool[];
    toolkitLoader?: ToolkitLoader;
    availableToolkitTypes: string[];
    hooks: Hook[];
    compaction: CompactionStrategy | null;
}

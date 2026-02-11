import type { BlobStore } from '@dexto/core';
import type { Cache } from '@dexto/core';
import type { Database } from '@dexto/core';
import type { DextoPlugin } from '@dexto/core';
import type { IDextoLogger } from '@dexto/core';
import type { InternalTool as Tool } from '@dexto/core';

export interface ResolvedServices {
    logger: IDextoLogger;
    storage: { blob: BlobStore; database: Database; cache: Cache };
    tools: Tool[];
    plugins: DextoPlugin[];
}

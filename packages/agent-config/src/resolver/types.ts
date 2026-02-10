import type { BlobStore } from '@dexto/core';
import type { Cache } from '@dexto/core';
import type { Database } from '@dexto/core';
import type { DextoPlugin } from '@dexto/core';
import type { IDextoLogger } from '@dexto/core';
import type { ICompactionStrategy as CompactionStrategy } from '@dexto/core'; // TODO: temporary glue code to be removed/verified (remove-by: 5.1)
import type { InternalTool as Tool } from '@dexto/core'; // TODO: temporary glue code to be removed/verified (remove-by: 5.1)

export interface ResolvedServices {
    logger: IDextoLogger;
    storage: { blob: BlobStore; database: Database; cache: Cache };
    tools: Tool[];
    plugins: DextoPlugin[];
    compaction?: CompactionStrategy | undefined;
}

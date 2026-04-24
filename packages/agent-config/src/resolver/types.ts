import type { Hook } from '@dexto/core';
import type { CompactionStrategy } from '@dexto/core';
import type { Logger } from '@dexto/core';
import type { DextoStores } from '@dexto/core/storage';
import type { Tool, ToolkitLoader } from '@dexto/core';

export interface ResolvedServices {
    logger: Logger;
    stores: DextoStores;
    tools: Tool[];
    toolkitLoader?: ToolkitLoader;
    hooks: Hook[];
    compaction: CompactionStrategy | null;
}

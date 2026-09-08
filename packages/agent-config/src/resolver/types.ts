import type { Hook } from '@dexto/core';
import type { CompactionStrategy } from '@dexto/core';
import type { Logger } from '@dexto/core';
import type { DextoStores } from '@dexto/core/storage';
import type { Skills, Tool, ToolkitLoader } from '@dexto/core';
import type { WorkspaceHandleProvider } from '@dexto/core/workspace';

export interface ResolvedServices {
    logger: Logger;
    stores: DextoStores;
    tools: Tool[];
    skills?: Skills | undefined;
    toolkitLoader?: ToolkitLoader;
    workspaceHandleProvider?: WorkspaceHandleProvider;
    hooks: Hook[];
    compaction: CompactionStrategy | null;
}

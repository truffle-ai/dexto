import type { ToolFactory } from '@dexto/agent-config';
import type { Tool } from '@dexto/core';
import {
    LifecycleToolsConfigSchema,
    type LifecycleToolsConfig,
    LIFECYCLE_TOOL_NAMES,
} from './tool-factory-config.js';
import { createViewLogsTool } from './view-logs-tool.js';
import {
    createMemoryListTool,
    createMemoryGetTool,
    createMemoryCreateTool,
    createMemoryUpdateTool,
    createMemoryDeleteTool,
} from './memory-tools.js';

type LifecycleToolName = (typeof LIFECYCLE_TOOL_NAMES)[number];

export const lifecycleToolsFactory: ToolFactory<LifecycleToolsConfig> = {
    configSchema: LifecycleToolsConfigSchema,
    metadata: {
        displayName: 'Lifecycle Tools',
        description: 'Self-observation tools (logs, memories)',
        category: 'lifecycle',
    },
    create: (config) => {
        const toolCreators: Record<LifecycleToolName, () => Tool> = {
            view_logs: () =>
                createViewLogsTool({
                    maxLogLines: config.maxLogLines,
                    maxLogBytes: config.maxLogBytes,
                }),
            memory_list: () => createMemoryListTool(),
            memory_get: () => createMemoryGetTool(),
            memory_create: () => createMemoryCreateTool(),
            memory_update: () => createMemoryUpdateTool(),
            memory_delete: () => createMemoryDeleteTool(),
        };

        const toolsToCreate = config.enabledTools ?? LIFECYCLE_TOOL_NAMES;
        return toolsToCreate.map((toolName) => toolCreators[toolName]());
    },
};

import { z } from 'zod';
import type { ToolFactory } from '@dexto/agent-config';
import type { InternalTool } from '@dexto/core';
import { createAskUserTool } from './implementations/ask-user-tool.js';
import { createDelegateToUrlTool } from './implementations/delegate-to-url-tool.js';
import { createGetResourceTool } from './implementations/get-resource-tool.js';
import { createInvokeSkillTool } from './implementations/invoke-skill-tool.js';
import { createListResourcesTool } from './implementations/list-resources-tool.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';

export const BUILTIN_TOOL_NAMES = [
    'ask_user',
    'search_history',
    'delegate_to_url',
    'list_resources',
    'get_resource',
    'invoke_skill',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

const BuiltinToolNameSchema = z.enum(BUILTIN_TOOL_NAMES);

export const BuiltinToolsConfigSchema = z
    .object({
        type: z.literal('builtin-tools'),
        enabledTools: z.array(BuiltinToolNameSchema).optional(),
    })
    .strict();

export type BuiltinToolsConfig = z.output<typeof BuiltinToolsConfigSchema>;

function createToolByName(name: BuiltinToolName): InternalTool {
    switch (name) {
        case 'ask_user':
            return createAskUserTool();
        case 'search_history':
            return createSearchHistoryTool();
        case 'delegate_to_url':
            return createDelegateToUrlTool();
        case 'list_resources':
            return createListResourcesTool();
        case 'get_resource':
            return createGetResourceTool();
        case 'invoke_skill':
            return createInvokeSkillTool();
        default: {
            const exhaustive: never = name;
            throw new Error(`Unknown builtin tool: ${exhaustive}`);
        }
    }
}

export const builtinToolsFactory: ToolFactory<BuiltinToolsConfig> = {
    configSchema: BuiltinToolsConfigSchema,
    metadata: {
        displayName: 'Built-in tools',
        description: 'Core built-in tools shipped with Dexto',
        category: 'core',
    },
    create: (config) => {
        const enabled = config.enabledTools ?? [...BUILTIN_TOOL_NAMES];
        return enabled.map(createToolByName);
    },
};

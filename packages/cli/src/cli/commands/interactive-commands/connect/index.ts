/**
 * Connect Commands Module
 *
 * Provider connect commands for interactive CLI.
 */

import type { CommandDefinition } from '../command-parser.js';
import { handleConnectCommand } from '../../connect/index.js';

export const connectCommand: CommandDefinition = {
    name: 'connect',
    description: 'Connect an LLM provider (OAuth, API keys, tokens)',
    usage: '/connect',
    category: 'General',
    handler: async () => {
        await handleConnectCommand({ interactive: true });
        return true;
    },
};

/**
 * Auth Commands Module
 *
 * Authentication commands for interactive CLI.
 */

import type { CommandDefinition } from '../command-parser.js';
import { handleLoginCommand } from '../../auth/login.js';

/**
 * Login command - triggers OAuth flow for Dexto authentication
 * Only available when DEXTO_FEATURE_AUTH=true
 */
export const loginCommand: CommandDefinition = {
    name: 'login',
    description: 'Login to Dexto',
    usage: '/login',
    category: 'General',
    handler: async () => {
        await handleLoginCommand({ interactive: true });
        return true;
    },
};

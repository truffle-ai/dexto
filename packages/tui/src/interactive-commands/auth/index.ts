/**
 * Auth Commands Module
 *
 * Authentication commands for interactive CLI.
 */

import type { CommandDefinition } from '../command-parser.js';
import { overlayOnlyHandler } from '../command-parser.js';

/**
 * Login command - triggers OAuth flow for Dexto authentication
 * Only available when DEXTO_FEATURE_AUTH=true
 */
export const loginCommand: CommandDefinition = {
    name: 'login',
    description: 'Login to Dexto',
    usage: '/login',
    category: 'General',
    handler: overlayOnlyHandler,
};

export const logoutCommand: CommandDefinition = {
    name: 'logout',
    description: 'Logout from Dexto',
    usage: '/logout',
    category: 'General',
    handler: overlayOnlyHandler,
};

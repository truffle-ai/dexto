/**
 * Documentation Commands Module
 *
 * This module defines documentation-related slash commands for the Dexto CLI interface.
 * These commands provide functionality for accessing documentation and help resources.
 *
 * Available Documentation Commands:
 * - /docs, /doc - Open Dexto documentation in browser
 */

import chalk from 'chalk';
import type { DextoAgent } from '@dexto/core';
import type { CommandDefinition } from './command-parser.js';
import { CommandOutputHelper } from './utils/command-output.js';

/**
 * Documentation commands
 */
export const documentationCommands: CommandDefinition[] = [
    {
        name: 'docs',
        description: 'Open Dexto documentation in browser',
        usage: '/docs',
        category: 'Documentation',
        aliases: ['doc'],
        handler: async (_args: string[], _agent: DextoAgent): Promise<boolean | string> => {
            const docsUrl = 'https://docs.dexto.ai/docs/category/getting-started';
            try {
                const { spawn } = await import('child_process');

                console.log(chalk.blue(`🌐 Opening Dexto documentation: ${docsUrl}`));

                // Cross-platform browser opening
                const command =
                    process.platform === 'darwin'
                        ? 'open'
                        : process.platform === 'win32'
                          ? 'start'
                          : 'xdg-open';

                spawn(command, [docsUrl], { detached: true, stdio: 'ignore' });
                return CommandOutputHelper.success('✅ Documentation opened in browser');
            } catch (error) {
                console.log(chalk.yellow(`💡 You can manually visit: ${docsUrl}`));
                return CommandOutputHelper.error(error, 'Failed to open documentation');
            }
        },
    },
];

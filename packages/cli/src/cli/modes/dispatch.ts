import { safeExit } from '../../analytics/wrapper.js';
import type { MainModeContext } from './context.js';

export async function dispatchMainMode(context: MainModeContext): Promise<void> {
    const mode = context.opts.mode ?? 'web';

    switch (mode) {
        case 'cli': {
            const { runCliMode } = await import('./cli.js');
            await runCliMode(context);
            return;
        }

        case 'web': {
            const { runWebMode } = await import('./web.js');
            await runWebMode(context);
            return;
        }

        case 'server': {
            const { runServerMode } = await import('./server.js');
            await runServerMode(context);
            return;
        }

        case 'mcp': {
            const { runMcpMode } = await import('./mcp.js');
            await runMcpMode(context);
            return;
        }

        default:
            if (mode === 'discord' || mode === 'telegram') {
                console.error(`❌ Error: '${mode}' mode has been moved to examples`);
                console.error('');
                console.error(
                    `The ${mode} bot is now a standalone example that you can customize.`
                );
                console.error('');
                console.error(`📖 See: examples/${mode}-bot/README.md`);
                console.error('');
                console.error('To run it:');
                console.error(`  cd examples/${mode}-bot`);
                console.error('  pnpm install');
                console.error('  pnpm start');
            } else {
                console.error(`❌ Unknown mode '${mode}'. Use web, cli, server, or mcp.`);
            }
            safeExit('main', 1, 'unknown-mode');
    }
}

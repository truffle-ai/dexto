import chalk from 'chalk';
import { getPort } from '../../utils/port-utils.js';
import type { MainModeContext } from './context.js';

export async function runWebMode(context: MainModeContext): Promise<void> {
    const { agent, opts, derivedAgentId, resolvedPath, getVersionCheckResult } = context;

    const [{ resolveWebRoot }, { startHonoApiServer }, { getWebUIAnalyticsConfig }] =
        await Promise.all([
            import('../../web.js'),
            import('../../api/server-hono.js'),
            import('../../analytics/index.js'),
        ]);

    const defaultPort = (() => {
        if (!opts.port) {
            return 3000;
        }

        const rawPort = opts.port.trim();
        const parsedPort = Number(rawPort);
        if (
            !/^\d+$/.test(rawPort) ||
            !Number.isInteger(parsedPort) ||
            parsedPort <= 0 ||
            parsedPort > 65535
        ) {
            throw new Error(`Invalid --port value "${opts.port}". Use a port between 1 and 65535.`);
        }

        return parsedPort;
    })();
    const port = getPort(process.env.PORT, defaultPort, 'PORT');
    const serverUrl = process.env.DEXTO_URL ?? `http://localhost:${port}`;

    const webRoot = resolveWebRoot();
    if (!webRoot) {
        console.warn(chalk.yellow('⚠️  WebUI not found in this build.'));
        console.info('For production: Run "pnpm build:all" to embed the WebUI');
        console.info('For development: Run "pnpm dev" for hot reload');
    }

    const webUIConfig = webRoot ? { analytics: await getWebUIAnalyticsConfig() } : undefined;

    await startHonoApiServer(
        agent,
        port,
        agent.config.agentCard || {},
        derivedAgentId,
        resolvedPath,
        webRoot,
        webUIConfig
    );

    console.log(chalk.green(`✅ Server running at ${serverUrl}`));

    const webUpdateInfo = await getVersionCheckResult();
    if (webUpdateInfo) {
        const { displayUpdateNotification } = await import('../utils/version-check.js');
        displayUpdateNotification(webUpdateInfo);
    }

    if (webRoot) {
        try {
            const { default: open } = await import('open');
            await open(serverUrl, { wait: false });
            console.log(chalk.green(`🌐 Opened WebUI in browser: ${serverUrl}`));
        } catch (_error) {
            console.log(chalk.yellow(`💡 WebUI is available at: ${serverUrl}`));
        }
    }
}

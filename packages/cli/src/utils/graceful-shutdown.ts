import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';

export function registerGracefulShutdown(getCurrentAgent: () => DextoAgent): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGUSR2'];

    let isShuttingDown = false;

    signals.forEach((signal) => {
        process.on(signal, async () => {
            if (isShuttingDown) return; // Prevent multiple shutdowns
            isShuttingDown = true;

            logger.info(`Received ${signal}, shutting down gracefully...`);
            try {
                const agent = getCurrentAgent();
                await agent.stop(); // Use existing comprehensive shutdown
                process.exit(0);
            } catch (error) {
                logger.error(
                    `Shutdown error: ${error instanceof Error ? error.message : String(error)}`,
                    { error }
                );
                process.exit(1);
            }
        });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
        logger.error(
            `Uncaught exception: ${error instanceof Error ? error.message : String(error)}`,
            { error },
            'red'
        );
        if (!isShuttingDown) {
            isShuttingDown = true;
            try {
                const agent = getCurrentAgent();
                await agent.stop();
            } catch (innerError) {
                logger.error(
                    `Error during shutdown initiated by uncaughtException: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
                    { error: innerError }
                );
            }
        }
        process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
        logger.error(`Unhandled rejection: ${reason}`, { reason }, 'red');
        if (!isShuttingDown) {
            isShuttingDown = true;
            try {
                const agent = getCurrentAgent();
                await agent.stop();
            } catch (innerError) {
                logger.error(
                    `Error during shutdown initiated by unhandledRejection: ${innerError instanceof Error ? innerError.message : String(innerError)}`,
                    { error: innerError }
                );
            }
        }
        process.exit(1);
    });
}

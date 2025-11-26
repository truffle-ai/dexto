import type { DextoAgent } from '@dexto/core';
import { logger } from '@dexto/core';

export interface GracefulShutdownOptions {
    /**
     * When true, the first SIGINT is ignored to let the application handle it
     * (e.g., for Ink CLI which needs to handle Ctrl+C for cancellation/exit warning).
     * A second SIGINT within the timeout will force exit.
     */
    inkMode?: boolean;
    /**
     * Timeout in ms before force exit in ink mode (default: 3000ms)
     */
    forceExitTimeout?: number;
}

export function registerGracefulShutdown(
    getCurrentAgent: () => DextoAgent,
    options: GracefulShutdownOptions = {}
): void {
    const { inkMode = false, forceExitTimeout = 3000 } = options;
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGUSR2'];

    // For SIGINT, handle separately based on mode
    if (!inkMode) {
        signals.push('SIGINT');
    }

    let isShuttingDown = false;

    const performShutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        logger.info(`Received ${signal}, shutting down gracefully...`);
        try {
            const agent = getCurrentAgent();
            await agent.stop();
            process.exit(0);
        } catch (error) {
            logger.error(
                `Shutdown error: ${error instanceof Error ? error.message : String(error)}`,
                { error }
            );
            process.exit(1);
        }
    };

    signals.forEach((signal) => {
        process.on(signal, () => performShutdown(signal));
    });

    // In ink mode, handle SIGINT specially - allow first one to pass through to Ink
    if (inkMode) {
        let firstSigintTime: number | null = null;

        process.on('SIGINT', () => {
            const now = Date.now();

            // If already shutting down, ignore
            if (isShuttingDown) return;

            // First SIGINT - record time and let Ink handle it
            if (firstSigintTime === null) {
                firstSigintTime = now;

                // Set timeout to clear the "first sigint" state
                setTimeout(() => {
                    if (
                        firstSigintTime !== null &&
                        Date.now() - firstSigintTime >= forceExitTimeout
                    ) {
                        firstSigintTime = null;
                    }
                }, forceExitTimeout);

                // Don't exit - let Ink handle it
                return;
            }

            // Second SIGINT within timeout - force exit
            if (now - firstSigintTime < forceExitTimeout) {
                void performShutdown('SIGINT (force)');
            } else {
                // Timeout expired, treat as new first SIGINT
                firstSigintTime = now;
            }
        });
    }

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

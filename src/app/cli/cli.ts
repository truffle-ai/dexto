import readline from 'readline';
import chalk from 'chalk';
import { logger } from '@core/index.js';
import { CLISubscriber } from './cli-subscriber.js';
import { DextoAgent } from '@core/index.js';
import { parseInput } from './interactive-commands/command-parser.js';
import { executeCommand } from './interactive-commands/commands.js';
import { getDextoPath } from '@core/utils/path.js';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import {
    DextoRuntimeError,
    DextoValidationError,
    LLMErrorCode,
    ErrorScope,
} from '@core/errors/index.js';

/**
 * Find and load the most recent session based on lastActivity.
 * This provides better UX than always loading the "default" session.
 */
async function loadMostRecentSession(agent: DextoAgent): Promise<void> {
    try {
        const sessionIds = await agent.listSessions();

        if (sessionIds.length === 0) {
            // No sessions exist, let agent create default
            logger.debug('No existing sessions found, will use default session');
            return;
        }

        // Find the session with the most recent activity
        let mostRecentSession = sessionIds[0];
        let mostRecentActivity = 0;

        for (const sessionId of sessionIds) {
            const metadata = await agent.getSessionMetadata(sessionId);
            if (metadata && metadata.lastActivity > mostRecentActivity) {
                mostRecentActivity = metadata.lastActivity;
                mostRecentSession = sessionId;
            }
        }

        // Load the most recent session if it's not already current
        const currentSessionId = agent.getCurrentSessionId();
        if (mostRecentSession !== currentSessionId) {
            await agent.loadSession(mostRecentSession);
            logger.info(`Loaded session: ${mostRecentSession}`, null, 'cyan');
        }
    } catch (error) {
        // If anything fails, just continue with current session
        logger.debug(
            `Failed to load most recent session: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Initializes common CLI setup: logging, event subscriptions, tool loading.
 * @param agent The DextoAgent instance providing access to all required services
 */
async function _initCli(agent: DextoAgent): Promise<void> {
    await loadMostRecentSession(agent);
    registerGracefulShutdown(agent);
    // Log connection info
    logger.debug(`Log level: ${logger.getLevel()}`);
    logger.info(`Connected servers: ${agent.mcpManager.getClients().size}`, null, 'green');
    const failedConnections = agent.mcpManager.getFailedConnections();
    if (Object.keys(failedConnections).length > 0) {
        logger.error(`Failed connections: ${Object.keys(failedConnections).length}.`, null, 'red');
    }

    // Reset conversation
    // await agent.resetConversation();

    // Set up event management
    logger.info('Setting up CLI event subscriptions...');
    const cliSubscriber = new CLISubscriber();
    cliSubscriber.subscribe(agent.agentEventBus);

    // Load available tools
    logger.info('Loading available tools...');
    try {
        const toolStats = await agent.toolManager.getToolStats();

        logger.info(
            `Loaded ${toolStats.total} total tools: ${toolStats.mcp} MCP, ${toolStats.internal} internal`
        );
    } catch (error) {
        logger.error(
            `Failed to load tools: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    logger.info(`CLI initialized successfully. Ready for input.`, null, 'green');

    // Show welcome message with slash command instructions
    console.log(chalk.bold.cyan('\n🚀 Welcome to Dexto CLI!'));
    console.log(chalk.dim('• Type your message normally to chat with the AI'));
    console.log(chalk.dim('• Use /command for system commands (e.g., /help, /session, /model)'));
    console.log(chalk.dim('• Type /help to see all available commands'));
    const logPath = getDextoPath('logs', 'dexto.log');
    console.log(chalk.dim(`• Logs available in ${logPath}\n`));
}

/**
 * Run the AI CLI with the given LLM service
 * @param agent Dexto agent instance
 */
export async function startAiCli(agent: DextoAgent) {
    try {
        // Common initialization
        await _initCli(agent);

        // Create readline interface
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: chalk.bold.green('\nWhat would you like to do? '),
        });

        // Make sure stdin is in flowing mode
        process.stdin.resume();
        rl.prompt();

        // Main interaction loop - simplified with question-based approach
        const promptUser = () => {
            return new Promise<string>((resolve) => {
                // Check if stdin is still connected/readable
                if (!process.stdin.isTTY) {
                    logger.warn('Input stream closed. Exiting CLI.');
                    resolve('exit'); // Simulate exit command
                    return;
                }
                process.stdin.resume();
                rl.question(
                    chalk.bold.green('\nWhat would you like to do? (type /help for commands) '),
                    (answer) => {
                        resolve(answer.trim());
                    }
                );
            });
        };

        async function handleInput(input: string): Promise<boolean> {
            const parsed = parseInput(input);

            if (parsed.type === 'command') {
                // Handle slash command
                if (!parsed.command) {
                    console.log(chalk.yellow('💡 Type /help to see available commands'));
                    return true;
                }

                return await executeCommand(parsed.command, parsed.args || [], agent);
            } else {
                // Handle regular prompt - pass to AI
                return false;
            }
        }

        try {
            while (true) {
                const userInput = await promptUser();

                if (await handleInput(userInput)) {
                    continue;
                }

                try {
                    // Simply call run - all updates happen via events
                    await agent.run(userInput);
                } catch (error) {
                    logger.error(
                        `Error in processing input: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }
        } finally {
            // Ensure cleanup happens even if the loop breaks unexpectedly
            rl.close();
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error during CLI initialization: ${errorMessage}`);
        process.exit(1); // Exit with error code if CLI setup fails
    }
}

/**
 * Run a single headless command via CLI without interactive prompt
 * @param agent The DextoAgent instance providing access to all required services
 * @param prompt The user input to process
 */
export async function startHeadlessCli(agent: DextoAgent, prompt: string): Promise<void> {
    // Common initialization
    await _initCli(agent);
    try {
        // Check if this is a slash command
        const parsed = parseInput(prompt);

        if (parsed.type === 'command') {
            // Execute slash command
            if (!parsed.command) {
                console.log(
                    chalk.yellow('💡 No command specified. Use /help to see available commands')
                );
                return;
            }

            await executeCommand(parsed.command, parsed.args || [], agent);
        } else {
            // Execute the task as a regular AI prompt
            // uncomment if we need to reset conversation for headless mode
            // await agent.resetConversation();
            await agent.run(prompt);
        }
    } catch (error: unknown) {
        if (error instanceof DextoRuntimeError && error.code === LLMErrorCode.MODEL_UNKNOWN) {
            logger.error(`LLM error: ${error.message}`, null, 'red');
        } else if (error instanceof DextoValidationError) {
            logger.error(`Validation failed:`, null, 'red');
            error.errors.forEach((err) => {
                logger.error(`  - ${err.message}`, null, 'red');
            });
        } else if (error instanceof DextoRuntimeError && error.scope === ErrorScope.CONFIG) {
            logger.error(`Configuration error: ${error.message}`, null, 'red');
        } else {
            logger.error(
                `Error in processing input: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        process.exit(1); // Exit with error code if headless execution fails
    }
}

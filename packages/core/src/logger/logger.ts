/**
 * TODO(logger-browser-safety): Make logging environment-safe without breaking consumers
 *
 * Problem
 * - The core logger is Node-only (winston + fs/path + file IO). If any module that depends on this
 *   logger is included in a browser bundle (directly or via an overly broad root export), Web UI builds
 *   can fail. Today our Web UI only imports types and a small util, so bundlers tree‑shake away the
 *   Node logger, but this is fragile if future UI imports include runtime modules.
 *
 * Constraints/Goals
 * - Keep file-based logging as the default for Node (excellent DX/UX).
 * - Keep logs visible in the browser (console-based), never a no‑op.
 * - Avoid touching "a lot of files" or changing call sites for consumers.
 * - Keep `@dexto/core` ergonomic; browser consumers should not have to learn a separate API.
 *
 * Plan (incremental)
 * 1) Introduce an environment-aware logging boundary:
 *    - Create a browser-safe logger implementation (console-based) that matches the logger API.
 *    - Expose logging via a subpath `@dexto/core/logger` and add conditional exports so that:
 *      - Browser resolves to the console logger
 *      - Node resolves to this file-based logger (current Winston version)
 *    - Alternative: use the `browser` field in package.json to alias the Node logger file to a
 *      browser-safe implementation at bundle time. Subpath conditional exports are preferred for clarity.
 *
 * 2) Keep the root export of `@dexto/core` browser-safe by default:
 *    - Continue to expose types and UI-safe helpers from the root.
 *    - Keep Node-only modules (storage/config/agent-registry/etc.) on explicit subpaths so browser
 *      builds do not pull them accidentally.
 *
 * 3) Optional API ergonomics:
 *    - Provide a top-level `Dexto` object (runtime orchestrator) that accepts a `logger` in its config
 *      and propagates it to sub-services (MCP manager, storage, etc.). This allows injection without
 *      consumers needing to import Node-only loggers.
 *
 * 4) UI safety now (tactical):
 *    - Ensure the Web UI imports types with `import type { ... } from '@dexto/core'` and uses API calls
 *      for runtime. This avoids bundling Node code until the logger split is implemented.
 *
 * Verification & Guardrails
 * - Add a CI check that building a minimal Next/Vite app that imports root `@dexto/core` types succeeds.
 * - Mark side-effect status appropriately and keep top-level Node-only side effects out of root paths.
 */

/**
 * TODO (Telemetry): Integrate OpenTelemetry structured logs with trace correlation
 *
 * Future Enhancement:
 * - Replace or enhance Winston logger with OpenTelemetry Logs API
 * - Automatically inject trace_id and span_id into all log messages
 * - Enable correlation between traces and logs in observability backends
 * - Support OpenTelemetry log exporters (OTLP, console, etc.)
 *
 * Benefits:
 * - Unified observability: traces, metrics, and logs in one system
 * - Click on trace in Jaeger → see correlated logs
 * - Click on log → see full trace context
 *
 * Implementation:
 * - Use @opentelemetry/api-logs package
 * - Create OTel-aware logger that wraps or replaces Winston
 * - Maintain existing logger API for backward compatibility
 * See feature-plans/telemetry.md for details
 */
import * as winston from 'winston';
import chalk from 'chalk';
import boxen from 'boxen';
import * as fs from 'fs';
import * as path from 'path';

// Winston logger configuration
const logLevels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6,
};

// Available chalk colors for message formatting
type ChalkColor =
    | 'black'
    | 'red'
    | 'green'
    | 'yellow'
    | 'blue'
    | 'magenta'
    | 'cyan'
    | 'white'
    | 'gray'
    | 'grey'
    | 'blackBright'
    | 'redBright'
    | 'greenBright'
    | 'yellowBright'
    | 'blueBright'
    | 'magentaBright'
    | 'cyanBright'
    | 'whiteBright';

// Custom format for console output
const consoleFormat = winston.format.printf(({ level, message, timestamp, color }) => {
    const levelColorMap: Record<string, (text: string) => string> = {
        error: chalk.red,
        warn: chalk.yellow,
        info: chalk.blue,
        http: chalk.cyan,
        verbose: chalk.magenta,
        debug: chalk.gray,
        silly: chalk.gray.dim,
    };

    const colorize = levelColorMap[level] || chalk.white;

    // Apply color to message if specified
    const formattedMessage =
        color && typeof color === 'string' && chalk[color as ChalkColor]
            ? chalk[color as ChalkColor](message)
            : message;

    return `${chalk.dim(timestamp)} ${colorize(level.toUpperCase())}: ${formattedMessage}`;
});

/**
 * Logic to redact sensitive information from logs.
 * This is useful for preventing sensitive information from being logged in production.
 * On by default, we can set the environment variable REDACT_SECRETS to false to disable this behavior.
 */
const SHOULD_REDACT = process.env.REDACT_SECRETS !== 'false';
const SENSITIVE_KEYS = ['apiKey', 'password', 'secret', 'token'];
const MASK_REGEX = new RegExp(
    `(${SENSITIVE_KEYS.join('|')})(["']?\\s*[:=]\\s*)(["'])?.*?\\3`,
    'gi'
);
const maskFormat = winston.format((info) => {
    if (SHOULD_REDACT && typeof info.message === 'string') {
        info.message = info.message.replace(MASK_REGEX, '$1$2$3[REDACTED]$3');
    }
    return info;
});

export interface LoggerOptions {
    level?: string;
    silent?: boolean;
    logToConsole?: boolean;
    customLogPath?: string;
}

// Helper to get default log level from environment or fallback to 'info'
const getDefaultLogLevel = (): string => {
    const envLevel = process.env.DEXTO_LOG_LEVEL;
    if (envLevel && Object.keys(logLevels).includes(envLevel.toLowerCase())) {
        return envLevel.toLowerCase();
    }
    return 'info';
};

export class Logger {
    private logger: winston.Logger;
    private isSilent: boolean = false;
    private logFilePath: string | null = null;
    private logToConsole: boolean = false;

    constructor(options: LoggerOptions = {}) {
        this.isSilent = options.silent || false;

        // Initialize transports synchronously
        this.initializeTransports(options);

        // Create logger with transports
        this.logger = winston.createLogger({
            levels: logLevels,
            level: options.level || getDefaultLogLevel(),
            silent: options.silent || false,
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                maskFormat(),
                winston.format.errors({ stack: true }),
                winston.format.splat(),
                winston.format.json()
            ),
            transports: this.createTransports(options),
        });
    }

    private initializeTransports(options: LoggerOptions) {
        // Check if console logging should be enabled for Winston logs
        // Default to false (file-only logging), enable only when explicitly requested
        const logToConsole = options.logToConsole ?? process.env.DEXTO_LOG_TO_CONSOLE === 'true';
        this.logToConsole = logToConsole;

        // Set up file logging path only if explicitly provided
        // File logging is optional - CLI enrichment layer provides paths for v2 logger
        if (options.customLogPath) {
            this.logFilePath = options.customLogPath;
        } else {
            this.logFilePath = null;
        }
    }

    private createTransports(_options: LoggerOptions): winston.transport[] {
        const transports: winston.transport[] = [];

        // Add console transport if enabled
        if (this.logToConsole) {
            transports.push(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({ format: 'HH:mm:ss' }),
                        maskFormat(),
                        consoleFormat
                    ),
                })
            );
        }

        // Add file transport only if path is provided
        if (this.logFilePath) {
            try {
                // Ensure log directory exists
                const logDir = path.dirname(this.logFilePath);
                fs.mkdirSync(logDir, { recursive: true });

                transports.push(
                    new winston.transports.File({
                        filename: this.logFilePath,
                        format: winston.format.combine(
                            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                            maskFormat(),
                            winston.format.errors({ stack: true }),
                            winston.format.json()
                        ),
                        // Add daily rotation
                        maxsize: 10 * 1024 * 1024, // 10MB
                        maxFiles: 7, // Keep 7 files
                        tailable: true,
                    })
                );
            } catch (error) {
                // If file logging fails, fall back to console
                console.error(
                    `Failed to initialize file logging: ${error}. Falling back to console.`
                );
                if (!this.logToConsole) {
                    this.logToConsole = true;
                    transports.push(
                        new winston.transports.Console({
                            format: winston.format.combine(
                                winston.format.timestamp({ format: 'HH:mm:ss' }),
                                maskFormat(),
                                consoleFormat
                            ),
                        })
                    );
                }
            }
        }

        // Ensure at least one transport exists (console fallback)
        if (transports.length === 0) {
            this.logToConsole = true;
            transports.push(
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.timestamp({ format: 'HH:mm:ss' }),
                        maskFormat(),
                        consoleFormat
                    ),
                })
            );
        }

        return transports;
    }

    // General logging methods with optional color parameter
    error(message: string, meta?: any, color?: ChalkColor) {
        // Handle Error objects specially to preserve stack traces
        if (meta instanceof Error) {
            this.logger.error(message, meta);
        } else {
            this.logger.error(message, { ...meta, color });
        }
    }

    warn(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.warn(message, meta);
        } else {
            this.logger.warn(message, { ...meta, color });
        }
    }

    info(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.info(message, meta);
        } else {
            this.logger.info(message, { ...meta, color });
        }
    }

    http(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.http(message, meta);
        } else {
            this.logger.http(message, { ...meta, color });
        }
    }

    verbose(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.verbose(message, meta);
        } else {
            this.logger.verbose(message, { ...meta, color });
        }
    }

    debug(message: string | object, meta?: any, color?: ChalkColor) {
        const formattedMessage =
            typeof message === 'string' ? message : JSON.stringify(message, null, 2);
        if (meta instanceof Error) {
            this.logger.debug(formattedMessage, meta);
        } else {
            this.logger.debug(formattedMessage, { ...meta, color });
        }
    }

    silly(message: string, meta?: any, color?: ChalkColor) {
        if (meta instanceof Error) {
            this.logger.silly(message, meta);
        } else {
            this.logger.silly(message, { ...meta, color });
        }
    }

    // Display AI response in a box
    displayAIResponse(response: any) {
        if (this.isSilent) return;

        if (response.content) {
            console.log(
                boxen(chalk.white(response.content), {
                    padding: 1,
                    borderColor: 'yellow',
                    title: '🤖 AI Response',
                    titleAlignment: 'center',
                })
            );
        } else {
            console.log(chalk.yellow('AI is thinking...'));
        }
    }

    // Tool-related logging
    toolCall(toolName: string, args: any) {
        if (this.isSilent) return;
        console.log(
            boxen(
                `${chalk.cyan('Tool Call')}: ${chalk.yellow(toolName)}\n${chalk.dim('Arguments')}:\n${chalk.white(JSON.stringify(args, null, 2))}`,
                { padding: 1, borderColor: 'blue', title: '🔧 Tool Call', titleAlignment: 'center' }
            )
        );
    }

    toolResult(result: any) {
        if (this.isSilent) return;
        let displayText = '';
        let isError = false;
        let borderColor = 'green';
        let title = '✅ Tool Result';

        // Check if result indicates an error
        if (result?.error || result?.isError) {
            isError = true;
            borderColor = 'yellow';
            title = '⚠️ Tool Result (Error)';
        }

        // Handle different result formats
        if (result?.content && Array.isArray(result.content)) {
            // Standard MCP format with content array
            result.content.forEach((item: any) => {
                if (item.type === 'text') {
                    displayText += item.text;
                } else if (item.type === 'image' && item.url) {
                    displayText += `[Image URL: ${item.url}]`;
                } else if (item.type === 'image') {
                    displayText += `[Image Data: ${item.mimeType || 'unknown type'}]`;
                } else if (item.type === 'markdown') {
                    displayText += item.markdown;
                } else {
                    displayText += `[Unsupported content type: ${item.type}]`;
                }
                displayText += '\n';
            });
        } else if (result?.message) {
            // Error message format
            displayText = result.message;
            isError = true;
            borderColor = 'red';
            title = '❌ Tool Error';
        } else if (typeof result === 'string') {
            // Plain string response - truncate if too long
            if (result.length > 1000) {
                displayText = `${result.slice(0, 500)}... [${result.length - 500} chars omitted]`;
            } else {
                displayText = result;
            }
        } else {
            // Fallback for any other format - truncate if too long
            try {
                const resultStr = JSON.stringify(result, null, 2);
                if (resultStr.length > 2000) {
                    displayText = `${resultStr.slice(0, 1000)}... [${resultStr.length - 1000} chars omitted]`;
                } else {
                    displayText = resultStr;
                }
            } catch {
                displayText = `[Unparseable result: ${typeof result}]`;
            }
        }

        // Format empty results
        if (!displayText || displayText.trim() === '') {
            displayText = '[Empty result]';
        }

        // Apply color based on error status
        const textColor = isError ? chalk.yellow : chalk.green;
        console.log(
            boxen(textColor(displayText), {
                padding: 1,
                borderColor,
                title,
                titleAlignment: 'center',
            })
        );
    }

    // Configuration
    setLevel(level: string) {
        if (Object.keys(logLevels).includes(level.toLowerCase())) {
            this.logger.level = level.toLowerCase();
            // Ensure we do not bypass silent / file-only modes
            if (!this.isSilent) {
                console.log(`Log level set to: ${level}`);
            }
        } else {
            this.error(`Invalid log level: ${level}. Using current level: ${this.logger.level}`);
        }
    }

    // Get the current log file path
    getLogFilePath(): string | null {
        return this.logFilePath;
    }

    // Get current log level
    getLevel(): string {
        return this.logger.level;
    }

    // CLI startup information display methods
    displayStartupInfo(info: {
        configPath?: string;
        model?: string;
        provider?: string;
        connectedServers?: { count: number; names: string[] };
        failedConnections?: { [key: string]: string };
        toolStats?: { total: number; mcp: number; internal: number };
        sessionId?: string;
        logLevel?: string;
        logFile?: string;
    }) {
        if (this.isSilent) return;

        console.log(''); // Add spacing

        if (info.configPath) {
            console.log(`📄 ${chalk.bold('Config:')} ${chalk.dim(info.configPath)}`);
        }

        if (info.model && info.provider) {
            console.log(
                `🤖 ${chalk.bold('Current Model:')} ${chalk.cyan(info.model)} ${chalk.dim(`(${info.provider})`)}`
            );
        }

        if (info.connectedServers) {
            if (info.connectedServers.count > 0) {
                const serverNames = info.connectedServers.names.join(', ');
                console.log(
                    `🔗 ${chalk.bold('Connected Servers:')} ${chalk.green(info.connectedServers.count)} ${chalk.dim(`(${serverNames})`)}`
                );
            } else {
                console.log(
                    `🔗 ${chalk.bold('Connected Servers:')} ${chalk.yellow('0')} ${chalk.dim('(no MCP servers connected)')}`
                );
            }
        }

        if (info.failedConnections && Object.keys(info.failedConnections).length > 0) {
            const failedNames = Object.keys(info.failedConnections);
            console.log(
                `❌ ${chalk.bold('Failed Connections:')} ${chalk.red(failedNames.length)} ${chalk.dim(`(${failedNames.join(', ')})`)}`
            );
            // Show specific error details
            for (const [serverName, error] of Object.entries(info.failedConnections)) {
                console.log(`   ${chalk.red('•')} ${chalk.dim(serverName)}: ${chalk.red(error)}`);
            }
        }

        if (info.toolStats) {
            console.log(
                `🛠️  ${chalk.bold('Available Tools:')} ${chalk.green(info.toolStats.total)} total ${chalk.dim(`(${info.toolStats.mcp} MCP, ${info.toolStats.internal} internal)`)}`
            );
        }

        if (info.sessionId) {
            console.log(`💬 ${chalk.bold('Session:')} ${chalk.blue(info.sessionId)}`);
        }

        if (info.logLevel && info.logFile) {
            console.log(
                `📋 ${chalk.bold('Log Level:')} ${chalk.cyan(info.logLevel)} ${chalk.dim(`(file: ${info.logFile})`)}`
            );
        }
    }

    displayError(message: string, error?: Error) {
        if (this.isSilent) return;

        const showStack = this.getLevel() === 'debug';
        const errorContent =
            error?.stack && showStack
                ? `${chalk.red('Error')}: ${chalk.red(message)}\n${chalk.dim(error.stack)}`
                : `${chalk.red('Error')}: ${chalk.red(message)}`;

        console.log(
            boxen(errorContent, {
                padding: 1,
                borderColor: 'red',
                title: '❌ Error',
                titleAlignment: 'center',
            })
        );
    }
}

// Export a default instance with log level from environment
export const logger = new Logger();

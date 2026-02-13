// Browser-safe console-backed logger implementation.
// Matches the public surface used by the app/CLI but avoids fs/path/winston.

export interface GlobalLoggerOptions {
    level?: string;
    silent?: boolean;
    logToConsole?: boolean;
}

export class GlobalLogger {
    private level: string;
    private isSilent: boolean;

    constructor(options: GlobalLoggerOptions = {}) {
        this.level = (options.level || 'info').toLowerCase();
        this.isSilent = options.silent ?? false;
    }

    private out(fn: (...args: any[]) => void, args: any[]) {
        if (!this.isSilent && typeof console !== 'undefined') fn(...args);
    }

    error(message: any, meta?: any) {
        this.out(console.error, [message, meta]);
    }
    warn(message: any, meta?: any) {
        this.out(console.warn, [message, meta]);
    }
    info(message: any, meta?: any) {
        this.out(console.info, [message, meta]);
    }
    http(message: any, meta?: any) {
        this.out(console.info, [message, meta]);
    }
    verbose(message: any, meta?: any) {
        this.out(console.debug, [message, meta]);
    }
    debug(message: any, meta?: any) {
        this.out(console.debug, [message, meta]);
    }
    silly(message: any, meta?: any) {
        this.out(console.debug, [message, meta]);
    }

    displayAIResponse(response: any) {
        this.out(console.log, [response]);
    }
    toolCall(toolName: string, args: any) {
        this.out(console.log, ['Tool Call', toolName, args]);
    }
    toolResult(result: any) {
        this.out(console.log, ['Tool Result', result]);
    }
    displayStartupInfo(info: Record<string, any>) {
        this.out(console.log, ['Startup', info]);
    }
    displayError(message: string, error?: Error) {
        this.out(console.error, [message, error]);
    }

    setLevel(level: string) {
        this.level = level.toLowerCase();
    }
    getLevel(): string {
        return this.level;
    }
    getLogFilePath(): string | null {
        return null;
    }
}

export const logger = new GlobalLogger();

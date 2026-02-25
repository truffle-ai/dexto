/**
 * Exit Handler
 *
 * Provides a way for commands to trigger a graceful CLI exit.
 * The exit function is registered by the Ink app and can be called
 * by commands to unmount the app properly.
 */

type ExitFunction = () => void;

let exitFn: ExitFunction | null = null;

export function registerExitHandler(fn: ExitFunction): void {
    exitFn = fn;
}

export function triggerExit(): void {
    if (exitFn) {
        exitFn();
    } else {
        // Fallback to process.exit if exit handler not registered
        process.exit(0);
    }
}

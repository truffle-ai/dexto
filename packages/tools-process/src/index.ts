/**
 * @dexto/tools-process
 *
 * Process tools factory for Dexto agents.
 * Provides process operation tools: bash exec, output, kill.
 */

// Main factory export (image-compatible)
export { processToolsFactory } from './tool-factory.js';

// Service and utilities (for advanced use cases)
export { ProcessService } from './process-service.js';
export { CommandValidator } from './command-validator.js';
export { ProcessError } from './errors.js';
export { ProcessErrorCode } from './error-codes.js';

// Types
export type {
    ProcessConfig,
    ExecuteOptions,
    ProcessResult,
    ProcessHandle,
    ProcessOutput,
    ProcessInfo,
    CommandValidation,
    OutputBuffer,
} from './types.js';

// Tool implementations (for custom integrations)
export { createBashExecTool } from './bash-exec-tool.js';
export { createBashOutputTool } from './bash-output-tool.js';
export { createKillProcessTool } from './kill-process-tool.js';

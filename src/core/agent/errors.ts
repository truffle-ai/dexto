// import type { Issue } from '@core/error/types.js';
// import { AgentErrorCode } from './error-codes.js';

// /**
//  * Base class for DextoAgent validation errors that occurred during Result->Exception conversion
//  * Preserves rich validation context from internal Result pattern for advanced error handling
//  */
// export class DextoValidationError extends Error {
//     public readonly issues: Issue[];
//     public readonly code: AgentErrorCode;

//     constructor(
//         message: string,
//         issues: Issue[],
//         code: AgentErrorCode = AgentErrorCode.RUN_FAILED
//     ) {
//         super(message);
//         this.name = 'DextoValidationError';
//         this.issues = issues;
//         this.code = code;
//     }
// }

// /**
//  * LLM configuration and switching errors
//  * Thrown by DextoAgent.switchLLM() when validation or switching fails
//  */
// export class DextoLLMError extends DextoValidationError {
//     constructor(message: string, issues: Issue[]) {
//         super(message, issues, AgentErrorCode.LLM_SWITCH_FAILED);
//         this.name = 'DextoLLMError';
//     }
// }

// /**
//  * MCP server configuration and connection errors
//  * Thrown by DextoAgent.connectMcpServer() when validation or connection fails
//  */
// export class DextoMCPError extends DextoValidationError {
//     constructor(message: string, issues: Issue[]) {
//         super(message, issues, AgentErrorCode.MCP_CONNECTION_FAILED);
//         this.name = 'DextoMCPError';
//     }
// }

// /**
//  * Input validation errors (text/image/file)
//  * Thrown by DextoAgent.run() when input validation fails
//  */
// export class DextoInputError extends DextoValidationError {
//     constructor(message: string, issues: Issue[]) {
//         super(message, issues, AgentErrorCode.RUN_FAILED);
//         this.name = 'DextoInputError';
//     }
// }

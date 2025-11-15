/**
 * JSON-RPC 2.0 Type Definitions
 *
 * Implements JSON-RPC 2.0 specification for A2A Protocol transport.
 * @see https://www.jsonrpc.org/specification
 */

/**
 * JSON-RPC 2.0 Request
 */
export interface JsonRpcRequest {
    /** JSON-RPC version (must be "2.0") */
    jsonrpc: '2.0';
    /** Method name to invoke */
    method: string;
    /** Method parameters (optional) */
    params?: any;
    /** Request ID (can be string, number, or null for notifications) */
    id?: string | number | null;
}

/**
 * JSON-RPC 2.0 Response (Success)
 */
export interface JsonRpcSuccessResponse {
    /** JSON-RPC version (must be "2.0") */
    jsonrpc: '2.0';
    /** Result of the method invocation */
    result: any;
    /** Request ID (matches request) */
    id: string | number | null;
}

/**
 * JSON-RPC 2.0 Response (Error)
 */
export interface JsonRpcErrorResponse {
    /** JSON-RPC version (must be "2.0") */
    jsonrpc: '2.0';
    /** Error object */
    error: JsonRpcError;
    /** Request ID (matches request, or null if ID couldn't be determined) */
    id: string | number | null;
}

/**
 * JSON-RPC 2.0 Error Object
 */
export interface JsonRpcError {
    /** Error code (integer) */
    code: number;
    /** Error message (short description) */
    message: string;
    /** Optional additional error data */
    data?: any;
}

/**
 * Union type for JSON-RPC responses
 */
export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * JSON-RPC 2.0 Batch Request
 */
export type JsonRpcBatchRequest = JsonRpcRequest[];

/**
 * JSON-RPC 2.0 Batch Response
 */
export type JsonRpcBatchResponse = JsonRpcResponse[];

/**
 * Standard JSON-RPC 2.0 Error Codes
 */
export enum JsonRpcErrorCode {
    /** Invalid JSON was received by the server */
    PARSE_ERROR = -32700,
    /** The JSON sent is not a valid Request object */
    INVALID_REQUEST = -32600,
    /** The method does not exist / is not available */
    METHOD_NOT_FOUND = -32601,
    /** Invalid method parameter(s) */
    INVALID_PARAMS = -32602,
    /** Internal JSON-RPC error */
    INTERNAL_ERROR = -32603,
    /** Reserved for implementation-defined server-errors (-32000 to -32099) */
    SERVER_ERROR_START = -32099,
    SERVER_ERROR_END = -32000,
}

/**
 * Type guard to check if response is an error
 */
export function isJsonRpcError(response: JsonRpcResponse): response is JsonRpcErrorResponse {
    return 'error' in response;
}

/**
 * Type guard to check if response is success
 */
export function isJsonRpcSuccess(response: JsonRpcResponse): response is JsonRpcSuccessResponse {
    return 'result' in response;
}

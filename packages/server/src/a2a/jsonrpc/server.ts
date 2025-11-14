/**
 * JSON-RPC 2.0 Server
 *
 * Handles JSON-RPC 2.0 request parsing, method dispatch, and response formatting.
 * Implements the full JSON-RPC 2.0 specification including batch requests.
 */

import type {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcBatchRequest,
    JsonRpcBatchResponse,
    JsonRpcError,
} from './types.js';
import { JsonRpcErrorCode } from './types.js';

/**
 * Method handler function type
 */
export type JsonRpcMethodHandler = (params: any) => Promise<any>;

/**
 * JSON-RPC 2.0 Server Options
 */
export interface JsonRpcServerOptions {
    /** Method handlers map */
    methods: Record<string, JsonRpcMethodHandler>;
    /** Optional error handler */
    onError?: (error: Error, request?: JsonRpcRequest) => void;
}

/**
 * JSON-RPC 2.0 Server
 *
 * Parses JSON-RPC requests, dispatches to handlers, and formats responses.
 *
 * Usage:
 * ```typescript
 * const server = new JsonRpcServer({
 *   methods: {
 *     'agent.createTask': async (params) => { ... },
 *     'agent.getTask': async (params) => { ... },
 *   }
 * });
 *
 * const response = await server.handle(request);
 * ```
 */
export class JsonRpcServer {
    private methods: Record<string, JsonRpcMethodHandler>;
    private onError: ((error: Error, request?: JsonRpcRequest) => void) | undefined;

    constructor(options: JsonRpcServerOptions) {
        this.methods = options.methods;
        this.onError = options.onError;
    }

    /**
     * Handle a JSON-RPC request (single or batch).
     *
     * @param request Single request or batch array
     * @returns Single response or batch array
     */
    async handle(
        request: JsonRpcRequest | JsonRpcBatchRequest
    ): Promise<JsonRpcResponse | JsonRpcBatchResponse> {
        // Handle batch requests
        if (Array.isArray(request)) {
            return await this.handleBatch(request);
        }

        // Handle single request
        return await this.handleSingle(request);
    }

    /**
     * Handle a batch of JSON-RPC requests.
     *
     * Processes all requests in parallel per JSON-RPC 2.0 spec.
     *
     * @param requests Array of requests
     * @returns Array of responses
     */
    private async handleBatch(requests: JsonRpcBatchRequest): Promise<JsonRpcBatchResponse> {
        // Empty batch is an error
        if (requests.length === 0) {
            return [
                this.createErrorResponse(null, JsonRpcErrorCode.INVALID_REQUEST, 'Empty batch'),
            ];
        }

        // Process all requests in parallel
        const responses = await Promise.all(requests.map((req) => this.handleSingle(req)));

        // Filter out notification responses (id is undefined)
        return responses.filter((res) => res.id !== undefined);
    }

    /**
     * Handle a single JSON-RPC request.
     *
     * @param request JSON-RPC request object
     * @returns JSON-RPC response object
     */
    private async handleSingle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
        try {
            // Validate JSON-RPC version
            if (request.jsonrpc !== '2.0') {
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INVALID_REQUEST,
                    'Invalid JSON-RPC version (must be "2.0")'
                );
            }

            // Validate method exists
            if (typeof request.method !== 'string') {
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INVALID_REQUEST,
                    'Method must be a string'
                );
            }

            // Check if method exists
            const handler = this.methods[request.method];
            if (!handler) {
                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.METHOD_NOT_FOUND,
                    `Method not found: ${request.method}`
                );
            }

            // Execute method handler
            try {
                const result = await handler(request.params);

                // Notifications (id is undefined) don't get responses
                if (request.id === undefined) {
                    // Return a dummy response that will be filtered out in batch processing
                    return { jsonrpc: '2.0', result: null, id: undefined as any };
                }

                return this.createSuccessResponse(request.id ?? null, result);
            } catch (error) {
                // Method execution error
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorData =
                    error instanceof Error ? { name: error.name, stack: error.stack } : undefined;

                // Call error handler if provided
                if (this.onError) {
                    this.onError(
                        error instanceof Error ? error : new Error(String(error)),
                        request
                    );
                }

                return this.createErrorResponse(
                    request.id ?? null,
                    JsonRpcErrorCode.INTERNAL_ERROR,
                    errorMessage,
                    errorData
                );
            }
        } catch (error) {
            // Request parsing/validation error
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResponse(null, JsonRpcErrorCode.INVALID_REQUEST, errorMessage);
        }
    }

    /**
     * Create a success response.
     */
    private createSuccessResponse(id: string | number | null, result: any): JsonRpcResponse {
        return {
            jsonrpc: '2.0',
            result,
            id,
        };
    }

    /**
     * Create an error response.
     */
    private createErrorResponse(
        id: string | number | null,
        code: number,
        message: string,
        data?: any
    ): JsonRpcResponse {
        const error: JsonRpcError = { code, message };
        if (data !== undefined) {
            error.data = data;
        }

        return {
            jsonrpc: '2.0',
            error,
            id,
        };
    }

    /**
     * Register a new method handler.
     *
     * @param method Method name
     * @param handler Handler function
     */
    registerMethod(method: string, handler: JsonRpcMethodHandler): void {
        this.methods[method] = handler;
    }

    /**
     * Unregister a method handler.
     *
     * @param method Method name
     */
    unregisterMethod(method: string): void {
        delete this.methods[method];
    }

    /**
     * Check if a method is registered.
     *
     * @param method Method name
     * @returns True if method exists
     */
    hasMethod(method: string): boolean {
        return method in this.methods;
    }

    /**
     * Get list of registered method names.
     *
     * @returns Array of method names
     */
    getMethods(): string[] {
        return Object.keys(this.methods);
    }
}

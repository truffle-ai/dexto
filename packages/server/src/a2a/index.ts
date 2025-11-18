/**
 * A2A Protocol Implementation
 *
 * Server-layer implementation of A2A Protocol v0.3.0.
 * Exposes DextoAgent capabilities through A2A-compliant interfaces.
 *
 * Specification: https://a2a-protocol.org/latest/specification
 *
 * @module a2a
 */

// Type definitions (A2A Protocol v0.3.0)
export type {
    Task,
    TaskState,
    TaskStatus,
    Message,
    MessageRole,
    Part,
    TextPart,
    FilePart,
    DataPart,
    FileWithBytes,
    FileWithUri,
    Artifact,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
    MessageSendParams,
    MessageSendConfiguration,
    TaskQueryParams,
    ListTasksParams,
    ListTasksResult,
    TaskIdParams,
    ConvertedMessage,
} from './types.js';

// Protocol adapters
export {
    TaskView,
    createTaskView,
    a2aToInternalMessage,
    internalToA2AMessage,
    internalMessagesToA2A,
    deriveTaskState,
    deriveTaskStateFromA2A,
} from './adapters/index.js';

// JSON-RPC transport
export {
    JsonRpcServer,
    A2AMethodHandlers,
    JsonRpcErrorCode,
    isJsonRpcError,
    isJsonRpcSuccess,
} from './jsonrpc/index.js';
export type {
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcError,
    JsonRpcMethodHandler,
    JsonRpcServerOptions,
} from './jsonrpc/index.js';

/**
 * A2A Protocol Type Definitions
 *
 * Type definitions compliant with A2A Protocol v0.3.0 specification.
 * Based on: https://a2a-protocol.org/latest/specification
 *
 * @module a2a/types
 */

/**
 * Task state per A2A Protocol specification.
 *
 * States:
 * - submitted: Task has been submitted
 * - working: Task is being processed
 * - input-required: Task needs user input
 * - completed: Task completed successfully
 * - canceled: Task was canceled
 * - failed: Task failed with error
 * - rejected: Task was rejected
 * - auth-required: Authentication required
 * - unknown: State is unknown
 */
export type TaskState =
    | 'submitted'
    | 'working'
    | 'input-required'
    | 'completed'
    | 'canceled'
    | 'failed'
    | 'rejected'
    | 'auth-required'
    | 'unknown';

/**
 * Message role per A2A Protocol specification.
 */
export type MessageRole = 'user' | 'agent';

/**
 * Base interface for all part types.
 */
export interface PartBase {
    metadata?: { [key: string]: any };
}

/**
 * Text part - contains text content.
 */
export interface TextPart extends PartBase {
    readonly kind: 'text';
    text: string;
}

/**
 * File base interface.
 */
export interface FileBase {
    name?: string;
    mimeType?: string;
}

/**
 * File with base64-encoded bytes.
 */
export interface FileWithBytes extends FileBase {
    bytes: string; // Base64 encoded
    uri?: never;
}

/**
 * File with URI reference.
 */
export interface FileWithUri extends FileBase {
    uri: string;
    bytes?: never;
}

/**
 * File part - contains file data.
 */
export interface FilePart extends PartBase {
    readonly kind: 'file';
    file: FileWithBytes | FileWithUri;
}

/**
 * Data part - contains structured JSON data.
 */
export interface DataPart extends PartBase {
    readonly kind: 'data';
    data: { [key: string]: any };
}

/**
 * Union of all part types per A2A specification.
 */
export type Part = TextPart | FilePart | DataPart;

/**
 * A2A Protocol message structure.
 */
export interface Message {
    readonly role: MessageRole;
    parts: Part[]; // Required: Array of message parts
    metadata?: { [key: string]: any }; // Optional: Extension metadata
    extensions?: string[]; // Optional: Extension identifiers
    referenceTaskIds?: string[]; // Optional: Referenced task IDs
    messageId: string; // Required: Unique message identifier
    taskId?: string; // Optional: Associated task ID
    contextId?: string; // Optional: Context identifier
    readonly kind: 'message'; // Required: Discriminator
}

/**
 * Task status structure.
 */
export interface TaskStatus {
    state: TaskState; // Required: Current state
    message?: Message; // Optional: Status message
    timestamp?: string; // Optional: ISO 8601 timestamp
}

/**
 * Artifact - generated output from the agent.
 */
export interface Artifact {
    artifactId: string; // Required: Unique artifact ID
    name?: string; // Optional: Artifact name
    description?: string; // Optional: Description
    parts: Part[]; // Required: Artifact content
    metadata?: { [key: string]: any }; // Optional: Metadata
    extensions?: string[]; // Optional: Extension IDs
}

/**
 * A2A Protocol task structure.
 */
export interface Task {
    id: string; // Required: Unique task identifier
    contextId: string; // Required: Context across related tasks
    status: TaskStatus; // Required: Current task status
    history?: Message[]; // Optional: Conversation history
    artifacts?: Artifact[]; // Optional: Task artifacts
    metadata?: { [key: string]: any }; // Optional: Extension metadata
    readonly kind: 'task'; // Required: Discriminator
}

/**
 * Task status update event (streaming).
 */
export interface TaskStatusUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: 'status-update';
    status: TaskStatus;
    final: boolean; // True for final event
    metadata?: { [key: string]: any };
}

/**
 * Task artifact update event (streaming).
 */
export interface TaskArtifactUpdateEvent {
    taskId: string;
    contextId: string;
    readonly kind: 'artifact-update';
    artifact: Artifact;
    append?: boolean; // Append to existing artifact
    lastChunk?: boolean; // Final chunk
    metadata?: { [key: string]: any };
}

/**
 * Push notification configuration.
 */
export interface PushNotificationConfig {
    url: string;
    headers?: { [key: string]: string };
}

/**
 * Message send configuration.
 */
export interface MessageSendConfiguration {
    acceptedOutputModes?: string[];
    historyLength?: number;
    pushNotificationConfig?: PushNotificationConfig;
    blocking?: boolean; // Wait for completion
}

/**
 * Parameters for message/send and message/stream methods.
 */
export interface MessageSendParams {
    message: Message; // Required
    configuration?: MessageSendConfiguration; // Optional
    metadata?: { [key: string]: any }; // Optional
}

/**
 * Parameters for tasks/get method.
 */
export interface TaskQueryParams {
    id: string; // Required: Task ID
    historyLength?: number; // Optional: Limit history items
    metadata?: { [key: string]: any };
}

/**
 * Parameters for tasks/list method.
 */
export interface ListTasksParams {
    contextId?: string;
    status?: TaskState;
    pageSize?: number; // 1-100, default 50
    pageToken?: string;
    historyLength?: number;
    lastUpdatedAfter?: number; // Unix timestamp
    includeArtifacts?: boolean;
    metadata?: { [key: string]: any };
}

/**
 * Result for tasks/list method.
 */
export interface ListTasksResult {
    tasks: Task[];
    totalSize: number;
    pageSize: number;
    nextPageToken: string;
}

/**
 * Parameters for tasks/cancel and tasks/resubscribe methods.
 */
export interface TaskIdParams {
    id: string; // Required: Task ID
    metadata?: { [key: string]: any };
}

/**
 * Converted message parts for internal use (compatibility layer).
 * Used by adapters to convert between A2A and Dexto internal format.
 */
export interface ConvertedMessage {
    text: string;
    image:
        | {
              image: string;
              mimeType: string;
          }
        | undefined;
    file:
        | {
              data: string;
              mimeType: string;
              filename?: string;
          }
        | undefined;
}

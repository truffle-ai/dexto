/**
 * @dexto/orchestration
 *
 * Agent orchestration layer for background task management,
 * event-driven completion handling, and async workflows.
 *
 * Key components:
 * - TaskRegistry: Tracks background tasks and their results
 * - SignalBus: Routes completion signals between components
 * - ConditionEngine: Evaluates composable wait conditions
 *
 * Example usage:
 * ```typescript
 * import { ConditionEngine, SignalBus, TaskRegistry } from '@dexto/orchestration';
 *
 * const signalBus = new SignalBus();
 * const taskRegistry = new TaskRegistry(signalBus);
 * const conditionEngine = new ConditionEngine(taskRegistry, signalBus);
 *
 * // Start a background task
 * taskRegistry.register({
 *   type: 'generic',
 *   taskId: 'my-task',
 *   description: 'My task',
 *   promise: someAsyncOperation(),
 * });
 *
 * // Wait for completion
 * const { signal } = await conditionEngine.wait({
 *   type: 'task',
 *   taskId: 'my-task',
 * });
 * ```
 */

// Infrastructure
export { SignalBus, type SignalHandler, type SignalPredicate } from './signal-bus.js';
export { TaskRegistry, type TaskRegistryConfig } from './task-registry.js';
export { ConditionEngine } from './condition-engine.js';

// Types
export type {
    Task,
    TaskStatus,
    TaskEntry,
    TaskResult,
    ProcessResult,
    Signal,
    SignalType,
    WaitCondition,
    WaitResult,
    AgentState,
    TaskInfo,
    TaskFilter,
    RegisterTaskOptions,
} from './types.js';

// Tools
export { createWaitForTool, createCheckTaskTool, createListTasksTool } from './tools/index.js';

export type {
    WaitForInput,
    WaitForOutput,
    CheckTaskInput,
    CheckTaskOutput,
    ListTasksInput,
    ListTasksOutput,
    TaskListItem,
} from './tools/index.js';

export { WaitForInputSchema, CheckTaskInputSchema, ListTasksInputSchema } from './tools/index.js';

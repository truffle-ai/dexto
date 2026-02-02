/**
 * @dexto/orchestration
 *
 * Agent orchestration layer for background task management,
 * event-driven completion handling, and async workflows.
 *
 * Key components:
 * - AgentController: Wraps DextoAgent with orchestration capabilities
 * - TaskRegistry: Tracks background tasks and their results
 * - SignalBus: Routes completion signals between components
 * - ConditionEngine: Evaluates composable wait conditions
 *
 * Example usage:
 * ```typescript
 * import { AgentController } from '@dexto/orchestration';
 *
 * const controller = new AgentController({ agent: myAgent });
 * await controller.start();
 *
 * // Start a background task
 * const taskId = controller.taskRegistry.registerGenericTask(
 *   'My task',
 *   someAsyncOperation()
 * );
 *
 * // Wait for completion
 * const { signal } = await controller.conditionEngine.wait({
 *   type: 'task',
 *   taskId,
 * });
 * ```
 */

// Main controller
export { AgentController, type AgentControllerConfig } from './agent-controller.js';

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
export {
    createStartTaskTool,
    createWaitForTool,
    createCheckTaskTool,
    createListTasksTool,
    createGenericTaskStarter,
} from './tools/index.js';

export type {
    OrchestrationTool,
    OrchestrationToolContext,
    TaskStarter,
    StartTaskInput,
    StartTaskOutput,
    WaitForInput,
    WaitForOutput,
    CheckTaskInput,
    CheckTaskOutput,
    ListTasksInput,
    ListTasksOutput,
    TaskListItem,
} from './tools/index.js';

export {
    StartTaskInputSchema,
    WaitForInputSchema,
    CheckTaskInputSchema,
    ListTasksInputSchema,
} from './tools/index.js';

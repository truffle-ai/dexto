/**
 * Tool Types
 *
 * Shared types for orchestration tools.
 */

import type { TaskRegistry } from '../task-registry.js';
import type { ConditionEngine } from '../condition-engine.js';
import type { SignalBus } from '../signal-bus.js';
import type { ZodSchema } from 'zod';

/**
 * Context provided to orchestration tools
 */
export interface OrchestrationToolContext {
    taskRegistry: TaskRegistry;
    conditionEngine: ConditionEngine;
    signalBus: SignalBus;
}

/**
 * Base tool interface matching @dexto/core Tool
 */
export interface OrchestrationTool {
    id: string;
    description: string;
    inputSchema: ZodSchema;
    execute: (input: unknown, context: OrchestrationToolContext) => Promise<unknown>;
}

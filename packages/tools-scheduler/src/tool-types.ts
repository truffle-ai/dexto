import type { ToolExecutionContext } from '@dexto/core';
import type { SchedulerManager } from './manager.js';

export type SchedulerManagerGetter = (context: ToolExecutionContext) => Promise<SchedulerManager>;

import type { ToolExecutionContext } from '@dexto/core';
import type { PlanService } from './plan-service.js';

export type PlanServiceGetter = (context: ToolExecutionContext) => Promise<PlanService>;

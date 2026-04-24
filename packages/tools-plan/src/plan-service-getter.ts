import type { ToolExecutionContext } from '@dexto/core/tools';
import type { PlanService } from './plan-service.js';

export type PlanServiceGetter = (context: ToolExecutionContext) => Promise<PlanService>;

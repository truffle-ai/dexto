import type { InternalMessage } from '../../types.js';
import { isOverflow, type ModelLimits } from '../overflow.js';
import { ReactiveOverflowStrategy, type ReactiveOverflowOptions } from './reactive-overflow.js';
import type {
    CompactionRuntimeContext,
    CompactionSettings,
    ICompactionStrategy,
} from '../types.js';

export interface ReactiveOverflowCompactionStrategyOptions {
    enabled?: boolean | undefined;
    maxContextTokens?: number | undefined;
    thresholdPercent?: number | undefined;
    strategy?: ReactiveOverflowOptions | undefined;
}

export class ReactiveOverflowCompactionStrategy implements ICompactionStrategy {
    readonly name = 'reactive-overflow';

    private readonly settings: CompactionSettings;
    private readonly strategyOptions: ReactiveOverflowOptions;

    constructor(options: ReactiveOverflowCompactionStrategyOptions = {}) {
        this.settings = {
            enabled: options.enabled ?? true,
            maxContextTokens: options.maxContextTokens,
            thresholdPercent: options.thresholdPercent ?? 0.9,
        };
        this.strategyOptions = options.strategy ?? {};
    }

    getSettings(): CompactionSettings {
        return this.settings;
    }

    getModelLimits(modelContextWindow: number): ModelLimits {
        const capped =
            this.settings.enabled && this.settings.maxContextTokens !== undefined
                ? Math.min(modelContextWindow, this.settings.maxContextTokens)
                : modelContextWindow;

        return { contextWindow: capped };
    }

    shouldCompact(inputTokens: number, modelLimits: ModelLimits): boolean {
        if (!this.settings.enabled) {
            return false;
        }
        return isOverflow({ inputTokens }, modelLimits, this.settings.thresholdPercent);
    }

    async compact(
        history: readonly InternalMessage[],
        context: CompactionRuntimeContext
    ): Promise<InternalMessage[]> {
        if (!this.settings.enabled) {
            return [];
        }

        const strategy = new ReactiveOverflowStrategy(
            context.model,
            this.strategyOptions,
            context.logger
        );

        return await strategy.compact(history);
    }
}

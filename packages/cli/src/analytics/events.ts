// packages/cli/src/analytics/events.ts
// Typed payload scaffolding for PostHog events emitted by the CLI.
// These types describe the additional properties supplied when we call
// `capture(event, properties)`. Base context (app, version, OS, execution context,
// session_id, etc.) is merged automatically in analytics/index.ts.

import type { ExecutionContext } from '@dexto/agent-management';
import type { SharedAnalyticsEventMap } from '@dexto/analytics';

export interface BaseEventContext {
    app?: 'dexto';
    app_version?: string;
    node_version?: string;
    os_platform?: NodeJS.Platform;
    os_release?: string;
    os_arch?: string;
    execution_context?: ExecutionContext;
    session_id?: string | null;
}

export interface CommandArgsMeta {
    argTypes: string[];
    positionalCount?: number;
}

export type CliCommandPhase = 'start' | 'end' | 'timeout';

interface CliCommandBaseEvent {
    name: string;
    phase: CliCommandPhase;
    args?: CommandArgsMeta;
}

export interface CliCommandStartEvent extends CliCommandBaseEvent {
    phase: 'start';
}

export interface CliCommandEndEvent extends CliCommandBaseEvent {
    phase: 'end';
    success: boolean;
    durationMs: number;
    error?: string;
    reason?: string;
    command?: string;
}

export interface CliCommandTimeoutEvent extends CliCommandBaseEvent {
    phase: 'timeout';
    timeoutMs: number;
}

export type CliCommandEvent = CliCommandStartEvent | CliCommandEndEvent | CliCommandTimeoutEvent;

export interface PromptEvent {
    mode: 'cli';
    provider: string;
    model: string;
}

/**
 * CLI analytics event map extending shared events with CLI-specific events.
 *
 * IMPORTANT: If an event is also tracked by WebUI, move it to SharedAnalyticsEventMap
 * in @dexto/analytics to avoid duplication.
 */
export interface DextoAnalyticsEventMap extends SharedAnalyticsEventMap {
    // CLI-specific events
    dexto_cli_command: CliCommandEvent;
    dexto_prompt: PromptEvent;
}

export type AnalyticsEventName = keyof DextoAnalyticsEventMap;

export type AnalyticsEventPayload<Name extends AnalyticsEventName> = DextoAnalyticsEventMap[Name];

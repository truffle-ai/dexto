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
    positionalRaw?: string[];
    positionalCount?: number;
    optionKeys?: string[];
    options?: Record<string, SanitizedOptionValue>;
}

export type SanitizedOptionValue =
    | string
    | number
    | boolean
    | null
    | { type: 'array'; length: number }
    | { type: 'object' };

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

export interface SetupEvent {
    provider: string;
    model: string;
    hadApiKeyBefore?: boolean;
    setupMode: 'interactive' | 'non-interactive';
    setupVariant?: 'quick-start' | 'custom' | 'dexto-nova';
    defaultMode?: string;
    hasBaseURL?: boolean;
    apiKeySkipped?: boolean;
}

export interface InstallAgentEvent {
    agent: string;
    status: 'installed' | 'skipped' | 'failed';
    force: boolean;
    reason?: string;
    error_message?: string;
}

export interface InstallAggregateEvent {
    requested: string[];
    installed: string[];
    skipped: string[];
    failed: string[];
    successCount: number;
    errorCount: number;
}

export interface UninstallAgentEvent {
    agent: string;
    status: 'uninstalled' | 'failed';
    force: boolean;
    error_message?: string;
}

export interface UninstallAggregateEvent {
    requested: string[];
    uninstalled: string[];
    failed: string[];
    successCount: number;
    errorCount: number;
}

export interface CreateProjectEvent {
    provider: string;
    providedKey: boolean;
}

export interface InitProjectEvent {
    provider: string;
    providedKey: boolean;
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
    dexto_setup: SetupEvent;
    dexto_install_agent: InstallAgentEvent;
    dexto_install: InstallAggregateEvent;
    dexto_uninstall_agent: UninstallAgentEvent;
    dexto_uninstall: UninstallAggregateEvent;
    dexto_create: CreateProjectEvent;
    dexto_init: InitProjectEvent;
}

export type AnalyticsEventName = keyof DextoAnalyticsEventMap;

export type AnalyticsEventPayload<Name extends AnalyticsEventName> = DextoAnalyticsEventMap[Name];

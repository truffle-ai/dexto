// packages/cli/src/analytics/index.ts

import { PostHog } from 'posthog-node';
import os from 'os';
import {
    isAnalyticsDisabled,
    DEFAULT_POSTHOG_HOST,
    DEFAULT_POSTHOG_KEY,
    loadState,
    saveState,
} from '@dexto/analytics';
import type { AnalyticsState } from '@dexto/analytics';
import { getExecutionContext } from '@dexto/agent-management';
import { randomUUID } from 'crypto';
import {
    AnalyticsEventName,
    AnalyticsEventPayload,
    BaseEventContext,
    CliCommandEndEvent,
    CliCommandStartEvent,
} from './events.js';

interface InitOptions {
    appVersion: string;
}

let client: PostHog | null = null;
let enabled = false;
let state: AnalyticsState | null = null;
let sessionId: string | null = null;
let appVersion: string | null = null;

function baseProps(): BaseEventContext {
    return {
        app: 'dexto',
        app_version: appVersion || 'unknown',
        node_version: process.version,
        os_platform: os.platform(),
        os_release: os.release(),
        os_arch: os.arch(),
        execution_context: getExecutionContext(),
        session_id: sessionId,
    };
}

/**
 * Initialize the analytics client for the CLI.
 *
 * - Respects DEXTO_ANALYTICS_DISABLED.
 * - Creates/loads the anonymous distinctId and a per-process session_id.
 * - Emits a dexto_session_created event for each process run.
 */
export async function initAnalytics(opts: InitOptions): Promise<void> {
    if (enabled || client) return; // idempotent
    if (isAnalyticsDisabled()) {
        enabled = false;
        return;
    }
    // Load or create state
    state = await loadState();
    sessionId = randomUUID();
    appVersion = opts.appVersion;

    const key = process.env.DEXTO_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY;
    const host = process.env.DEXTO_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST;
    if (typeof key !== 'string' || !/^phc_[A-Za-z0-9]+/.test(key) || !host) {
        enabled = false;
        return;
    }
    client = new PostHog(key, {
        host,
        flushAt: 1,
        flushInterval: 0,
        disableGeoip: false,
    });
    enabled = true;

    process.on('exit', () => {
        try {
            client?.flush?.();
        } catch {
            // Ignore flush errors: analytics should never block process exit.
        }
    });

    capture('dexto_session_created', {
        source: 'cli',
        sessionId: sessionId || 'unknown',
        trigger: 'manual',
    });
}

/**
 * Capture a single analytics event with optional properties.
 * Automatically enriches events with base context (app/os/node/session).
 */
export function capture<Name extends AnalyticsEventName>(
    event: Name,
    properties: AnalyticsEventPayload<Name> = {} as AnalyticsEventPayload<Name>
): void {
    if (!enabled || !client || !state) return;
    try {
        client.capture({
            distinctId: state.distinctId,
            event,
            properties: { ...baseProps(), ...properties },
        });
    } catch {
        // swallow
    }
}

/**
 * Attempt a graceful shutdown of the analytics client, flushing queued events.
 */
export async function shutdownAnalytics(): Promise<void> {
    if (client) {
        try {
            await client.shutdown();
        } catch {
            // ignore
        }
    }
}

// Commander hooks
type TimerMap = Map<string, number>;
const timers: TimerMap = new Map();

/**
 * Mark the start of a command for timing and emit a lightweight start event.
 * Adds local counters as a coarse diagnostic aid.
 */
export async function onCommandStart(
    name: string,
    extra: Partial<Omit<CliCommandStartEvent, 'name' | 'phase'>> = {}
): Promise<void> {
    if (!enabled) return;
    timers.set(name, Date.now());
    if (state) {
        await saveState(state);
    }
    const payload: CliCommandStartEvent = {
        name,
        phase: 'start',
        ...extra,
    };
    capture('dexto_cli_command', payload);
}

/**
 * Mark the end of a command and emit a completion event with success/failure
 * and measured duration. Accepts optional extra properties.
 */
export async function onCommandEnd(
    name: string,
    success: boolean,
    extra: Partial<Omit<CliCommandEndEvent, 'name' | 'phase' | 'success' | 'durationMs'>> = {}
): Promise<void> {
    if (!enabled) return;
    const start = timers.get(name) ?? Date.now();
    const durationMs = Date.now() - start;
    timers.delete(name);

    const payload: CliCommandEndEvent = {
        name,
        phase: 'end',
        success,
        durationMs,
        ...extra,
    };
    capture('dexto_cli_command', payload);

    if (state) {
        state.commandRunCounts = state.commandRunCounts || {};
        state.commandRunCounts[name] = (state.commandRunCounts[name] || 0) + 1;
        await saveState(state);
    }
}

/**
 * Whether analytics are currently enabled for this process.
 */
export function getEnabled(): boolean {
    return enabled;
}

/**
 * Build the analytics configuration for WebUI injection.
 * Returns the config needed by the WebUI's PostHog client, or null if disabled.
 */
export async function getWebUIAnalyticsConfig(): Promise<{
    distinctId: string;
    posthogKey: string;
    posthogHost: string;
    appVersion: string;
} | null> {
    if (isAnalyticsDisabled()) {
        return null;
    }

    try {
        const analyticsState = await loadState();
        return {
            distinctId: analyticsState.distinctId,
            posthogKey: process.env.DEXTO_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY,
            posthogHost: process.env.DEXTO_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
            appVersion: appVersion || 'unknown',
        };
    } catch {
        // If analytics state loading fails, return null to disable analytics
        return null;
    }
}

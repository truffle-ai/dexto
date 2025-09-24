// packages/cli/src/analytics/index.ts

import { PostHog } from 'posthog-node';
import os from 'os';
import { isAnalyticsDisabled, DEFAULT_POSTHOG_HOST, DEFAULT_POSTHOG_KEY } from './constants.js';
import { AnalyticsState, loadState, saveState } from './state.js';
import { getExecutionContext } from '@dexto/core';
import { randomUUID } from 'crypto';

/**
 * Generic event properties type for analytics capture.
 * Keep values JSON-serializable. Do not include raw prompts or secrets.
 */
export type Properties = Record<string, unknown>;

interface InitOptions {
    appVersion: string;
}

let client: PostHog | null = null;
let enabled = false;
let state: AnalyticsState | null = null;
let sessionId: string | null = null;
let appVersion: string | null = null;

function baseProps(): Properties {
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
 * - Emits a dexto_session_start event for each process run.
 *
 * Usage:
 *   await initAnalytics({ appVersion: pkg.version });
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

    // Validate public key format (must look like PostHog public key: phc_*)
    const key = DEFAULT_POSTHOG_KEY;
    if (typeof key !== 'string' || !/^phc_[A-Za-z0-9]+/.test(key)) {
        enabled = false;
        return;
    }
    client = new PostHog(key, {
        host: DEFAULT_POSTHOG_HOST,
        flushAt: 1,
        flushInterval: 0,
        disableGeoip: false,
    });
    enabled = true;

    // Flush on exit quickly
    const graceful = async () => {
        try {
            if (client) {
                await client.shutdown();
            }
        } catch {
            // ignore
        }
    };
    process.once('beforeExit', graceful);
    process.once('SIGINT', graceful);
    process.once('SIGTERM', graceful);
    // Best-effort flush on hard exits
    process.on('exit', () => {
        try {
            client?.flush?.();
        } catch {}
    });

    // Session start event on every run
    capture('dexto_session_start');
}

/**
 * Capture a single analytics event with optional properties.
 * Automatically enriches events with base context (app/os/node/session).
 */
export function capture(event: string, properties: Properties = {}): void {
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
 * Invoked automatically on process lifecycle events, but can be called manually.
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
export function onCommandStart(name: string, extra: Properties = {}) {
    if (!enabled) return;
    timers.set(name, Date.now());
    // Count runs immediately to avoid missing due to early process.exit
    if (state) {
        state.commandRunCounts = state.commandRunCounts || {};
        state.commandRunCounts[name] = (state.commandRunCounts[name] || 0) + 1;
        // fire and forget
        void saveState(state);
    }
    // Fire a lightweight start event
    capture('dexto_cli_command', { name, phase: 'start', ...extra });
}

/**
 * Mark the end of a command and emit a completion event with success/failure
 * and measured duration. Accepts optional extra properties.
 */
export async function onCommandEnd(name: string, success: boolean, extra: Properties = {}) {
    if (!enabled) return;
    const start = timers.get(name) ?? Date.now();
    const durationMs = Date.now() - start;
    timers.delete(name);
    capture('dexto_cli_command', { name, success, durationMs, ...extra });
    // Update optional local counts
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

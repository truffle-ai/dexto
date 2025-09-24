// packages/cli/src/analytics/index.ts

import { PostHog } from 'posthog-node';
import os from 'os';
import { isAnalyticsDisabled, DEFAULT_POSTHOG_HOST, DEFAULT_POSTHOG_KEY } from './constants.js';
import { AnalyticsState, loadState, saveState } from './state.js';
import { getExecutionContext } from '@dexto/core';

type Properties = Record<string, unknown>;

interface InitOptions {
    appVersion: string;
}

let client: PostHog | null = null;
let enabled = false;
let state: AnalyticsState | null = null;

function baseProps(version: string): Properties {
    return {
        app: 'dexto',
        app_version: version,
        node_version: process.version,
        os_platform: os.platform(),
        os_release: os.release(),
        os_arch: os.arch(),
        execution_context: getExecutionContext(),
    };
}

export async function initAnalytics(opts: InitOptions): Promise<void> {
    if (enabled || client) return; // idempotent
    if (isAnalyticsDisabled()) {
        enabled = false;
        return;
    }
    // Load or create state
    state = await loadState();

    // Guard if key placeholder is not replaced
    const key = DEFAULT_POSTHOG_KEY;
    if (!key || key === 'PH_PUBLIC_KEY_PLACEHOLDER') {
        // Key is not configured; disable silently
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

    // First run event
    if (state && !state.firstRunTracked) {
        capture('dexto_first_run', baseProps(opts.appVersion));
        state.firstRunTracked = true;
        await saveState(state);
    }
}

export function capture(event: string, properties: Properties = {}): void {
    if (!enabled || !client || !state) return;
    try {
        client.capture({
            distinctId: state.distinctId,
            event,
            properties: properties,
        });
    } catch {
        // swallow
    }
}

export async function shutdownAnalytics(): Promise<void> {
    if (client) {
        try {
            await client.shutdown();
        } catch {
            // ignore
        }
    }
}

export async function captureFirstPromptOnce(props: Properties): Promise<void> {
    if (!enabled || !state) return;
    if (!state.firstPromptTracked) {
        capture('dexto_first_prompt', props);
        state.firstPromptTracked = true;
        await saveState(state);
    }
}

// Commander hooks
type TimerMap = Map<string, number>;
const timers: TimerMap = new Map();

export function onCommandStart(name: string) {
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
    capture('dexto_cli_command', { name, phase: 'start' });
}

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

export function getEnabled(): boolean {
    return enabled;
}

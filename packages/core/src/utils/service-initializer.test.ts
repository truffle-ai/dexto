import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgentRuntimeSettings } from '../agent/runtime-config.js';
import type { Logger } from '../logger/v2/types.js';

const { initMock } = vi.hoisted(() => ({
    initMock: vi.fn(),
}));

vi.mock('../telemetry/telemetry.js', () => ({
    Telemetry: {
        init: initMock,
    },
}));

import { initializeAgentTelemetry } from './service-initializer.js';

describe('initializeAgentTelemetry', () => {
    const debugMock = vi.fn();
    const logger = {
        debug: debugMock,
    } as unknown as Logger;

    const createSettings = (
        telemetry: AgentRuntimeSettings['telemetry'] = {
            enabled: true,
            export: { type: 'console' },
        }
    ): AgentRuntimeSettings =>
        ({
            agentId: 'test-agent',
            telemetry,
        }) as unknown as AgentRuntimeSettings;

    beforeEach(() => {
        initMock.mockReset();
        debugMock.mockReset();
    });

    test('uses the default telemetry init path when enabled and no override is provided', async () => {
        const settings = createSettings();

        await initializeAgentTelemetry(settings, logger);

        expect(initMock).toHaveBeenCalledWith(settings.telemetry);
        expect(debugMock).toHaveBeenCalledWith('Telemetry initialized');
    });

    test('skips the default telemetry init path when telemetry is disabled', async () => {
        await initializeAgentTelemetry(createSettings({ enabled: false }), logger);

        expect(initMock).not.toHaveBeenCalled();
        expect(debugMock).not.toHaveBeenCalled();
    });

    test('uses the host-provided bootstrap override instead of the default init path', async () => {
        const settings = createSettings();
        const telemetryBootstrap = vi.fn();

        await initializeAgentTelemetry(settings, logger, telemetryBootstrap);

        expect(telemetryBootstrap).toHaveBeenCalledWith({
            agentId: 'test-agent',
            config: settings.telemetry,
            logger,
        });
        expect(initMock).not.toHaveBeenCalled();
    });
});

/**
 * Test utilities for logger mocking
 *
 * Provides a reusable mock logger for tests that need IDextoLogger.
 */

import { vi } from 'vitest';
import type { IDextoLogger, LogLevel } from './types.js';

/**
 * Creates a mock logger that satisfies IDextoLogger interface.
 * All methods are vi.fn() mocks that can be spied on.
 */
export function createMockLogger(): IDextoLogger {
    const mockLogger: IDextoLogger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => mockLogger),
        destroy: vi.fn(),
        setLevel: vi.fn(),
        getLevel: vi.fn((): LogLevel => 'info'),
        getLogFilePath: vi.fn(() => null),
    };
    return mockLogger;
}

/**
 * Creates a silent mock logger with no-op functions.
 * Useful when you don't need to spy on logger calls.
 */
export function createSilentMockLogger(): IDextoLogger {
    const mockLogger: IDextoLogger = {
        debug: () => {},
        silly: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        trackException: () => {},
        createChild: () => mockLogger,
        destroy: async () => {},
        setLevel: () => {},
        getLevel: () => 'info',
        getLogFilePath: () => null,
    };
    return mockLogger;
}

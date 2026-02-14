/**
 * Test utilities for logger mocking
 *
 * Provides a reusable mock logger for tests that need Logger.
 */

import { vi } from 'vitest';
import type { Logger, LogLevel } from './types.js';

/**
 * Creates a mock logger that satisfies Logger.
 * All methods are vi.fn() mocks that can be spied on.
 */
export function createMockLogger(): Logger {
    const mockLogger: Logger = {
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
export function createSilentMockLogger(): Logger {
    const mockLogger: Logger = {
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

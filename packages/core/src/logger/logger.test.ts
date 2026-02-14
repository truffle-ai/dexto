import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GlobalLogger } from '../logger/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

// Ensure console.log is mocked and environment is reset between tests
beforeEach(() => {
    delete process.env.DEXTO_LOG_LEVEL;
    delete process.env.DEXTO_LOG_TO_CONSOLE;
    delete process.env.DEBUG;
    vi.restoreAllMocks();
});

afterEach(() => {
    // Clean up any temporary log files
    vi.restoreAllMocks();
});

describe('Logger utilities', () => {
    let spyLog: ReturnType<typeof vi.spyOn>;
    let _spyStdErrWrite: ReturnType<typeof vi.spyOn>;
    let tempDir: string;

    beforeEach(() => {
        spyLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        _spyStdErrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as any;
        tempDir = fs.mkdtempSync(path.join(tmpdir(), 'dexto-logger-test-'));
    });

    afterEach(() => {
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    it('getDefaultLogLevel falls back to "info"', () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });
        expect(l.getLevel()).toBe('info');
    });

    it('respects DEXTO_LOG_LEVEL env var', () => {
        process.env.DEXTO_LOG_LEVEL = 'debug';
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });
        expect(l.getLevel()).toBe('debug');
    });

    it('setLevel updates level and rejects invalid levels', () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ level: 'info', customLogPath });
        l.setLevel('warn');
        expect(l.getLevel()).toBe('warn');
        // Invalid level should not change current level
        l.setLevel('invalid');
        expect(l.getLevel()).toBe('warn');
    });

    it('uses file logging by default', () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });
        expect(l.getLogFilePath()).toBe(customLogPath);
    });

    it('enables console logging when DEXTO_LOG_TO_CONSOLE=true', () => {
        process.env.DEXTO_LOG_TO_CONSOLE = 'true';
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });

        // Logger should still have file path set
        expect(l.getLogFilePath()).toBe(customLogPath);

        // toolCall should log to console when console logging is enabled
        l.toolCall('testTool', { foo: 'bar' });
        expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('Tool Call'));
    });

    it('display methods always use console.log (UI display)', () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });

        l.toolCall('testTool', { foo: 'bar' });
        // Display methods (toolCall, displayAIResponse, toolResult) always use console.log for UI
        expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('Tool Call'));
    });

    it('creates log file directory if it does not exist', async () => {
        const logDir = path.join(tempDir, 'nested', 'log', 'dir');
        const customLogPath = path.join(logDir, 'test.log');

        const l = new GlobalLogger({ customLogPath });

        // Give async initialization time to complete
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(fs.existsSync(logDir)).toBe(true);
        expect(l.getLogFilePath()).toBe(customLogPath);
    });

    it('actually writes logs to the file', async () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });

        // Write a test log
        l.info('Test log message');

        // Give time for file write
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Check that file exists and contains the log
        expect(fs.existsSync(customLogPath)).toBe(true);
        const logContent = fs.readFileSync(customLogPath, 'utf8');
        expect(logContent).toContain('Test log message');
        expect(logContent).toContain('"level":"info"');
    });

    it('uses synchronous path resolution for project detection', () => {
        const customLogPath = path.join(tempDir, 'test.log');
        const l = new GlobalLogger({ customLogPath });

        // Logger should initialize synchronously without errors
        expect(l.getLogFilePath()).toBe(customLogPath);

        // Should be able to log immediately
        l.info('Immediate log');
        expect(l.getLevel()).toBe('info');
    });
});

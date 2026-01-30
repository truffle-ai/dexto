import { describe, test, expect, vi, beforeEach, type Mocked } from 'vitest';
import { DatabaseHistoryProvider } from './database.js';
import type { Database } from '@core/storage/types.js';
import { SessionErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { createMockLogger } from '@core/logger/v2/test-utils.js';

describe('DatabaseHistoryProvider error mapping', () => {
    let db: Mocked<Database>;
    let provider: DatabaseHistoryProvider;
    const sessionId = 's-1';
    const mockLogger = createMockLogger();

    beforeEach(() => {
        db = {
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            list: vi.fn(),
            clear: vi.fn(),
            append: vi.fn(),
            getRange: vi.fn(),
            getLength: vi.fn(),
            connect: vi.fn(),
            disconnect: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            getStoreType: vi.fn().mockReturnValue('memory'),
        } as any;

        provider = new DatabaseHistoryProvider(sessionId, db, mockLogger);
    });

    test('saveMessage maps backend error to SessionError.storageFailed', async () => {
        db.append.mockRejectedValue(new Error('append failed'));
        await expect(
            provider.saveMessage({ role: 'user', content: 'hi' } as any)
        ).rejects.toMatchObject({
            code: SessionErrorCode.SESSION_STORAGE_FAILED,
            scope: ErrorScope.SESSION,
            type: ErrorType.SYSTEM,
            context: expect.objectContaining({ sessionId }),
        });
    });

    test('clearHistory maps backend error to SessionError.resetFailed', async () => {
        db.delete.mockRejectedValue(new Error('delete failed'));
        await expect(provider.clearHistory()).rejects.toMatchObject({
            code: SessionErrorCode.SESSION_RESET_FAILED,
            scope: ErrorScope.SESSION,
            type: ErrorType.SYSTEM,
            context: expect.objectContaining({ sessionId }),
        });
    });

    test('getHistory maps backend error to SessionError.storageFailed', async () => {
        db.getRange.mockRejectedValue(new Error('getRange failed'));
        await expect(provider.getHistory()).rejects.toMatchObject({
            code: SessionErrorCode.SESSION_STORAGE_FAILED,
            scope: ErrorScope.SESSION,
            type: ErrorType.SYSTEM,
            context: expect.objectContaining({ sessionId }),
        });
    });
});

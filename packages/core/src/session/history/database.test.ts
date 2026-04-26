import { describe, test, expect, vi, beforeEach, type Mocked } from 'vitest';
import { DatabaseHistoryProvider } from './database.js';
import type { Database } from '../../storage/types.js';
import { SessionErrorCode } from '../error-codes.js';
import { ErrorScope, ErrorType } from '../../errors/types.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import type { InternalMessage } from '../../context/types.js';

describe('DatabaseHistoryProvider error mapping', () => {
    let db: Mocked<Database>;
    let provider: DatabaseHistoryProvider;
    const sessionId = 's-1';
    const mockLogger = createMockLogger();
    const createTextMessage = (id: string, content: string): InternalMessage => ({
        id,
        role: 'user',
        content: [{ type: 'text', text: content }],
    });

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

    test('getHistory keeps the latest stored version when message IDs repeat', async () => {
        const originalAssistant = createTextMessage('assistant-1', 'partial');
        const userMessage = createTextMessage('user-1', 'next');
        const updatedAssistant = createTextMessage('assistant-1', 'complete');
        db.getRange.mockResolvedValue([originalAssistant, userMessage, updatedAssistant]);

        await expect(provider.getHistory()).resolves.toEqual([updatedAssistant, userMessage]);
        expect(db.delete).not.toHaveBeenCalled();
    });

    test('updateMessage appends the new version without deleting existing history', async () => {
        const originalMessage = createTextMessage('assistant-1', 'partial');
        const updatedMessage = createTextMessage('assistant-1', 'complete');
        db.getRange.mockResolvedValue([originalMessage]);

        await provider.updateMessage(updatedMessage);
        await provider.flush();

        expect(db.append).toHaveBeenCalledWith(`messages:${sessionId}`, updatedMessage);
        expect(db.delete).not.toHaveBeenCalled();
    });

    test('flush maps backend append errors without deleting history', async () => {
        const originalMessage = createTextMessage('assistant-1', 'partial');
        const updatedMessage = createTextMessage('assistant-1', 'complete');
        db.getRange.mockResolvedValue([originalMessage]);
        db.append.mockRejectedValue(new Error('append failed'));

        await provider.updateMessage(updatedMessage);

        await expect(provider.flush()).rejects.toMatchObject({
            code: SessionErrorCode.SESSION_STORAGE_FAILED,
            scope: ErrorScope.SESSION,
            type: ErrorType.SYSTEM,
            context: expect.objectContaining({ sessionId }),
        });
        expect(db.delete).not.toHaveBeenCalled();
    });

    test('flush failure does not overwrite newer pending updates', async () => {
        const originalMessage = createTextMessage('assistant-1', 'partial');
        const failedMessage = createTextMessage('assistant-1', 'in flight');
        const newerMessage = createTextMessage('assistant-1', 'complete');
        db.getRange.mockResolvedValue([originalMessage]);
        db.append.mockImplementationOnce(async () => {
            await provider.updateMessage(newerMessage);
            throw new Error('append failed');
        });

        await provider.updateMessage(failedMessage);
        await expect(provider.flush()).rejects.toMatchObject({
            code: SessionErrorCode.SESSION_STORAGE_FAILED,
        });

        db.append.mockResolvedValue(undefined);
        await provider.flush();

        expect(db.append).toHaveBeenNthCalledWith(1, `messages:${sessionId}`, failedMessage);
        expect(db.append).toHaveBeenNthCalledWith(2, `messages:${sessionId}`, newerMessage);
        expect(db.delete).not.toHaveBeenCalled();
    });
});

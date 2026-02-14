/**
 * File Transport
 *
 * Logs to a file with automatic rotation based on file size.
 * Keeps a configurable number of rotated log files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LoggerTransport, LogEntry } from '../types.js';

export interface FileTransportConfig {
    /** Absolute path to log file */
    path: string;
    /** Max file size in bytes before rotation (default: 10MB) */
    maxSize?: number;
    /** Max number of rotated files to keep (default: 5) */
    maxFiles?: number;
}

/**
 * File transport with size-based rotation
 */
export class FileTransport implements LoggerTransport {
    private filePath: string;
    private maxSize: number;
    private maxFiles: number;
    private writeStream: fs.WriteStream | null = null;
    private currentSize: number = 0;
    private isRotating: boolean = false;
    private pendingLogs: string[] = [];

    constructor(config: FileTransportConfig) {
        this.filePath = config.path;
        this.maxSize = config.maxSize ?? 10 * 1024 * 1024; // 10MB default
        this.maxFiles = config.maxFiles ?? 5; // Keep 5 files default

        // Ensure log directory exists
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Get current file size if it exists
        if (fs.existsSync(this.filePath)) {
            const stats = fs.statSync(this.filePath);
            this.currentSize = stats.size;
        }

        // Create write stream
        this.createWriteStream();
    }

    private createWriteStream(): void {
        this.writeStream = fs.createWriteStream(this.filePath, {
            flags: 'a', // Append mode
            encoding: 'utf8',
        });

        this.writeStream.on('error', (error) => {
            console.error('FileTransport write stream error:', error);
        });
    }

    write(entry: LogEntry): void {
        // Format log entry as JSON line
        const line = JSON.stringify(entry) + '\n';
        const lineSize = Buffer.byteLength(line, 'utf8');

        // Buffer logs if not ready or rotating (prevents log loss)
        if (!this.writeStream || this.isRotating) {
            this.pendingLogs.push(line);
            return;
        }

        // Check if rotation is needed
        if (this.currentSize + lineSize > this.maxSize) {
            // Buffer this log and trigger async rotation
            this.pendingLogs.push(line);
            void this.rotate(); // Fire and forget - logs are buffered
            return;
        }

        // Write to file immediately
        this.writeStream.write(line);
        this.currentSize += lineSize;
    }

    /**
     * Rotate log files asynchronously
     * Renames current file to .1, shifts existing rotated files up (.1 -> .2, etc.)
     * Deletes oldest file if maxFiles is exceeded, then flushes buffered logs
     */
    private async rotate(): Promise<void> {
        if (this.isRotating) {
            return;
        }

        this.isRotating = true;

        try {
            // Close current write stream asynchronously
            if (this.writeStream) {
                await new Promise<void>((resolve) => {
                    this.writeStream!.end(() => resolve());
                });
                this.writeStream = null;
            }

            // Use async file operations to avoid blocking event loop
            const promises = [];

            // Delete oldest rotated file if it exists
            const oldestFile = `${this.filePath}.${this.maxFiles}`;
            try {
                await fs.promises.access(oldestFile);
                promises.push(fs.promises.unlink(oldestFile));
            } catch {
                // File doesn't exist, skip
            }

            await Promise.all(promises);

            // Shift existing rotated files up by one
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                const oldFile = `${this.filePath}.${i}`;
                const newFile = `${this.filePath}.${i + 1}`;

                try {
                    await fs.promises.access(oldFile);
                    await fs.promises.rename(oldFile, newFile);
                } catch {
                    // File doesn't exist, skip
                }
            }

            // Rename current file to .1
            try {
                await fs.promises.access(this.filePath);
                await fs.promises.rename(this.filePath, `${this.filePath}.1`);
            } catch {
                // File doesn't exist, skip
            }

            // Reset size counter and create new stream
            this.currentSize = 0;
            this.createWriteStream();

            // Flush buffered logs after rotation completes
            await this.flushPendingLogs();
        } catch (error) {
            console.error('FileTransport rotation error:', error);
        } finally {
            this.isRotating = false;
        }
    }

    /**
     * Flush buffered logs to the write stream
     * Called after rotation completes to prevent log loss
     */
    private async flushPendingLogs(): Promise<void> {
        while (this.pendingLogs.length > 0 && this.writeStream) {
            const line = this.pendingLogs.shift()!;
            const lineSize = Buffer.byteLength(line, 'utf8');

            // Check if we need to rotate again
            if (this.currentSize + lineSize > this.maxSize) {
                // Put the log back and trigger another rotation
                this.pendingLogs.unshift(line);
                await this.rotate();
                break;
            }

            // Write to stream
            this.writeStream.write(line);
            this.currentSize += lineSize;
        }
    }

    /**
     * Get the log file path
     */
    getFilePath(): string {
        return this.filePath;
    }

    /**
     * Cleanup resources
     */
    destroy(): void {
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = null;
        }
    }
}

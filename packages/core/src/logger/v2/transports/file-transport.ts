/**
 * File Transport
 *
 * Logs to a file with automatic rotation based on file size.
 * Keeps a configurable number of rotated log files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ILoggerTransport, LogEntry } from '../types.js';

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
export class FileTransport implements ILoggerTransport {
    private filePath: string;
    private maxSize: number;
    private maxFiles: number;
    private writeStream: fs.WriteStream | null = null;
    private currentSize: number = 0;
    private isRotating: boolean = false;

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
        if (!this.writeStream || this.isRotating) {
            return;
        }

        // Format log entry as JSON line
        const line = JSON.stringify(entry) + '\n';
        const lineSize = Buffer.byteLength(line, 'utf8');

        // Check if rotation is needed
        if (this.currentSize + lineSize > this.maxSize) {
            this.rotate();
        }

        // Write to file
        this.writeStream.write(line);
        this.currentSize += lineSize;
    }

    /**
     * Rotate log files
     * Renames current file to .1, shifts existing rotated files up (.1 -> .2, etc.)
     * Deletes oldest file if maxFiles is exceeded
     */
    private rotate(): void {
        if (this.isRotating) {
            return;
        }

        this.isRotating = true;

        try {
            // Close current write stream
            if (this.writeStream) {
                this.writeStream.end();
                this.writeStream = null;
            }

            // Delete oldest rotated file if it exists
            const oldestFile = `${this.filePath}.${this.maxFiles}`;
            if (fs.existsSync(oldestFile)) {
                fs.unlinkSync(oldestFile);
            }

            // Shift existing rotated files up by one
            for (let i = this.maxFiles - 1; i >= 1; i--) {
                const oldFile = `${this.filePath}.${i}`;
                const newFile = `${this.filePath}.${i + 1}`;

                if (fs.existsSync(oldFile)) {
                    fs.renameSync(oldFile, newFile);
                }
            }

            // Rename current file to .1
            if (fs.existsSync(this.filePath)) {
                fs.renameSync(this.filePath, `${this.filePath}.1`);
            }

            // Reset size counter and create new stream
            this.currentSize = 0;
            this.createWriteStream();
        } catch (error) {
            console.error('FileTransport rotation error:', error);
        } finally {
            this.isRotating = false;
        }
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

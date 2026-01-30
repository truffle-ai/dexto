/**
 * Model downloader for local GGUF models.
 *
 * Downloads models from HuggingFace with:
 * - Progress tracking via events
 * - Resume support for interrupted downloads
 * - Hash verification after download
 */

import { createWriteStream, promises as fs, existsSync, createReadStream } from 'fs';
import { createHash } from 'crypto';
import * as path from 'path';
import type { ModelDownloadProgress, ModelDownloadStatus } from './types.js';
import { LocalModelError } from './errors.js';
import { getLocalModelById } from './registry.js';

/**
 * Event emitter interface for download progress.
 */
export interface DownloadEvents {
    onProgress?: (progress: ModelDownloadProgress) => void;
    onComplete?: (modelId: string, filePath: string) => void;
    onError?: (modelId: string, error: Error) => void;
}

/**
 * Download options.
 */
export interface DownloadOptions {
    /** Directory to save the model */
    targetDir: string;
    /** Events for progress tracking */
    events?: DownloadEvents;
    /** HuggingFace token for gated models */
    hfToken?: string;
    /** Whether to verify hash after download */
    verifyHash?: boolean;
    /** Abort signal for cancellation */
    signal?: AbortSignal;
    /** Expected SHA-256 hash for verification */
    expectedHash?: string;
}

/**
 * Download result.
 */
export interface DownloadResult {
    /** Whether download succeeded */
    success: boolean;
    /** Full path to downloaded file */
    filePath: string;
    /** File size in bytes */
    sizeBytes: number;
    /** SHA-256 hash of the file */
    sha256?: string;
    /** Whether download was resumed from partial */
    resumed: boolean;
}

/**
 * Build the HuggingFace download URL for a model file.
 */
function buildHuggingFaceUrl(huggingfaceId: string, filename: string): string {
    // HuggingFace URL format: https://huggingface.co/{repo}/resolve/main/{filename}
    return `https://huggingface.co/${huggingfaceId}/resolve/main/${filename}`;
}

/**
 * Get the size of a partial download file.
 */
async function getPartialSize(filePath: string): Promise<number> {
    try {
        const stats = await fs.stat(filePath);
        return stats.size;
    } catch {
        return 0;
    }
}

/**
 * Calculate SHA-256 hash of a file.
 */
export async function calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash('sha256');
        const stream = createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Create a progress event object.
 */
function createProgressEvent(
    modelId: string,
    status: ModelDownloadStatus,
    bytesDownloaded: number,
    totalBytes: number,
    speed?: number,
    eta?: number,
    error?: string
): ModelDownloadProgress {
    const progress: ModelDownloadProgress = {
        modelId,
        status,
        bytesDownloaded,
        totalBytes,
        percentage: totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0,
    };

    if (speed !== undefined) {
        progress.speed = speed;
    }
    if (eta !== undefined) {
        progress.eta = eta;
    }
    if (error !== undefined) {
        progress.error = error;
    }

    return progress;
}

/**
 * Download a model from HuggingFace.
 */
async function downloadFromHuggingFace(
    url: string,
    targetPath: string,
    options: DownloadOptions,
    modelId: string,
    expectedSize: number
): Promise<DownloadResult> {
    const { events, hfToken, signal } = options;

    // Check for partial download to support resume
    const tempPath = `${targetPath}.download`;
    const partialSize = await getPartialSize(tempPath);
    const resumed = partialSize > 0;

    const headers: Record<string, string> = {
        'User-Agent': 'Dexto/1.0',
    };

    // Add auth token for gated models
    if (hfToken) {
        headers['Authorization'] = `Bearer ${hfToken}`;
    }

    // Add range header for resume
    if (partialSize > 0) {
        headers['Range'] = `bytes=${partialSize}-`;
    }

    try {
        // Build fetch options - only include signal if provided
        const fetchOptions: RequestInit = { headers };
        if (signal) {
            fetchOptions.signal = signal;
        }

        const response = await fetch(url, fetchOptions);

        // Check for auth errors (gated models)
        if (response.status === 401 || response.status === 403) {
            throw LocalModelError.hfAuthRequired(modelId);
        }

        if (!response.ok && response.status !== 206) {
            throw LocalModelError.downloadFailed(
                modelId,
                `HTTP ${response.status}: ${response.statusText}`
            );
        }

        // Get content length for progress tracking
        const contentLengthHeader = response.headers.get('content-length');
        const contentLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
        const totalSize = partialSize + contentLength;

        // Ensure target directory exists
        await fs.mkdir(path.dirname(tempPath), { recursive: true });

        // Open file for writing (append if resuming)
        const writeStream = createWriteStream(tempPath, {
            flags: resumed ? 'a' : 'w',
        });

        // Track download progress
        let bytesDownloaded = partialSize;
        const startTime = Date.now();
        let lastProgressUpdate = startTime;

        const reader = response.body?.getReader();
        if (!reader) {
            writeStream.destroy();
            throw LocalModelError.downloadFailed(modelId, 'No response body');
        }

        try {
            // Read and write chunks
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                writeStream.write(value);
                bytesDownloaded += value.length;

                // Emit progress every 100ms
                const now = Date.now();
                if (now - lastProgressUpdate > 100 || done) {
                    lastProgressUpdate = now;
                    const elapsedSeconds = (now - startTime) / 1000;
                    const speed =
                        elapsedSeconds > 0 ? (bytesDownloaded - partialSize) / elapsedSeconds : 0;
                    const remainingBytes = totalSize - bytesDownloaded;
                    const eta = speed > 0 ? remainingBytes / speed : 0;

                    const progress = createProgressEvent(
                        modelId,
                        'downloading',
                        bytesDownloaded,
                        totalSize || expectedSize,
                        speed,
                        eta
                    );

                    events?.onProgress?.(progress);
                }
            }

            // Close write stream
            await new Promise<void>((resolve, reject) => {
                writeStream.end((err: Error | null | undefined) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } catch (error) {
            writeStream.destroy();
            throw error;
        }

        // Emit verifying status
        events?.onProgress?.(createProgressEvent(modelId, 'verifying', bytesDownloaded, totalSize));

        // Rename temp file to final path
        await fs.rename(tempPath, targetPath);

        // Get final file size
        const stats = await fs.stat(targetPath);

        // Emit complete status
        events?.onProgress?.(createProgressEvent(modelId, 'complete', stats.size, stats.size));

        return {
            success: true,
            filePath: targetPath,
            sizeBytes: stats.size,
            resumed,
        };
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw LocalModelError.downloadInterrupted(modelId);
        }
        throw error;
    }
}

/**
 * Download a local model by ID.
 */
export async function downloadModel(
    modelId: string,
    options: DownloadOptions
): Promise<DownloadResult> {
    const modelInfo = getLocalModelById(modelId);
    if (!modelInfo) {
        throw LocalModelError.modelNotFound(modelId);
    }

    const targetPath = path.join(options.targetDir, modelInfo.filename);
    const url = buildHuggingFaceUrl(modelInfo.huggingfaceId, modelInfo.filename);

    // Check if file already exists
    if (existsSync(targetPath)) {
        const stats = await fs.stat(targetPath);
        // Verify size matches expected
        if (stats.size === modelInfo.sizeBytes) {
            return {
                success: true,
                filePath: targetPath,
                sizeBytes: stats.size,
                resumed: false,
            };
        }
        // Delete partial/corrupt file
        await fs.unlink(targetPath);
    }

    try {
        // Emit pending status
        options.events?.onProgress?.(
            createProgressEvent(modelId, 'pending', 0, modelInfo.sizeBytes)
        );

        const result = await downloadFromHuggingFace(
            url,
            targetPath,
            options,
            modelId,
            modelInfo.sizeBytes
        );

        // Verify hash if requested and expected hash is provided
        if (options.verifyHash && options.expectedHash) {
            const actualHash = await calculateFileHash(targetPath);
            if (actualHash !== options.expectedHash) {
                // Delete corrupted file
                await fs.unlink(targetPath);
                throw LocalModelError.hashMismatch(modelId, options.expectedHash, actualHash);
            }
            result.sha256 = actualHash;
        }

        options.events?.onComplete?.(modelId, targetPath);
        return result;
    } catch (error) {
        options.events?.onError?.(modelId, error as Error);
        throw error;
    }
}

/**
 * Download a model directly from a URL (for custom models).
 */
export async function downloadModelFromUrl(
    modelId: string,
    url: string,
    filename: string,
    options: DownloadOptions
): Promise<DownloadResult> {
    const targetPath = path.join(options.targetDir, filename);

    try {
        // Emit pending status
        options.events?.onProgress?.(createProgressEvent(modelId, 'pending', 0, 0));

        const result = await downloadFromHuggingFace(url, targetPath, options, modelId, 0);
        options.events?.onComplete?.(modelId, targetPath);
        return result;
    } catch (error) {
        options.events?.onError?.(modelId, error as Error);
        throw error;
    }
}

/**
 * Check available disk space at a path.
 */
export async function checkDiskSpace(targetDir: string): Promise<number> {
    // This is a simplified check - in production, use a library like check-disk-space
    // For now, we'll return a large value and let the OS handle space errors
    try {
        await fs.access(targetDir);
        return Number.MAX_SAFE_INTEGER;
    } catch {
        // Directory doesn't exist, try to create it to check permissions
        try {
            await fs.mkdir(targetDir, { recursive: true });
            return Number.MAX_SAFE_INTEGER;
        } catch {
            return 0;
        }
    }
}

/**
 * Validate that there's enough disk space for a model.
 */
export async function validateDiskSpace(
    modelId: string,
    requiredBytes: number,
    targetDir: string
): Promise<void> {
    const available = await checkDiskSpace(targetDir);
    if (available < requiredBytes) {
        throw LocalModelError.insufficientDiskSpace(modelId, requiredBytes, available);
    }
}

/**
 * Clean up partial download files.
 */
export async function cleanupPartialDownload(targetDir: string, filename: string): Promise<void> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        await fs.unlink(tempPath);
    } catch {
        // Ignore if file doesn't exist
    }
}

/**
 * Check if a download is in progress (partial file exists).
 */
export async function isDownloadInProgress(targetDir: string, filename: string): Promise<boolean> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        await fs.access(tempPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the progress of a partial download.
 */
export async function getPartialDownloadProgress(
    modelId: string,
    targetDir: string,
    filename: string,
    totalBytes: number
): Promise<ModelDownloadProgress | null> {
    const tempPath = path.join(targetDir, `${filename}.download`);
    try {
        const stats = await fs.stat(tempPath);
        return createProgressEvent(modelId, 'downloading', stats.size, totalBytes);
    } catch {
        return null;
    }
}

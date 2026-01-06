/**
 * Clipboard utilities for reading images from system clipboard
 *
 * Supports macOS, Windows/WSL, and Linux (Wayland + X11).
 *
 */

import { spawn } from 'node:child_process';
import { platform, release } from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export interface ClipboardImageContent {
    /** Base64-encoded image data */
    data: string;
    /** MIME type of the image */
    mimeType: string;
}

/**
 * Execute a command and return stdout as a buffer
 * @param command - The command to execute
 * @param args - Command arguments
 * @param timeoutMs - Timeout in milliseconds (default: 10000)
 */
async function execCommand(
    command: string,
    args: string[],
    timeoutMs: number = 10000
): Promise<{ stdout: Buffer; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        let timedOut = false;
        const proc = spawn(command, args);
        const stdoutChunks: Buffer[] = [];
        let stderr = '';

        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr: stderr + '\nCommand timed out',
                exitCode: 1,
            });
        }, timeoutMs);

        proc.stdout.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
        });

        proc.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        proc.on('close', (exitCode) => {
            if (timedOut) return;
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr,
                exitCode: exitCode ?? 1,
            });
        });

        proc.on('error', () => {
            if (timedOut) return;
            clearTimeout(timer);
            resolve({
                stdout: Buffer.concat(stdoutChunks),
                stderr,
                exitCode: 1,
            });
        });
    });
}

/**
 * Execute an osascript command and return stdout as string
 */
async function execOsascript(script: string): Promise<{ stdout: string; success: boolean }> {
    const result = await execCommand('osascript', ['-e', script]);
    return {
        stdout: result.stdout.toString().trim(),
        success: result.exitCode === 0,
    };
}

/**
 * Read image from clipboard on macOS
 * Uses osascript to save clipboard image to temp file, reads it, then cleans up
 */
async function readClipboardImageMacOS(): Promise<ClipboardImageContent | undefined> {
    const tmpFile = path.join(os.tmpdir(), `dexto-clipboard-${Date.now()}-${process.pid}.png`);

    try {
        // AppleScript to save clipboard image as PNG to temp file
        const script = `
            set imageData to the clipboard as "PNGf"
            set fileRef to open for access POSIX file "${tmpFile}" with write permission
            set eof fileRef to 0
            write imageData to fileRef
            close access fileRef
        `;

        const result = await execOsascript(script);
        if (!result.success) {
            return undefined;
        }

        // Read the temp file
        const buffer = await fs.readFile(tmpFile);
        if (buffer.length === 0) {
            return undefined;
        }

        return {
            data: buffer.toString('base64'),
            mimeType: 'image/png',
        };
    } catch {
        return undefined;
    } finally {
        // Clean up temp file
        try {
            await fs.unlink(tmpFile);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Read image from clipboard on Windows (including WSL)
 * Uses PowerShell to get clipboard image and convert to base64
 */
async function readClipboardImageWindows(): Promise<ClipboardImageContent | undefined> {
    try {
        // PowerShell script to get clipboard image as base64 PNG
        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            $img = [System.Windows.Forms.Clipboard]::GetImage()
            if ($img) {
                $ms = New-Object System.IO.MemoryStream
                $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                [System.Convert]::ToBase64String($ms.ToArray())
            }
        `.trim();

        // Use powershell.exe for both native Windows and WSL (works on both)
        const powershellCmd = 'powershell.exe';
        const result = await execCommand(powershellCmd, ['-command', script]);

        const base64 = result.stdout.toString().trim();
        if (!base64 || result.exitCode !== 0) {
            return undefined;
        }

        // Validate it's actually base64 data
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length === 0) {
            return undefined;
        }

        return {
            data: base64,
            mimeType: 'image/png',
        };
    } catch {
        return undefined;
    }
}

/**
 * Check if current environment is WSL (Windows Subsystem for Linux)
 * Checks for both 'wsl' (WSL2) and 'microsoft' (WSL1) in kernel release
 */
function isWSL(): boolean {
    if (platform() !== 'linux') return false;
    const rel = release().toLowerCase();
    return rel.includes('wsl') || rel.includes('microsoft');
}

/**
 * Read image from clipboard on Linux
 * Tries Wayland (wl-paste) first, then X11 (xclip)
 */
async function readClipboardImageLinux(): Promise<ClipboardImageContent | undefined> {
    // Try Wayland first (wl-paste)
    try {
        const result = await execCommand('wl-paste', ['-t', 'image/png']);
        if (result.exitCode === 0 && result.stdout.length > 0) {
            return {
                data: result.stdout.toString('base64'),
                mimeType: 'image/png',
            };
        }
    } catch {
        // wl-paste not available or failed, try xclip
    }

    // Try X11 (xclip)
    try {
        const result = await execCommand('xclip', [
            '-selection',
            'clipboard',
            '-t',
            'image/png',
            '-o',
        ]);
        if (result.exitCode === 0 && result.stdout.length > 0) {
            return {
                data: result.stdout.toString('base64'),
                mimeType: 'image/png',
            };
        }
    } catch {
        // xclip not available or failed
    }

    return undefined;
}

/**
 * Read image from system clipboard
 *
 * @returns ClipboardImageContent if clipboard contains an image, undefined otherwise
 *
 * @example
 * ```typescript
 * const image = await readClipboardImage();
 * if (image) {
 *     console.log(`Got ${image.mimeType} image, ${image.data.length} bytes base64`);
 * }
 * ```
 */
export async function readClipboardImage(): Promise<ClipboardImageContent | undefined> {
    const os = platform();

    if (os === 'darwin') {
        return readClipboardImageMacOS();
    }

    if (os === 'win32' || isWSL()) {
        return readClipboardImageWindows();
    }

    if (os === 'linux') {
        return readClipboardImageLinux();
    }

    return undefined;
}

/**
 * Write text to system clipboard
 *
 * @param text - The text to copy to clipboard
 * @returns true if successful, false otherwise
 *
 * @example
 * ```typescript
 * const success = await writeToClipboard('Hello, World!');
 * if (success) {
 *     console.log('Copied to clipboard');
 * }
 * ```
 */
export async function writeToClipboard(text: string): Promise<boolean> {
    const os = platform();

    try {
        if (os === 'darwin') {
            // macOS: use pbcopy
            const proc = spawn('pbcopy');
            proc.stdin.write(text);
            proc.stdin.end();
            return new Promise((resolve) => {
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            });
        }

        if (os === 'win32' || isWSL()) {
            // Windows/WSL: use clip.exe (simpler than PowerShell)
            const proc = spawn('clip.exe');
            proc.stdin.write(text);
            proc.stdin.end();
            return new Promise((resolve) => {
                proc.on('close', (code) => resolve(code === 0));
                proc.on('error', () => resolve(false));
            });
        }

        if (os === 'linux') {
            // Try Wayland first (wl-copy), fall back to X11 (xclip)
            const tryClipboardTool = (cmd: string, args: string[] = []): Promise<boolean> => {
                return new Promise((resolve) => {
                    const proc = spawn(cmd, args);
                    let errorOccurred = false;

                    proc.on('error', () => {
                        errorOccurred = true;
                        resolve(false);
                    });

                    proc.stdin.write(text);
                    proc.stdin.end();

                    proc.on('close', (code) => {
                        if (!errorOccurred) {
                            resolve(code === 0);
                        }
                    });
                });
            };

            // Try wl-copy first, then xclip
            const wlResult = await tryClipboardTool('wl-copy');
            if (wlResult) return true;

            return tryClipboardTool('xclip', ['-selection', 'clipboard']);
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Check if clipboard contains an image (without reading it)
 * This is a lighter-weight check that doesn't require reading the full image data.
 *
 * @returns true if clipboard likely contains an image
 */
export async function clipboardHasImage(): Promise<boolean> {
    const os = platform();

    if (os === 'darwin') {
        try {
            const result = await execOsascript('clipboard info');
            // Check for image types in clipboard info
            const imageRegex =
                /«class PNGf»|TIFF picture|JPEG picture|GIF picture|«class JPEG»|«class TIFF»/;
            return imageRegex.test(result.stdout);
        } catch {
            return false;
        }
    }

    if (os === 'win32' || isWSL()) {
        try {
            // Quick check if clipboard has an image
            const script = `
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.Clipboard]::ContainsImage()
            `.trim();

            const powershellCmd = 'powershell.exe';
            const result = await execCommand(powershellCmd, ['-command', script]);
            return result.stdout.toString().trim().toLowerCase() === 'true';
        } catch {
            return false;
        }
    }

    if (os === 'linux') {
        // Try Wayland first
        try {
            const result = await execCommand('wl-paste', ['--list-types']);
            if (result.exitCode === 0 && result.stdout.toString().includes('image/')) {
                return true;
            }
        } catch {
            // Try X11
        }

        // Try X11
        try {
            const result = await execCommand('xclip', [
                '-selection',
                'clipboard',
                '-t',
                'TARGETS',
                '-o',
            ]);
            if (result.exitCode === 0 && result.stdout.toString().includes('image/')) {
                return true;
            }
        } catch {
            // xclip not available
        }
    }

    return false;
}

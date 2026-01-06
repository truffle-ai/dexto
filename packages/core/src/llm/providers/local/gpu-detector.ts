/**
 * GPU detection for local model acceleration.
 *
 * Detects available GPU backends:
 * - Metal: Apple Silicon (M1/M2/M3/M4 series)
 * - CUDA: NVIDIA GPUs on Linux/Windows
 * - Vulkan: Cross-platform fallback for AMD/Intel GPUs
 * - CPU: Fallback when no GPU is available
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import type { GPUBackend, GPUInfo } from './types.js';

const execAsync = promisify(exec);

/**
 * Detect available GPU backend for the current system.
 * Returns the best available option.
 */
export async function detectGPU(): Promise<GPUInfo> {
    const platform = os.platform();

    // macOS: Check for Metal (Apple Silicon or discrete GPU)
    if (platform === 'darwin') {
        const metalInfo = await detectMetal();
        if (metalInfo.available) {
            return metalInfo;
        }
    }

    // Linux/Windows: Check for CUDA (NVIDIA)
    if (platform === 'linux' || platform === 'win32') {
        const cudaInfo = await detectCUDA();
        if (cudaInfo.available) {
            return cudaInfo;
        }

        // Fallback to Vulkan
        const vulkanInfo = await detectVulkan();
        if (vulkanInfo.available) {
            return vulkanInfo;
        }
    }

    // Default to CPU
    return {
        backend: 'cpu',
        available: true,
        deviceName: `${os.cpus()[0]?.model ?? 'Unknown CPU'}`,
    };
}

/**
 * Detect Metal GPU on macOS.
 */
async function detectMetal(): Promise<GPUInfo> {
    try {
        // Use system_profiler to get GPU info on macOS
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json 2>/dev/null');
        const data = JSON.parse(stdout);
        const gpuData = data?.SPDisplaysDataType?.[0];

        if (gpuData) {
            const chipName = gpuData.sppci_model ?? gpuData._name ?? 'Apple GPU';
            const isAppleSilicon =
                chipName.toLowerCase().includes('apple') ||
                chipName.toLowerCase().includes('m1') ||
                chipName.toLowerCase().includes('m2') ||
                chipName.toLowerCase().includes('m3') ||
                chipName.toLowerCase().includes('m4');

            // Apple Silicon has unified memory, so VRAM = system RAM
            // For discrete GPUs, try to parse VRAM
            const result: GPUInfo = {
                backend: 'metal',
                available: true,
                deviceName: chipName,
            };

            if (isAppleSilicon) {
                // Unified memory - use total system memory
                result.vramMB = Math.round(os.totalmem() / (1024 * 1024));
            } else if (gpuData.sppci_vram) {
                // Parse VRAM string like "8 GB"
                const vramMatch = gpuData.sppci_vram.match(/(\d+)\s*(GB|MB)/i);
                if (vramMatch) {
                    result.vramMB =
                        parseInt(vramMatch[1]!) * (vramMatch[2]!.toUpperCase() === 'GB' ? 1024 : 1);
                }
            }

            return result;
        }
    } catch {
        // Ignore errors - Metal not available
    }

    return {
        backend: 'metal',
        available: false,
    };
}

/**
 * Detect NVIDIA CUDA GPU.
 */
async function detectCUDA(): Promise<GPUInfo> {
    try {
        // Use nvidia-smi to detect NVIDIA GPU
        const { stdout } = await execAsync(
            'nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits 2>/dev/null'
        );

        const lines = stdout.trim().split('\n');
        if (lines.length > 0 && lines[0]) {
            const [name, memoryMB, driverVersion] = lines[0].split(', ').map((s) => s.trim());

            const result: GPUInfo = {
                backend: 'cuda',
                available: true,
            };

            if (name) {
                result.deviceName = name;
            }
            if (memoryMB) {
                result.vramMB = parseInt(memoryMB);
            }
            if (driverVersion) {
                result.driverVersion = driverVersion;
            }

            return result;
        }
    } catch {
        // nvidia-smi not available or no NVIDIA GPU
    }

    return {
        backend: 'cuda',
        available: false,
    };
}

/**
 * Detect Vulkan GPU support.
 */
async function detectVulkan(): Promise<GPUInfo> {
    try {
        // Try vulkaninfo command (available when Vulkan SDK is installed)
        const { stdout } = await execAsync('vulkaninfo --summary 2>/dev/null');

        // Parse device name from vulkaninfo output
        const deviceMatch = stdout.match(/deviceName\s*=\s*(.+)/);
        const deviceName = deviceMatch?.[1]?.trim() ?? 'Vulkan GPU';

        const result: GPUInfo = {
            backend: 'vulkan',
            available: true,
            deviceName,
        };

        // Parse VRAM if available
        const heapMatch = stdout.match(/heapSize\s*=\s*(\d+)/);
        if (heapMatch) {
            result.vramMB = Math.round(parseInt(heapMatch[1]!) / (1024 * 1024));
        }

        return result;
    } catch {
        // vulkaninfo not available
    }

    // Fallback: Check for common AMD/Intel GPU indicators on Linux
    if (os.platform() === 'linux') {
        try {
            const { stdout } = await execAsync('lspci | grep -i "vga\\|3d\\|display" 2>/dev/null');
            if (stdout.includes('AMD') || stdout.includes('Intel') || stdout.includes('Radeon')) {
                // GPU detected but Vulkan tools not installed
                const deviceMatch = stdout.match(/: (.+)/);
                return {
                    backend: 'vulkan',
                    available: true,
                    deviceName: deviceMatch?.[1]?.trim() ?? 'GPU (Vulkan)',
                };
            }
        } catch {
            // lspci not available
        }
    }

    return {
        backend: 'vulkan',
        available: false,
    };
}

/**
 * Get a human-readable summary of GPU detection results.
 */
export function formatGPUInfo(info: GPUInfo): string {
    if (!info.available) {
        return `${info.backend.toUpperCase()} not available`;
    }

    const parts = [info.deviceName ?? info.backend.toUpperCase()];

    if (info.vramMB) {
        const vramGB = (info.vramMB / 1024).toFixed(1);
        parts.push(`${vramGB}GB`);
    }

    if (info.driverVersion) {
        parts.push(`Driver: ${info.driverVersion}`);
    }

    return parts.join(' • ');
}

/**
 * Check if a specific backend is available.
 */
export async function isBackendAvailable(backend: GPUBackend): Promise<boolean> {
    switch (backend) {
        case 'metal':
            return (await detectMetal()).available;
        case 'cuda':
            return (await detectCUDA()).available;
        case 'vulkan':
            return (await detectVulkan()).available;
        case 'cpu':
            return true;
        default:
            return false;
    }
}

/**
 * Get all available backends on the current system.
 */
export async function getAvailableBackends(): Promise<GPUBackend[]> {
    const backends: GPUBackend[] = [];
    const platform = os.platform();

    if (platform === 'darwin') {
        if ((await detectMetal()).available) {
            backends.push('metal');
        }
    }

    if (platform === 'linux' || platform === 'win32') {
        if ((await detectCUDA()).available) {
            backends.push('cuda');
        }
        if ((await detectVulkan()).available) {
            backends.push('vulkan');
        }
    }

    // CPU is always available
    backends.push('cpu');

    return backends;
}

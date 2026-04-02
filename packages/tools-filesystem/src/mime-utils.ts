import * as path from 'node:path';

const MIME_BY_EXTENSION: Record<string, string> = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.cjs': 'text/javascript',
    '.jsx': 'text/javascript',
    '.ts': 'text/typescript',
    '.mts': 'text/typescript',
    '.cts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.vue': 'text/x-vue',
    '.json': 'application/json',
    '.jsonc': 'application/json',
    '.xml': 'application/xml',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.toml': 'application/toml',
    '.ini': 'text/plain',
    '.cfg': 'text/plain',
    '.conf': 'text/plain',
    '.csv': 'text/csv',
    '.log': 'text/plain',
    '.py': 'text/x-python',
    '.rb': 'text/x-ruby',
    '.php': 'text/x-php',
    '.java': 'text/x-java-source',
    '.kt': 'text/x-kotlin',
    '.swift': 'text/x-swift',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.cpp': 'text/x-c++src',
    '.c': 'text/x-csrc',
    '.h': 'text/x-chdr',
    '.hpp': 'text/x-c++hdr',
    '.sh': 'text/x-shellscript',
    '.bash': 'text/x-shellscript',
    '.zsh': 'text/x-shellscript',
    '.fish': 'text/x-shellscript',
    '.sql': 'text/x-sql',
    '.rst': 'text/x-rst',
    '.tex': 'text/x-tex',
    '.dockerfile': 'text/x-dockerfile',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.weba': 'audio/webm',
    '.mp4': 'video/mp4',
    '.m4v': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.ogv': 'video/ogg',
};

const MIME_BY_BASENAME: Record<string, string> = {
    dockerfile: 'text/x-dockerfile',
    makefile: 'text/plain',
    readme: 'text/plain',
    license: 'text/plain',
};

const EXTRA_TEXT_MIME_TYPES = new Set([
    'application/json',
    'application/xml',
    'application/yaml',
    'application/toml',
    'application/javascript',
]);

export type MediaFileKind = 'image' | 'audio' | 'video' | 'file';

export function detectMimeType(filePath: string, rawContent?: Buffer): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext && MIME_BY_EXTENSION[ext]) {
        return MIME_BY_EXTENSION[ext];
    }

    const base = path.basename(filePath).toLowerCase();
    if (MIME_BY_BASENAME[base]) {
        return MIME_BY_BASENAME[base];
    }

    if (rawContent && !isLikelyBinary(rawContent)) {
        return 'text/plain';
    }

    return 'application/octet-stream';
}

export function isTextMimeType(mimeType: string): boolean {
    return mimeType.startsWith('text/') || EXTRA_TEXT_MIME_TYPES.has(mimeType);
}

export function getMediaFileKind(mimeType: string): MediaFileKind {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.startsWith('video/')) return 'video';
    return 'file';
}

export function isLikelyBinary(rawContent: Buffer): boolean {
    const sample = rawContent.subarray(0, Math.min(rawContent.length, 8000));
    for (const byte of sample) {
        if (byte === 0) {
            return true;
        }
    }
    return false;
}

export interface ModelRecencyCandidate {
    name: string;
    releaseDate?: string;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER_GROUP_PATTERN = /\d+/g;
const NAME_COLLATOR = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function parseIsoDateToTimestamp(value: string): number | null {
    const match = ISO_DATE_PATTERN.exec(value.trim());
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }

    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }

    return timestamp;
}

function stripDateTokens(name: string): string {
    return name
        .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
        .replace(/\d{8}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractVersionPartsFromModelName(name: string): number[] {
    const modelTail = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
    const normalized = stripDateTokens(modelTail.toLowerCase());

    const parts = Array.from(normalized.matchAll(NUMBER_GROUP_PATTERN))
        .map((match) => {
            const raw = match[0];
            if (!raw) return null;
            if (raw.length >= 6) return null;
            const parsed = Number(raw);
            return Number.isFinite(parsed) ? parsed : null;
        })
        .filter((part): part is number => part !== null);

    return parts;
}

function compareVersionPartsDescending(left: number[], right: number[]): number {
    const maxParts = Math.max(left.length, right.length);
    for (let i = 0; i < maxParts; i++) {
        const leftPart = left[i];
        const rightPart = right[i];

        if (leftPart === undefined && rightPart === undefined) {
            continue;
        }
        if (leftPart === undefined) {
            return 1;
        }
        if (rightPart === undefined) {
            return -1;
        }
        if (leftPart !== rightPart) {
            return rightPart - leftPart;
        }
    }

    return 0;
}

export function compareModelsLatestFirst(
    left: ModelRecencyCandidate,
    right: ModelRecencyCandidate
): number {
    const leftDate = left.releaseDate ? parseIsoDateToTimestamp(left.releaseDate) : null;
    const rightDate = right.releaseDate ? parseIsoDateToTimestamp(right.releaseDate) : null;

    // Primary sort: release date desc.
    if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
        return rightDate - leftDate;
    }
    // Dated models first.
    if (leftDate !== null && rightDate === null) {
        return -1;
    }
    if (leftDate === null && rightDate !== null) {
        return 1;
    }

    // Same date (or both missing): use numeric-aware version-like fallback from name.
    const leftVersion = extractVersionPartsFromModelName(left.name);
    const rightVersion = extractVersionPartsFromModelName(right.name);
    const byVersion = compareVersionPartsDescending(leftVersion, rightVersion);
    if (byVersion !== 0) {
        return byVersion;
    }

    // Final deterministic fallback.
    return NAME_COLLATOR.compare(right.name, left.name);
}

export function isDeprecatedModelStatus(status: string | undefined): boolean {
    return status?.toLowerCase() === 'deprecated';
}

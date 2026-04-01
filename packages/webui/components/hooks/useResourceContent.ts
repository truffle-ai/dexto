import { useEffect, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { parseApiResponse } from '@/lib/api-errors';

type NormalizedResourceItem =
    | {
          kind: 'text';
          text: string;
          mimeType?: string;
      }
    | {
          kind: 'image';
          src: string;
          mimeType: string;
          alt?: string;
      }
    | {
          kind: 'audio';
          src: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'video';
          src: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'file';
          src?: string;
          mimeType?: string;
          filename?: string;
      };

type RawNormalizedResourceItem =
    | {
          kind: 'text';
          text: string;
          mimeType?: string;
      }
    | {
          kind: 'image';
          base64: string;
          mimeType: string;
          alt?: string;
      }
    | {
          kind: 'audio';
          base64: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'video';
          base64: string;
          mimeType: string;
          filename?: string;
      }
    | {
          kind: 'file';
          base64: string;
          mimeType?: string;
          filename?: string;
      };

export interface NormalizedResource {
    uri: string;
    name?: string;
    meta?: Record<string, unknown>;
    items: NormalizedResourceItem[];
}

interface RawNormalizedResource {
    uri: string;
    name?: string;
    meta?: Record<string, unknown>;
    items: RawNormalizedResourceItem[];
}

export interface ResourceState {
    status: 'loading' | 'loaded' | 'error';
    data?: NormalizedResource;
    error?: string;
}

type ResourceStateMap = Record<string, ResourceState>;

function decodeBase64(base64: string): number[] {
    const normalized = base64.replace(/\s/g, '');
    const binary = window.atob(normalized);
    const bytes = new Array<number>(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

function createObjectUrl(base64: string, mimeType?: string): string {
    const bytes = decodeBase64(base64);
    const blob = new Blob([Uint8Array.from(bytes)], mimeType ? { type: mimeType } : undefined);
    return URL.createObjectURL(blob);
}

function normalizeResource(uri: string, payload: any): RawNormalizedResource {
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];
    const meta = (payload?._meta ?? {}) as Record<string, unknown>;
    const name =
        (typeof meta.originalName === 'string' && meta.originalName.trim().length > 0
            ? meta.originalName
            : undefined) || uri;

    const items: RawNormalizedResourceItem[] = [];

    for (const item of contents) {
        if (!item || typeof item !== 'object') continue;

        if (typeof (item as { text?: unknown }).text === 'string') {
            items.push({
                kind: 'text',
                text: (item as { text: string }).text,
                mimeType: typeof item.mimeType === 'string' ? item.mimeType : undefined,
            });
            continue;
        }

        const blobData = typeof item.blob === 'string' ? item.blob : undefined;
        const rawData = typeof item.data === 'string' ? item.data : undefined;
        const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined;
        const filename = typeof item.filename === 'string' ? item.filename : undefined;

        if ((blobData || rawData) && mimeType) {
            const base64 = blobData ?? rawData!;
            if (mimeType.startsWith('image/')) {
                items.push({
                    kind: 'image',
                    base64,
                    mimeType,
                    alt: filename || name,
                });
            } else if (mimeType.startsWith('audio/')) {
                items.push({
                    kind: 'audio',
                    base64,
                    mimeType,
                    filename: filename || name,
                });
            } else if (mimeType.startsWith('video/')) {
                items.push({
                    kind: 'video',
                    base64,
                    mimeType,
                    filename: filename || name,
                });
            } else {
                items.push({
                    kind: 'file',
                    base64,
                    mimeType,
                    filename: filename || name,
                });
            }
            continue;
        }

        if (mimeType && mimeType.startsWith('text/') && typeof item.value === 'string') {
            items.push({
                kind: 'text',
                text: item.value,
                mimeType,
            });
        }
    }

    return {
        uri,
        name,
        meta,
        items,
    };
}

function materializeResource(raw: RawNormalizedResource): {
    data: NormalizedResource;
    objectUrls: string[];
} {
    const objectUrls: string[] = [];
    const items: NormalizedResourceItem[] = raw.items.map((item) => {
        if (item.kind === 'text') {
            return item;
        }

        const src = createObjectUrl(item.base64, item.mimeType);
        objectUrls.push(src);

        if (item.kind === 'image') {
            return {
                kind: 'image',
                src,
                mimeType: item.mimeType,
                alt: item.alt,
            };
        }

        if (item.kind === 'audio') {
            return {
                kind: 'audio',
                src,
                mimeType: item.mimeType,
                filename: item.filename,
            };
        }

        if (item.kind === 'video') {
            return {
                kind: 'video',
                src,
                mimeType: item.mimeType,
                filename: item.filename,
            };
        }

        return {
            kind: 'file',
            src,
            mimeType: item.mimeType,
            filename: item.filename,
        };
    });

    return {
        data: {
            uri: raw.uri,
            name: raw.name,
            meta: raw.meta,
            items,
        },
        objectUrls,
    };
}

async function fetchResourceContent(uri: string): Promise<RawNormalizedResource> {
    const body = await parseApiResponse(
        client.api.resources[':resourceId'].content.$get({
            param: { resourceId: encodeURIComponent(uri) },
        }),
        'Failed to load resource content'
    );
    return normalizeResource(uri, body.content);
}

export function useResourceContent(resourceUris: string[]): ResourceStateMap {
    // Serialize array for stable dependency comparison.
    // Arrays are compared by reference in React, so ['a','b'] !== ['a','b'] even though
    // values are identical. Serializing to 'a|b' allows value-based comparison to avoid
    // unnecessary re-computation when parent passes new array reference with same contents.
    const serializedUris = resourceUris.join('|');

    const normalizedUris = useMemo(() => {
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const uri of resourceUris) {
            if (!uri || typeof uri !== 'string') continue;
            const trimmed = uri.trim();
            if (!trimmed || seen.has(trimmed)) continue;
            seen.add(trimmed);
            ordered.push(trimmed);
        }
        return ordered;
        // We use resourceUris inside but only depend on serializedUris. This is safe because
        // serializedUris is derived from resourceUris - when the string changes, the array
        // values changed too. This is an intentional optimization to prevent re-runs when
        // array reference changes but values remain the same.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [serializedUris]);

    const queries = useQueries({
        queries: normalizedUris.map((uri) => ({
            queryKey: ['resourceContent', uri],
            queryFn: () => fetchResourceContent(uri),
            enabled: !!uri,
            retry: false,
        })),
    });

    const querySignature = queries
        .map((query, index) => {
            const uri = normalizedUris[index] ?? '';
            const status = query.status;
            const dataUpdatedAt = query.dataUpdatedAt ?? 0;
            const errorUpdatedAt = query.errorUpdatedAt ?? 0;
            return `${uri}:${status}:${dataUpdatedAt}:${errorUpdatedAt}`;
        })
        .join('|');

    const { resources, objectUrls } = useMemo(() => {
        const result: ResourceStateMap = {};
        const urls: string[] = [];

        queries.forEach((query, index) => {
            const uri = normalizedUris[index];
            if (!uri) return;

            if (query.isLoading) {
                result[uri] = { status: 'loading' };
            } else if (query.error) {
                result[uri] = {
                    status: 'error',
                    error: query.error instanceof Error ? query.error.message : String(query.error),
                };
            } else if (query.data) {
                const materialized = materializeResource(query.data);
                urls.push(...materialized.objectUrls);
                result[uri] = { status: 'loaded', data: materialized.data };
            }
        });

        return { resources: result, objectUrls: urls };
        // We intentionally key this memo off querySignature instead of the queries array identity.
        // useQueries returns a new array reference frequently, which would recreate object URLs on
        // every render. querySignature changes only when the meaningful query state/data changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedUris, querySignature]);

    useEffect(() => {
        return () => {
            objectUrls.forEach((url) => URL.revokeObjectURL(url));
        };
    }, [objectUrls]);

    return resources;
}

export type { NormalizedResourceItem };

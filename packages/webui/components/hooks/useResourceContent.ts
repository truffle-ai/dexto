'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

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

export interface NormalizedResource {
    uri: string;
    name?: string;
    meta?: Record<string, unknown>;
    items: NormalizedResourceItem[];
}

export interface ResourceState {
    status: 'loading' | 'loaded' | 'error';
    data?: NormalizedResource;
    error?: string;
}

type ResourceStateMap = Record<string, ResourceState>;

function buildDataUrl(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`;
}

function normalizeResource(uri: string, payload: any): NormalizedResource {
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];
    const meta = (payload?._meta ?? {}) as Record<string, unknown>;
    const name =
        (typeof meta.originalName === 'string' && meta.originalName.trim().length > 0
            ? meta.originalName
            : undefined) || uri;

    const items: NormalizedResourceItem[] = [];

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
            const src = buildDataUrl(base64, mimeType);
            if (mimeType.startsWith('image/')) {
                items.push({
                    kind: 'image',
                    src,
                    mimeType,
                    alt: filename || name,
                });
            } else if (mimeType.startsWith('audio/')) {
                items.push({
                    kind: 'audio',
                    src,
                    mimeType,
                    filename: filename || name,
                });
            } else if (mimeType.startsWith('video/')) {
                items.push({
                    kind: 'video',
                    src,
                    mimeType,
                    filename: filename || name,
                });
            } else {
                items.push({
                    kind: 'file',
                    src,
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

async function fetchResourceContent(uri: string): Promise<NormalizedResource> {
    const body = await apiFetch<{ content: any }>(
        `/api/resources/${encodeURIComponent(uri)}/content`
    );
    const contentPayload = body?.content;
    if (!contentPayload) {
        throw new Error('No content returned for resource');
    }
    return normalizeResource(uri, contentPayload);
}

export function useResourceContent(resourceUris: string[]): ResourceStateMap {
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
    }, [resourceUris.join('|')]);

    const queries = useQueries({
        queries: normalizedUris.map((uri) => ({
            queryKey: ['resourceContent', uri],
            queryFn: () => fetchResourceContent(uri),
            enabled: !!uri,
            retry: false,
        })),
    });

    const resources: ResourceStateMap = useMemo(() => {
        const result: ResourceStateMap = {};
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
                result[uri] = { status: 'loaded', data: query.data };
            }
        });
        return result;
    }, [queries, normalizedUris]);

    return resources;
}

export type { NormalizedResourceItem };

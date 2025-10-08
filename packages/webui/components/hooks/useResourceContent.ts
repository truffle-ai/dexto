'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

    const [resources, setResources] = useState<ResourceStateMap>({});
    const resourcesRef = useRef<ResourceStateMap>({});
    const inFlightRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        resourcesRef.current = resources;
    }, [resources]);

    useEffect(() => {
        normalizedUris.forEach((uri) => {
            if (!uri) return;

            const existing = resourcesRef.current[uri];
            if (existing && existing.status !== 'error') {
                return;
            }
            if (inFlightRef.current.has(uri)) {
                return;
            }

            inFlightRef.current.add(uri);
            setResources((prev) => ({
                ...prev,
                [uri]: { status: 'loading' },
            }));

            (async () => {
                try {
                    const response = await fetch(
                        `/api/resources/${encodeURIComponent(uri)}/content`
                    );
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                    }
                    const body = await response.json();
                    const contentPayload = body?.content;
                    if (!contentPayload) {
                        throw new Error('No content returned for resource');
                    }
                    const normalized = normalizeResource(uri, contentPayload);
                    setResources((prev) => ({
                        ...prev,
                        [uri]: { status: 'loaded', data: normalized },
                    }));
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    setResources((prev) => ({
                        ...prev,
                        [uri]: { status: 'error', error: message },
                    }));
                } finally {
                    inFlightRef.current.delete(uri);
                }
            })();
        });
    }, [normalizedUris]);

    return resources;
}

export type { NormalizedResourceItem };

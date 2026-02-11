import React from 'react';
import { Input } from '../../ui/input';
import { LabelWithTooltip } from '../../ui/label-with-tooltip';
import { Collapsible } from '../../ui/collapsible';
import type { AgentConfig } from '@dexto/agent-config';
import type { CacheType, DatabaseType } from '@dexto/storage/schemas';
import { CACHE_TYPES, DATABASE_TYPES } from '@dexto/storage/schemas';

type StorageConfig = NonNullable<AgentConfig['storage']>;

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

interface StorageSectionProps {
    value: StorageConfig;
    onChange: (value: StorageConfig) => void;
    errors?: Record<string, string>;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    errorCount?: number;
    sectionErrors?: string[];
}

export function StorageSection({
    value,
    onChange,
    errors = {},
    open,
    onOpenChange,
    errorCount = 0,
    sectionErrors = [],
}: StorageSectionProps) {
    const cacheRecord = value.cache as Record<string, unknown>;
    const databaseRecord = value.database as Record<string, unknown>;

    const updateCache = (updates: Partial<Record<string, unknown>>) => {
        onChange({
            ...value,
            cache: { ...value.cache, ...updates } as StorageConfig['cache'],
        });
    };

    const updateDatabase = (updates: Partial<Record<string, unknown>>) => {
        onChange({
            ...value,
            database: { ...value.database, ...updates } as StorageConfig['database'],
        });
    };

    const showCacheUrl = value.cache.type === 'redis';
    const showDatabaseUrl = value.database.type === 'sqlite' || value.database.type === 'postgres';

    return (
        <Collapsible
            title="Storage Configuration"
            defaultOpen={false}
            open={open}
            onOpenChange={onOpenChange}
            errorCount={errorCount}
            sectionErrors={sectionErrors}
        >
            <div className="space-y-6">
                {/* Cache Configuration */}
                <div className="space-y-3">
                    <h4 className="text-sm font-medium">Cache</h4>
                    <div>
                        <LabelWithTooltip
                            htmlFor="cache-type"
                            tooltip="Storage backend for caching data (in-memory or Redis)"
                        >
                            Cache Type
                        </LabelWithTooltip>
                        <select
                            id="cache-type"
                            value={value.cache.type}
                            onChange={(e) => updateCache({ type: e.target.value as CacheType })}
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {CACHE_TYPES.map((type) => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </select>
                    </div>

                    {showCacheUrl && (
                        <div>
                            <LabelWithTooltip
                                htmlFor="cache-url"
                                tooltip="Redis connection URL (e.g., redis://localhost:6379)"
                            >
                                Redis URL
                            </LabelWithTooltip>
                            <Input
                                id="cache-url"
                                value={readOptionalString(cacheRecord, 'url') ?? ''}
                                onChange={(e) => updateCache({ url: e.target.value || undefined })}
                                placeholder="redis://localhost:6379"
                                aria-invalid={!!errors['storage.cache.url']}
                            />
                            {errors['storage.cache.url'] && (
                                <p className="text-xs text-destructive mt-1">
                                    {errors['storage.cache.url']}
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* Database Configuration */}
                <div className="space-y-3">
                    <h4 className="text-sm font-medium">Database</h4>
                    <div>
                        <LabelWithTooltip
                            htmlFor="database-type"
                            tooltip="Storage backend for persistent data (in-memory, SQLite, or PostgreSQL)"
                        >
                            Database Type
                        </LabelWithTooltip>
                        <select
                            id="database-type"
                            value={value.database.type}
                            onChange={(e) =>
                                updateDatabase({ type: e.target.value as DatabaseType })
                            }
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                            {DATABASE_TYPES.map((type) => (
                                <option key={type} value={type}>
                                    {type}
                                </option>
                            ))}
                        </select>
                    </div>

                    {showDatabaseUrl && (
                        <div>
                            <LabelWithTooltip
                                htmlFor="database-url"
                                tooltip={
                                    value.database.type === 'sqlite'
                                        ? 'File path for SQLite database'
                                        : 'PostgreSQL connection string'
                                }
                            >
                                {value.database.type === 'sqlite'
                                    ? 'SQLite Path'
                                    : 'PostgreSQL URL'}
                            </LabelWithTooltip>
                            <Input
                                id="database-url"
                                value={
                                    readOptionalString(databaseRecord, 'url') ??
                                    readOptionalString(databaseRecord, 'path') ??
                                    ''
                                }
                                onChange={(e) => {
                                    if (value.database.type === 'sqlite') {
                                        updateDatabase({ path: e.target.value || undefined });
                                    } else {
                                        updateDatabase({ url: e.target.value || undefined });
                                    }
                                }}
                                placeholder={
                                    value.database.type === 'sqlite'
                                        ? './dexto.db'
                                        : 'postgresql://user:pass@localhost:5432/dexto'
                                }
                                aria-invalid={
                                    !!(
                                        errors['storage.database.url'] ||
                                        errors['storage.database.path']
                                    )
                                }
                            />
                            {(errors['storage.database.url'] ||
                                errors['storage.database.path']) && (
                                <p className="text-xs text-destructive mt-1">
                                    {errors['storage.database.url'] ||
                                        errors['storage.database.path']}
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Collapsible>
    );
}

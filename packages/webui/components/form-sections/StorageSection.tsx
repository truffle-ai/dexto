'use client';

import React from 'react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Collapsible } from '../ui/collapsible';
import type { AgentConfig } from '@dexto/core';

type StorageConfig = NonNullable<AgentConfig['storage']>;

interface StorageSectionProps {
  value: StorageConfig;
  onChange: (value: StorageConfig) => void;
  errors?: Record<string, string>;
}

const CACHE_TYPES = ['in-memory', 'redis'];
const DATABASE_TYPES = ['in-memory', 'sqlite', 'postgres'];

export function StorageSection({ value, onChange, errors = {} }: StorageSectionProps) {
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
    <Collapsible title="Storage Configuration" defaultOpen={false}>
      <div className="space-y-6">
        {/* Cache Configuration */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Cache</h4>
          <div>
            <Label htmlFor="cache-type">Cache Type</Label>
            <select
              id="cache-type"
              value={value.cache.type}
              onChange={(e) => updateCache({ type: e.target.value as any })}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {CACHE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          {showCacheUrl && 'url' in value.cache && (
            <div>
              <Label htmlFor="cache-url">Redis URL</Label>
              <Input
                id="cache-url"
                value={value.cache.url || ''}
                onChange={(e) => updateCache({ url: e.target.value || undefined })}
                placeholder="redis://localhost:6379"
              />
              {errors['cache.url'] && (
                <p className="text-xs text-destructive mt-1">{errors['cache.url']}</p>
              )}
            </div>
          )}
        </div>

        {/* Database Configuration */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Database</h4>
          <div>
            <Label htmlFor="database-type">Database Type</Label>
            <select
              id="database-type"
              value={value.database.type}
              onChange={(e) => updateDatabase({ type: e.target.value as any })}
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
              <Label htmlFor="database-url">
                {value.database.type === 'sqlite' ? 'SQLite Path' : 'PostgreSQL URL'}
              </Label>
              <Input
                id="database-url"
                value={('url' in value.database && value.database.url) || ('path' in value.database && value.database.path) || ''}
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
              />
              {errors['database.url'] && (
                <p className="text-xs text-destructive mt-1">{errors['database.url']}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Collapsible>
  );
}

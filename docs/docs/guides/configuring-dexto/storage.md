---
sidebar_position: 7
sidebar_label: "Storage Configuration"
---

# Storage Configuration

Configure how your Dexto agent stores data with flexible backend options for caching, database persistence, and blob storage.

:::tip Complete Reference
For complete field documentation, backend options, and connection pooling details, see **[agent.yml → Storage](./agent-yml.md#storage-configuration)**.
:::

## Overview

Storage in Dexto consists of three layers:
- **Cache** - Temporary, high-speed data access
- **Database** - Persistent, long-term storage
- **Blob Store** - Binary data (images, files, large objects)

Each layer can use different backends tailored to your needs, from simple in-memory setups to robust production environments.

## Supported Backends

| Backend | Type | Use Case |
|---------|------|----------|
| **in-memory** | Cache/DB | Development, quick-start, testing |
| **redis** | Cache | High-performance caching |
| **sqlite** | Database | Simple file-based persistence |
| **postgres** | Database | Production, scalable deployments |

## Backend Configuration

### In-Memory

Simplest backend, data lost when process terminates:

```yaml
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
```

**Use for:** Development, testing, no persistence needed

### Redis

High-performance in-memory data store for caching:

```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
    maxConnections: 50
```

**Use for:** Production caching, high-speed access

### SQLite

File-based SQL database for simple persistence:

```yaml
storage:
  database:
    type: sqlite
    database: my-agent.db
    path: "${{dexto.agent_dir}}/data"
```

**Use for:** Single-instance deployments, simple persistence

### PostgreSQL

Production-grade relational database:

```yaml
storage:
  database:
    type: postgres
    host: db.example.com
    port: 5432
    database: dexto_prod
    user: dexto_user
    password: $DB_PASSWORD
    maxConnections: 20
```

**Use for:** Production, scalable deployments, multi-instance

## Blob Storage

### In-Memory Blob Store

```yaml
storage:
  blobStore:
    type: in-memory
    maxBlobSize: 5242880      # 5MB
    maxTotalSize: 52428800    # 50MB
```

**Use for:** Development, temporary files, small blobs

### Local Blob Store

```yaml
storage:
  blobStore:
    type: local
    storePath: "${{dexto.agent_dir}}/blobs"
    maxBlobSize: 104857600     # 100MB
    maxTotalSize: 10737418240  # 10GB
    cleanupAfterDays: 60
```

**Use for:** Production, persistent blob storage, larger files

## Common Configurations

### Default (Development)

```yaml
# No storage configuration needed - uses in-memory defaults
```

### Production (Redis + PostgreSQL)

```yaml
storage:
  cache:
    type: redis
    url: $REDIS_URL
    maxConnections: 100
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING
    maxConnections: 25
  blobStore:
    type: local
    storePath: /var/data/dexto/blobs
    cleanupAfterDays: 60
```

### Simple Persistent (SQLite)

```yaml
storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    database: my-dexto-agent.sqlite
  blobStore:
    type: local
    storePath: "${{dexto.agent_dir}}/blobs"
```

### Hybrid (Redis + SQLite)

```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
  database:
    type: sqlite
    path: "${{dexto.agent_dir}}/data/dexto.db"
  blobStore:
    type: local
    storePath: "${{dexto.agent_dir}}/data/blobs"
```

## When to Use Each Backend

| Scenario | Cache | Database | Blob Store |
|----------|-------|----------|------------|
| **Development** | in-memory | in-memory | in-memory |
| **Simple Production** | redis | sqlite | local |
| **Scalable Production** | redis | postgres | local |
| **Testing** | in-memory | sqlite | in-memory |

## Configuration Options

Common options available for all backends:
- `maxConnections` - Maximum connection pool size
- `idleTimeoutMillis` - Idle connection timeout
- `connectionTimeoutMillis` - Connection establishment timeout
- `options` - Backend-specific additional options

## Best Practices

1. **Use environment variables** - Store passwords and connection strings as `$VAR`
2. **Match backend to use case** - Redis for caching, Postgres/SQLite for persistence
3. **Tune connection pools** - Adjust `maxConnections` based on load
4. **Set blob limits** - Configure appropriate size limits for your use case
5. **Use local blob store in production** - For persistence and cleanup automation

## See Also

- [agent.yml Reference → Storage](./agent-yml.md#storage-configuration) - Complete field documentation
- [Memory Configuration](./memory.md) - Requires persistent database

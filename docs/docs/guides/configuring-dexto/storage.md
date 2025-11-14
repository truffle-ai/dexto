---
sidebar_position: 7
sidebar_label: "Storage Configuration"
---

# Storage Configuration

Configure how your Dexto agent stores data: cache, database, and blob storage.

:::tip Complete Reference
For complete field documentation and all storage options, see **[agent.yml → Storage](./agent-yml.md#storage-configuration)**.
:::

## Overview

Dexto storage has three components:
- **Cache** - Temporary, high-speed data access (in-memory or Redis)
- **Database** - Persistent storage (in-memory, SQLite, or PostgreSQL)
- **Blob** - Binary data storage (in-memory or local filesystem)

## Storage Types

| Component | Options | Use Case |
|-----------|---------|----------|
| **Cache** | in-memory, redis | Temporary data, sessions |
| **Database** | in-memory, sqlite, postgres | Persistent data, memories |
| **Blob** | in-memory, local | Files, images, large objects |

## Cache

Temporary, high-speed data access.

### in-memory

Data lost when process terminates:

```yaml
storage:
  cache:
    type: in-memory
```

**Use for:** Development, testing

### redis

High-performance caching:

```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
    maxConnections: 50
```

**Use for:** Production

## Database

Persistent data storage.

### in-memory

Non-persistent:

```yaml
storage:
  database:
    type: in-memory
```

**Use for:** Testing

### sqlite

File-based persistence:

```yaml
storage:
  database:
    type: sqlite
    path: ./data/my-agent.db
```

**Use for:** Single-instance, simple deployments

### postgres

Production-grade database:

```yaml
storage:
  database:
    type: postgres
    host: db.example.com
    port: 5432
    database: dexto_prod
    password: $DB_PASSWORD
```

**Use for:** Production, multi-instance

## Blob

Binary data storage.

### in-memory

```yaml
storage:
  blob:
    type: in-memory
    maxBlobSize: 5242880      # 5MB
```

**Use for:** Development

### local

Filesystem storage:

```yaml
storage:
  blob:
    type: local
    storePath: "${{dexto.agent_dir}}/blobs"
    maxBlobSize: 104857600     # 100MB
    cleanupAfterDays: 60
```

**Use for:** Production, persistent files

## Example Configurations

### Development (Default)

```yaml
# No storage config needed - defaults to in-memory for all components
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
  blob:
    type: in-memory
```

:::tip CLI Auto-Configuration
When using the Dexto CLI, SQLite database and local blob storage paths are automatically provided at:
- Database: `~/.dexto/database/<agent-id>.db`
- Blobs: `~/.dexto/blobs/<agent-id>/`

You don't need to specify these paths manually unless you want custom locations.
:::

### Production (Redis + PostgreSQL)

```yaml
storage:
  cache:
    type: redis
    url: $REDIS_URL
  database:
    type: postgres
    url: $POSTGRES_URL
  blob:
    type: local
    storePath: /var/data/blobs
```

### Simple (SQLite)

```yaml
storage:
  database:
    type: sqlite
    # path: automatically provided by CLI as ~/.dexto/database/<agent-id>.db
  blob:
    type: local
    # storePath: automatically provided by CLI as ~/.dexto/blobs/<agent-id>/
```

Or with explicit paths:

```yaml
storage:
  database:
    type: sqlite
    path: ./data/my-agent.db
  blob:
    type: local
    storePath: ./data/blobs
```

## When to Use

| Scenario | Cache | Database | Blob |
|----------|-------|----------|------|
| **Development** | in-memory | in-memory | in-memory |
| **Simple Production** | redis | sqlite | local |
| **Scalable Production** | redis | postgres | local |
| **Testing** | in-memory | sqlite | in-memory |

## Best Practices

1. **Use environment variables** - Store passwords and connection strings as `$VAR`
2. **Match storage to use case** - Redis for caching, Postgres/SQLite for persistence
3. **Set appropriate limits** - Configure `maxConnections`, `maxBlobSize` based on load
4. **Use local blob storage in production** - For persistence and automatic cleanup

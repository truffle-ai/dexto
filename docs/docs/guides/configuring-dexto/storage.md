---
sidebar_position: 5
sidebar_label: "Storage Configuration"
---

# Storage Configuration

The `storage` section in your configuration file defines how your agent stores data. It's composed of two main components: a `cache` for temporary, high-speed data access, and a `database` for persistent, long-term storage.

You can configure different backends for both the cache and the database, allowing you to tailor your agent's storage to your specific needs, from simple in-memory setups to robust production environments using Redis and PostgreSQL.

```yaml
storage:
  cache:
    # Cache backend configuration
  database:
    # Database backend configuration
```

## Supported Backends

Dexto supports the following storage backends, which can be used for either `cache` or `database`:

| Backend    | Type         | Use Case                                                    |
|------------|--------------|-------------------------------------------------------------|
| **In-Memory** | `in-memory`     | Default, simple, no-dependency setup for quick-start & dev. |
| **Redis**  | `redis`      | High-performance caching and ephemeral data storage.        |
| **SQLite** | `sqlite`     | Simple, file-based persistent database.                     |
| **Postgres** | `postgres` | Robust, scalable, and feature-rich persistent database.     |


## Common Backend Options

These options can be applied to any backend type (`in-memory`, `redis`, `sqlite`, `postgres`) to configure connection pooling behavior.

```typescript
export interface BaseBackendConfig {
    maxConnections?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    options?: Record<string, any>;
}
```

-   `maxConnections`: Maximum number of connections in the pool.
-   `idleTimeoutMillis`: Time in milliseconds that a connection can be idle before being closed.
-   `connectionTimeoutMillis`: Time in milliseconds to wait for a connection to be established.
-   `options`: A key-value map for any other backend-specific options.

---

## Backend-Specific Configuration

### In-Memory (`in-memory`)

The simplest backend, storing all data in memory. Data is lost when the Dexto process terminates. It's the default for both `cache` and `database` if not otherwise specified.

**TypeScript Interface:**
```typescript
export interface InMemoryBackendConfig {
    type: 'in-memory';
    // Inherits common backend options
}
```

**Example:**
```yaml
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
```

---

### Redis (`redis`)

A high-performance in-memory data store, ideal for caching.

**TypeScript Interface:**
```typescript
export interface RedisBackendConfig {
    type: 'redis';
    url?: string;      // e.g., "redis://user:pass@host:port"
    host?: string;
    port?: number;
    password?: string;
    database?: number; // DB index
    // Inherits common backend options
}
```
**Field Explanations:**
- `type`: Must be `'redis'`.
- `url`: A full Redis connection string. If provided, `host`, `port`, etc., are ignored.
- `host`, `port`, `password`, `database`: Individual connection parameters. `host` is required if `url` is not provided.

**Example:**
```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
    maxConnections: 50
```

---

### SQLite (`sqlite`)

A serverless, file-based SQL database engine, great for simple, persistent storage without needing a separate database server.

**TypeScript Interface:**
```typescript
export interface SqliteBackendConfig {
    type: 'sqlite';
    path?: string;     // Directory to store the DB file
    database?: string; // Filename for the database (e.g., "dexto.db")
    // Inherits common backend options
}
```

**Field Explanations:**
- `type`: Must be `'sqlite'`.
- `path`: The directory where the database file will be stored. If omitted, Dexto will use a default location.
- `database`: The name of the database file. Defaults to `dexto.db`.

**Example:**
```yaml
storage:
  database:
    type: sqlite
    database: my-agent.db
    path: /var/data/dexto
```

---

### PostgreSQL (`postgres`)

A powerful, open-source object-relational database system, suitable for production and large-scale deployments.

**TypeScript Interface:**
```typescript
export interface PostgresBackendConfig {
    type: 'postgres';
    url?: string; // e.g., "postgresql://user:pass@host:port/dbname"
    connectionString?: string; // Alternative to URL
    host?: string;
    port?: number;
    database?: string;
    password?: string;
    // Inherits common backend options
}
```
**Field Explanations:**
- `type`: Must be `'postgres'`.
- `url` or `connectionString`: A full PostgreSQL connection string.
- `host`, `port`, `database`, `password`: Individual connection parameters. `host` is required if a URL is not provided.

**Example:**
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
    idleTimeoutMillis: 30000
```

## Configuration Examples

### Default: In-Memory Only
If you provide no storage configuration, Dexto defaults to using the `in-memory` backend for both cache and database.

```yaml
# No storage section needed for this default behavior
```
This is equivalent to:
```yaml
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
```

### Production: Redis and PostgreSQL
A common production setup uses Redis for its speed as a cache and PostgreSQL for its reliability as a database.

```yaml
storage:
  cache:
    type: redis
    url: $REDIS_URL
    maxConnections: 100
    idleTimeoutMillis: 10000
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING
    maxConnections: 25
    idleTimeoutMillis: 30000
```

### Simple Persistent: SQLite
For a simple setup that persists data across restarts without a full database server, use SQLite.

```yaml
storage:
  cache:
    type: in-memory # Keep cache in-memory for speed
  database:
    type: sqlite
    database: my-dexto-agent.sqlite
```

### Hybrid: Redis Cache with SQLite DB
For a single-instance production setup, this combines a fast Redis cache with a simple, persistent SQLite database.

```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
  database:
    type: sqlite
    path: ./data/dexto.db
```

### Advanced Configuration
You can pass backend-specific parameters through the `options` field.

**Advanced Redis Example:**
```yaml
storage:
  cache:
    type: redis
    host: localhost
    port: 6379
    options:
      commandTimeout: 5000
      maxRetriesPerRequest: 3
```

**Advanced PostgreSQL Example:**
```yaml
storage:
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING
    options:
      ssl: true
      application_name: dexto-agent
      statement_timeout: 30000
```

## Best Practices
- **Use Environment Variables:** Store sensitive information like passwords and connection strings in environment variables (`$VAR_NAME`).
- **Match Backend to Use Case:** Use `redis` or `in-memory` for caching and `postgres` or `sqlite` for persistent data.
- **Tune Connection Pools:** Adjust `maxConnections` and timeouts based on your expected load and database capacity.

For more information on how these storage layers are used within Dexto, see the [Storage Pattern Examples](https://github.com/truffle-ai/dexto/blob/main/feature-plans/settings-storage/storage-examples.md). 
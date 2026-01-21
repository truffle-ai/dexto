# Auto-Update & Schema Migration Feature Plan

## Overview

This document captures research and design options for implementing auto-update functionality in Dexto CLI, with particular focus on handling breaking schema changes to agent configurations and user preferences.

**Key Challenges:**
- Automatically updating the CLI when users relaunch
- Handling breaking changes in agent config schemas
- Protecting user customizations (modified bundled agents, custom agents)
- Handling preferences.yml schema changes
- Providing clear migration paths and recovery options

---

## Table of Contents

1. [Current Dexto State](#1-current-dexto-state)
2. [Research: OpenCode](#2-research-opencode)
3. [Research: Gemini-CLI](#3-research-gemini-cli)
4. [Research: Codex](#4-research-codex)
5. [Comparison Matrix](#5-comparison-matrix)
6. [Design Options](#6-design-options)
7. [Recommended Approach](#7-recommended-approach)
8. [Implementation Details](#8-implementation-details)
9. [Edge Cases & Recovery](#9-edge-cases--recovery)
10. [File Structure](#10-file-structure)
11. [Open Questions](#11-open-questions)
12. [CI Enforcement for Breaking Schema Changes](#12-ci-enforcement-for-breaking-schema-changes)
13. [Handling Direct Package Manager Updates](#13-handling-direct-package-manager-updates)
14. [Utility Commands](#14-utility-commands)
15. [Implementation Phases](#15-implementation-phases)
16. [References](#17-references)

---

## 1. Current Dexto State

### Agent Schema Location
**Primary file:** `packages/core/src/agent/schemas.ts`

```typescript
export const AgentConfigSchema = createAgentConfigSchema({ strict: true });
export const AgentConfigSchemaRelaxed = createAgentConfigSchema({ strict: false });

export type AgentConfig = z.input<typeof AgentConfigSchema>;
export type ValidatedAgentConfig = z.output<typeof AgentConfigSchema>;
```

**Key characteristics:**
- Uses `.strict()` validation (rejects unknown fields)
- Comprehensive field defaults with `.default()`
- Factory function for flexible validation strictness
- No schema versioning

### Preferences Schema Location
**File:** `packages/agent-management/src/preferences/schemas.ts`

```typescript
GlobalPreferencesSchema = z.object({
  llm: PreferenceLLMSchema,
  defaults: PreferenceDefaultsSchema,
  setup: PreferenceSetupSchema,
  sounds: PreferenceSoundsSchema
}).strict()
```

**Key characteristics:**
- Strict validation
- Complex cross-field validation via `superRefine()`
- No version field

### Directory Structure
```
~/.dexto/
├── preferences.yml              # Global preferences
├── agents/
│   ├── registry.json           # Installed agents registry
│   ├── coding-agent/
│   │   └── coding-agent.yml
│   └── {custom-agents}/
├── logs/
├── database/
├── blobs/
├── commands/
├── sounds/
└── .env
```

### Current Limitations

| Aspect | Current State | Impact |
|--------|---------------|--------|
| Schema versioning | None | Can't detect what version a config was written for |
| Migration system | None | Breaking changes require manual user intervention |
| Auto-update | None | Users must manually update |
| Backup system | None | No safety net for config changes |
| Version tracking | None | Don't know what CLI version user last ran |

---

## 2. Research: OpenCode

### 2.1 Auto-Update Mechanism

**Files:**
- `/packages/opencode/src/cli/upgrade.ts`
- `/packages/opencode/src/cli/cmd/upgrade.ts`
- `/packages/opencode/src/installation/index.ts`

#### Update Check Flow

```typescript
// Respects user preferences
const config = await loadConfig();
if (config.autoupdate === false) {
  return; // User disabled auto-update
}
if (config.autoupdate === "notify") {
  console.log(`Update available: ${latest}`);
  return; // Just notify, don't auto-upgrade
}

// Auto-upgrade enabled (default)
await performUpgrade();
```

#### Installation Method Detection

```typescript
function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath;

  // Check for package manager signatures in path
  if (execPath.includes('/.npm/')) return 'npm';
  if (execPath.includes('/.pnpm/')) return 'pnpm';
  if (execPath.includes('/.bun/')) return 'bun';
  if (execPath.includes('/homebrew/') || execPath.includes('/opt/homebrew')) return 'brew';

  // Check if specific package managers are available
  if (commandExists('pnpm')) return 'pnpm';
  if (commandExists('bun')) return 'bun';
  if (commandExists('npm')) return 'npm';

  return 'unknown';
}
```

#### Upgrade Commands by Method

| Method | Command |
|--------|---------|
| npm | `npm install -g opencode-ai@latest` |
| pnpm | `pnpm add -g opencode-ai@latest` |
| bun | `bun install -g opencode-ai@latest` |
| brew | `brew upgrade opencode` |
| curl | Re-run install script |

#### Version Checking

```typescript
async function fetchLatestVersion(): Promise<string> {
  // Multi-source with fallbacks
  try {
    // 1. Try npm registry (for channel-specific versions)
    const response = await fetch(`https://registry.npmjs.org/opencode-ai`);
    const data = await response.json();
    return data['dist-tags'][channel]; // 'stable' or 'beta'
  } catch {
    // 2. Fallback to GitHub releases
    const response = await fetch('https://api.github.com/repos/opencode/opencode/releases/latest');
    const data = await response.json();
    return data.tag_name;
  }
}
```

### 2.2 Schema Migration Approach

**File:** `/packages/opencode/src/config/config.ts`

OpenCode uses **Zod transforms during parsing** - no explicit version tracking.

#### Deprecated Field Handling

```typescript
const AgentConfigSchema = z.object({
  // Current fields
  steps: z.number().default(50),
  permission: PermissionSchema.default({}),

  // Deprecated fields (still accepted)
  maxSteps: z.number().optional(),  // @deprecated - use 'steps'
  tools: z.record(z.boolean()).optional(),  // @deprecated - use 'permission'
})
.transform((agent) => {
  // Migration happens during parsing
  const steps = agent.steps ?? agent.maxSteps;

  // Convert old boolean tools → new permission model
  const permission: Permission = {};
  for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
    permission[tool] = enabled ? "allow" : "deny";
  }

  return {
    steps,
    permission: { ...permission, ...agent.permission },
    // Deprecated fields are stripped from output
  };
});
```

#### Top-Level Field Renames

```typescript
const ConfigSchema = z.object({
  agent: AgentConfigSchema.optional(),
  share: ShareConfigSchema.optional(),

  // Old field names
  mode: AgentConfigSchema.optional(),      // renamed to 'agent'
  autoshare: z.boolean().optional(),       // renamed to 'share'
})
.transform((config) => ({
  agent: config.agent ?? config.mode,
  share: config.share ?? (config.autoshare ? { enabled: true } : undefined),
}));
```

#### Schema URI (Implicit Versioning)

```typescript
// Auto-add schema reference on first load
if (!config.$schema) {
  config.$schema = "https://opencode.ai/config.json";
  await saveConfig(config);
}
```

The schema at that URL is regenerated from Zod definitions. Old configs work because deprecated fields are accepted.

### 2.3 Config Format Support

- **JSONC** (JSON with Comments) - preferred
- **JSON** - standard
- **TOML** - legacy, auto-converted to JSON on load

```typescript
// TOML auto-migration
if (existsSync('config.toml') && !existsSync('config.json')) {
  const tomlContent = readFileSync('config.toml');
  const parsed = parseTOML(tomlContent);
  writeFileSync('config.json', JSON.stringify(parsed, null, 2));
  unlinkSync('config.toml');  // Delete old file
}
```

### 2.4 Environment Variable Interpolation

```typescript
// Config supports dynamic values
const value = "{env:OPENAI_API_KEY}";  // Resolved at parse time
const value = "{file:/path/to/key}";   // File contents injected
```

### 2.5 Event Publishing

```typescript
// Notify UI components of updates
Bus.publish(Installation.Event.UpdateAvailable, { version: latest });
Bus.publish(Installation.Event.Updated, { version: latest });
```

### 2.6 OpenCode Summary

| Aspect | Approach |
|--------|----------|
| Version tracking | Implicit via schema URI |
| Migration trigger | During Zod parsing |
| Deprecated fields | Accepted, transformed, stripped |
| Unknown fields | `catchall(z.any())` preserves them |
| Breaking changes | Add deprecated field + transform |
| Rollback support | No |
| User notification | Silent migration |

---

## 3. Research: Gemini-CLI

### 3.1 Auto-Update Mechanism

**Files:**
- `/packages/core/src/utils/updateCheck.ts`
- `/packages/core/src/utils/handleAutoUpdate.ts`
- `/packages/core/src/utils/installationInfo.ts`

#### Version Checking

```typescript
import latestVersion from 'latest-version';
import semver from 'semver';

async function checkForUpdates(): Promise<UpdateInfo | null> {
  // Respect user preference
  if (settings.disableUpdateNag) return null;

  // Don't block startup - timeout after 2 seconds
  const latest = await Promise.race([
    latestVersion('@google/gemini-cli'),
    timeout(2000).then(() => null)
  ]);

  if (!latest) return null;

  const current = getCurrentVersion();

  // Handle nightly vs stable
  if (isNightlyVersion(current)) {
    // Check both nightly and stable, pick best
    const nightlyLatest = await latestVersion('@google/gemini-cli', { version: 'nightly' });
    // If same base version, prefer nightly; otherwise pick highest
    return pickBestVersion(current, latest, nightlyLatest);
  }

  if (semver.gt(latest, current)) {
    return { version: latest, type: 'stable' };
  }

  return null;
}
```

#### Update Execution

```typescript
async function handleAutoUpdate(updateInfo: UpdateInfo): Promise<void> {
  // Skip in sandbox mode
  if (isSandboxMode()) return;

  // Skip for npx/pnpx (not applicable)
  if (isNpxInstallation()) return;

  const method = detectInstallMethod();
  const command = getUpgradeCommand(method, updateInfo.version);

  // Spawn detached process (won't block main process)
  const child = spawn(command, {
    detached: true,
    stdio: 'ignore',
    shell: true
  });
  child.unref();

  // Emit event for UI
  emitUpdateEvent('started', updateInfo);
}
```

#### Installation Detection

```typescript
function detectInstallMethod(): InstallMethod {
  const execPath = process.execPath;
  const cwd = process.cwd();

  // Check environment hints
  if (process.env.npm_execpath?.includes('pnpm')) return 'pnpm';
  if (process.env.npm_execpath?.includes('yarn')) return 'yarn';
  if (process.env.BUN_INSTALL) return 'bun';

  // Check path signatures
  if (execPath.includes('/homebrew/')) return 'homebrew';
  if (execPath.includes('/.npm/')) return 'npm';

  // Check for git clone
  if (existsSync(path.join(cwd, '.git'))) return 'git';

  return 'npm'; // Default fallback
}
```

### 3.2 Schema Migration Approach

**Files:**
- `/packages/core/src/utils/settingsSchema.ts`
- `/packages/core/src/utils/settings.ts`

Gemini-CLI has an **explicit migration layer** with bidirectional support.

#### Schema Definition (Declarative)

```typescript
// 1597 lines of schema definitions
const settingsSchema = {
  'tools.allowed': {
    type: 'array',
    label: 'Allowed Tools',
    category: 'Tools',
    default: ['*'],
    description: 'List of tools the agent can use',
    requiresRestart: false,
    mergeStrategy: MergeStrategy.UNION,
  },
  'model.default': {
    type: 'string',
    label: 'Default Model',
    category: 'Model',
    default: 'gemini-2.0-flash',
    description: 'The default model to use',
    requiresRestart: true,  // Important flag!
    mergeStrategy: MergeStrategy.REPLACE,
  },
  // ... 100+ more settings
};
```

#### Merge Strategies

```typescript
enum MergeStrategy {
  REPLACE = 'replace',        // New value completely replaces old
  CONCAT = 'concat',          // Arrays concatenated
  UNION = 'union',            // Arrays merged, duplicates removed
  SHALLOW_MERGE = 'shallow_merge',  // Objects shallow merged
}

function mergeSettings(base: Settings, override: Settings): Settings {
  const result = { ...base };

  for (const [path, value] of Object.entries(override)) {
    const schema = settingsSchema[path];
    const strategy = schema?.mergeStrategy ?? MergeStrategy.REPLACE;

    switch (strategy) {
      case MergeStrategy.REPLACE:
        result[path] = value;
        break;
      case MergeStrategy.UNION:
        result[path] = [...new Set([...base[path] ?? [], ...value])];
        break;
      case MergeStrategy.SHALLOW_MERGE:
        result[path] = { ...base[path], ...value };
        break;
      case MergeStrategy.CONCAT:
        result[path] = [...(base[path] ?? []), ...value];
        break;
    }
  }

  return result;
}
```

#### V1 → V2 Migration Map

```typescript
// 80+ field mappings
const V1_TO_V2_KEY_MAP: Record<string, string> = {
  // Flat V1 key → Nested V2 path
  'allowedTools': 'tools.allowed',
  'autoAccept': 'tools.autoAccept',
  'blockedTools': 'tools.blocked',
  'checkpointing': 'general.checkpointing',
  'customInstructions': 'general.customInstructions',
  'customThemes': 'ui.customThemes',
  'disableUpdateNag': 'general.disableUpdateNag',
  'enableInteractiveShell': 'tools.enableInteractiveShell',
  'maxConcurrentMcpConnections': 'mcp.maxConcurrentConnections',
  'mcpServers': 'mcp.servers',
  'model': 'model.default',
  'preferredEditor': 'general.preferredEditor',
  'sandbox': 'tools.sandbox',
  'theme': 'ui.theme',
  'thinkingMode': 'model.thinkingMode',
  'useBundledRipgrep': 'tools.useBundledRipgrep',
  'yolo': 'tools.yolo',
  // ... 60+ more
};
```

#### Migration Detection

```typescript
function needsMigration(settings: Record<string, unknown>): boolean {
  for (const key of Object.keys(settings)) {
    // Special case: 'model' exists in both V1 and V2
    if (key === 'model') {
      // V1: model is a string
      // V2: model is an object { default: string, ... }
      if (typeof settings[key] === 'string') return true;
      continue;
    }

    // If key is a V1-only key, needs migration
    if (V1_TO_V2_KEY_MAP[key] && !V2_TOP_LEVEL_KEYS.includes(key)) {
      return true;
    }
  }
  return false;
}
```

#### Forward Migration (V1 → V2)

```typescript
function migrateSettingsToV2(flatSettings: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [oldKey, value] of Object.entries(flatSettings)) {
    const newPath = V1_TO_V2_KEY_MAP[oldKey];

    if (newPath) {
      // Set nested property
      // 'tools.allowed' → { tools: { allowed: value } }
      setNestedProperty(result, newPath, value);
    } else {
      // Preserve unknown keys at root
      result[oldKey] = value;
    }
  }

  return result;
}

function setNestedProperty(obj: any, path: string, value: any): void {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = current[parts[i]] ?? {};
    current = current[parts[i]];
  }

  current[parts[parts.length - 1]] = value;
}
```

#### Backward Migration (V2 → V1)

```typescript
function migrateSettingsToV1(v2Settings: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // Reverse the mapping
  for (const [v1Key, v2Path] of Object.entries(V1_TO_V2_KEY_MAP)) {
    const value = getNestedProperty(v2Settings, v2Path);
    if (value !== undefined) {
      result[v1Key] = value;
    }
  }

  // Preserve unknown keys
  for (const [key, value] of Object.entries(v2Settings)) {
    if (!V2_TOP_LEVEL_KEYS.includes(key)) {
      result[key] = value;
    }
  }

  return result;
}
```

### 3.3 Hook Migration (Cross-Tool)

**Command:** `gemini hooks migrate --from-claude`

```typescript
const EVENT_MAPPING: Record<string, string> = {
  'PreToolUse': 'BeforeTool',
  'PostToolUse': 'AfterTool',
  'UserPromptSubmit': 'BeforeAgent',
  'Stop': 'AfterAgent',
  'PreCompact': 'PreCompress',
};

const TOOL_NAME_MAPPING: Record<string, string> = {
  'Edit': 'replace',
  'Bash': 'run_shell_command',
  'Read': 'read_file',
  'Write': 'write_file',
  'Glob': 'glob',
  'Grep': 'grep',
};

function migrateClaudeHook(hook: ClaudeHook): GeminiHook {
  return {
    event: EVENT_MAPPING[hook.event] ?? hook.event,
    command: hook.command,
    matcher: transformToolNamesInMatcher(hook.matcher),
  };
}

function transformToolNamesInMatcher(matcher: string): string {
  let result = matcher;
  for (const [claudeName, geminiName] of Object.entries(TOOL_NAME_MAPPING)) {
    result = result.replace(new RegExp(claudeName, 'g'), geminiName);
  }
  return result;
}
```

### 3.4 Settings File Scope Hierarchy

```
Priority (lowest to highest):
1. System defaults (built-in)
2. User settings (~/.gemini/settings.json)
3. Workspace settings (.gemini/settings.json)
4. System overrides
```

### 3.5 Format Preservation

```typescript
import stripJsonComments from 'strip-json-comments';

async function updateSettingsFilePreservingFormat(
  filePath: string,
  updates: Partial<Settings>
): Promise<void> {
  const content = await readFile(filePath, 'utf-8');

  // Parse with comments stripped
  const settings = JSON.parse(stripJsonComments(content));

  // Apply updates
  const updated = mergeSettings(settings, updates);

  // Write back (comments are lost, but structure preserved)
  await writeFile(filePath, JSON.stringify(updated, null, 2));
}
```

### 3.6 Gemini-CLI Summary

| Aspect | Approach |
|--------|----------|
| Version tracking | Implicit via key structure detection |
| Migration trigger | Before parsing, separate layer |
| Migration map | 80+ explicit field mappings |
| Merge strategies | Per-field (REPLACE, UNION, CONCAT, SHALLOW_MERGE) |
| Breaking changes | Add to mapping table |
| Rollback support | Yes (bidirectional V1↔V2) |
| Cross-tool migration | Yes (Claude → Gemini hooks) |
| User notification | Silent, unless requiresRestart |

---

## 4. Research: Codex

### 4.1 Auto-Update Mechanism

**Files:**
- `/codex-rs/tui/src/updates.rs`
- `/codex-rs/tui/src/update_action.rs`

#### Background Version Checking

```rust
// Check every 20 hours (configurable)
const CHECK_INTERVAL: Duration = Duration::from_secs(20 * 60 * 60);

#[derive(Serialize, Deserialize)]
struct VersionCache {
    version: String,
    checked_at: DateTime<Utc>,
    dismissed_versions: Vec<String>,  // User said "skip this version"
}

async fn check_for_updates(config: &Config) -> Option<UpdateInfo> {
    // Respect user config
    if !config.check_for_update_on_startup {
        return None;
    }

    let cache_path = home_dir().join(".codex/version.json");
    let cache: VersionCache = load_or_default(&cache_path);

    // Don't check too frequently
    if cache.checked_at + CHECK_INTERVAL > Utc::now() {
        return None;
    }

    let latest = fetch_latest_version().await?;

    // Don't show dismissed versions
    if cache.dismissed_versions.contains(&latest) {
        return None;
    }

    // Simple semver comparison
    if parse_version(&latest) > parse_version(CURRENT_VERSION) {
        return Some(UpdateInfo {
            version: latest,
            install_method: detect_install_method(),
        });
    }

    None
}

fn parse_version(v: &str) -> Option<(u64, u64, u64)> {
    // Simple x.y.z parsing
    // Returns None for prerelease versions (1.0.0-rc.1)
    let parts: Vec<&str> = v.trim_start_matches('v').split('.').collect();
    if parts.len() != 3 { return None; }

    Some((
        parts[0].parse().ok()?,
        parts[1].parse().ok()?,
        parts[2].parse().ok()?,
    ))
}
```

#### Install Method Detection

```rust
fn detect_install_method() -> InstallMethod {
    // Check environment variables first
    if std::env::var("CODEX_MANAGED_BY_NPM").is_ok() {
        return InstallMethod::Npm;
    }
    if std::env::var("CODEX_MANAGED_BY_BUN").is_ok() {
        return InstallMethod::Bun;
    }

    // Check executable path
    let exe_path = std::env::current_exe().ok()?;
    let path_str = exe_path.to_string_lossy();

    if path_str.contains("/opt/homebrew") || path_str.contains("/usr/local/Cellar") {
        return InstallMethod::Homebrew;
    }

    InstallMethod::Unknown
}

fn get_upgrade_command(method: InstallMethod, version: &str) -> Option<String> {
    match method {
        InstallMethod::Npm => Some(format!("npm install -g @openai/codex@{}", version)),
        InstallMethod::Bun => Some(format!("bun install -g @openai/codex@{}", version)),
        InstallMethod::Homebrew => Some("brew upgrade codex".to_string()),
        InstallMethod::Unknown => None,  // No suggestion
    }
}
```

### 4.2 Schema Migration Approach

**Files:**
- `/codex-rs/mcp-types/generate_mcp_types.py`
- `/codex-rs/mcp-types/schema/2025-03-26/schema.json`
- `/codex-rs/mcp-types/schema/2025-06-18/schema.json`
- `/codex-rs/core/src/config/types.rs`

#### Date-Based Schema Versioning

```
codex-rs/mcp-types/schema/
├── 2025-03-26/
│   └── schema.json    # Old version
└── 2025-06-18/
    └── schema.json    # Current version
```

```rust
// In generated code
pub const MCP_SCHEMA_VERSION: &str = "2025-06-18";
pub const JSONRPC_VERSION: &str = "2.0";
```

#### Code Generation from Schema

```python
# generate_mcp_types.py
SCHEMA_VERSION = "2025-06-18"

def main():
    schema_path = f"schema/{SCHEMA_VERSION}/schema.json"
    schema = json.load(open(schema_path))

    rust_code = []
    rust_code.append(f'pub const MCP_SCHEMA_VERSION: &str = "{SCHEMA_VERSION}";')

    for type_name, type_def in schema["definitions"].items():
        rust_code.append(generate_rust_struct(type_name, type_def))

    output_path = "src/lib.rs"

    if "--check" in sys.argv:
        # CI mode: verify generated matches checked-in
        existing = open(output_path).read()
        generated = "\n".join(rust_code)
        if existing != generated:
            print("Generated code doesn't match!")
            sys.exit(1)
    else:
        # Normal mode: write generated code
        open(output_path, "w").write("\n".join(rust_code))
```

#### Protocol Version in Messages

```rust
pub struct InitializeRequest {
    pub protocol_version: String,  // "2025-06-18"
    pub capabilities: ClientCapabilities,
    // ...
}

// When creating requests
let request = InitializeRequest {
    protocol_version: MCP_SCHEMA_VERSION.to_string(),
    // ...
};
```

#### Custom Deserializers for Config Migration

```rust
// config/types.rs

// Raw struct accepts both old and new field names
#[derive(Deserialize)]
struct RawMcpServerConfig {
    // New field (preferred)
    #[serde(default)]
    startup_timeout_sec: Option<f64>,

    // Old field (deprecated but still accepted)
    #[serde(default)]
    startup_timeout_ms: Option<u64>,

    // Other fields...
    command: String,
    args: Vec<String>,
}

// Clean struct is the actual config type
pub struct McpServerConfig {
    pub startup_timeout: Option<Duration>,
    pub command: String,
    pub args: Vec<String>,
}

impl TryFrom<RawMcpServerConfig> for McpServerConfig {
    type Error = ConfigError;

    fn try_from(raw: RawMcpServerConfig) -> Result<Self, Self::Error> {
        // Handle both old and new field
        let startup_timeout = match (raw.startup_timeout_sec, raw.startup_timeout_ms) {
            // New field takes precedence
            (Some(sec), _) => {
                Some(Duration::try_from_secs_f64(sec)
                    .map_err(|_| ConfigError::InvalidTimeout)?)
            }
            // Fall back to old field
            (None, Some(ms)) => Some(Duration::from_millis(ms)),
            // Neither specified
            (None, None) => None,
        };

        Ok(McpServerConfig {
            startup_timeout,
            command: raw.command,
            args: raw.args,
        })
    }
}
```

### 4.3 Interactive Migration Prompts

**File:** `/codex-rs/tui/src/model_migration.rs`

For significant changes, Codex shows interactive prompts:

```rust
pub struct ModelMigration {
    pub from_model: String,
    pub to_model: String,
    pub message: String,
    pub can_opt_out: bool,
    pub config_flag: &'static str,
}

pub async fn check_model_migration(config: &Config) -> Option<ModelMigration> {
    // GPT-5 → GPT-5.1 migration
    if config.model.starts_with("gpt-5")
        && config.model != "gpt-5.1"
        && !config.hide_gpt5_1_migration_prompt.unwrap_or(false)
    {
        return Some(ModelMigration {
            from_model: config.model.clone(),
            to_model: "gpt-5.1".into(),
            message: "GPT-5.1 is now available with improved coding performance. Would you like to upgrade?".into(),
            can_opt_out: true,
            config_flag: "hide_gpt5_1_migration_prompt",
        });
    }

    // GPT-5.1 → GPT-5.1-codex-max migration
    if config.model == "gpt-5.1"
        && !config.hide_gpt_5_1_codex_max_migration_prompt.unwrap_or(false)
    {
        return Some(ModelMigration {
            from_model: "gpt-5.1".into(),
            to_model: "gpt-5.1-codex-max".into(),
            message: "GPT-5.1-codex-max is optimized for coding. Switch?".into(),
            can_opt_out: true,
            config_flag: "hide_gpt_5_1_codex_max_migration_prompt",
        });
    }

    None
}
```

User acknowledges prompt, and it writes to config:

```toml
# ~/.codex/config.toml
[notice]
hide_gpt5_1_migration_prompt = true
hide_gpt_5_1_codex_max_migration_prompt = true
```

### 4.4 Version Constants

```rust
// Embedded at compile time from Cargo.toml
pub const CODEX_CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
```

### 4.5 Codex Summary

| Aspect | Approach |
|--------|----------|
| Version tracking | Explicit date-based (2025-06-18) |
| Schema storage | Multiple versions in git |
| Code generation | Python script from JSON Schema |
| Migration trigger | Custom deserializers (Serde) |
| Deprecated fields | Both old and new accepted in Raw struct |
| Breaking changes | Add old field to Raw struct + TryFrom logic |
| User notification | Interactive prompts with dismissal |
| Dismiss tracking | Config flags (hide_*_migration_prompt) |
| Update check frequency | Every 20 hours, background |

---

## 5. Comparison Matrix

### 5.1 Update Mechanisms

| Aspect | OpenCode | Gemini-CLI | Codex |
|--------|----------|------------|-------|
| Check frequency | On startup | On startup | Every 20 hours |
| Timeout | Not specified | 2 seconds | Not specified |
| User preference | `autoupdate: true/false/"notify"` | `disableUpdateNag` | `check_for_update_on_startup` |
| Dismiss specific versions | No | No | Yes |
| Detached upgrade | Yes | Yes | N/A (Rust binary) |
| Install detection | Path-based | Path + env vars | Env vars + path |

### 5.2 Migration Approaches

| Aspect | OpenCode | Gemini-CLI | Codex |
|--------|----------|------------|-------|
| Version tracking | Implicit (schema URI) | Implicit (key structure) | Explicit (date-based) |
| Migration location | Inside Zod transforms | Separate migration layer | Custom deserializers |
| When migration runs | During parsing | Before parsing | During deserialization |
| Deprecated fields | Accepted & transformed | Mapped to new location | Accepted via serde |
| Unknown fields | Preserved (catchall) | Preserved at root | Rejected (strict) |
| Bidirectional | No | Yes (V1↔V2) | No |
| User prompts | Silent | Silent (unless restart) | Interactive |

### 5.3 Config Formats

| Tool | Primary Format | Other Formats | Comments Support |
|------|---------------|---------------|------------------|
| OpenCode | JSONC | JSON, TOML (legacy) | Yes |
| Gemini-CLI | JSON | None | Via strip-json-comments |
| Codex | TOML | None | Yes (TOML native) |
| **Dexto** | YAML | None | Yes (YAML native) |

### 5.4 Breaking Change Strategies

| Strategy | OpenCode | Gemini-CLI | Codex |
|----------|----------|------------|-------|
| Add deprecated field to schema | ✅ | ❌ | ✅ |
| Explicit migration map | ❌ | ✅ | ❌ |
| Transform during parse | ✅ | ❌ | ✅ |
| requiresRestart flag | ❌ | ✅ | ❌ |
| Merge strategies | ❌ | ✅ | ❌ |

---

## 6. Design Options

### Option A: Zod Transforms (OpenCode Style)

Handle migrations inside Zod schema during parsing.

```typescript
const AgentConfigSchema = z.object({
  // Current structure
  llm: z.object({
    model: z.object({
      name: z.string(),
      reasoning: z.enum(['none', 'basic', 'extended']).optional(),
    }),
  }),

  // Deprecated fields (still accepted)
  model: z.string().optional(),  // @deprecated: moved to llm.model.name
})
.transform((config) => {
  // Migrate old → new
  if (config.model && !config.llm?.model?.name) {
    config.llm = {
      ...config.llm,
      model: { name: config.model },
    };
  }

  // Strip deprecated fields
  const { model, ...rest } = config;
  return rest;
});
```

**Pros:**
- Migrations colocated with schema definitions
- No separate version tracking
- Works automatically during parsing
- Simple for field renames/moves

**Cons:**
- Can't handle massive restructures
- Deprecated fields accumulate in schema forever
- No way to know "how old" a config is
- Complex transforms become messy
- Silent failures possible

---

### Option B: Explicit Migration Registry (Gemini-CLI Style)

Separate migration layer with version-to-version transforms.

```typescript
// packages/core/src/migrations/agent-migrations.ts

const V1_5_TO_V1_6_MAP = {
  'model': 'llm.model.name',
  'maxTokens': 'llm.context.maxTokens',
  'mcpServers': 'servers.mcp',
};

function needsMigrationV1_5_to_V1_6(config: unknown): boolean {
  return typeof config.model === 'string';
}

function migrateV1_5_to_V1_6(config: unknown): unknown {
  const result = {};
  for (const [oldKey, newPath] of Object.entries(V1_5_TO_V1_6_MAP)) {
    if (config[oldKey] !== undefined) {
      setNestedProperty(result, newPath, config[oldKey]);
    }
  }
  // Copy unmapped fields
  for (const [key, value] of Object.entries(config)) {
    if (!V1_5_TO_V1_6_MAP[key]) {
      result[key] = value;
    }
  }
  return result;
}
```

**Pros:**
- Explicit, auditable migration paths
- Can handle complex restructures
- Bidirectional possible
- Clear version boundaries

**Cons:**
- Large mapping tables to maintain
- Migration code separate from schema
- More boilerplate

---

### Option C: Sequential Version Migrations (Recommended Hybrid)

Track CLI version, apply sequential migrations on startup.

```typescript
// packages/core/src/migrations/index.ts

interface Migration {
  version: string;           // Target version
  description: string;       // Human-readable
  breaking: boolean;         // Requires backup?
  agentConfig?: (config: unknown) => unknown;
  preferences?: (config: unknown) => unknown;
}

const migrations: Migration[] = [
  {
    version: '1.6.0',
    description: 'llm.model changed from string to object',
    breaking: true,
    agentConfig: (config) => {
      if (typeof config.llm?.model === 'string') {
        config.llm.model = { name: config.llm.model };
      }
      return config;
    },
  },
  {
    version: '1.7.0',
    description: 'mcpServers renamed to servers',
    breaking: false,
    agentConfig: (config) => {
      if (config.mcpServers) {
        config.servers = config.mcpServers;
        delete config.mcpServers;
      }
      return config;
    },
  },
  {
    version: '2.0.0',
    description: 'Complete preferences restructure',
    breaking: true,
    preferences: migratePreferencesV1toV2,
  },
];

function getMigrationsBetween(from: string, to: string): Migration[] {
  return migrations.filter(m =>
    semver.gt(m.version, from) && semver.lte(m.version, to)
  );
}
```

**Pros:**
- Clear version progression
- Sequential application (1.5→1.6→1.7→2.0)
- Can mark breaking vs non-breaking
- Easy to audit what changed when

**Cons:**
- Need to track CLI version
- Migrations can't be removed (need to support old→new for any version)

---

### Option D: Separate User Configs (Split Approach)

Separate bundled agent configs from user customizations.

```
~/.dexto/agents/coding-agent/
├── coding-agent.yml           # Bundled, replaced on update
└── coding-agent.local.yml     # User overrides, migrated
```

**Pros:**
- Bundled configs always current
- User data clearly separated
- Can nuke bundled without losing customizations

**Cons:**
- Changes user workflow significantly
- Two files to manage
- Merge logic complexity
- **User rejected this approach**

---

### Option E: Graceful Degradation (Minimal)

Don't migrate - just handle failures gracefully.

```typescript
async function loadAgentConfig(path: string): Promise<AgentConfig | null> {
  try {
    const raw = await loadYaml(path);
    return AgentConfigSchema.parse(raw);
  } catch (error) {
    if (isZodError(error)) {
      logger.warn(`Config incompatible: ${path}`);
      logger.warn(`Run 'dexto agent reset ${agentId}' to fix`);
      return null;
    }
    throw error;
  }
}
```

**Pros:**
- Simplest implementation
- Users explicitly choose to reset

**Cons:**
- Poor UX - things just stop working
- No automatic recovery
- Users lose all customizations on reset

---

## 7. Recommended Approach

**Recommendation: Option C (Sequential Version Migrations) with elements from A and B**

### Core Components

1. **Version Tracking**
   - Store last-run CLI version in `~/.dexto/.cli-version`
   - Optional `schemaVersion` field in config files (fallback to .cli-version)

2. **Migration Registry**
   - Sequential migrations defined per breaking version
   - Each migration is a transform function
   - Migrations applied in order

3. **Automatic Backup**
   - Before any migration, backup to `~/.dexto-backup-{timestamp}`
   - Keep last N backups (configurable, default 3)

4. **Upgrade Command**
   - `dexto upgrade [version]` - check, show changes, perform upgrade
   - Show pending migrations before upgrade
   - Migration happens on next startup (new version)

5. **Recovery Commands**
   - `dexto restore-backup` - restore from backup
   - `dexto agent reset <id>` - reset single agent to defaults

### Why This Approach

| Requirement | How It's Met |
|-------------|--------------|
| Don't change user workflows | Configs stay in same location, same format |
| Know what version config was for | .cli-version tracking + optional schemaVersion |
| Handle breaking changes | Sequential migrations with validation |
| Protect user data | Automatic backups before migration |
| Clear recovery path | restore-backup and agent reset commands |

---

## 8. Implementation Details

### 8.1 Version Tracking

```typescript
// packages/core/src/migrations/version-tracker.ts

const VERSION_FILE = '.cli-version';

export function getLastRunVersion(): string {
  const versionPath = path.join(getDextoGlobalPath('root'), VERSION_FILE);

  if (existsSync(versionPath)) {
    return readFileSync(versionPath, 'utf-8').trim();
  }

  // No version file = first run or pre-versioning user
  // Assume oldest version that needs migration
  return '1.0.0';
}

export function setLastRunVersion(version: string): void {
  const versionPath = path.join(getDextoGlobalPath('root'), VERSION_FILE);
  writeFileSync(versionPath, version);
}

export function getCurrentVersion(): string {
  return pkg.version;  // From package.json
}
```

### 8.2 Migration Registry

```typescript
// packages/core/src/migrations/registry.ts

export interface Migration {
  version: string;
  description: string;
  breaking: boolean;
  agentConfig?: (config: unknown) => unknown;
  preferences?: (config: unknown) => unknown;
}

export const migrations: Migration[] = [
  // Add migrations here as breaking changes happen
  // {
  //   version: '1.6.0',
  //   description: 'Example: llm.model became an object',
  //   breaking: true,
  //   agentConfig: (config) => { ... },
  // },
];

export function getMigrationsBetween(from: string, to: string): Migration[] {
  return migrations
    .filter(m => semver.gt(m.version, from) && semver.lte(m.version, to))
    .sort((a, b) => semver.compare(a.version, b.version));
}

export function hasBreakingChanges(from: string, to: string): boolean {
  return getMigrationsBetween(from, to).some(m => m.breaking);
}
```

### 8.3 Migration Executor

```typescript
// packages/core/src/migrations/executor.ts

export interface MigrationResult {
  ok: boolean;
  path: string;
  error?: string;
  zodErrors?: z.ZodFormattedError<unknown>;
}

export async function migrateConfig(
  configPath: string,
  type: 'agentConfig' | 'preferences',
  fromVersion: string,
  toVersion: string
): Promise<MigrationResult> {
  const migrations = getMigrationsBetween(fromVersion, toVersion);

  if (migrations.length === 0) {
    return { ok: true, path: configPath };
  }

  try {
    // Load raw YAML
    let config = await loadYaml(configPath);

    // Apply migrations sequentially
    for (const migration of migrations) {
      const transform = migration[type];
      if (transform) {
        config = transform(config);
      }
    }

    // Validate against current schema
    const schema = type === 'agentConfig' ? AgentConfigSchema : GlobalPreferencesSchema;
    const result = schema.safeParse(config);

    if (!result.success) {
      return {
        ok: false,
        path: configPath,
        error: 'Migration produced invalid config',
        zodErrors: result.error.format(),
      };
    }

    // Write back (preserving comments if possible)
    await writeYamlPreservingFormat(configPath, config);

    return { ok: true, path: configPath };

  } catch (e) {
    return {
      ok: false,
      path: configPath,
      error: e.message,
    };
  }
}
```

### 8.4 Startup Migration Flow

```typescript
// packages/core/src/migrations/startup.ts

export async function runStartupMigrations(): Promise<void> {
  const lastVersion = getLastRunVersion();
  const currentVersion = getCurrentVersion();

  if (lastVersion === currentVersion) {
    return;  // No migration needed
  }

  const pendingMigrations = getMigrationsBetween(lastVersion, currentVersion);

  if (pendingMigrations.length === 0) {
    // Version changed but no migrations needed
    setLastRunVersion(currentVersion);
    return;
  }

  // Log what we're doing
  logger.info(`Migrating configs from v${lastVersion} to v${currentVersion}`);
  for (const m of pendingMigrations) {
    logger.info(`  ${m.version}: ${m.description}`);
  }

  // Backup if any breaking changes
  if (hasBreakingChanges(lastVersion, currentVersion)) {
    const backupPath = await createBackup();
    logger.info(`Backup created at: ${backupPath}`);
  }

  // Migrate preferences
  const prefsPath = path.join(getDextoGlobalPath('root'), 'preferences.yml');
  if (existsSync(prefsPath)) {
    const result = await migrateConfig(prefsPath, 'preferences', lastVersion, currentVersion);
    if (!result.ok) {
      logger.warn(`Failed to migrate preferences: ${result.error}`);
    }
  }

  // Migrate all agents
  const agentsDir = getDextoGlobalPath('agents');
  const agentDirs = await readdir(agentsDir);

  const results: MigrationResult[] = [];
  for (const agentId of agentDirs) {
    const configPath = path.join(agentsDir, agentId, `${agentId}.yml`);
    if (existsSync(configPath)) {
      const result = await migrateConfig(configPath, 'agentConfig', lastVersion, currentVersion);
      results.push(result);
    }
  }

  // Report failures
  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    logger.warn(`\nFailed to migrate ${failures.length} config(s):`);
    for (const f of failures) {
      logger.warn(`  ${f.path}: ${f.error}`);
    }
    logger.warn(`\nBackup available for recovery.`);
  }

  // Update version tracker
  setLastRunVersion(currentVersion);
}
```

### 8.5 Backup System

```typescript
// packages/core/src/migrations/backup.ts

const MAX_BACKUPS = 3;

export async function createBackup(): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(os.homedir(), `.dexto-backup-${timestamp}`);
  const sourcePath = getDextoGlobalPath('root');

  // Copy entire ~/.dexto
  await cp(sourcePath, backupPath, { recursive: true });

  // Clean up old backups
  await cleanOldBackups();

  return backupPath;
}

async function cleanOldBackups(): Promise<void> {
  const homeDir = os.homedir();
  const entries = await readdir(homeDir);

  const backups = entries
    .filter(e => e.startsWith('.dexto-backup-'))
    .map(e => ({ name: e, path: path.join(homeDir, e) }))
    .sort((a, b) => b.name.localeCompare(a.name));  // Newest first

  // Remove backups beyond MAX_BACKUPS
  for (const backup of backups.slice(MAX_BACKUPS)) {
    await rm(backup.path, { recursive: true });
  }
}

export async function restoreBackup(backupPath?: string): Promise<void> {
  // Find latest backup if not specified
  if (!backupPath) {
    const homeDir = os.homedir();
    const entries = await readdir(homeDir);
    const backups = entries
      .filter(e => e.startsWith('.dexto-backup-'))
      .sort()
      .reverse();

    if (backups.length === 0) {
      throw new Error('No backups found');
    }

    backupPath = path.join(homeDir, backups[0]);
  }

  const targetPath = getDextoGlobalPath('root');

  // Remove current
  await rm(targetPath, { recursive: true });

  // Restore from backup
  await cp(backupPath, targetPath, { recursive: true });
}
```

### 8.6 Upgrade Command

```typescript
// packages/cli/src/cli/commands/upgrade.ts

export async function upgradeCommand(targetVersion?: string): Promise<void> {
  const currentVersion = getCurrentVersion();
  const latest = targetVersion ?? await fetchLatestVersion();

  if (currentVersion === latest) {
    console.log(`Already on version ${currentVersion}`);
    return;
  }

  console.log(`Current version: ${currentVersion}`);
  console.log(`Available version: ${latest}`);

  // Check for breaking changes
  const pendingMigrations = getMigrationsBetween(currentVersion, latest);
  const breaking = pendingMigrations.filter(m => m.breaking);

  if (breaking.length > 0) {
    console.log(`\nThis upgrade includes breaking changes:\n`);
    for (const m of breaking) {
      console.log(`  v${m.version}: ${m.description}`);
    }
    console.log(`\nYour configs will be automatically migrated on next startup.`);
    console.log(`A backup will be created before migration.`);
  }

  const proceed = await confirm('Proceed with upgrade?');
  if (!proceed) {
    console.log('Upgrade cancelled.');
    return;
  }

  // Detect install method and upgrade
  const method = detectInstallMethod();
  const command = getUpgradeCommand(method, latest);

  if (!command) {
    console.log(`Could not detect installation method.`);
    console.log(`Please upgrade manually.`);
    return;
  }

  console.log(`\nRunning: ${command}`);
  execSync(command, { stdio: 'inherit' });

  console.log(`\nUpgrade complete. Restart dexto to apply migrations.`);
}

function detectInstallMethod(): 'npm' | 'pnpm' | 'bun' | 'brew' | 'unknown' {
  const execPath = process.execPath;

  // Check environment
  if (process.env.npm_execpath?.includes('pnpm')) return 'pnpm';
  if (process.env.BUN_INSTALL) return 'bun';

  // Check path
  if (execPath.includes('/.pnpm/')) return 'pnpm';
  if (execPath.includes('/.bun/')) return 'bun';
  if (execPath.includes('/.npm/')) return 'npm';
  if (execPath.includes('/homebrew/') || execPath.includes('/opt/homebrew')) return 'brew';

  // Check available commands
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {}

  try {
    execSync('bun --version', { stdio: 'ignore' });
    return 'bun';
  } catch {}

  return 'npm';  // Default
}

function getUpgradeCommand(method: string, version: string): string | null {
  switch (method) {
    case 'npm': return `npm install -g dexto@${version}`;
    case 'pnpm': return `pnpm add -g dexto@${version}`;
    case 'bun': return `bun install -g dexto@${version}`;
    case 'brew': return `brew upgrade dexto`;
    default: return null;
  }
}
```

### 8.7 Recovery Commands

```typescript
// packages/cli/src/cli/commands/restore-backup.ts

export async function restoreBackupCommand(): Promise<void> {
  const homeDir = os.homedir();
  const entries = await readdir(homeDir);
  const backups = entries
    .filter(e => e.startsWith('.dexto-backup-'))
    .sort()
    .reverse();

  if (backups.length === 0) {
    console.log('No backups found.');
    return;
  }

  console.log('Available backups:');
  backups.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));

  const choice = await select('Select backup to restore:', backups);
  const backupPath = path.join(homeDir, choice);

  const proceed = await confirm(`Restore from ${choice}? This will replace current configs.`);
  if (!proceed) return;

  await restoreBackup(backupPath);
  console.log('Backup restored successfully.');
}
```

```typescript
// packages/cli/src/cli/commands/agent-reset.ts

export async function agentResetCommand(agentId: string): Promise<void> {
  // Check if it's a bundled agent
  if (!BUNDLED_AGENT_IDS.includes(agentId)) {
    console.log(`'${agentId}' is not a bundled agent.`);
    console.log(`Use 'dexto agent delete ${agentId}' to remove custom agents.`);
    return;
  }

  const configPath = path.join(getDextoGlobalPath('agents'), agentId, `${agentId}.yml`);

  const proceed = await confirm(`Reset ${agentId} to defaults? Your customizations will be lost.`);
  if (!proceed) return;

  // Copy bundled agent config
  const bundledPath = getBundledAgentPath(agentId);
  await copyFile(bundledPath, configPath);

  console.log(`${agentId} reset to defaults.`);
}
```

---

## 9. Edge Cases & Recovery

### 9.1 User Skips Multiple Versions

User on v1.5.0 updates directly to v2.0.0 (skipping v1.6.0 and v1.7.0).

**Solution:** Migrations are applied sequentially:
```
v1.5.0 → v1.6.0 migration
v1.6.0 → v1.7.0 migration
v1.7.0 → v2.0.0 migration
```

Each migration assumes the previous one has run.

### 9.2 User Copies Config From Elsewhere

User copies a config from a friend on v1.5.0, but they're on v1.7.0.

**Problem:** We think config is v1.7.0 (based on .cli-version), but it's v1.5.0 format.

**Solutions:**
1. **Validation catches it** - Zod fails if schema is incompatible
2. **Optional schemaVersion field** - If present, use it for migration

```yaml
# Optional field in config files
schemaVersion: "1.5.0"  # If present, use this for migration
name: my-agent
# ...
```

```typescript
function getConfigVersion(config: unknown, fallback: string): string {
  if (typeof config === 'object' && config !== null && 'schemaVersion' in config) {
    return config.schemaVersion as string;
  }
  return fallback;  // Use .cli-version
}
```

### 9.3 Migration Produces Invalid Config

A migration transform has a bug or edge case.

**Solution:**
1. Validate after migration
2. Keep backup
3. Report detailed error
4. Skip invalid config (don't crash)

```
⚠️  Migration failed for: ~/.dexto/agents/my-agent/my-agent.yml

Error: Migration produced invalid config
  - llm.model.name: Required field missing

Your backup is at: ~/.dexto-backup-2026-01-19T10-30-00

Options:
  • Fix manually: edit the config file
  • Reset to defaults: dexto agent reset my-agent
  • Restore backup: dexto restore-backup
```

### 9.4 First-Time User on New Version

User installs dexto for the first time on v2.0.0.

**Solution:** No .cli-version file exists:
- Detect first-time setup (no ~/.dexto directory)
- Skip migrations entirely
- Write current version to .cli-version

### 9.5 Bundled Agent Has New Features

New version adds fields to bundled agents that user's migrated version won't have.

**Solution:** Zod defaults handle this automatically:
```typescript
const AgentConfigSchema = z.object({
  // New field with default
  newFeature: z.boolean().default(false),
});
```

User's config file doesn't have `newFeature`, but parsed config will have `newFeature: false`.

### 9.6 User Wants to See Pending Migrations Before Update

**Solution:** Add `dexto upgrade --dry-run`:

```typescript
export async function upgradeCommand(options: { dryRun?: boolean }): Promise<void> {
  const latest = await fetchLatestVersion();
  const migrations = getMigrationsBetween(getCurrentVersion(), latest);

  console.log(`Pending migrations for upgrade to v${latest}:\n`);
  for (const m of migrations) {
    const breaking = m.breaking ? ' [BREAKING]' : '';
    console.log(`  v${m.version}${breaking}: ${m.description}`);
  }

  if (options.dryRun) {
    console.log(`\nDry run - no changes made.`);
    return;
  }

  // ... proceed with upgrade
}
```

---

## 10. File Structure

```
packages/core/src/migrations/
├── index.ts              # Public exports
├── registry.ts           # Migration definitions
├── executor.ts           # Migration execution logic
├── version-tracker.ts    # .cli-version management
├── backup.ts             # Backup/restore logic
├── transforms/           # Individual migration transforms
│   ├── v1.6.0.ts
│   ├── v1.7.0.ts
│   └── v2.0.0.ts
└── __tests__/
    ├── registry.test.ts
    ├── executor.test.ts
    └── transforms/
        ├── v1.6.0.test.ts
        └── ...

packages/cli/src/cli/commands/
├── upgrade.ts            # dexto upgrade command
├── restore-backup.ts     # dexto restore-backup command
└── agent-reset.ts        # dexto agent reset command
```

---

## 11. Open Questions

### 11.1 Schema Version in Config Files?

Should we add an optional `schemaVersion` field to config files?

**Pros:**
- Explicit version tracking per file
- Handles configs copied from elsewhere
- Self-documenting

**Cons:**
- Adds clutter
- Users might delete it
- Most cases work fine with .cli-version

**Recommendation:** Add as optional field. Use if present, fall back to .cli-version.

### 11.2 Auto-Update Behavior?

What should the default auto-update behavior be?

| Option | Description |
|--------|-------------|
| `true` | Auto-update on startup (OpenCode default) |
| `false` | Never auto-update |
| `"notify"` | Show notification but don't update |
| `"prompt"` | Ask user each time |

**Recommendation:** Default to `"notify"` - inform users but don't change behavior unexpectedly.

### 11.3 How Long to Support Old Versions?

How many versions back should migrations support?

**Options:**
- Forever (accumulating migrations)
- N major versions
- N months/years

**Recommendation:** Support all versions. Migrations are small transforms. The cost of keeping them is low compared to user frustration.

### 11.4 What About preferences.yml?

Should preferences follow the same migration system as agent configs?

**Recommendation:** Yes, same system. Add preferences transforms to the migration registry.

### 11.5 Interactive Migration Prompts?

Should we show interactive prompts for significant migrations (like Codex)?

**Options:**
- Always silent (OpenCode)
- Always prompt for breaking changes
- Prompt only for specific high-impact changes

**Recommendation:** Silent by default with clear logging. Add `requiresConfirmation` flag to specific migrations if needed in future.

---

## 12. CI Enforcement for Breaking Schema Changes

Without enforcement, developers will forget to add migrations when making breaking schema changes. CI must catch this before merge.

### 12.1 The Problem

1. Developer changes schema (e.g., renames `model` to `llm.model.name`)
2. Developer forgets to add a migration
3. PR gets merged
4. Users update and their configs break

### 12.2 Solution: Schema Snapshot Testing

We maintain a "snapshot" of the current schema structure and detect when it changes in incompatible ways.

#### Schema Snapshot File

```json
// packages/core/src/migrations/schema-snapshots.json
{
  "agentConfig": {
    "version": "1.5.0",
    "hash": "a1b2c3d4",
    "shape": {
      "required": ["name", "llm"],
      "properties": {
        "name": { "type": "string" },
        "llm": { "type": "object", "properties": { "model": { "type": "string" } } }
      }
    }
  },
  "preferences": {
    "version": "1.5.0", 
    "hash": "e5f6g7h8",
    "shape": { ... }
  }
}
```

#### CI Test Logic

```typescript
// packages/core/src/migrations/__tests__/schema-enforcement.test.ts

describe('Schema Migration Enforcement', () => {
  it('should have migration when schema has breaking changes', () => {
    const snapshot = loadSchemaSnapshots();
    const currentShape = zodToJsonSchema(AgentConfigSchema);
    const currentHash = hashSchema(currentShape);
    
    // Case 1: Hash unchanged = no schema changes = PASS
    if (currentHash === snapshot.agentConfig.hash) {
      return; // All good, nothing changed
    }
    
    // Case 2: Hash changed = schema modified
    // Now check if it's a BREAKING change
    const breakingChanges = detectBreakingChanges(
      snapshot.agentConfig.shape,
      currentShape
    );
    
    if (breakingChanges.length === 0) {
      // Non-breaking change (e.g., new optional field with default)
      // Developer should run: pnpm run update-schema-snapshot
      fail(
        `Schema changed but snapshot not updated.\n` +
        `Run 'pnpm run update-schema-snapshot' to update.`
      );
    }
    
    // Case 3: Breaking changes detected
    // A migration MUST exist for the current version
    const currentVersion = getCurrentVersion();
    const migrationExists = migrations.some(
      m => m.version === currentVersion && m.agentConfig
    );
    
    if (!migrationExists) {
      fail(
        `Breaking schema changes detected but no migration found:\n` +
        breakingChanges.map(c => `  - ${c.type}: ${c.field}`).join('\n') +
        `\n\nAdd a migration to packages/core/src/migrations/registry.ts`
      );
    }
  });
});
```

#### Breaking Change Detection

```typescript
function detectBreakingChanges(oldShape: JsonSchema, newShape: JsonSchema): BreakingChange[] {
  const changes: BreakingChange[] = [];
  
  // 1. Removed required fields
  for (const field of oldShape.required ?? []) {
    if (!newShape.properties?.[field]) {
      changes.push({ type: 'field-removed', field });
    }
  }
  
  // 2. Type changes (string → object, etc.)
  for (const [field, oldDef] of Object.entries(oldShape.properties ?? {})) {
    const newDef = newShape.properties?.[field];
    if (newDef && oldDef.type !== newDef.type) {
      changes.push({ type: 'type-changed', field, from: oldDef.type, to: newDef.type });
    }
  }
  
  // 3. Field renamed (heuristic: old field gone + new field appeared)
  const oldFields = new Set(Object.keys(oldShape.properties ?? {}));
  const newFields = new Set(Object.keys(newShape.properties ?? {}));
  const removed = [...oldFields].filter(f => !newFields.has(f));
  const added = [...newFields].filter(f => !oldFields.has(f));
  
  // If exactly one removed and one added with same type, likely a rename
  if (removed.length === 1 && added.length === 1) {
    const oldType = oldShape.properties?.[removed[0]]?.type;
    const newType = newShape.properties?.[added[0]]?.type;
    if (oldType === newType) {
      changes.push({ type: 'field-renamed', from: removed[0], to: added[0] });
    }
  }
  
  // 4. New required field without default
  for (const field of newShape.required ?? []) {
    if (!oldShape.properties?.[field]) {
      const hasDefault = newShape.properties?.[field]?.default !== undefined;
      if (!hasDefault) {
        changes.push({ type: 'new-required-no-default', field });
      }
    }
  }
  
  return changes;
}
```

### 12.3 Developer Workflow

#### When Making Non-Breaking Changes

```bash
# Add a new optional field with a default
# 1. Modify the schema
# 2. Run the snapshot update script
$ pnpm run update-schema-snapshot

# This updates schema-snapshots.json with new hash
# Commit both the schema change and updated snapshot
```

#### When Making Breaking Changes

```bash
# Rename a field, remove a field, change a type, etc.
# 1. Modify the schema
# 2. Add a migration to registry.ts
# 3. Run tests to verify migration handles the change
# 4. Run snapshot update
$ pnpm run update-schema-snapshot

# Commit schema change + migration + updated snapshot
```

### 12.4 GitHub Action for PR Checks

```yaml
# .github/workflows/schema-check.yml
name: Schema Change Check

on:
  pull_request:
    paths:
      - 'packages/core/src/agent/schemas.ts'
      - 'packages/agent-management/src/preferences/schemas.ts'
      - 'packages/core/src/migrations/**'

jobs:
  check-schema:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - run: pnpm install
      - run: pnpm run test:schema-migrations
      
      - name: Comment on PR if schema changed
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## ⚠️ Schema Change Detected
              
This PR modifies schema files but CI checks failed.

**If this is a non-breaking change** (new optional field with default):
\`\`\`bash
pnpm run update-schema-snapshot
\`\`\`

**If this is a breaking change** (field removed/renamed/type changed):
1. Add a migration to \`packages/core/src/migrations/registry.ts\`
2. Add tests for the migration
3. Run \`pnpm run update-schema-snapshot\`

See [Auto-Update Feature Plan](../feature-plans/auto-update.md#12-ci-enforcement-for-breaking-schema-changes) for details.`
            })
```

### 12.5 File Structure for CI Enforcement

```
packages/core/src/migrations/
├── schema-snapshots.json        # Tracked in git, updated by script
├── schema-utils.ts              # Hash generation, comparison logic
├── __tests__/
│   └── schema-enforcement.test.ts
└── scripts/
    └── update-schema-snapshot.ts
```

---

## 13. Handling Direct Package Manager Updates

Users often update via `npm install -g dexto@latest` instead of `dexto upgrade`. This must work seamlessly.

### 13.1 How It Works

The migration system runs on **CLI startup**, not during the upgrade command:

```
1. User runs: npm install -g dexto@2.0.0
2. User runs: dexto chat (or any command)
3. CLI startup:
   - Reads ~/.dexto/.cli-version → "1.5.0"
   - Gets running version from package.json → "2.0.0"
   - Versions differ → run migrations
4. Migrations execute before command runs
5. Updates .cli-version to "2.0.0"
6. Command executes with migrated configs
```

### 13.2 Implementation: Startup Hook

```typescript
// packages/cli/src/cli/index.ts

async function main() {
  // FIRST: Run migrations if needed (before any command parsing)
  const migrationResult = await runStartupMigrations();
  
  // Show update message if migrations ran
  if (migrationResult.migrated) {
    displayMigrationSummary(migrationResult);
  }
  
  // THEN: Parse and execute the user's command
  const program = createProgram();
  await program.parseAsync(process.argv);
}
```

### 13.3 User-Facing Message

When migrations run, inform the user:

```
$ dexto chat

╭─────────────────────────────────────────────────────────╮
│  Dexto updated: v1.5.0 → v2.0.0                        │
│                                                         │
│  Migrated configs:                                      │
│    ✓ preferences.yml                                   │
│    ✓ agents/coding-agent/coding-agent.yml              │
│                                                         │
│  Backup created: ~/.dexto-backup-2026-01-21T10-30-00   │
│                                                         │
│  Run 'dexto doctor' to verify your setup               │
╰─────────────────────────────────────────────────────────╯

Starting chat session...
```

### 13.4 Edge Cases

| Scenario | Handling |
|----------|----------|
| Migration fails | Show error, point to backup, suggest `dexto doctor` |
| User runs multiple terminals | Use file locking on .cli-version during migration |
| User downgrades version | Log warning, don't run reverse migrations (backups exist) |
| First-time install | No .cli-version exists, skip migrations entirely |

---

## 14. Utility Commands

### 14.1 `dexto doctor` - Diagnose and Fix Issues

Inspired by `brew doctor`, `flutter doctor`, `npm doctor`.

#### Usage

```bash
$ dexto doctor

Dexto Doctor
============

Checking installation...
  ✓ CLI version: 2.0.0
  ✓ Node.js version: 20.10.0 (>=18 required)
  ✓ Installation method: pnpm global

Checking configuration...
  ✓ ~/.dexto directory exists
  ✓ preferences.yml valid
  ✓ .cli-version matches running version
  ⚠ agents/coding-agent/coding-agent.yml has unknown fields: ['oldField']
    → Run 'dexto doctor --fix' to remove unknown fields

Checking agents...
  ✓ coding-agent: valid config, 3 MCP servers configured
  ✗ my-custom-agent: invalid config
    → llm.model.name: Required
    → Run 'dexto agent validate my-custom-agent' for details

Checking MCP servers...
  ✓ filesystem: connected
  ✓ github: connected  
  ⚠ slack: connection timeout (5s)
    → Check server configuration or network

Checking disk usage...
  ✓ Logs: 45 MB (~/.dexto/logs)
  ⚠ Blobs: 2.3 GB (~/.dexto/blobs)
    → Run 'dexto clean --blobs' to remove old blobs
  ✓ Database: 12 MB

Summary: 2 warnings, 1 error
  Run 'dexto doctor --fix' to auto-fix where possible
```

#### Implementation Structure

```typescript
// packages/cli/src/cli/commands/doctor.ts

interface DoctorCheck {
  name: string;
  category: 'installation' | 'configuration' | 'agents' | 'mcp' | 'disk';
  run: () => Promise<CheckResult>;
  fix?: () => Promise<FixResult>;  // Optional auto-fix capability
}

interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
  fixable?: boolean;
}

const checks: DoctorCheck[] = [
  // Installation checks
  { name: 'CLI version', category: 'installation', run: checkCliVersion },
  { name: 'Node.js version', category: 'installation', run: checkNodeVersion },
  { name: 'Installation method', category: 'installation', run: checkInstallMethod },
  
  // Configuration checks
  { name: 'Dexto directory', category: 'configuration', run: checkDextoDir },
  { name: 'preferences.yml', category: 'configuration', run: checkPreferences, fix: fixPreferences },
  { name: 'Version tracking', category: 'configuration', run: checkVersionFile },
  
  // Agent checks
  { name: 'Agent configs', category: 'agents', run: checkAgentConfigs },
  
  // MCP checks
  { name: 'MCP servers', category: 'mcp', run: checkMcpConnections },
  
  // Disk checks
  { name: 'Disk usage', category: 'disk', run: checkDiskUsage },
];
```

### 14.2 `dexto clean` - Free Disk Space

#### Usage

```bash
# Interactive mode
$ dexto clean

What would you like to clean?
  ❯ Logs (45 MB) - Chat logs older than 30 days
    Blobs (2.3 GB) - Cached files older than 7 days  
    Sessions (120 MB) - Completed session data
    Backups (890 MB) - Old migration backups (keeping latest 3)
    All of the above

# Direct mode
$ dexto clean --logs --older-than 7d
Cleaning logs older than 7 days...
  Removed 23 log files (38 MB)

# Dry run
$ dexto clean --all --dry-run
Would remove:
  - 23 log files (38 MB)
  - 145 blob files (2.1 GB)  
  - 8 session directories (95 MB)
  - 2 backup directories (650 MB)
Total: 2.88 GB

Run without --dry-run to proceed.
```

#### Implementation Structure

```typescript
// packages/cli/src/cli/commands/clean.ts

interface CleanOptions {
  logs?: boolean;
  blobs?: boolean;
  sessions?: boolean;
  backups?: boolean;
  all?: boolean;
  olderThan?: string;  // '7d', '30d', '1h'
  dryRun?: boolean;
  force?: boolean;     // Skip confirmation
}

interface CleanTarget {
  name: string;
  path: string;
  pattern: string;
  maxAge?: Duration;
  keep?: number;       // Keep N most recent (for backups)
}

const defaultTargets: Record<string, CleanTarget> = {
  logs: {
    name: 'Logs',
    path: '~/.dexto/logs',
    pattern: '**/*.log',
    maxAge: { days: 30 },
  },
  blobs: {
    name: 'Blobs', 
    path: '~/.dexto/blobs',
    pattern: '**/*',
    maxAge: { days: 7 },
  },
  sessions: {
    name: 'Sessions',
    path: '~/.dexto/sessions',
    pattern: '*',
    maxAge: { days: 30 },
  },
  backups: {
    name: 'Backups',
    path: '~',
    pattern: '.dexto-backup-*',
    keep: 3,  // Always keep latest 3
  },
};
```

### 14.3 `dexto reset` - Nuclear Option

```bash
$ dexto reset

⚠️  This will remove ALL Dexto data:
  - All agent configurations (including custom agents)
  - All preferences
  - All chat history and sessions  
  - All cached data

A backup will be created first.

Are you sure? (type 'reset' to confirm): reset

Creating backup... done (~/.dexto-backup-2026-01-21T10-30-00)
Removing ~/.dexto... done
Reinitializing... done

Dexto has been reset to a fresh install.
```

### 14.4 Additional Utility Commands

| Command | Purpose |
|---------|---------|
| `dexto doctor` | Diagnose issues, validate configs |
| `dexto clean` | Free disk space |
| `dexto reset` | Full reset to fresh install |
| `dexto config show` | Show effective merged config |
| `dexto config path` | Show paths to config files |
| `dexto config edit [agent]` | Open config in $EDITOR |

---

## 15. Implementation Phases

### Phase 1: Foundation
- [ ] Add `.cli-version` tracking
- [ ] Create migration registry structure  
- [ ] Implement backup system
- [ ] Add `dexto upgrade` command
- [ ] Add schema snapshot infrastructure

### Phase 2: Migration Execution
- [ ] Implement migration executor
- [ ] Add startup migration hook with user messaging
- [ ] Create recovery commands (`restore-backup`, `agent reset`)
- [ ] Add dry-run support
- [ ] Implement file locking for concurrent access

### Phase 3: CI & Validation
- [ ] Add schema snapshot tests
- [ ] Add breaking change detection
- [ ] Create `update-schema-snapshot` script
- [ ] Add GitHub Action for PR checks

### Phase 4: Utility Commands
- [ ] Implement `dexto doctor`
- [ ] Implement `dexto clean`
- [ ] Implement `dexto reset`
- [ ] Add optional `schemaVersion` field support

### Phase 5: Polish
- [ ] Implement notification system for available updates
- [ ] Add migration testing utilities
- [ ] Documentation
- [ ] User guide for migration troubleshooting

---

## 17. References

### External Codebases
- OpenCode: `/packages/opencode/src/cli/upgrade.ts`, `/packages/opencode/src/config/config.ts`
- Gemini-CLI: `/packages/core/src/utils/settings.ts`, `/packages/core/src/utils/updateCheck.ts`
- Codex: `/codex-rs/tui/src/updates.rs`, `/codex-rs/core/src/config/types.rs`

### Dexto Files
- Agent schema: `packages/core/src/agent/schemas.ts`
- Preferences schema: `packages/agent-management/src/preferences/schemas.ts`
- Config loading: `packages/agent-management/src/config/loader.ts`
- Path utilities: `packages/agent-management/src/utils/path.ts`

### New Files (To Be Created)
- Migration registry: `packages/core/src/migrations/registry.ts`
- Schema snapshots: `packages/core/src/migrations/schema-snapshots.json`
- Version tracker: `packages/core/src/migrations/version-tracker.ts`
- Doctor command: `packages/cli/src/cli/commands/doctor.ts`
- Clean command: `packages/cli/src/cli/commands/clean.ts`

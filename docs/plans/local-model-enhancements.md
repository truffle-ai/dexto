# Local Model Enhancements Plan

## Goals

### Primary Goal
Enable users to use **custom GGUF files** from arbitrary paths (e.g., `/path/to/my-model.gguf`) with full metadata support (display names, context length, etc.) in both CLI and Web UI.

### Secondary Goals

1. **Make `local` and `ollama` first-class providers in Web UI**
   - Currently only supported in CLI; Web UI tells users to use "openai-compatible" instead
   - Web UI custom model form should have dedicated `local` and `ollama` options

2. **Sync CLI and Web UI experiences**
   - Both should show the same installed local models
   - Both should show the same Ollama models (when Ollama is running)
   - Custom models created in one should be visible in the other

3. **Close the Web UI gap for dynamic model discovery**
   - CLI directly calls `getAllInstalledModels()` and `listOllamaModels()`
   - Web UI has no API endpoints to fetch these - shows empty lists
   - Need new API endpoints to expose this data

### Non-Goals (Out of Scope)
- Model downloading UI in Web UI (keep that in CLI/setup flow)
- Ollama model pulling/management (use Ollama CLI for that)
- Changes to the core local model registry (20 preset models)

---

## Design Pattern: Mirror Ollama's "Custom Model Name" Flow

The Ollama setup already has a working pattern for custom models that we should mirror for local GGUF files:

### Ollama Flow (Current - Working)
```
┌─────────────────────────────────────────┐
│ Select an Ollama model                  │
│   ○ gemma3n:e2b                         │  ← Installed models (from API)
│   ○ llama3.2:latest                     │
│   ● ... Enter custom model name         │  ← For models not yet pulled
│   ○ ← Back                              │
└─────────────────────────────────────────┘
                    │
                    ▼ (if custom selected)
┌─────────────────────────────────────────┐
│ Enter the Ollama model name             │
│ > llama3.2:70b                          │
└─────────────────────────────────────────┘
                    │
                    ▼ (check if available)
┌─────────────────────────────────────────┐
│ ⚠️ Model 'llama3.2:70b' not available   │
│ Pull 'llama3.2:70b' from Ollama now?    │
│   ● Yes  ○ No                           │
└─────────────────────────────────────────┘
                    │
                    ▼ (if yes, pulls model)
                  Done!
```

### Local GGUF Flow (Proposed - Mirror Pattern)
```
┌─────────────────────────────────────────┐
│ Select a local model                    │
│   ○ llama-3.3-8b-q4 (5GB)              │  ← Installed models (from state.json)
│   ○ qwen-2.5-coder-7b-q4 (4.7GB)       │
│   ● ... Use custom GGUF file            │  ← For arbitrary GGUF paths
│   ○ + Download a new model              │
│   ○ ← Back                              │
└─────────────────────────────────────────┘
                    │
                    ▼ (if custom selected)
┌─────────────────────────────────────────┐
│ Enter path to GGUF file                 │
│ > /path/to/my-model.gguf                │
└─────────────────────────────────────────┘
                    │
                    ▼ (validate file exists)
┌─────────────────────────────────────────┐
│ ✓ Found: my-model.gguf (4.2GB)          │
│                                         │
│ Display name (optional):                │
│ > My Custom Llama                       │
│                                         │
│ Context length (default 4096):          │
│ > 8192                                  │
└─────────────────────────────────────────┘
                    │
                    ▼ (save as custom model)
                  Done!
```

### Key Parallels

| Aspect | Ollama | Local GGUF |
|--------|--------|------------|
| **List source** | `listOllamaModels()` API call | `getAllInstalledModels()` from state.json |
| **Custom option** | "Enter custom model name" | "Use custom GGUF file" |
| **User input** | Model name (e.g., `llama3.2:70b`) | File path (e.g., `/path/to/model.gguf`) |
| **Validation** | Check if model in Ollama | Check if file exists on disk |
| **Recovery** | Offer to `ollama pull` | Show error + instructions |
| **Storage** | Just model name in config | Model ID + `filePath` in custom-models.json |
| **Runtime** | Ollama API handles it | `node-llama-cpp` loads from path |

---

## Current State Analysis

### What Works
| Feature | CLI | Web UI |
|---------|-----|--------|
| Select from preset local models | ✅ Setup flow | ❌ No UI |
| Select from installed local models | ✅ Model selector | ❌ Empty list |
| Select Ollama models | ✅ Model selector | ❌ Empty list |
| Add custom model (openai-compatible) | ✅ Wizard | ✅ Form |
| Add custom model (local) | ⚠️ Partial | ❌ Not in form |
| Add custom model (ollama) | ⚠️ Partial | ❌ Not in form |

### Architecture Gaps

1. **No API for dynamic models**: Web UI calls `/api/llm/catalog` which returns empty arrays for local/ollama since `LLM_REGISTRY` models are populated dynamically only in CLI

2. **Schema missing `filePath`**: `CustomModelSchema` has no field for GGUF file paths

3. **Factory doesn't check custom models**: When `provider: 'local'`, factory only passes `modelId` to adapter, doesn't look up custom model metadata

---

## Implementation Phases

### Phase 1: Schema & Backend Foundation
**Goal**: Add the data structures and API endpoints needed for custom local models

#### 1.1 Schema Changes
**File**: `packages/agent-management/src/models/custom-models.ts`

```typescript
// Add filePath field to CustomModelSchema
CustomModelSchema = z.object({
    name: z.string().min(1),
    provider: z.enum(CUSTOM_MODEL_PROVIDERS),
    baseURL: z.string().url().optional(),
    displayName: z.string().optional(),
    filePath: z.string().optional(),  // NEW: for local GGUF files
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    apiKey: z.string().optional(),
});
```

#### 1.2 New API Endpoints
**File**: `packages/server/src/hono/routes/models.ts` (new file)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models/local` | GET | List installed GGUF models from state.json |
| `/api/models/local/validate` | POST | Validate a GGUF file path exists |
| `/api/models/ollama` | GET | Proxy to Ollama API to list models |

```typescript
// GET /api/models/local
// Returns installed models from ~/.dexto/models/state.json
{
  "models": [
    {
      "id": "llama-3.3-8b-q4",
      "displayName": "Llama 3.3 8B Instruct",
      "filePath": "/Users/x/.dexto/models/llama-3.3-8b-q4/...",
      "sizeBytes": 5020000000,
      "source": "huggingface",
      "contextLength": 131072
    }
  ]
}

// POST /api/models/local/validate
// Request: { "filePath": "/path/to/model.gguf" }
// Response: { "valid": true, "sizeBytes": 5020000000 } or { "valid": false, "error": "File not found" }

// GET /api/models/ollama
// Proxies to Ollama API (handles connection errors gracefully)
{
  "available": true,
  "models": [
    { "name": "llama3.2:latest", "size": 2000000000 }
  ]
}
// or if Ollama not running:
{ "available": false, "models": [], "error": "Ollama not running" }
```

#### 1.3 Factory Enhancement
**File**: `packages/core/src/llm/services/factory.ts`

```typescript
case 'local': {
    // Check for custom model with filePath
    const customModels = await loadCustomModels();
    const customModel = customModels.find(
        cm => cm.name === model && cm.provider === 'local'
    );

    return createLocalLanguageModel({
        modelId: model,
        modelPath: customModel?.filePath,  // Pass direct path if custom model
    });
}
```

**Deliverables**:
- [ ] Updated `CustomModelSchema` with `filePath`
- [ ] New `models.ts` route file with 3 endpoints
- [ ] Updated factory to resolve custom model file paths
- [ ] Unit tests for new endpoints

---

### Phase 2: CLI Enhancements
**Goal**: Add "Use custom GGUF file" option to CLI setup flow (mirroring Ollama pattern)

#### 2.1 Local Model Setup Flow
**File**: `packages/cli/src/cli/utils/local-model-setup.ts`

Mirror the Ollama pattern from `setupOllamaModels()` (lines 400-496):

**Current Ollama code to mirror:**
```typescript
// Ollama adds custom option like this (line 447-452):
modelOptions.push({
    value: '_custom',
    label: `${chalk.blue('...')} Enter custom model name`,
    hint: 'For models not yet pulled',
});

// Then handles it (line 474-492):
if (selected === '_custom') {
    const modelName = await p.text({
        message: 'Enter the Ollama model name',
        placeholder: 'llama3.2:70b',
    });
    const isReady = await ensureOllamaModelAvailable(trimmedName);
    // ...
}
```

**New local GGUF code (add to `selectInstalledModel` or similar):**
```typescript
// Add custom GGUF option alongside existing options
modelOptions.push({
    value: '_custom_gguf',
    label: `${chalk.blue('...')} Use custom GGUF file`,
    hint: 'For GGUF files not in registry',
});

// Handle custom GGUF selection
if (selected === '_custom_gguf') {
    const filePath = await p.text({
        message: 'Enter path to GGUF file',
        placeholder: '/path/to/model.gguf',
        validate: (value) => {
            if (!value.endsWith('.gguf')) return 'Must be a .gguf file';
            return undefined;
        },
    });

    const isReady = await ensureCustomGGUFAvailable(filePath.trim());
    if (!isReady) {
        return { success: false };
    }

    return { success: true, modelId: customModelId };
}
```

**New helper function (mirror `ensureOllamaModelAvailable`):**
```typescript
/**
 * Validate custom GGUF file and save as custom model.
 * Returns true if model is ready to use, false if validation failed.
 */
async function ensureCustomGGUFAvailable(filePath: string): Promise<boolean> {
    // 1. Check if file exists
    const stats = await validateGGUFFile(filePath);
    if (!stats.valid) {
        console.log(chalk.red(`\n❌ ${stats.error}\n`));
        return false;
    }

    console.log(chalk.green(`✓ Found: ${path.basename(filePath)} (${formatSize(stats.sizeBytes)})\n`));

    // 2. Prompt for metadata (like Ollama just uses the name as-is)
    const displayName = await p.text({
        message: 'Display name (optional)',
        placeholder: path.basename(filePath, '.gguf'),
    });

    const contextLength = await p.text({
        message: 'Context length',
        placeholder: '4096',
        initialValue: '4096',
    });

    // 3. Generate model ID from filename
    const modelId = generateModelId(filePath, displayName);

    // 4. Save as custom model
    await saveCustomModel({
        name: modelId,
        provider: 'local',
        filePath: filePath,
        displayName: displayName || path.basename(filePath, '.gguf'),
        maxInputTokens: parseInt(contextLength) || 4096,
    });

    console.log(chalk.green(`\n✓ Registered as '${modelId}'\n`));
    return true;
}
```

#### 2.2 Provider Config Update
**File**: `packages/cli/src/cli/ink-cli/components/overlays/custom-model-wizard/provider-config.ts`

Update local provider config:
```typescript
local: {
    displayName: 'Local (GGUF)',
    description: 'Use a custom GGUF model file with node-llama-cpp',
    steps: [
        {
            field: 'name',
            label: 'Model ID',
            placeholder: 'e.g., my-custom-llama',
            required: true,
        },
        {
            field: 'filePath',
            label: 'GGUF File Path',
            placeholder: '/path/to/model.gguf',
            required: true,
            validate: (value) => {
                if (!value.endsWith('.gguf')) return 'Must be a .gguf file';
                return null;
            },
            asyncValidation: async (value) => {
                // Call validation API or check fs directly
            },
        },
        DISPLAY_NAME_STEP,
        MAX_INPUT_TOKENS_STEP,
    ],
    buildModel: (values, provider) => ({
        name: values.name,
        provider,
        filePath: values.filePath,
        displayName: values.displayName,
        maxInputTokens: values.maxInputTokens ? parseInt(values.maxInputTokens) : undefined,
    }),
    setupInfo: {
        title: 'node-llama-cpp Setup',
        description: 'Requires node-llama-cpp to be installed',
        docsUrl: 'https://docs.dexto.ai/docs/guides/local-models',
    },
},
```

**Deliverables**:
- [ ] "Use custom GGUF file" option in setup flow
- [ ] Updated provider-config.ts with filePath field
- [ ] File path validation (sync + async)
- [ ] Integration with custom models storage

---

### Phase 3: Web UI - API Integration
**Goal**: Web UI can fetch and display local/ollama models

#### 3.1 New React Hooks
**File**: `packages/webui/components/hooks/useLocalModels.ts`

```typescript
export function useLocalModels(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.models.local,
        queryFn: async () => {
            const res = await client.api.models.local.$get();
            if (!res.ok) throw new Error('Failed to fetch local models');
            return await res.json();
        },
        enabled: options?.enabled ?? true,
    });
}

export type LocalModel = NonNullable<ReturnType<typeof useLocalModels>['data']>['models'][number];
```

**File**: `packages/webui/components/hooks/useOllamaModels.ts`

```typescript
export function useOllamaModels(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.models.ollama,
        queryFn: async () => {
            const res = await client.api.models.ollama.$get();
            if (!res.ok) throw new Error('Failed to fetch Ollama models');
            return await res.json();
        },
        enabled: options?.enabled ?? true,
        retry: false,  // Don't retry if Ollama not running
    });
}
```

#### 3.2 Update Model Picker
**File**: `packages/webui/components/ModelPicker/ModelPickerModal.tsx`

- Fetch local models via `useLocalModels()`
- Fetch Ollama models via `useOllamaModels()`
- Display in appropriate sections alongside API models
- Show "Ollama not running" message if unavailable

**Deliverables**:
- [ ] `useLocalModels` hook
- [ ] `useOllamaModels` hook
- [ ] Updated query keys
- [ ] Model picker displays local/ollama models

---

### Phase 4: Web UI - Custom Model Form
**Goal**: Web UI can add custom local/ollama models

#### 4.1 Add Providers to Form
**File**: `packages/webui/components/ModelPicker/CustomModelForms.tsx`

```typescript
// Update type
export type CustomModelProvider =
    | 'openai-compatible'
    | 'openrouter'
    | 'litellm'
    | 'glama'
    | 'bedrock'
    | 'ollama'   // NEW
    | 'local';   // NEW

// Add to PROVIDER_OPTIONS
{
    value: 'ollama',
    label: 'Ollama',
    description: 'Local Ollama server models',
},
{
    value: 'local',
    label: 'Local (GGUF)',
    description: 'Custom GGUF files via node-llama-cpp',
},
```

#### 4.2 Ollama Fields Component
```typescript
function OllamaFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    return (
        <>
            {/* Setup Guide */}
            <SetupBanner
                title="Ollama Setup"
                description="Requires Ollama to be installed and running"
                docsUrl="https://ollama.ai"
            />

            {/* Model Name */}
            <FormField
                label="Model Name"
                required
                value={formData.name}
                onChange={(v) => onChange({ name: v })}
                placeholder="e.g., llama3.2:latest"
            />

            {/* Base URL (optional) */}
            <FormField
                label="Ollama URL"
                value={formData.baseURL}
                onChange={(v) => onChange({ baseURL: v })}
                placeholder="http://localhost:11434 (default)"
            />

            {/* Display Name */}
            <FormField
                label="Display Name"
                optional
                value={formData.displayName}
                onChange={(v) => onChange({ displayName: v })}
            />
        </>
    );
}
```

#### 4.3 Local Fields Component
```typescript
function LocalFields({ formData, onChange, setLocalError }: ProviderFieldsProps) {
    const [validating, setValidating] = useState(false);
    const [fileValid, setFileValid] = useState<boolean | null>(null);

    // Debounced file validation
    useEffect(() => {
        if (!formData.filePath) return;
        setValidating(true);
        const timer = setTimeout(async () => {
            const res = await client.api.models.local.validate.$post({
                json: { filePath: formData.filePath }
            });
            const data = await res.json();
            setFileValid(data.valid);
            setValidating(false);
        }, 500);
        return () => clearTimeout(timer);
    }, [formData.filePath]);

    return (
        <>
            {/* Setup Guide */}
            <SetupBanner
                title="node-llama-cpp Setup"
                description="Requires node-llama-cpp to be installed"
                docsUrl="https://docs.dexto.ai/docs/guides/local-models"
            />

            {/* Model ID */}
            <FormField
                label="Model ID"
                required
                value={formData.name}
                onChange={(v) => onChange({ name: v })}
                placeholder="e.g., my-custom-llama"
            />

            {/* File Path */}
            <FormField
                label="GGUF File Path"
                required
                value={formData.filePath}
                onChange={(v) => onChange({ filePath: v })}
                placeholder="/path/to/model.gguf"
                validating={validating}
                valid={fileValid}
                error={fileValid === false ? 'File not found or not readable' : undefined}
            />

            {/* Display Name */}
            <FormField
                label="Display Name"
                optional
                value={formData.displayName}
                onChange={(v) => onChange({ displayName: v })}
            />

            {/* Context Length */}
            <FormField
                label="Max Input Tokens"
                optional
                type="number"
                value={formData.maxInputTokens}
                onChange={(v) => onChange({ maxInputTokens: v })}
                placeholder="4096 (default)"
            />
        </>
    );
}
```

#### 4.4 Form Data Schema Update
```typescript
export interface CustomModelFormData {
    provider: CustomModelProvider;
    name: string;
    baseURL: string;
    displayName: string;
    maxInputTokens: string;
    maxOutputTokens: string;
    apiKey: string;
    filePath: string;  // NEW
}
```

**Deliverables**:
- [ ] `OllamaFields` component
- [ ] `LocalFields` component with file validation
- [ ] Updated `CustomModelFormData` type
- [ ] Updated form submission to include `filePath`

---

### Phase 5: Testing & Documentation
**Goal**: Ensure everything works end-to-end

#### 5.1 Integration Tests
- [ ] Custom local model creation via CLI
- [ ] Custom local model creation via Web UI
- [ ] Model switching to custom local model
- [ ] File path validation (valid/invalid paths)
- [ ] Ollama model listing (running/not running)

#### 5.2 E2E Tests
- [ ] Full flow: Add custom GGUF → Select → Chat
- [ ] Sync: Create in CLI → Visible in Web UI
- [ ] Sync: Create in Web UI → Visible in CLI

#### 5.3 Documentation Updates
- [ ] Update local models guide with custom GGUF instructions
- [ ] Add troubleshooting for common issues
- [ ] Update API reference with new endpoints

---

## File Change Summary

| Phase | File | Change Type |
|-------|------|-------------|
| 1 | `packages/agent-management/src/models/custom-models.ts` | Modify |
| 1 | `packages/server/src/hono/routes/models.ts` | **New** |
| 1 | `packages/server/src/hono/index.ts` | Modify (add route) |
| 1 | `packages/core/src/llm/services/factory.ts` | Modify |
| 2 | `packages/cli/src/cli/utils/local-model-setup.ts` | Modify |
| 2 | `packages/cli/.../provider-config.ts` | Modify |
| 3 | `packages/webui/components/hooks/useLocalModels.ts` | **New** |
| 3 | `packages/webui/components/hooks/useOllamaModels.ts` | **New** |
| 3 | `packages/webui/lib/queryKeys.ts` | Modify |
| 3 | `packages/webui/components/ModelPicker/ModelPickerModal.tsx` | Modify |
| 4 | `packages/webui/components/ModelPicker/CustomModelForms.tsx` | Modify |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| File path security (path traversal) | Medium | High | Validate paths, restrict to allowed directories |
| Ollama API changes | Low | Medium | Abstract Ollama calls, handle errors gracefully |
| Large GGUF file handling | Medium | Medium | Async validation, progress indicators |
| node-llama-cpp not installed | Medium | Low | Clear error messages, setup instructions |

---

## Success Criteria

1. **Custom GGUF Path**: User can add `/path/to/model.gguf` and chat with it
2. **Display Names**: Custom models show friendly names in selectors
3. **CLI/Web Sync**: Models added in CLI appear in Web UI and vice versa
4. **First-Class Providers**: `local` and `ollama` appear as options in Web UI custom model form
5. **Dynamic Discovery**: Web UI shows installed local models and Ollama models (when available)
6. **Error Handling**: Clear messages for invalid paths, missing dependencies, Ollama not running

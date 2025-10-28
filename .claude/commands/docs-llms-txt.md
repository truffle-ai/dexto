---
description: "Update LLM Providers documentation to match llms.txt"
allowed-tools: ["bash", "read", "write", "edit"]
---

# LLM Providers Documentation Updater

Synchronizes `docs/docs/guides/supported-llm-providers.md` with the source of truth at `docs/static/llms.txt`.

## Workflow

### 1. Read the Source Data

Read the llms.txt file:

```bash
cat docs/static/llms.txt
```

Parse the file to extract:
- **Provider names** (sections starting with ##)
- **Model lists** under each provider
- **Default models** (marked with *)
- **Provider metadata** (homepage, features, notes)

### 2. Read Current Documentation

```bash
cat docs/docs/guides/supported-llm-providers.md
```

### 3. Compare and Update

For each provider in llms.txt:

**Check if provider exists in documentation:**
- If missing: Add new provider section
- If exists: Update model list, default model, features if changed
- If provider removed from llms.txt: Remove from documentation

**Maintain structure:**
- Built-in Providers section first
- OpenAI-Compatible Providers section second
- Keep "Choosing the Right Provider" and "Environment Variables" sections
- Preserve :::tip callouts and frontmatter

**Built-in Provider format:**

````markdown
### {Provider Name}

```yaml
llm:
  provider: {provider-id}
  model: {default-model}
  apiKey: ${API_KEY_VAR}
```

**Supported models:**
- {list of models, with default first}

**Features:**
- Feature 1
- Feature 2

---
````

**OpenAI-Compatible Provider format:**

````markdown
### {Provider Name}

```yaml
llm:
  provider: openai-compatible
  model: {model-name}
  apiKey: ${API_KEY}
  baseURL: {base-url}
  maxInputTokens: {tokens}
```

**{Additional notes or popular models}**

---
````

### 4. Update Documentation

Use the Edit or Write tool to update `docs/docs/guides/supported-llm-providers.md` with all changes.

### 5. Verify

Read the updated file to ensure:
- All providers from llms.txt are present
- Model lists are complete and accurate
- Default models are correctly identified
- No duplicate entries
- YAML examples are syntactically correct
- Environment variables section is up-to-date

## Important Notes

- **Source of truth:** `docs/static/llms.txt`
- **Keep:** Frontmatter, :::tip callout, section headers, "Choosing the Right Provider", "Environment Variables"
- **Update:** Provider sections, model lists, default models, features
- **Remove:** Providers not in llms.txt
- **Format:** Follow existing markdown structure exactly
- **Accuracy:** Ensure model names match llms.txt exactly

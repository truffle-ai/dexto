---
description: "Review code changes and update documentation accordingly"
allowed-tools: ["bash", "read", "glob", "grep", "task"]
---

# Documentation Update Assistant

Reviews code changes on the current branch and identifies documentation that needs updates.

## Workflow

### 1. Analyze Code Changes

First, examine the entire diff of the current branch against the main branch:

```bash
git diff main...HEAD
```

Understand what has changed:
- New features added
- APIs modified or added
- Configuration options changed
- Breaking changes
- Bug fixes that affect documented behavior

### 2. Audit Documentation

Use sub-agents to comprehensively check all documentation in the project:

**Documentation Locations:**
- `docs/` - Main Docusaurus documentation site
  - Explanatory docs (concepts, guides)
  - Configuration docs (agent.yml, settings)
  - API reference docs (SDK, REST API, WebSocket)
  - Tutorials and examples
  - Getting started guides
- `README.md` - Project root README
- `packages/*/README.md` - Package-specific READMEs
- `CLAUDE.md` - AI assistant guidelines
- Other markdown files throughout the codebase

**Documentation Categories to Check:**
1. **Explanatory Docs** - Concepts, architecture, how things work
2. **Configuration Docs** - agent.yml, preferences, settings
3. **API Reference Docs** - SDK methods, REST endpoints, WebSocket events
4. **Tutorials** - Step-by-step guides and walkthroughs
5. **Getting Started** - Installation, quickstart, first steps
6. **Examples & Demos** - Code examples and demo projects
7. **Guides** - How-to guides for specific features

### 3. Identify Documentation Gaps

Cross-reference the code changes with existing documentation:
- Are new features documented?
- Do API changes require doc updates?
- Are configuration examples up to date?
- Do tutorials still work with the changes?
- Are there new use cases to document?
- Do breaking changes have migration guides?

### 4. Recommend Updates

Present a structured list of recommended documentation updates:

```markdown
## Recommended Documentation Updates

### High Priority
- [ ] **File**: `docs/static/openapi/openapi.json`
  - **Reason**: New `fileDataInput` parameter added to `/api/message` endpoint
  - **Changes Needed**: Update OpenAPI spec with new parameter (regenerate via sync-openapi-docs script)

### Medium Priority
- [ ] **File**: `packages/core/README.md`
  - **Reason**: New `StorageService` class added
  - **Changes Needed**: Update architecture section

### Low Priority
- [ ] **File**: `docs/docs/tutorials/building-triage-system.md`
  - **Reason**: Updated error handling patterns
  - **Changes Needed**: Update code examples to use new error types

### Optional
- [ ] **File**: `docs/docs/examples-demos/` (new file)
  - **Reason**: Good opportunity to add example for new feature
  - **Changes Needed**: Create new example demonstrating file upload feature
```

### 5. Ask for User Confirmation

Present the recommendations and ask:
- Which updates should be implemented?
- Are there additional docs that should be updated?
- Should any examples or tutorials be added?

## Usage

```bash
/update-docs
```

The command will automatically:
1. Analyze your branch's changes
2. Scan all documentation
3. Identify gaps and outdated content
4. Recommend specific updates
5. Wait for your approval before making changes

## Notes

- Always check if examples still run with the new changes
- Update API reference docs for any signature changes
- Add migration guides for breaking changes
- Keep CLAUDE.md updated with new patterns or conventions
- Consider adding new tutorials for significant features

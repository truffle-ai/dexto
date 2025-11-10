# CLI Improvement Plan: Migrating WebUI Features

## Overview
This document outlines the plan to migrate key WebUI features to the modern Ink-based CLI (`ink-cli` mode) to create a frictionless, feature-rich terminal experience.

## Current State Analysis

### WebUI Features (What We Have)
1. **Slash Command Autocomplete** - Dropdown with fuzzy search, keyboard navigation, argument hints
2. **Resource Autocomplete (@ mentions)** - File/resource references with autocomplete
3. **Model Picker** - Visual model switching with search
4. **Session Management** - Panel with list, create, switch, delete, search
5. **Memory Panel** - Create, view, search, and manage memories
6. **Servers Panel** - MCP server management and connection
7. **Settings Modal** - Configuration and preferences
8. **Global Search** - Search across conversations
9. **Tool Confirmation** - Inline approval cards
10. **Quick Actions** - Starter prompts and quick actions
11. **File Attachments** - Image and file uploads
12. **Audio Recording** - Voice input support

### Current CLI Features (What We Have)
- Basic slash commands (`/help`, `/model`, `/session`, etc.)
- Simple readline-based input
- Basic message display
- Tool confirmation via prompts

## Migration Plan

### Phase 1: Core UX Improvements (High Priority)

#### 1.1 Enhanced Slash Command Autocomplete ⭐ **CRITICAL**
**Status**: Not implemented  
**Priority**: P0 - Highest

**Features to Implement**:
- Dropdown menu below input that appears when typing `/`
- Fuzzy search/filtering as user types
- Keyboard navigation (Arrow Up/Down, Enter, Tab, Escape)
- Show command arguments with hints (`<arg>`, `<arg?>`, descriptions)
- Display command source badges (MCP, Custom, Starter, File)
- Show command descriptions
- Highlight selected item
- Auto-complete on Tab/Enter
- Show "Create new prompt" option when no matches

**Implementation Approach**:
- Create `SlashCommandAutocomplete` component using Ink's `Box` and `Text`
- Use `useInput` hook for keyboard navigation
- Fetch prompts from agent (similar to WebUI's `usePrompts` hook)
- Filter commands based on typed query
- Position dropdown above input area
- Handle focus management

**Files to Create/Modify**:
- `packages/cli/src/cli/ink-cli/components/SlashCommandAutocomplete.tsx`
- Update `packages/cli/src/cli/ink-cli.tsx` to integrate autocomplete

**Dependencies**:
- Access to prompts API (via agent)
- Fuzzy matching library (or simple string matching)

---

#### 1.2 Resource Autocomplete (@ Mentions) ⭐ **HIGH**
**Status**: Not implemented  
**Priority**: P1

**Features to Implement**:
- Show dropdown when typing `@` at start or after space
- List available resources (files, MCP resources)
- Filter by query string
- Keyboard navigation
- Show resource metadata (name, URI, server name)
- Display resource type indicators
- Auto-complete on selection

**Implementation Approach**:
- Create `ResourceAutocomplete` component
- Detect `@` position in input (similar to WebUI's `findActiveAtIndex`)
- Fetch resources from agent
- Filter and sort resources
- Display in dropdown format

**Files to Create/Modify**:
- `packages/cli/src/cli/ink-cli/components/ResourceAutocomplete.tsx`
- Update input handling in `ink-cli.tsx`

**Dependencies**:
- Access to resources API (via agent)

---

#### 1.3 Improved Input Component
**Status**: Basic implementation exists  
**Priority**: P1

**Features to Implement**:
- Multi-line input support (for longer prompts)
- Better cursor management
- Support for both slash commands and @ mentions simultaneously
- Visual indicators for active autocomplete type
- Input history (Up/Down arrows for previous inputs)

**Implementation Approach**:
- Enhance `TextInput` usage or create custom input component
- Track input history
- Handle multi-line input with proper rendering

---

### Phase 2: Feature Parity (Medium Priority)

#### 2.1 Model Picker UI ⭐ **HIGH**
**Status**: Basic `/model switch` command exists  
**Priority**: P1

**Features to Implement**:
- Interactive model picker modal/dropdown
- Search/filter models
- Show model capabilities (multimodal, streaming, etc.)
- Display current model prominently
- Quick switch via keyboard shortcut (e.g., `Ctrl+M`)

**Implementation Approach**:
- Create `ModelPicker` component using Ink modals
- Fetch available models from agent
- Display in searchable list format
- Integrate with existing model switching logic

**Files to Create/Modify**:
- `packages/cli/src/cli/ink-cli/components/ModelPicker.tsx`
- Add keyboard shortcut handler

---

#### 2.2 Session Management UI ⭐ **HIGH**
**Status**: Basic `/session` commands exist  
**Priority**: P1

**Features to Implement**:
- Session list panel/modal
- Search sessions
- Create new session
- Switch sessions
- Delete sessions
- Show session metadata (title, message count, last activity)
- Quick session switch via keyboard shortcut (e.g., `Ctrl+S`)

**Implementation Approach**:
- Create `SessionPanel` component
- Use Ink modals or side panel
- Integrate with existing session commands

**Files to Create/Modify**:
- `packages/cli/src/cli/ink-cli/components/SessionPanel.tsx`

---

#### 2.3 Memory Management UI
**Status**: Not implemented  
**Priority**: P2

**Features to Implement**:
- View memories list
- Create new memory
- Search memories
- Delete memories
- Show memory tags and metadata
- Access via `/memory` command or keyboard shortcut

**Implementation Approach**:
- Create `MemoryPanel` component
- Integrate with memory API
- Display in modal format

**Files to Create/Modify**:
- `packages/cli/src/cli/ink-cli/components/MemoryPanel.tsx`
- `packages/cli/src/cli/ink-cli/components/CreateMemoryModal.tsx`

---

#### 2.4 Enhanced Message Display
**Status**: Basic implementation exists  
**Priority**: P2

**Features to Implement**:
- Better formatting for code blocks
- Syntax highlighting (if possible in terminal)
- Collapsible long messages
- Copy message content
- Show timestamps (optional, toggleable)
- Better tool call visualization
- Inline tool approval cards (if possible)

**Implementation Approach**:
- Enhance message rendering in `InkCLI` component
- Use Ink's `Box` and `Text` for better layout
- Consider using libraries like `chalk` for colors

---

### Phase 3: Advanced Features (Lower Priority)

#### 3.1 MCP Server Management UI
**Status**: Basic `/mcp` commands exist  
**Priority**: P2

**Features to Implement**:
- List connected servers
- Connect/disconnect servers
- View server tools
- Server status indicators
- Access via `/mcp` command or panel

**Implementation Approach**:
- Create `ServersPanel` component
- Integrate with MCP management API

---

#### 3.2 Settings/Configuration UI
**Status**: Basic `/config` command exists  
**Priority**: P3

**Features to Implement**:
- Settings modal/panel
- View current configuration
- Edit settings (where applicable)
- Export configuration
- Access via `/settings` or keyboard shortcut

---

#### 3.3 Global Search
**Status**: Basic `/search` command exists  
**Priority**: P3

**Features to Implement**:
- Search modal
- Search across all sessions
- Filter by role (user/assistant)
- Display search results
- Navigate to results

---

#### 3.4 Quick Actions / Starter Prompts
**Status**: Not implemented  
**Priority**: P3

**Features to Implement**:
- Show quick action buttons/suggestions
- Starter prompts integration
- Access on welcome screen or empty state

---

## Implementation Strategy

### Component Architecture
```
ink-cli/
├── components/
│   ├── SlashCommandAutocomplete.tsx  (Phase 1.1)
│   ├── ResourceAutocomplete.tsx       (Phase 1.2)
│   ├── ModelPicker.tsx               (Phase 2.1)
│   ├── SessionPanel.tsx               (Phase 2.2)
│   ├── MemoryPanel.tsx                (Phase 2.3)
│   ├── ServersPanel.tsx               (Phase 3.1)
│   └── SettingsModal.tsx               (Phase 3.2)
├── hooks/
│   ├── usePrompts.ts                  (Reuse from core or create)
│   ├── useResources.ts                (Reuse from core or create)
│   └── useSessions.ts                 (Reuse from core or create)
└── ink-cli.tsx                        (Main component)
```

### Key Design Decisions

1. **Modal vs Inline**: Use Ink modals for complex panels (sessions, memory, settings), inline dropdowns for autocomplete
2. **Keyboard Shortcuts**: Implement common shortcuts (Ctrl+M for model, Ctrl+S for sessions, etc.)
3. **State Management**: Use React hooks and context for shared state
4. **API Access**: Access features through DextoAgent instance (same as WebUI)
5. **Styling**: Use Ink's built-in components with chalk for colors

### Technical Considerations

1. **Performance**: Limit message history display (already implemented - last 50)
2. **Terminal Compatibility**: Ensure works across different terminal emulators
3. **Accessibility**: Support keyboard-only navigation
4. **Error Handling**: Graceful degradation if features unavailable

## Success Metrics

- [ ] Slash command autocomplete works smoothly with keyboard navigation
- [ ] Resource autocomplete (@ mentions) functional
- [ ] Model switching via UI (not just command)
- [ ] Session management via UI
- [ ] All existing CLI commands still work
- [ ] Performance is acceptable (no lag on typing)
- [ ] Works in common terminals (iTerm2, Terminal.app, Windows Terminal)

## Next Steps

1. **Start with Phase 1.1** - Slash Command Autocomplete (highest impact)
2. **Then Phase 1.2** - Resource Autocomplete
3. **Then Phase 2.1 & 2.2** - Model and Session UIs
4. **Iterate based on feedback**

## Open Questions

1. Should we support file attachments in CLI? (Probably not - terminal limitation)
2. Should we support audio recording? (Probably not - terminal limitation)
3. How to handle very long messages? (Collapsible sections?)
4. Should we support themes/colors customization? (Maybe via config)

## Notes

- Focus on features that make sense in a terminal context
- Prioritize keyboard-driven interactions
- Keep it simple and fast - terminal users value speed
- Don't try to replicate everything from WebUI - adapt for terminal constraints


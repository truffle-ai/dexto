---
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

feat: Redesign agent registry system with improved agent switching

- **@dexto/core**: Enhanced agent registry with better ID-based resolution, improved error handling, and normalized registry entries
- **dexto**: Added agent switching capabilities via API with proper state management
- **@dexto/webui**: Updated agent selector UI with better UX for switching between agents

Breaking changes:
- Agent resolution now uses `agentId` instead of `agentName` throughout the system
- Registry entries now require explicit `id` field matching the registry key

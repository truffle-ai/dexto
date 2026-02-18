---
'@dexto/agent-management': patch
'dexto': patch
---

- Add a `/sounds` overlay to preview and select notification sounds (startup/approval/completion), including custom files from `~/.dexto/sounds/`.
- Play an optional startup sound when the interactive CLI launches.
- Add preferences to select per-event sound files via paths relative to `~/.dexto/sounds` (`sounds.*SoundFile`).

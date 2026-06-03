---
'@dexto/core': patch
---

Upgrade MiniMax provider with M3 model (default) and clean up older models.

- Add `MiniMax-M3` as the new default model (512K context window, 128K max output, image input support)
- Keep `MiniMax-M2.7` and `MiniMax-M2.7-highspeed` as alternatives
- Remove older models (`MiniMax-M2.5`, `MiniMax-M2.5-highspeed`, `MiniMax-M2.1`, `MiniMax-M2`)
- Fix API base URL from `api.minimax.chat` to `api.minimax.io`
- Update Dexto Nova gateway model from `minimax/minimax-m2.7` to `minimax/minimax-m3`
- Update curated model list and documentation

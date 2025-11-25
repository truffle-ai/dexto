---
"dexto": patch
---

Fix cursor navigation in CLI input. Users can now use left/right arrow keys, Home/End keys to navigate within the input text. Fixed by replacing CustomInput with CustomTextInput which uses ink-text-input with built-in cursor support.

---
'@dexto/core': patch
---

Context stats, the turn-ending tool check, compaction marks and streaming into a reply the manager did not start no longer load the whole chat. `getContextStats` takes `hasSummary` from the model history load its estimate already does. The other paths read only the messages they need through two new optional `ConversationStore` methods, `getMessagesById` and `getToolResultsByCallId`; a store without them falls back to `listMessages` as before.

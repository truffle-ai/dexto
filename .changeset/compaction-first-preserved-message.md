---
'@dexto/core': patch
---

A compaction summary now records `firstPreservedMessageId`, the id of the first message it keeps, and `filterCompacted()` cuts the history at that message, dropping any earlier summary in between. A summary's `originalMessageCount` indexes its compaction's input, which is the full history for a manual compaction (`DextoAgent.compactContext`) and the model history, starting at the previous summary, for an overflow one. So an overflow re-compaction used to keep messages it had already summarized. Summaries without the id, including every summary written before this release, keep the count reading. `originalMessageCount` is still written for readers that haven't upgraded.

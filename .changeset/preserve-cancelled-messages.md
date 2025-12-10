---
'dexto': patch
---

Preserve cancelled messages in chat history instead of removing them

When users cancel a streaming response (Ctrl+C or Escape), the partial message is now kept in the chat history with a [Cancelled] indicator, allowing users to reference the partial content that was generated before cancellation.

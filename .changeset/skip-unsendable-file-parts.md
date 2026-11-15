---
'@dexto/core': patch
---

Stop runs from failing when an attachment is a file type the provider's SDK cannot send

**Upgrade note: attachments the provider cannot receive now reach the model as a short text note instead of failing the run.** The model registry lists "document" support for models such as OpenAI's, but the provider SDKs only send some types (OpenAI sends images and PDFs; Anthropic images and PDFs; Groq, xAI and OpenAI-compatible endpoints images). A `.docx`, `.xlsx` or `.pptx` attached to such a model used to throw `AI_UnsupportedFunctionalityError` before any request was made, which failed the whole run. Core now checks each file part against what the provider SDK actually sends. Text-like files are still inlined as text. Any other unsupported file is replaced by a note naming the file and its type, so the model can read it with tools or tell the user. Supported types (images, PDFs and so on) are sent exactly as before. No configuration change is needed.

---
'@dexto/core': patch
---

Replace an image of a type the provider cannot view (such as HEIC sent to Anthropic, OpenAI or a gateway) with a text note instead of sending it. Core used to log `Could not validate image support` and send the image anyway, which made the provider fail or stop with no reply. The note names the image type, so the model can tell the user. Google and Vertex still receive HEIC and HEIF, which Gemini reads, and endpoints you configure yourself (openai-compatible, LiteLLM, Ollama, local) still receive any image type, as before.

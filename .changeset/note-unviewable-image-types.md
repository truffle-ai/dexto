---
'@dexto/core': patch
---

Replace an image of a type no model can view (such as HEIC) with a text note instead of sending it to the provider. Core used to log `Could not validate image support` and send the image anyway, which made the provider fail or stop with no reply. The note names the image type, so the model can tell the user. Images whose support could not be checked for an unknown model are still sent as before.

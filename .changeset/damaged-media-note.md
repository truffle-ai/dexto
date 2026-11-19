---
'@dexto/core': patch
---

When a model provider refuses a file or image because it is damaged (corrupted, badly formatted, could not be read), the note that replaces it now says the file looks damaged and that sending it again will not help, instead of "withheld". A model told only "withheld" asked the person to re-upload the same broken file (DEXTO-3266).

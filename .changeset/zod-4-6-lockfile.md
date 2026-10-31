---
'dexto': patch
'@dexto/core': patch
'@dexto/server': patch
---

Build, test and ship the Docker image and standalone binaries with `zod` 4.6.7 and `follow-redirects` 1.16.2 instead of `zod` 4.3.6 and `follow-redirects` 1.16.1, which have published advisories. The declared `zod` range is unchanged, so installs from npm already resolved a patched `zod`; this makes the repository's tests and bundled artifacts match what users get. The cancel-task route now declares its path parameter with `unknown().transform().pipe()` because `z.preprocess` no longer type-checks there.

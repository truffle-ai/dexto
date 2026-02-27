---
'dexto': patch
'@dexto/image-local': patch
'@dexto/image-logger-agent': patch
---

- Add a GitHub Actions workflow to build and upload standalone CLI binaries to existing `dexto@*` releases.
- Add `scripts/build-standalone-binaries.sh` to compile multi-platform Bun executables, package runtime `dist/` assets, and generate SHA-256 checksums.
- Improve standalone binary runtime bootstrapping by auto-setting `DEXTO_PACKAGE_ROOT` from the executable directory and extending WebUI asset resolution fallback paths.

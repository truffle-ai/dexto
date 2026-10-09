## Why

The OSS CLI can log in but cannot progressively discover Cloud capabilities. Users and agents need a small machine-readable path from available sources to search results and input schemas.

## What Changes

- Add an isolated `@dexto/client-sdk/cloud` discovery client for existing Cloud sources, search, and describe routes.
- Add `dexto cloud sources`, `search`, and `describe` with JSON output and server pagination.
- Reuse existing device/API-key credentials and validate response contracts at the OSS boundary.
- Exclude invocation, OAuth changes, credential-context endpoints, and Cloud repository changes.

## Capabilities

### New Capabilities

- `cloud-cli-discovery`: Authenticated progressive Cloud capability discovery from the OSS CLI and SDK.

### Modified Capabilities

None.

## Impact

Additive CLI and client-sdk exports; existing local server client and Core behavior remain unchanged. Cloud continues owning authorization, capability ranking, schemas, and availability. Cloud source is read-only evidence; its private source-export capabilities client cannot be distributed through OSS today.

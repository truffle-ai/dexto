---
sidebar_position: 3
---

# Multimodal Resource Model

This document proposes a cleaner resource model for multimodal inputs in Dexto.

The goal is to make local files, uploaded artifacts, generated assets, and other resources behave consistently across:

- LLM prompt construction
- WebUI rendering
- conversation history persistence
- tool calls and follow-up references

## Goals

We want the resource system to support the following:

- consume multimodal data from local files, blobs, and other resource backends
- let the LLM process media directly when the current model supports it
- preserve a text-based reference that the LLM can mention again in later turns
- allow UI consumers to render media without forcing the LLM to repeatedly ingest it
- avoid copying local filesystem media into blob storage unless there is a real need
- keep tool contracts simple rather than forcing every tool to resolve multiple identifier types

## Current Friction

Today the system mixes three different concerns:

1. identity
2. prompt transport
3. UI rendering

That leads to a few problems:

- `@fs://...` and `@blob:...` references are sometimes expanded directly into prompt content
- media can be rehydrated into the LLM across multiple turns even when the UI is the only consumer that still needs it
- history persistence is closer to provider transport shapes (`image` / `file`) than to stable resource identity
- local media can end up duplicated into blob storage even when the file already exists on disk and is addressable by path

## Design Principles

The resource system should follow these rules:

1. **Persist identity, not transport**
   Conversation history should store stable references to resources, not large provider-specific payloads.

2. **Project late**
   Convert resources into model-specific multimodal parts only when building a prompt for a specific turn.

3. **Keep UI hydration separate from prompt hydration**
   The WebUI should be able to render resources from persisted refs without forcing the LLM path to ingest the same media again.

4. **Use the simplest canonical reference**
   Local files should keep filesystem identity. Opaque assets should keep blob or artifact identity.

5. **Keep tools narrow**
   Tools should continue to accept the identifiers natural to their domain. Central runtime code should do any necessary resolution.

## Proposed Model

The canonical stored representation should be a first-class `resource` content part.

```ts
type ResourcePart = {
  type: 'resource';
  uri: string;
  name: string;
  mimeType: string;
  kind: 'text' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';
  size?: number;
  metadata?: {
    originalPath?: string;
    mtimeMs?: number;
    source?: 'filesystem' | 'upload' | 'generated' | 'tool' | 'remote';
  };
};
```

This part represents **what the asset is**, not how it will be sent to a provider.

## Canonical Identity Rules

### Local filesystem assets

Local files should keep their native identity:

- absolute path on disk

These should not be copied into blob storage just to make them renderable or prompt-compatible.
For now, the path itself should be the canonical reference for local media.

### Uploaded or generated assets

Assets without a stable local path should keep an opaque resource identity:

- `blob:...`
- future artifact URIs like `artifact:...`

These can optionally expose a friendly display name to the LLM, but the canonical key remains the URI.

## Projection Layers

The key change is to treat multimodal content as a projection from `ResourcePart`, not as the persisted history format.

### 1. Storage projection

Persist the `ResourcePart` in session history.

This keeps history compact and stable, and avoids repeated base64 persistence.

### 2. UI projection

When the WebUI loads conversation history, it should:

- inspect `resource` parts
- fetch the underlying resource using its `uri`
- render image/audio/video/file views as appropriate

This should remain independent from model capability checks.

### 3. Prompt projection

When building the prompt for the next LLM call, the runtime should inspect each `resource` part and decide one of the following:

- inline text content for text resources
- emit an `image` part for supported images
- emit a `file` part for supported audio, video, PDF, or other supported binary files
- emit a metadata placeholder for unsupported or dropped media

This is where model support, size limits, and retention policy should apply.

## Text Anchors for Follow-up Turns

The LLM should still receive a small textual anchor next to any projected media so it can refer to the asset later.

Examples:

```txt
Attached file: /Users/shaun/project/demo.mp4
Attached file: blob:abc123 (meeting-recording.mp3)
Attached image: /Users/shaun/project/diagram.png
```

For local files, keep the real path visible.

For opaque assets, keep the real URI visible and optionally include a friendlier display name.

This avoids inventing alias-only identifiers that every tool would need to learn how to resolve.

## Tool Contract Rules

Tools should not all be upgraded to accept every possible resource identifier.

Instead:

- filesystem tools continue to accept absolute paths
- blob or artifact-aware tools accept blob or artifact URIs
- runtime-level adapter code may resolve `resource` parts into the tool-specific argument shape when needed

This keeps tool contracts stable and prevents identifier-resolution logic from spreading across the entire tool surface.

## Retention and Cost Control

The expensive part is not storing the resource reference. The expensive part is re-projecting large media into the prompt over and over.

The prompt builder should apply a retention policy such as:

- newest media-bearing messages may be projected as true multimodal content
- older media-bearing messages should be demoted to metadata placeholders
- text resources can still be expanded normally
- resources can be explicitly re-referenced by the user to bring them back into the active multimodal window

This keeps the UI fully rehydratable while keeping LLM context spend under control.

## Metadata Enrichment

Prompt placeholders become more useful if resource metadata is available cheaply.

Useful metadata includes:

- filename
- mime type
- size
- image dimensions
- audio or video duration
- PDF page count
- filesystem modification time

This metadata should be stored on the `resource` part or fetched lazily and cached near the resource layer.

## Recommended End State

The ideal architecture is:

- `resource` part is the canonical persisted identity
- `image` and `file` parts are transient prompt projections
- WebUI consumes resource refs directly
- prompt construction decides whether to inline, attach, or placeholder the resource
- local filesystem media stays path-based rather than being duplicated into blob storage

## Migration Plan

### Phase 1: Formalize resource identity

- add a first-class `resource` content part in `packages/core`
- define `kind`, `mimeType`, `name`, `size`, and optional metadata fields
- keep existing `image` and `file` content parts working during transition

### Phase 2: Normalize reference parsing

- change `@resource` parsing to resolve into `resource` parts rather than directly into prompt payloads
- preserve text anchors in the expanded prompt text

### Phase 3: Separate projections

- move all multimodal expansion logic into the prompt-building layer
- keep WebUI resource hydration independent of the prompt path

### Phase 4: Stop unnecessary blob duplication

- when reading local files through filesystem tooling, create `resource` parts pointing at the absolute path
- only copy into blob storage for uploads, generated artifacts, remote downloads, or when persistence outside the original path is required

### Phase 5: Centralize tool argument adaptation

- add a small runtime adapter for turning `resource` parts into tool arguments where needed
- avoid pushing identifier-resolution requirements into every tool implementation

## Open Questions

These decisions still need to be made when implementing the model fully:

- how aggressively should path-based local references be normalized across platforms
- where should resource metadata be cached
- how should mutated local files be detected across turns
- whether tool results should be allowed to persist `resource` parts directly
- whether resource references should participate in compaction differently from normal text content

## Recommendation

The best path forward is:

- treat resource identity as first-class
- keep local files as local references
- keep opaque uploads and generated assets as blob or artifact references
- separate prompt projection from UI hydration
- attach multimodal content only when the current model can use it and only while it remains inside the active retention window

This keeps the system simpler, cheaper, and less brittle than storing transport payloads in history or forcing all tools to understand alias-based identifiers.

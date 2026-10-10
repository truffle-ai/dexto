# Design

## Context

See proposal.md for motivation. Descriptor identity already carries literal connection and upstream tool names. Existing agent calls deliberately transform tool errors and carry execution context; the standalone protocol boundary needs different result semantics.

## Goals / Non-Goals

Expose one additive request using existing identities and SDK clients. Do not add alias resolution, client construction, agent policy, transport-specific execution, retry or connection scheduling.

## Decisions

- Capture the registered client and name-owned saved restart configuration timeout before awaiting. Desired configuration metadata is not actual runtime configuration. Externally registered clients without saved configuration retain the SDK request default.
- Call the existing SDK helper, then parse its full result at the typed boundary. This retains task/output-schema checks and protocol extension fields without unsafe casts.
- Reject names with observed connection/restart work before calling a partially initialized client. In-flight disconnect or replacement fails through the captured client rather than rerouting.
- Forward an optional caller AbortSignal. Preserve legacy agent execution APIs, timeout defaults, error conversion and invocation context.

## Risks / Trade-offs

- Caller-owned authorization → document that direct calls do not install agent execution policy.
- Upstream cancellation can be best effort → prove notification and continued client usability, without promising tool side-effect rollback.
- Existing legacy lifecycle races remain → scope initialization guard to observed operations and retain current scheduling.

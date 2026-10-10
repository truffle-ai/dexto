# Design

## Context

The existing one-shot operation owns a Core manager and silent logger in one try/finally. Default process signal termination bypasses finally and can orphan a stdio child. Core publishes candidate clients only after handshake; disconnectAll cannot close a candidate still awaiting startup.

## Goals / Non-Goals

**Goals:** preserve the first SIGINT/SIGTERM, cancel active requests, finish one cleanup path, return clear machine output and remove listeners.

**Non-Goals:** Core signal ownership, new connection cancellation APIs, task duration caps, policy changes, server rollback, hosted repository edits or forced-kill cleanup promises.

## Decisions

Install process listeners inside the one-shot owner before awaiting startup. Each listener records the first signal and aborts its AbortController; it does not start cleanup. Await the original startup promise, then skip operation dispatch if already interrupted. Pass the signal through Core callToolDirect and SDK readResource/getPrompt. Keep cleanup in the existing finally, sequentially disconnecting and destroying the logger, then removing listeners. Interruption replaces the operation outcome after cleanup, including a signal received during cleanup.

Keep the existing alias descriptor and input validation before direct tool execution. The portable Core API owns literal execution and request cancellation, while the CLI owns process signals. Existing generic graceful shutdown logs globally and exits zero, so it cannot be reused unchanged for the one-shot JSON/exit contract.

## Risks / Trade-offs

SDK connect/discovery currently do not accept CLI cancellation or apply the configured operation timeout. Interruption can wait their existing request deadlines, currently the SDK's default 60 seconds per pending handshake/discovery request. Repeated signals keep graceful ownership; operators can forcibly terminate separately, forfeiting cleanup. Remote cancellation is advisory and cannot undo side effects. POSIX signal process regressions are skipped on Windows, whose external termination semantics differ; in-process ownership tests remain portable.

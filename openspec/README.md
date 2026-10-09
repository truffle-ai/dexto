# OSS Revamp Slices

The OSS revamp is tracked in [DOS-108](https://linear.app/truffleai/issue/DOS-108). Each release has its own change and pull request.

| Slice | Tracking                                              | Outcome                                                    |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------- |
| 1     | [DOS-109](https://linear.app/truffleai/issue/DOS-109) | Versioned JSON and JSONL task output                       |
| 2     | [DOS-110](https://linear.app/truffleai/issue/DOS-110) | Familiar session-scoped approvals and permission controls  |
| 3     | [DOS-111](https://linear.app/truffleai/issue/DOS-111) | Shared host composition and lifecycle, Cloud compatibility |
| 4     | [DOS-112](https://linear.app/truffleai/issue/DOS-112) | Simple quick-task TUI and Core capability parity           |
| 5     | [DOS-113](https://linear.app/truffleai/issue/DOS-113) | Public Cloud client, scoped login, discovery, invocation   |
| 6     | [DOS-114](https://linear.app/truffleai/issue/DOS-114) | Deployable agent server and minimal distributions          |

Recover the unpushed August runtime work selectively against current upstream. Keep Core portable and hosted policy in Cloud. Do not combine the old aggregate runtime diff into one release.

`changes/` contains scoped proposals, designs, behavioral specs, and test-first task lists. The repository does not pin the OpenSpec CLI; tooling adoption is separate. The first slice uses the existing development tooling and changeset release process.

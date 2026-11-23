## 1. Permission timeout

- [x] 1.1 Withdraw an unanswered permission request after `permissions.timeout` and answer it as timed out.
- [x] 1.2 Withdraw an open permission request when its turn is cancelled.
- [x] 1.3 Share the withdraw logic between forms and permissions.
- [x] 1.4 Integration test: an unanswered permission with `permissions.timeout: 300` is withdrawn, the tool fails as timed out without running, and the turn ends `end_turn`.
- [x] 1.5 Integration test: a turn cancelled while its permission request is unanswered withdraws the request.

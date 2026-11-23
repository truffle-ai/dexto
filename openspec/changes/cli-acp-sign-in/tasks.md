## 1. Sign-in

- [x] 1.1 Offer **Sign in to Dexto** as a terminal auth method to clients that declare `auth.terminal` or `_meta["terminal-auth"]`.
- [x] 1.2 Add `dexto acp login`, identical to `dexto login`, and its CLI audit row.

## 2. Tests and docs

- [x] 2.1 Integration tests: the method is offered for either marker and not otherwise; `dexto acp login` and `dexto login` give the same output and exit code.
- [x] 2.2 Mention the sign-in in the ACP guide.

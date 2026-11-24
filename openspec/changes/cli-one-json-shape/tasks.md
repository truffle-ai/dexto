## 1. List envelope and pagination

- [x] 1.1 Test and make `Output.list` print `{data, has_more, next_after}` for every page, with sibling facts and without `next_cursor`.
- [x] 1.2 Print every list command through `Output.list`: loops, apps, applications, chat agents/computers/browser profiles, site records, docs search, cloud search, connections, import, share received.
- [x] 1.3 Print `profile get` and `profile set` as the profile itself.

## 2. Key case

- [x] 2.1 Test and add `jsonKeys`, which converts printed keys to snake_case and leaves data fields' keys as they are.
- [x] 2.2 Use it in `Output` and in every writer that prints JSON itself (connections, chat follow and credits streams).
- [x] 2.3 Update help `json_output` shapes and the tests that asserted camelCase output.

## 3. Exit codes

- [ ] 3.1 Test and add `uuidArgument`; check chat, run and Project ids with it before any call.
- [ ] 3.2 Map a tool result's invalid-input error to `invalid_input`, and an unknown `cloud models get` model to `not_found`.

## 4. Contract test and release

- [ ] 4.1 Add `json-contract.test.ts`: every list command against a fake camelCase server, checking the envelope and key case, and failing on an uncovered `list` command.
- [ ] 4.2 Add a major `dexto` changeset listing every renamed key and changed shape.
- [ ] 4.3 Run the cloud CLI tests, typecheck, lint, build and the CLI audit.

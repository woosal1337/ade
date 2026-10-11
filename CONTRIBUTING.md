# Contributing to ade

Read [the development guide](docs/development.md) before the first change.
Use the package manager and lockfile recorded in [PROJECT.json](PROJECT.json).
Keep one editable owner for each production file.

## Change procedure

1. Read the task and record its plan.
2. Make the smallest change that meets its acceptance criteria.
3. Run the quality gates and relevant product checks.
4. Record the result and remaining work on the task.
5. Commit or push only within the current authorization.

Use imperative commit titles. Keep each authorized commit focused.
Do not reformat untouched code or stage unrelated work.
Use `ege@chele.bi` for the author and committer emails.

## Code rules

Use strict TypeScript with erasable syntax only. Node.js runs the source files directly in tests.
Validate untrusted input with the zod schemas in `src/profile/schema.ts`.
Use `AdeError` for expected failures. Give each error a code, a message, and a hint.
Export public SDK names only from `src/index.ts`. Keep them stable.
Run external commands with an argument array. Never use a shell.

Keep prose explanations in docs. Do not add prose comments inside authored code or configuration files.
Read [the source policy](docs/quality.md) for generated files and required directives.
Add tests for meaningful behavior. Do not add tests that only repeat the implementation.
Do not add a dependency without a concrete need.

## Review evidence

State the problem and resulting behavior first.
Record the commands that passed and any checks that remain pending.
Keep CI, provider delivery, and live acceptance distinct from local success.

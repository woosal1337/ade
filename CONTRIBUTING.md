# Contributing to ade

Read [the development guide](docs/development.md) before the first change.
Run `npm ci` to install the tools from the lockfile.

## Change procedure

1. Open an issue before a large change, so that the approach is clear before the work.
2. Make the smallest change that meets the goal.
3. Run `python3 tools/quality.py check`. It runs the same gates as CI.
4. Open a pull request. State the problem, the result, and the checks that passed.

Use imperative commit titles. Keep each commit focused.
Do not reformat untouched code or stage unrelated work.
Use your own Git name and email for each commit.

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

## Security

Do not report a security problem in a public issue. Read [SECURITY.md](SECURITY.md).
A change to the trust gate, the secret handling, or the path checks needs a regression test. Read [the security model](docs/security.md).

## Review evidence

State the problem and the result first.
Record the commands that passed and any checks that remain open.
Keep CI results apart from local results.

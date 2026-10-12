# ade agent guidance

Read `README.md`, `PROJECT.json`, `docs/architecture.md`, and `docs/quality.md` before a change.
This file owns repository guidance. Edit this file when a client needs the same rule.
`CLAUDE.md` imports this file. Keep client bridges free of duplicate rules.

## Product contract

ade manages an agent development environment (ADE) from one profile directory. A profile declares MCP servers, skills, global instructions, harness settings, extra config files, and secret references. The CLI and the TypeScript SDK use one engine.

Acceptance criteria:

1. `ade capture` writes the current machine setup into a profile. It never copies a secret value. It writes a `${secret:NAME}` reference instead.
2. `ade plan` shows every change before a write. A second plan after `ade apply` shows no changes.
3. `ade apply` writes only the entries that the profile owns. It keeps every other key, file, and link.
4. Each apply keeps a backup. `ade revert` restores the entries of one apply.
5. `ade status` reports drift: a managed entry that changed outside ade.
6. The SDK gives the same operations with typed results.

## Architecture

Keep each harness format inside its adapter in `src/harness/`. The engine does not know the file format of a harness.
Keep `plan` free of writes. Only `apply` and `revert` write to a target home.
Read target paths through the context. Only `src/core/context.ts` reads the real home directory.
Write files only through the helpers in `src/core/fsx.ts`. Record a backup before each write.
Never write a resolved secret into a profile, the state file, or command output.

Keep the selected framework's file conventions. Read `research/stack.md` before a dependency or framework change.
Use names, small functions, types, and documents to explain the code.
Do not add inline or block prose comments to authored source, tests, or configuration files.
Keep required tool directives and generated files in the explicit exception list in `docs/quality.md`.
Do not use an exception to hide authored comments.

## Work and records

Record a real decision in `docs/decisions/`. Keep heavy data outside Git.
The maintainer tracks tasks outside this repository.

## Checks and delivery

Run `python3 tools/quality.py check` before completing a change.
Run the relevant integration, build, or device checks from `docs/quality.md`.
Run `python3 tools/quality.py hooks-install` after each clone.
Keep the local gates and CI commands equal.
Commit and push only when the current request authorizes them.
Commit with the Git name and email of the person who asked for the change.
Report local checks, CI results, commits, pushes, and deployments as separate facts.

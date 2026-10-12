# 0001: Project foundation

Date: 2026-10-11

Status: Accepted for the initial foundation.

## Context

Developers configure each coding agent by hand. MCP servers, skills, instructions, and settings drift between agents and between machines. A survey of agent setup sync tools on 2026-10-10 found no tool that also manages harness settings, extension packages, and machine moves, with an SDK.

## Decision

Build ade as one TypeScript package with a CLI and an SDK on one engine.

1. A profile directory is the source of truth. It holds plain JSON and files, so Git can version and share it.
2. ade owns items, not whole files. It changes only the keys, servers, and paths that the profile declares.
3. Every write follows a plan, keeps a backup, and updates a state file with content hashes.
4. A shared store in `~/.agents` holds skill and instruction copies. Harness entries link to it.
5. Secrets stay outside the profile as references.

The stack: Node.js and TypeScript, npm, zod for the schema, smol-toml for TOML, Biome, and the Node.js test runner.

## Alternatives

- Extend `stack`. Its design is read-only, and its notes keep it that way.
- Use `getsentry/dotagents`. It does not manage harness settings, extension packages, or secrets.
- Use `spxrogers/agentsync`. It is a Go binary with no SDK, and its Pi support is shallow.
- Use Bun as the toolchain. Pi and other harnesses run on Node.js, so npm and Node.js give the widest SDK use.

## Consequences

- Each harness needs an adapter and fixture tests. A format change in a harness needs an adapter update.
- TOML writes remove comments. The plan warns before such a write.
- The state directory holds backups that can contain secrets. It uses mode 0700.
- TypeScript 7 has no stable parser API, so the comment check pins the TypeScript 6.0.3 API separately.

## Evidence

Read [the stack research](../../research/stack.md) for the dated sources and version compatibility.

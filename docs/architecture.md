# ade architecture

ade reads a profile, builds the desired state for each harness, and compares it with the target home and the last applied state. The result is a plan. Apply executes the plan with backups, then records the new state. The CLI and the SDK call the same engine.

## Modules and boundaries

| Module | Responsibility |
|---|---|
| `src/core/context.ts` | The target home, environment, platform, state directory, and cache directory. The only reader of the real home |
| `src/core/doc.ts`, `merge.ts` | JSON and TOML documents, key paths, and JSON merge patches |
| `src/core/fsx.ts` | Path inspection, tree hashes, atomic writes, links, copies, and path guards |
| `src/profile/` | The zod schema, validation, load and save, pure edit functions, and bundles |
| `src/profile/spec.ts`, `source.ts` | Source parsing, Git source fetch, and the default source |
| `src/profile/risk.ts`, `trust.ts` | The risk summary and the trust store |
| `src/profile/pack.ts` | The bundle build for remote, pack, and share, and the token scan |
| `src/profile/markdown.ts` | The ADE.md writer and parser |
| `src/secrets/` | `${secret:NAME}` and `${home}` references, secret providers, and masks |
| `src/harness/adapters.ts` | One adapter for each harness: paths, MCP format, settings file, asset rules, inventory rules, and plugin support |
| `src/harness/plugins.ts` | Plugin lists and commands for Claude Code, Codex, Grok, Gemini CLI, Cursor IDE, and Zed |
| `src/harness/paths.ts` | App folders for macOS, Windows, and Linux |
| `src/skills/` | Path, Git, and link skill sources, and the Git cache |
| `src/engine/desired.ts` | The desired entries for the active harnesses |
| `src/engine/external.ts` | Plugin probes and commands, and `git apply` for patches |
| `src/engine/inventory.ts` | The file classifier for `ade inventory` and for extra files in capture |
| `src/engine/plan.ts` | The comparison of desired, current, and recorded state, with the steps for apply |
| `src/engine/journal.ts`, `apply.ts`, `history.ts` | Backups, atomic steps, rollback, apply records, and revert |
| `src/engine/capture.ts` | The machine-to-profile capture, with secret extraction and native overrides |
| `src/engine/status.ts`, `doctor.ts`, `update.ts` | Drift reports, checks, and Git skill locks |
| `src/remote/client.ts` | The profile shipment, the SSH transport, and the remote calls |
| `src/remote/agent.ts` | The remote entry point. The build bundles it into `dist/remote-agent.mjs` |
| `src/cli/` | Arguments, prompts, human output, and JSON envelopes |
| `src/index.ts` | The public SDK |

The engine does not know a harness file format. Each format stays in its adapter.

## Data flow

1. The CLI or the SDK loads and validates the profile.
2. The secret resolver reads each referenced secret from its provider.
3. The engine builds the desired entries for each active harness.
4. The engine reads the current target and the state. It classifies each entry as create, update, delete, in sync, or drift.
5. Apply checks the plan fingerprint, takes the state lock, writes the steps with backups, and updates the state.

Each entry has a stable key, for example `mcp:claude:elliptic`, `setting:pi:/defaultModel`, `skill:shared:review`, `instructions:codex`, `file:claude:hooks/check.sh`, `plugin:claude:tool@acme`, or `patch:pi:git/github.com/acme/tool`.

Apply runs the steps in this order: plugin commands, paths, documents, then patches. The harness commands run first, so a harness that changes its own files at start does not change the values that ade writes after it. Read [the ownership decision](decisions/0002-entry-ownership.md) for the rules.

## Storage

| Location | Content |
|---|---|
| The profile directory | `ade.json`, `ade.lock.json`, `ade.schema.json`, `AGENTS.md`, `skills/`, and `files/` |
| `~/.agents/` | The shared store: `AGENTS.md` and `skills/<name>` |
| The state directory | `state.json`, `trust.json`, `sources.json`, `settings.json`, the `lock` file, and `applies/<id>/` with `record.json` and backups |
| The cache directory | `git/` cache repositories and `trees/` with one checkout for each commit and subfolder |

The state directory is `$ADE_STATE_DIR`, or `$XDG_STATE_HOME/ade`, or `~/.local/state/ade`. On Windows it is `%LOCALAPPDATA%\ade\state`. The cache directory follows the same rules with `cache`. A custom `--home` puts both directories under that home.

## Runtime and deployment

ade runs on the machine that it configures, or it sends its engine to another machine over SSH. It has no server. The npm package `@woosal1337/ade` stays private until a release decision. Node.js 22 or later runs the built package from `dist/`.

## Decisions

Read [the foundation decision](decisions/0001-project-foundation.md), [the ownership decision](decisions/0002-entry-ownership.md), [the remote decision](decisions/0003-remote-agent.md), [the sources decision](decisions/0004-git-sources-and-trust.md), [the coverage decision](decisions/0005-full-coverage.md), [the ADE.md decision](decisions/0006-ade-md.md), and [the stack research](../research/stack.md).
Add a decision record when a choice changes a boundary or creates a lasting tradeoff.
Keep operational steps in [the runbook](runbook.md).

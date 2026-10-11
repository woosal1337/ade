# ade

Plan, apply, and revert one agent development environment (MCP servers, skills, instructions, settings, and config files) across Claude Code, Codex, Cursor, Grok, and Pi. CLI and TypeScript SDK.

Status: Version 0.1.0 in development. No release exists. This repository owns the production files.

| Record | Value |
|---|---|
| Repository | [woosal1337/ade](https://github.com/woosal1337/ade) |
| Website | Not published |
| Topics | agent-skills, ai-agents, claude-code, cli, codex, cursor, developer-tools, dotfiles, grok, mcp, pi-coding-agent, sdk, typescript |
| Task board | [Todo](https://elliptic.sh/app/019fde50-6654-7c03-81a5-2b4aa937b624) |
| Knowledge | projects/ade/README.md |
| Metadata | [PROJECT.json](PROJECT.json) |

## Use ade

1. Capture the current machine into a profile:

   ```bash
   ade capture --out ~/agent-profile
   ```

2. Compare the profile with a machine. Plan writes nothing:

   ```bash
   ade plan --profile ~/agent-profile
   ```

3. Make the machine match the profile. Each apply keeps a backup:

   ```bash
   ade apply --profile ~/agent-profile
   ```

4. Undo the last apply:

   ```bash
   ade revert
   ```

Put the profile directory in Git to share it, or move it with `ade export` and `ade import`. A profile holds secret references, never secret values.

## What ade manages

| Kind | Profile field | Harness files |
|---|---|---|
| MCP servers | `mcp` | `~/.claude.json`, `~/.codex/config.toml`, `~/.cursor/mcp.json`, `~/.grok/config.toml`, `~/.pi/agent/mcp.json` |
| Skills | `skills` | `~/.agents/skills/<name>`, with a link in `~/.claude/skills` |
| Global instructions | `instructions` | `~/.agents/AGENTS.md`, linked from each harness |
| Settings | `settings` | The main settings file of each harness, or another JSON or TOML file in its home |
| Extension packages and plugins | `settings` | For example the Pi `packages` list or the Claude Code `enabledPlugins` map |
| Other files | `files` | Any file in a harness home or the user home, with optional secret templates |
| Secrets | `secrets` | Values come from the environment, a file, a command, or the macOS Keychain |

ade owns entries, not whole files. It changes only the keys, servers, and paths that the profile declares. It records a content hash for each entry, so `ade status` can find changes made outside ade.

## Commands

| Command | Use |
|---|---|
| `ade init`, `ade capture` | Create a profile |
| `ade add`, `ade remove`, `ade set`, `ade unset`, `ade list` | Edit and read the profile |
| `ade update` | Lock the current commits of Git skills |
| `ade plan`, `ade apply`, `ade status` | Compare and apply |
| `ade revert`, `ade history` | Undo an apply, list the apply records |
| `ade doctor`, `ade harnesses` | Check the profile, the secrets, and the harness paths |
| `ade export`, `ade import`, `ade schema` | Share a profile, print the JSON Schema |

Every command takes `--json` for a stable machine-readable result. Read [the profile reference](docs/profile.md) for the file format and [the SDK guide](docs/sdk.md) for the TypeScript API.

## Start development

Read [the development guide](docs/development.md) for the exact tool versions and setup commands.

```bash
npm ci
python3 tools/quality.py hooks-install
python3 tools/quality.py check
node src/cli.ts --help
```

## Source map

| Path | Owner |
|---|---|
| `src/core/` | Context, errors, hashes, documents, and file operations |
| `src/profile/` | Profile schema, load and save, edits, and bundles |
| `src/secrets/` | Secret references and their providers |
| `src/harness/` | One adapter for each harness |
| `src/skills/` | Skill sources and the Git cache |
| `src/engine/` | Desired state, plan, apply, status, revert, capture, and doctor |
| `src/cli/` | Command parsing and output |
| `src/index.ts` | The public SDK |
| `test/` | Behavior tests in scratch home directories |
| `tools/` | The source comment check and the quality runner |
| `research/` | Dated sources |
| `docs/` | Architecture, profile reference, SDK guide, development, quality, runbook, and decisions |
| `log/` | Dated work notes |

Read [the architecture](docs/architecture.md) before adding a module.

## Project rules

Read [AGENTS.md](AGENTS.md) for agent guidance and [CONTRIBUTING.md](CONTRIBUTING.md) for development rules.
[Quality gates](docs/quality.md) define the checks for local hooks and continuous integration (CI).
[Stack research](research/stack.md) records the selected versions and their sources.
[The first decision](docs/decisions/0001-project-foundation.md) explains the foundation, and [the second decision](docs/decisions/0002-entry-ownership.md) explains the ownership model.
[The runbook](docs/runbook.md) gives operational commands.

## Delivery state

The private GitHub repository exists and has no commits. The local quality gates pass, and both Git hooks are installed in this clone. No commit, push, CI run, or npm release exists yet. The package stays private until a release decision.

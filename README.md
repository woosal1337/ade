# ade

Plan, apply, and revert one agent development environment (MCP servers, skills, instructions, settings, plugins, and config files) across 10 coding agents. CLI and TypeScript SDK.

Supported harnesses: Claude Code, Codex, Cursor (CLI and IDE), Grok, Pi, Gemini CLI, OpenCode, Zed, Claude Desktop, and Antigravity.

Status: Version 0.1.0 in development. No release exists. This repository owns the production files.

| Record | Value |
|---|---|
| Repository | [woosal1337/ade](https://github.com/woosal1337/ade) |
| Website | Not published |
| Topics | agent-skills, ai-agents, claude-code, cli, codex, cursor, developer-tools, dotfiles, grok, mcp, pi-coding-agent, sdk, typescript |
| Task board | [Todo](https://elliptic.sh/app/019fde50-6654-7c03-81a5-2b4aa937b624) |
| Knowledge | projects/ade/README.md |
| Metadata | [PROJECT.json](PROJECT.json) |

## Use a published profile

```bash
ade plan cobanov/agents
ade apply cobanov/agents
```

A source is a local folder, `owner/repo[/subfolder][@ref]` on GitHub, or a Git URL. ade asks you to trust a Git source before its first apply. Read [the sources guide](docs/sources.md) to use or publish a profile.

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

5. Apply the same profile to another machine over SSH:

   ```bash
   ade remote igris apply --profile ~/agent-profile
   ```

Put the profile directory in Git to share it, or move it with `ade export` and `ade import`. A profile holds secret references, never secret values. Read [the remote guide](docs/remote.md) for SSH targets.

## What ade manages

| Kind | Profile field | Examples |
|---|---|---|
| MCP servers | `mcp` | Each harness gets its own format, including local-scope Claude Code servers |
| Skills | `skills` | `~/.agents/skills/<name>`, with links where a harness needs them |
| Global instructions | `instructions` | `~/.agents/AGENTS.md`, linked from each harness |
| Settings | `settings` | Each key of each settings file, including Cursor IDE and Zed settings with comments |
| Subagents, commands, hooks, rules, themes | `files` | `~/.claude/agents/`, `~/.codex/prompts/`, `~/.grok/hooks/`, `~/.pi/agent/extensions/` |
| Plugins, extensions, marketplaces | `plugins` | Claude Code, Codex, Grok, Gemini CLI, Cursor IDE, and Zed |
| Pi packages | `settings`, `patches` | The `packages` list, and local changes to package code |
| Other files | `files` | Any file under a root, as a copy, a link, a template, or a seed |
| Secrets | `secrets` | Values come from the environment, a file, a command, or the macOS Keychain |

Read [the harness support list](docs/harnesses.md) for each file of each harness. `ade inventory` shows the files on your machine and their sync status. ade never syncs sign-ins, tokens, sessions, history, or caches.

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
| `ade inventory` | List each file of each harness, and show which files ade syncs |
| `ade remote <host> <command>` | Run plan, apply, status, doctor, revert, history, harnesses, or capture on another machine |
| `ade use`, `ade trust`, `ade pack` | Set the default source, trust a Git source, write a profile for publication |
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
| `src/remote/` | The SSH client, the protocol, and the remote agent |
| `src/cli/` | Command parsing and output |
| `src/index.ts` | The public SDK |
| `test/` | Behavior tests in scratch home directories |
| `tools/` | The source comment check, the quality runner, and the agent build |
| `research/` | Dated sources |
| `docs/` | Architecture, harness support, profile reference, sources guide, SDK guide, remote guide, development, quality, runbook, and decisions |
| `examples/starter/` | A small published profile |
| `log/` | Dated work notes |

Read [the architecture](docs/architecture.md) before adding a module.

## Project rules

Read [AGENTS.md](AGENTS.md) for agent guidance and [CONTRIBUTING.md](CONTRIBUTING.md) for development rules.
[Quality gates](docs/quality.md) define the checks for local hooks and continuous integration (CI).
[Stack research](research/stack.md) records the selected versions and their sources.
[The first decision](docs/decisions/0001-project-foundation.md) explains the foundation. [The second decision](docs/decisions/0002-entry-ownership.md) explains the ownership model. [The third decision](docs/decisions/0003-remote-agent.md) explains the remote agent. [The fourth decision](docs/decisions/0004-git-sources-and-trust.md) explains Git sources and trust. [The fifth decision](docs/decisions/0005-full-coverage.md) explains the coverage rules.
[The runbook](docs/runbook.md) gives operational commands.

## Delivery state

The private GitHub repository holds the code. CI runs the checks on Ubuntu, and the tests on macOS, Windows, and Node.js 22. No npm release exists. The package stays private until a release decision. To install it from Git:

```bash
npm install -g git+ssh://git@github.com/woosal1337/ade.git
```

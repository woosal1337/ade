# Harness support

ade supports 10 harnesses. Run `ade harnesses` to show their paths on a machine. Run `ade inventory` to show each file of each harness and its sync status.

## Claude Code

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.claude/CLAUDE.md` | Link or copy of the shared `AGENTS.md` |
| MCP servers | `mcpServers` in `~/.claude.json` | One entry for each server |
| Local-scope MCP servers | `projects.<path>.mcpServers` in `~/.claude.json` | The settings key `home:.claude.json` |
| Skills | `~/.claude/skills/<name>` | Link to `~/.agents/skills/<name>`, or a copy |
| Settings | `~/.claude/settings.json` | Each key, except `extraKnownMarketplaces` and `enabledPlugins` |
| Subagents, commands, output styles, hooks | `agents/`, `commands/`, `output-styles/`, `hooks/` | Files |
| Key bindings | `keybindings.json` | File |
| Plugins and marketplaces | `plugins/installed_plugins.json`, `plugins/known_marketplaces.json` | `claude plugin marketplace add` and `claude plugin install` |
| Never synced | `.credentials.json`, sessions, history, `projects/`, caches, `plugins/cache/` | Private or runtime |

## Codex

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.codex/AGENTS.md` | Link or copy |
| MCP servers | `[mcp_servers.<name>]` in `~/.codex/config.toml` | One entry for each server |
| Skills | Codex reads `~/.agents/skills` | The shared copy |
| Settings | `~/.codex/config.toml` | Each key, except `projects`, `notice`, `marketplaces`, and `plugins` |
| Prompts, rules, subagents, hooks | `prompts/`, `rules/`, `agents/`, `hooks.json` | Files, and `hooks.json` key by key |
| Plugins and marketplaces | `[marketplaces]` and `[plugins]` in `config.toml` | `codex plugin marketplace add` and `codex plugin add` |
| Never synced | `auth.json`, `installation_id`, the SQLite databases, sessions | Private or runtime |

## Cursor

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | User rules live in the Cursor account | Not synced, because no file exists |
| MCP servers | `mcpServers` in `~/.cursor/mcp.json` | One entry for each server |
| Skills | Cursor reads `~/.agents/skills` | The shared copy |
| CLI settings | `~/.cursor/cli-config.json` | Each key, except account caches |
| Hooks, subagents, commands, rules, local plugins | `hooks.json`, `hooks/`, `agents/`, `commands/`, `rules/`, `plugins/local/` | Files, and `hooks.json` key by key |
| IDE settings, key bindings, snippets | `Cursor/User/settings.json`, `keybindings.json`, `snippets/` | The root `cursor-user`. The settings file can hold comments |
| IDE extensions | `~/.cursor/extensions/extensions.json` | `cursor --install-extension <id>@<version>` |
| Never synced | `sdk/` (an API key), chats, projects, caches | Private or runtime |

## Grok

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.grok/AGENTS.md` | Link or copy |
| MCP servers | `[mcp_servers.<name>]` in `~/.grok/config.toml` | One entry for each server |
| Skills | Grok reads `~/.agents/skills` | The shared copy |
| Settings | `~/.grok/config.toml` | Each key, except `cli`, `privacy`, `marketplace`, and `plugins.enabled` |
| Hooks, subagents, commands, local plugins | `hooks/`, `agents/`, `commands/`, `plugins/` | Files |
| Installed plugins | `installed-plugins/` | `grok plugin install <name> --trust` |
| Never synced | `auth.json`, `agent_id`, `trusted_folders.toml`, memory, sessions | Private or runtime |

## Pi

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.pi/agent/AGENTS.md` | Link or copy |
| MCP servers | `mcpServers` in `~/.pi/agent/mcp.json` | One entry for each server |
| Skills | Pi reads `~/.agents/skills` | The shared copy |
| Settings and packages | `~/.pi/agent/settings.json` | Each key. Pi installs the `packages` list on its next start |
| Local extensions, prompts, themes, key bindings | `extensions/`, `prompts/`, `themes/`, `keybindings.json` | Files |
| Package configs | Any other folder, such as `pi-codex-subagents/`, and JSON files such as `claude-bridge.json` | Files, and JSON key by key |
| Model catalog | `models-store.json` | A seed file. ade writes it only when it does not exist |
| Local changes in Git packages | `git/<host>/<owner>/<repo>` | A patch. ade applies it after Pi installs the package |
| Never synced | `auth.json`, `mcp-auth.json`, `npm/`, `git/`, `install/`, sessions | Private or runtime |

## Gemini CLI

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.gemini/GEMINI.md` | Link or copy |
| MCP servers | `mcpServers` in `~/.gemini/settings.json`, with `httpUrl` | One entry for each server |
| Skills | Gemini CLI reads `~/.agents/skills` | The shared copy |
| Settings | `~/.gemini/settings.json` | Each key |
| Subagents, commands, policies | `agents/`, `commands/`, `policies/` | Files |
| Extensions | `~/.gemini/extensions/` | `gemini extensions install <source>` |
| Never synced | `oauth_creds.json`, `google_accounts.json`, MCP tokens, history | Private or runtime |

## OpenCode

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.config/opencode/AGENTS.md` | Link or copy |
| MCP servers | `mcp` in `~/.config/opencode/opencode.json`, with `local` and `remote` types | One entry for each server |
| Skills | OpenCode reads `~/.agents/skills` | The shared copy |
| Settings and npm plugins | `opencode.json`, including its `plugin` list | Each key |
| TUI settings, agents, commands, modes, plugins, tools, themes | `tui.json`, `agents/`, `commands/`, `modes/`, `plugins/`, `tools/`, `themes/` | Files, and `tui.json` key by key |

## Zed

| Item | Location | How ade syncs it |
|---|---|---|
| MCP servers | `context_servers` in the Zed `settings.json` | One entry for each server |
| Settings | The Zed `settings.json`, which can hold comments | Each key |
| Key map, tasks, snippets, themes | `keymap.json`, `tasks.json`, `snippets/`, `themes/` | Files |
| Extensions | The installed extensions folder | `auto_install_extensions` for each missing extension |

## Claude Desktop

| Item | Location | How ade syncs it |
|---|---|---|
| MCP servers | `mcpServers` in `claude_desktop_config.json` | Stdio servers only. ade skips HTTP servers with a warning |
| Settings | `claude_desktop_config.json` | Each key |
| Desktop extensions | `Claude Extensions/`, `Claude Extensions Settings/`, `extensions-installations.json` | Files |

## Antigravity

| Item | Location | How ade syncs it |
|---|---|---|
| Instructions | `~/.gemini/GEMINI.md`, shared with Gemini CLI | Link or copy, one time for both |
| MCP servers | `mcpServers` in `~/.gemini/config/mcp_config.json`, with `serverUrl` and `disabled` | One entry for each server |
| Skills | `~/.gemini/config/skills/<name>` | Link or copy |
| Settings | `~/.gemini/antigravity-cli/settings.json` | Each key, except `trustedWorkspaces` |
| Hooks and global workflows | `hooks.json`, `hooks/`, `global_workflows/` | Files, and `hooks.json` key by key |

## App folders

| App | macOS | Windows | Linux |
|---|---|---|---|
| Cursor IDE (`cursor-user`) | `~/Library/Application Support/Cursor/User` | `%APPDATA%\Cursor\User` | `~/.config/Cursor/User` |
| Claude Desktop | `~/Library/Application Support/Claude` | `%APPDATA%\Claude` | `~/.config/Claude` |
| Zed | `~/.config/zed` | `%APPDATA%\Zed` | `~/.config/zed` |

## Rules for all harnesses

- **Extra files.** `ade capture` takes each small text file that no rule covers in a harness home. `ade inventory` marks these files as `extra`. Capture skips a file with a credential name, such as `.env`, `*.pem`, or a name with `token`, `secret`, or `credential`. It also skips an extra file that holds a token or a secret assignment, and prints a warning.
- **Referenced files.** A setting that names a file under the home, such as a status line script, makes capture take that file.
- **Linked files.** A file that is a link keeps its link target in the profile and its content as a fallback. Apply makes the link when the target exists, and copies the content when it does not.
- **Plugin commands.** Apply runs the harness commands before it writes files. A revert runs the reverse commands. The harness program must be on the PATH.
- **Never synced.** Sign-ins, tokens, sessions, history, caches, logs, memory, and folders that hold only state files. `ade inventory --all` lists them as `private` or `runtime`.
- **Unknown folders.** `ade inventory` marks a folder without a rule as `unknown`. Add it with `ade add file <root>:<path>`.

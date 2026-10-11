# Profile reference

A profile is a directory. Its `ade.json` file declares the environment. The other files hold the instructions, skills, and file sources that `ade.json` names. Run `ade schema` to print the JSON Schema. `ade init` and `ade capture` also write it as `ade.schema.json`, so editors can check the file.

## Example

```json
{
  "$schema": "./ade.schema.json",
  "version": 1,
  "name": "team",
  "harnesses": ["claude", "codex", "pi"],
  "install": "auto",
  "instructions": { "file": "AGENTS.md" },
  "mcp": {
    "docs": { "transport": "http", "url": "https://docs.example.com/mcp" },
    "github": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${secret:GITHUB_TOKEN}" },
      "harnesses": ["claude", "codex"]
    }
  },
  "skills": {
    "review": { "path": "skills/review" },
    "security-audit": {
      "git": "https://github.com/cloudflare/security-audit-skill",
      "subdir": "skills/security-audit",
      "ref": "main"
    }
  },
  "settings": {
    "pi": { "defaultModel": "claude-opus-5-5", "packages": ["npm:pi-claude-bridge"] },
    "claude": { "permissions": { "defaultMode": "auto" } }
  },
  "files": [{ "root": "home", "target": ".npmrc", "source": "files/npmrc", "template": true }],
  "secrets": {
    "GITHUB_TOKEN": { "from": "keychain", "service": "ade", "account": "github" },
    "NPM_TOKEN": { "from": "env", "name": "NPM_TOKEN" }
  }
}
```

## Top-level fields

| Field | Use |
|---|---|
| `version` | Always `1` |
| `name`, `description` | Labels for people |
| `harnesses` | The target harnesses. Without it, ade targets the harnesses that it finds in the home |
| `install` | `link`, `copy`, or `auto`. `auto` links on macOS and Linux and copies on Windows |
| `instructions` | The global instructions file, and an optional `harnesses` list |
| `mcp` | MCP servers by name |
| `skills` | Skills by name |
| `settings` | Settings patches by harness and file |
| `files` | Other files |
| `secrets` | Secret sources by name |

## MCP servers

| Field | Use |
|---|---|
| `transport` | `stdio` or `http` |
| `command`, `args`, `env`, `cwd` | The process of a `stdio` server |
| `url`, `headers` | The endpoint of an `http` server |
| `description` | Used by harnesses that support it, such as Pi |
| `enabled` | `false` disables the server. ade removes it from harnesses that have no enabled flag |
| `harnesses` | Limit the server to these harnesses |
| `overrides` | Native keys for one harness, merged into its entry as a JSON merge patch. A `null` value removes a key |

Example of an override: `"overrides": { "codex": { "startup_timeout_sec": 30 } }`. `ade capture` writes overrides for native keys that the common fields do not cover.

## Skills

A skill has one of three sources:

| Source | Fields | Result |
|---|---|---|
| Path | `path` | A copy of the profile directory in `~/.agents/skills/<name>` |
| Git | `git`, `ref`, `subdir` | A copy of the locked commit. Run `ade update` to lock a new commit in `ade.lock.json` |
| Link | `link` | A link to a directory on this machine, for example a checkout that you edit |

Codex, Cursor, Grok, and Pi read `~/.agents/skills` directly. Claude Code gets a link in `~/.claude/skills`, or a copy in copy mode. Add `harnesses` to limit the Claude Code link. `ade capture` records a skill installed by `npx skills` with its Git origin.

## Settings

A settings key is a harness name, or a harness name, a colon, and a JSON or TOML file in the harness home:

| Key | File |
|---|---|
| `claude` | `~/.claude/settings.json` |
| `codex` | `~/.codex/config.toml` |
| `cursor` | `~/.cursor/cli-config.json` |
| `grok` | `~/.grok/config.toml` |
| `pi` | `~/.pi/agent/settings.json` |
| `pi:claude-bridge.json` | `~/.pi/agent/claude-bridge.json` |

ade manages each leaf value of a patch as one entry. Objects merge. Arrays and scalars replace. A `null` leaf deletes the key. Put MCP servers in the `mcp` section, not in settings.

## Files

| Field | Use |
|---|---|
| `root` | `home` or a harness name |
| `target` | The path under the root |
| `source` | The path in the profile |
| `template` | `true` replaces secret and home references. A file with a secret gets mode 600 |
| `mode` | An octal file mode, for example `600` |

## References in values

| Reference | Value at apply time |
|---|---|
| `${secret:NAME}` | The value of the declared secret `NAME` |
| `${home}` | The target home directory |
| `$${` | A literal `${` |

Other `${VARIABLE}` text stays as it is, so harnesses that expand environment variables still see it.

## Secrets

| Source | Fields |
|---|---|
| `env` | `name`: the environment variable |
| `file` | `path`: a file, with `~` or `${home}` |
| `command` | `argv`: a command that prints the value. ade runs it without a shell |
| `keychain` | `service`, `account`: a macOS Keychain item |

ade never writes a resolved secret into the profile, the state file, or command output. The harness files that need a secret get mode 600 when ade creates them.

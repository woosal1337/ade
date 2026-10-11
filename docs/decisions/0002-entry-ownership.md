# 0002: Entry ownership, drift, and the shared store

Date: 2026-10-11

Status: Accepted for version 0.1.0.

## Context

Harness configuration files hold more than the user's setup. `~/.claude.json` holds counters, caches, and account data next to the MCP servers. A tool that rewrites whole files loses that data. Harnesses and their own CLIs also edit the same files, so a sync tool must notice changes that it did not make.

## Decision

1. ade owns entries, not files. An entry is one MCP server, one settings leaf, one skill path, one instructions path, or one extra file. Each entry has a stable key, such as `mcp:claude:elliptic` or `setting:pi:/defaultModel`.
2. The state file records one content hash for each entry that ade applied. The plan compares the desired value, the current value, and the recorded hash:

   | Current equals desired | Current equals recorded | Result |
   |---|---|---|
   | Yes | Any | In sync. A missing record becomes a new record |
   | No | Yes, or no record | Create, update, or delete |
   | No | No | Drift. Apply stops until `--force` |

3. ade deletes an entry that left the profile only if the entry still has its recorded hash. Otherwise ade leaves it in place and stops managing it.
4. Each apply writes an apply record with backups. A file write is atomic. A failed apply rolls back its finished writes. A revert restores entries, not whole documents, so other changes in the same file stay.
5. A shared store in `~/.agents` holds the skill copies and the instructions copy. Codex, Cursor, Grok, and Pi read `~/.agents/skills` directly. Harness entries link to the store on macOS and Linux and copy it on Windows.
6. A settings file behind a link gets the write at its real path. The link stays.

## Alternatives

- Rewrite whole files from the profile. This loses harness data and user keys.
- Merge with three-way text merges. This needs a base copy of each file and gives conflicts that a person must read.
- Overwrite drift without a stop. This hides user edits.

## Consequences

- A first apply after `ade capture` writes nothing. It only records the entries.
- `ade status` shows drift for each entry.
- TOML documents lose comments when ade writes them. The plan warns before the write.
- The apply records hold old file content. They can hold secrets, so the state directory uses mode 700.

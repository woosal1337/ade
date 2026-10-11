---
ade: 1
name: "starter"
description: "A small public ade profile: global rules, one skill, and one documentation MCP server."
generator: "ade 0.1.0"
created: "2026-10-11T22:39:38.894Z"
source: "woosal1337/ade/examples/single-file"
harnesses: []
secrets: []
files: 3
digest: "sha256:9c54b436913363d5cdc2f730e949275e4b6ef06635a2a862264fb145fe7071a4"
---

# starter

A small public ade profile: global rules, one skill, and one documentation MCP server.

## Use this setup

1. Install ade. It needs Node.js 22 or later:

   ```bash
   npm install -g github:woosal1337/ade
   ```

2. Show the changes for your machine. The plan writes nothing:

   ```bash
   ade plan woosal1337/ade/examples/single-file
   ```

3. Apply the setup. ade asks you to trust the source first:

   ```bash
   ade apply woosal1337/ade/examples/single-file
   ```

Without ade, one command installs it and runs the plan and the apply:

| Platform | Command |
|---|---|
| macOS and Linux | `curl -fsSL https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.sh \| sh -s -- woosal1337/ade/examples/single-file` |
| Windows | `$env:ADE_SOURCE = "woosal1337/ade/examples/single-file"; irm https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.ps1 \| iex` |

## What this setup does

| | Area | Item |
|---|---|---|
|  | harness | targets the installed harnesses |
|  | instructions | replaces the global instructions of the target harnesses |
|  | mcp | context7 connects to https://mcp.context7.com/mcp |
|  | skill | instructions for agents: write-commit |

Items with ! run programs, write files, read secrets, or change permissions.

## Secrets

This setup needs no secrets.

## Contents

| Kind | Entries |
|---|---|
| Harnesses | the harnesses on each machine |
| Instructions | `AGENTS.md` |
| MCP servers | `context7 (http)` |
| Skills | `write-commit` |
| Settings | none |
| Plugins | none |
| Files | none |
| Patches | none |

## Files

ade writes this section. Do not edit it by hand. Run `ade share` again after a change to the profile.

### `AGENTS.md`

```markdown ade-file path="AGENTS.md" sha256="1d3380f826e28b1f018b34c27c7d9fecc90a7ee454e781d3a44354630364ec30"
# Global agent rules

1. Read the project README and its agent guidance before a change.
2. Make the smallest change that meets the request.
3. Run the project checks before you report a change as done.
4. Report what you ran and what failed. Do not hide a failure.
5. Never print a secret in chat, logs, or commits.
```

### `ade.json`

```json ade-file path="ade.json" sha256="e64750968dd4d5792e4bd771b579edbd817955bfe65bc6c0725aae9199dc3586"
{
  "version": 1,
  "name": "starter",
  "description": "A small public ade profile: global rules, one skill, and one documentation MCP server.",
  "install": "auto",
  "instructions": {
    "file": "AGENTS.md"
  },
  "mcp": {
    "context7": {
      "transport": "http",
      "url": "https://mcp.context7.com/mcp",
      "description": "Current library documentation"
    }
  },
  "skills": {
    "write-commit": {
      "path": "skills/write-commit"
    }
  }
}
```

### `skills/write-commit/SKILL.md`

```markdown ade-file path="skills/write-commit/SKILL.md" sha256="d628dc9134c6bd572b2c73fd4af9392e2c79695cca7560739921fac8bcdda990"
---
name: write-commit
description: Write a focused Git commit message for the staged changes. Use when the user asks for a commit message or a commit.
---

# Write a commit message

1. Run `git diff --cached` to read the staged changes.
2. Write a title in the imperative mood, at most 72 characters.
3. Add a body only when the reason is not clear from the title.
4. Keep one change per commit. Ask before you split staged work.
```

# The ADE.md standard

ADE.md is one Markdown file that holds a complete agent development environment. A person reads it on GitHub. ade imports it 1:1. Put it at the root of any repository, next to the README.

Version: 1. Date: 2026-10-12.

## Use an ADE.md

1. Show the changes for your machine:

   ```bash
   ade plan <owner>/<repo>
   ```

2. Apply the setup. ade shows what the setup runs and writes, and asks you to trust the source:

   ```bash
   ade apply <owner>/<repo>
   ```

A local file also works: `ade plan ./ADE.md`. Without ade on the machine, use the install scripts in [Install scripts](#install-scripts).

## Write an ADE.md

1. Write the file from your profile:

   ```bash
   ade share --profile ~/agent-profile --repo <owner>/<repo>
   ```

2. Read the warnings. `ade share` refuses a value that looks like a token or a private key.
3. Read the file, and remove anything that you do not want to share.
4. Commit `ADE.md` to the repository.

Run `ade share` again after each change to the profile. Do not edit the file blocks by hand. `ade verify ADE.md` fails on a hand edit.

## Layout

An ADE.md has three parts, in this order:

| Part | Content | Owner |
|---|---|---|
| Front matter | Machine metadata between two `---` lines | ade |
| Human sections | The use steps, the trust summary, the secrets, and the contents | ade. A person can read them |
| File blocks | Every file of the profile, one fenced block each, under `## Files` | ade |

ade writes all three parts. When ade imports the file, it reads only the front matter and the file blocks. The human sections describe the profile. They do not change it.

## Front matter

```yaml
---
ade: 1
name: "team"
description: "Global rules, one skill, and one documentation MCP server."
generator: "ade 0.1.0"
created: "2026-10-12T09:00:00.000Z"
source: "acme/agents"
harnesses: ["claude", "pi"]
secrets: ["GITHUB_TOKEN"]
files: 5
digest: "sha256:4f1c..."
---
```

| Field | Required | Meaning |
|---|---|---|
| `ade` | Yes | The format version. Version 1 is this document |
| `name`, `description` | No | Labels for people |
| `generator` | No | The ade version that wrote the file |
| `created` | No | The time of the write, in UTC |
| `source` | No | The source that the use steps name, for example `acme/agents` |
| `harnesses` | No | The target harnesses, or `[]` for the harnesses on each machine |
| `secrets` | No | The names of the secrets that the profile needs |
| `files` | Yes | The number of file blocks |
| `digest` | Yes | The digest of all file blocks |

Each value is JSON: a quoted string, a number, or a list. A reader that does not know a field ignores it.

## File blocks

Each file block is a fenced code block with the `ade-file` word in its info string:

````markdown
### `skills/review/SKILL.md`

```markdown ade-file path="skills/review/SKILL.md" sha256="9b1e..."
---
name: review
description: Review a change before a merge.
---
```
````

| Attribute | Required | Meaning |
|---|---|---|
| `path` | Yes | The relative path in the profile, with `/` separators |
| `sha256` | Yes | The SHA-256 hash of the file bytes, in lowercase hex |
| `encoding` | No | `utf8` or `base64`. The default is `utf8` |
| `eol` | No | `none` when the file has no final newline |
| `mode` | No | `755` for an executable file |

Rules for a writer:

1. Use a fence of backticks that is longer than the longest backtick run in the content, and at least 3.
2. Write the content between the fences. Write `base64` for a file with a zero byte, a carriage return, or bytes that are not UTF-8.
3. Write the closing fence with the same length as the opening fence.
4. Sort the blocks by path. One file named `ade.json` is required.

Rules for a reader:

1. Take the lines between the opening fence and the next line that is the same fence.
2. Join the lines with a line feed. Add a final line feed unless `eol="none"` is set.
3. Decode `base64` content.
4. Compare the SHA-256 hash of the bytes with `sha256`. A difference is an error.
5. Reject a path that is absolute, that has `..`, or that has a backslash.

## Digest

The digest is the SHA-256 hash of one line for each file block, sorted by path:

```text
<path> <sha256>\n
```

`ade verify` compares the digest and the `files` count with the file blocks. A difference is an error.

## Sources

Every command that reads a profile accepts an ADE.md:

| Source | Example |
|---|---|
| A local file | `./ADE.md`, `~/Downloads/ADE.md` |
| A folder with an ADE.md and no `ade.json` | `./team` |
| A Git repository with an ADE.md at its root | `acme/agents` |
| An ADE.md in a subfolder of a repository | `acme/agents/profiles/work` or `acme/agents/profiles/work/ADE.md` |

A folder with both files uses `ade.json`. A Git source needs trust before its first apply. Read [the sources guide](sources.md).

## Install scripts

The ade repository has two scripts that install ade and then run `ade plan` and `ade apply` for a source:

| Platform | Command |
|---|---|
| macOS and Linux | `curl -fsSL https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.sh \| sh -s -- <owner>/<repo>` |
| Windows | `$env:ADE_SOURCE = "<owner>/<repo>"; irm https://raw.githubusercontent.com/woosal1337/ade/main/scripts/install.ps1 \| iex` |

The scripts need Node.js 22 or later. They install the npm package in `ADE_PACKAGE`. The default is the ade repository on GitHub. The apply step asks for trust and confirmation, as a normal `ade apply` does.

## Check an ADE.md in CI

```yaml
- run: npx -y github:woosal1337/ade verify ADE.md
```

`ade verify` checks the digest, each file hash, the profile schema, and the token scan. It prints the trust summary. It exits with code 1 on an error.

# Security model

ade writes the setup of coding agents on your machine. A setup can start programs, change files, and send secrets to servers. This page states what ade protects and what it does not protect.

## Sources and trust

| Source | Example | Trust |
|---|---|---|
| Your profile folder | `~/.config/ade`, `./team` | No prompt. ade treats it as your own work |
| Git source | `acme/agents`, `https://git.example.com/team/agents.git` | A prompt before the first import or apply |
| Shared file | `~/Downloads/ADE.md`, `bundle.json` | A prompt before the first import or apply |

1. Before trust, ade shows a summary of the source. Items with `!` run programs, write files, read secrets, or change permissions.
2. You type `yes`, or you add `--trust`. ade records a hash of each entry that it writes or runs.
3. A new commit or a new file stays trusted only when each entry hash is equal. Any changed entry needs trust again, and ade lists the changed entries.
4. `ade trust <source> --remove` removes the trust. It does not undo an apply. Use `ade revert` for that.

A trusted profile can run programs as you. MCP servers, hooks, plugins, patches, and secret commands all run with your rights. Trust a source only when you would run its code.

## Before trust

`ade plan`, `ade status`, and `ade doctor` of an untrusted source do these things:

- They fetch the source and its Git skills with Git.
- They run `git apply --check` for patches and read the plugin lists of the harness CLIs.
- They use placeholder values for secrets. They run no secret command, and they read no secret file and no Keychain item.

ade refuses a shared profile that links a file or a skill to a local path, or that fetches a skill from a local repository.

## Git

- ade passes `--` before each URL and ref, and it refuses values that Git can read as an option.
- A ref matches only `HEAD`, `refs/heads/<ref>`, or `refs/tags/<ref>`. A ref that names both a branch and a tag fails.
- The cache key of a tree holds the repository URL and the commit.
- ade checks out trees with `core.symlinks=false`, so Git writes a symbolic link as a plain file with the link text. A source or skill folder that is itself a symbolic link fails.
- The cache folder has mode 700.

## Secrets

- A profile stores `${secret:NAME}` references. A secret comes from the environment, a file, a command, or the macOS Keychain.
- `ade capture` replaces values that look like secrets with references. It skips files with credential names, such as `.env` or `*.pem`, and extra files that hold a token.
- `ade share`, `ade pack`, and `ade verify` refuse values that look like tokens or private keys.
- Plan output masks each secret value before it cuts the text.
- ade gives mode 600 to a file that gets a secret, unless a file entry sets another mode.
- The state folder has mode 700. It holds the backups and the apply records. An apply record keeps the old value of each key that ade changed.

## Terminal output

In text output, ade escapes control characters. Profile text and remote output cannot move the cursor, clear the screen, or hide text. JSON output escapes them by the JSON rules.

## Remote machines

`ade remote` runs `ssh` with your SSH configuration. It sends the engine and the profile on standard input. It sends secret values only with `--send-secrets`. ade checks the envelope of each remote result before it uses it.

## Limits

- ade does not control what a harness does with its configuration after the write.
- The SDK functions do not check trust. A host app must call `checkTrust` and show `riskSummary` before an apply. Read [the SDK guide](sdk.md).
- On Windows, ade does not set POSIX file modes.
- The install scripts install the newest commit of the ade repository. Set `ADE_PACKAGE` to a tag to pin a version.

## Audit

The maintainer audited the source on 2026-10-12 with the [security-audit skill](https://github.com/cloudflare/security-audit-skill). The audit found 18 problems in the trust gate, the path checks, and the secret handling. Version 0.1.0 fixes all of them, and each fix has a regression test in `test/hardening.test.ts` or `test/sources.test.ts`.

Report a new problem through [SECURITY.md](../SECURITY.md).

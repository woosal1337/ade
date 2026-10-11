# 0006: ADE.md, one Markdown file for a shared setup

Date: 2026-10-12

Status: Accepted for version 0.1.0.

## Context

Users want to put their setup in any repository, next to their code, and let others copy it 1:1. A profile folder holds `ade.json`, skills, and files. It works, but it adds a folder tree to a repository and a reader cannot see the setup in one place. A JSON bundle holds everything in one file, but people cannot read it.

## Decision

1. ADE.md is the shared format. It is Markdown, so GitHub shows it as a page.
2. The file starts with JSON values in YAML front matter. A reader needs no YAML parser.
3. ade writes the human sections: the use steps, the trust summary, the secret names, and the contents. Import ignores them.
4. Each profile file is one fenced code block with the `ade-file` word, a path, and a SHA-256 hash. The fence is longer than any backtick run in the content.
5. The front matter holds the file count and a digest of the sorted paths and hashes. A hand edit fails `ade verify` and every import.
6. A file with a zero byte, a carriage return, or bytes that are not UTF-8 uses base64. A file without a final newline sets `eol="none"`.
7. Every source command reads ADE.md: a local file, a folder, or a Git repository.
8. `ade share` refuses token values, and writes a byte-identical file when the profile did not change.
9. Two install scripts install ade with npm and run the plan and the apply for a source.

## Alternatives

- Parse the human sections. A person could edit the setup in Markdown, but a typo would change the setup without a check.
- Use a ZIP or tar file. Git shows no diff, and GitHub shows no page.
- Use the `files` of a Git repository with no index file. A reader cannot see the setup in one place, and ade cannot check the content.

## Consequences

- A user edits the profile folder, not the ADE.md, then runs `ade share` again.
- A large binary file makes a large ADE.md. Skills and configs are text, so most files stay small. A capture of one Mac gave 74 files in 694 KB.
- The install scripts need Node.js 22 and access to the npm package in `ADE_PACKAGE`.
